# Audit logging

Every state-changing API call writes an immutable audit row. This document
covers what gets logged, how the wrapper works, what's deliberately *not*
logged, and the rotation story.

## Why this exists

The platform handles patient health information governed by
HIPAA-equivalent regimes (and, in our deployments, the South Sudan MoH's
own audit requirements). An auditor must be able to answer, for any given
record:

- **Who** touched it?
- **When**?
- **What** did they do — view, create, update, delete, export?
- **Did it succeed?** Failed-auth probes are exactly as interesting as
  successful writes.

A scattered "developer remembered to call `logAudit`" approach fails this
the moment one route forgets. Audit logging is enforced uniformly via a
decorator at the route layer.

## The decorator API

[`src/lib/audit/with-audit.ts`](../../src/lib/audit/with-audit.ts)
exports a single function:

```ts
import { withAuditLog } from '@/lib/audit/with-audit';

async function postHandler(request: NextRequest) {
  // ...real work, returns a NextResponse...
}
export const POST = withAuditLog(postHandler, { action: 'patient.create' });
```

`AuditOptions`:

| field        | type       | required | meaning                                                                    |
|--------------|------------|----------|----------------------------------------------------------------------------|
| `action`     | `string`   | yes      | Logical action name, e.g. `patient.create`, `lab.update`. See conventions. |
| `resourceId` | `function` | no       | Pulls a resource id from the request — written into the log details.       |
| `category`   | `enum`     | no       | One of `CREATE | UPDATE | DELETE | EXPORT | OTHER`. Default: from method.   |

### Naming convention

Action names are `<resource>.<verb>`, all lowercase, dot-separated. Pick
the resource off the URL path; pick the verb off the HTTP method.

| route                                | method | action                |
|--------------------------------------|--------|-----------------------|
| `/api/patients`                      | POST   | `patient.create`      |
| `/api/patients/[id]`                 | PATCH  | `patient.update`      |
| `/api/patients/[id]/archive`         | POST   | `patient.archive`     |
| `/api/lab/[id]`                      | PATCH  | `lab.update`          |
| `/api/admin/conflicts/[id]`          | POST   | `conflict.resolve`    |
| `/api/medical-records/[id]`          | DELETE | `medicalrecord.delete`|

The convention is enforced by code review, not by a regex. Adding a new
mutation route should add a new action name and follow the pattern.

## What gets logged

Every wrapped invocation writes one row to the CouchDB database
`tamamhealth_audit_log` (created lazily by [`auditLogDB()` in
`lib/db.ts`](../../src/lib/db.ts)). The row uses the
[`AuditLogDoc`](../../src/lib/db-types.ts) shape and includes:

- `action` — the configured action name.
- `userId` and `username` — pulled from `getAuthPayload(request)`. If the
  request was unauthenticated, `userId` is `undefined` and `username` is
  the literal string `'anonymous'`.
- `details` — JSON-encoded:
  ```
  { method, path, resourceId?, status, durationMs, category, error?, actualRole? }
  ```
  Only metadata. **Never** the request body. `actualRole` is only present
  when a super-admin is impersonating another role — it records the
  impersonator's real role alongside the acting identity.
- `success` — `response.status < 400`. Handler exceptions are also
  recorded as `success: false` with the original error name (not message)
  in `details.error`.
- `createdAt` / `updatedAt` — ISO timestamps at write time.

The audit write is fire-and-forget: a CouchDB outage can never fail a
real clinical write. The wrapper is wrapped in `try`/`catch` and the
underlying [`logAudit`](../../src/lib/services/audit-service.ts) function
itself swallows write errors with a `console.error`.

## What is NOT logged

- **Request bodies.** Bodies routinely contain PHI — patient names, vitals,
  ICD-10 codes, prescription text. Logging them would create a parallel,
  unredacted copy of every clinical mutation in our audit DB. The
  `details` field is metadata-only by design.
- **Response bodies.** Same reasoning, plus they're typically larger.
- **Headers.** Could leak session tokens.
- **Reads (GET / HEAD / OPTIONS).** The wrapper short-circuits on safe
  methods to avoid log spam. PHI access on a read should call
  [`logDataAccess`](../../src/lib/services/audit-service.ts) explicitly
  from the route — see `/api/medical-records` GET and `/api/reports` GET
  for examples. A more structured pair, `logPhiRead` / `logPhiSearch`,
  also exists in `audit-service.ts` and writes richer fields (`role`,
  `hospitalId`, `patientId`, `resourceType`, `resourceId`, `route`,
  `query`, `resultCount`) onto the same `AuditLogDoc` shape — several
  newer PHI-read routes use these instead of the plainer `logDataAccess`.
  `logPhiRead` covers `GET /api/patients/[id]` and every `/api/fhir/*`
  data route that returns patient data (`Patient/[id]`, `Observation`,
  `MedicationRequest`, `Encounter`, `Bundle/referral/[id]`) — each fires
  after the scope check passes, so a 403/404 never becomes a phantom
  "read" row.

The existing `audit-service.ts` already redacts via `JSON.stringify` of a
small, hand-curated `details` object. If you need to log a value, add a
field; do not pass through user-supplied input verbatim.

## Exempt routes

The wrapper is opt-in (you wrap a handler explicitly) so opting *out* is
just not wrapping. The current exempt list:

| Path                              | Why                                                                       |
|-----------------------------------|---------------------------------------------------------------------------|
| `/api/auth/login`                 | Login auditing is a separate concern — failed logins are rate-limited.    |
| `/api/auth/logout`                | Idempotent, no-op on bad input; not a clinical mutation.                  |
| `/api/auth/me`                    | Read-only.                                                                |
| `/api/demo-credentials`           | Public, unauthenticated by necessity (the sign-in page has no session yet); GET-only, and fails closed to an empty roster outside the standalone demo gate. |
| `/api/booking/*`                  | Public, unauthenticated booking requests; same rationale as login.        |
| `/api/fhir/metadata`              | Public CapabilityStatement.                                               |
| `/api/country/metadata`           | Public reference data.                                                   |
| `/api/terminology/*`              | Public reference data, no PHI.                                           |
| `/api/patient-portal/*`           | Separate JWT scheme with its own audit policy.                           |
| `/api/sync/*`                     | Already heavily logged via the sync-event outbox — would double-write.   |

`/api/auth/change-password` is not wrapped either, but it is not a gap: it
follows the same pattern as `/api/auth/login` (see below) — direct
`logAuditSafe` calls for `password_change_success` and
`password_change_failed`, because, like login, its request body carries
raw passwords that must never reach `details`.

Adding a new public/read-only route? It does not need the wrapper. Adding
a new mutation route? It does — review will not approve a `POST | PUT |
PATCH | DELETE` handler that is not wrapped, with a single documented
exception captured in this list.

**Known gaps**, surfaced here rather than silently omitted: none tracked at
present. The two routes previously listed here are both handled, just not
by the decorator:

- `/api/auth/change-password` — password changes are now audited via direct
  `logAuditSafe` calls (see above), not `withAuditLog`.
- `/api/couch/[...path]` — a raw CouchDB write proxy handling POST/PUT/DELETE
  against org-scoped databases, distinct from `/api/sync/*`. It already logs
  one `sync.gateway.write` row per proxied write (not per proxied request —
  reads and the constant pull-poll/push-replication traffic are screened out
  first) via a direct `logAuditSafe` call, for the same body-shape reason
  `withAuditLog` doesn't fit here: the proxied body is an arbitrary CouchDB
  document, not something to serialize into `details`.

If a genuinely unaudited mutation route turns up, add it here with the
same treatment: file, reason, and either a fix or an explicit exemption —
this list is kept honest by hand, not generated.

## Storage and retention

- **Storage.** The audit log lives in CouchDB database
  `tamamhealth_audit_log`. The doc shape is
  [`AuditLogDoc`](../../src/lib/db-types.ts).
- **Retention.** Currently indefinite. CouchDB compaction reclaims tombstone
  space but does not delete rows. Aging rows out (e.g. moving rows older
  than 7 years to cold storage, or vacuuming after 10) is a future ticket
  — captured in the platform roadmap, not implemented today.
- **Immutability.** Audit rows are written once and never updated.
  `getRecentAuditLogs` in `audit-service.ts` is read-only. There is no
  HTTP endpoint that mutates an audit row; deleting one would require a
  direct CouchDB admin operation, which is logged at the operating-system
  layer.

## Testing

`src/__tests__/audit/` was deleted along with ~200 other files in a large
unrelated sync-refactor commit (2026-08-07) and rebuilt 2026-08-18 — it is
not empty. It currently holds:

- [`with-audit.test.ts`](../../src/__tests__/audit/with-audit.test.ts) (15
  tests) — the `withAuditLog` decorator: one row per wrapped invocation,
  `success: false` on non-2xx/thrown handlers, identity flow-through with
  anonymous fallback, logging failures never surfacing to the caller, and
  safe-method (GET/HEAD/OPTIONS) bypass.
- [`get-recent-audit-logs-scope.test.ts`](../../src/__tests__/audit/get-recent-audit-logs-scope.test.ts) —
  `getRecentAuditLogs`'s `DataScope` parameter: fails closed with no scope,
  `super_admin`/`government` see every org unscoped, every other role is
  filtered to its own org and never sees a row with no determinable
  tenant.

Route-level PHI-read auditing (`logPhiRead` on `/api/patients/[id]` and the
`/api/fhir/*` data routes) is covered by
[`src/__tests__/api/phi-read-audit.test.ts`](../../src/__tests__/api/phi-read-audit.test.ts):
each route emits exactly one `logPhiRead` call on a successful read and
none on a 403/404 denial.
