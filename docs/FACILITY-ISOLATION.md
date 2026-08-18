# Facility PHI isolation

Status: **partially implemented.** Read this before assuming the boundary holds.

## The problem

Facility-level PHI separation was enforced entirely on the client. Replication
used a JavaScript `filter` function running in the browser, and that function
constrained `orgId` only — there was **no facility condition at all**. Every
user in an organisation therefore replicated every facility's PHI onto their
device, and `filterByScope` hid it at render time.

The UI hid it. The data was present. Anyone able to read the device's local
database — a stolen phone, a shared workstation, browser devtools — could read
patients from facilities the user had no right to see.

## What has changed

The browser-side filter is gone. Replication now sends a CouchDB **selector**,
built by `src/lib/sync/facility-entitlements.ts`, which CouchDB evaluates
**server-side** on the `_changes` feed. Documents outside the user's
entitlement are never sent and never reach the local replica.

Entitlement is derived from the user:

- Roles in `MULTI_FACILITY_ROLES` (super admin, org admin, medical
  superintendent, hospital manager, county health director, government) get
  org-wide access.
- Everyone else gets their home facility, plus any explicit grants.
- A user with **no** facility gets no facility documents at all. This is
  fail-closed on purpose: an unknown facility must not fall through to
  "everything".
- Documents with no `hospitalId` (reference data, configuration, organisation
  records) always replicate. They are not facility PHI, and excluding them
  breaks every screen.

This closes the threat the ticket describes. A facility-scoped user's device no
longer holds other facilities' patients.

## What has NOT changed — read this part

**A selector is not an authorization boundary.**

CouchDB has no per-document read ACL. The selector is supplied *by the client*,
so an authenticated user who modifies the client — or who talks to CouchDB
directly with their own credentials — can request everything the database
holds. The selector controls what an honest client receives. It does not
control what a dishonest one can ask for.

The only true read boundary in CouchDB is **the database itself**, via its
`_security` object. Reaching full isolation therefore requires partitioning
data into per-facility databases.

Concretely, the current state is:

| Threat | Covered? |
| --- | --- |
| Lost/stolen device; local replica inspected | **Yes** — the data is no longer there |
| Curious user reading another facility in the UI | Yes (also `filterByScope`) |
| Authenticated user issuing their own CouchDB request | **No** |
| Authenticated user editing client code to widen the selector | **No** |

## Migration path to true isolation

1. **Add explicit entitlement storage.** There is no per-user multi-facility
   grant field on the user record today, so cross-facility access is
   role-derived only. Add `facilityIds` to `UserDoc` and a screen to manage it.
   `entitlementFor()` already reads the field, so this is a data change rather
   than another pass over the replication path.

2. **Provision one database per facility** for PHI-bearing document types
   (`patient`, `medical_record`, `lab_result`, `prescription`, `triage`,
   `clinical_encounter`, …). Naming: `tamamhealth_<type>_<facilityId>`.

3. **Set `_security` per database** so `members.roles` contains
   `facility:<facilityId>`. Provision that role on each CouchDB user alongside
   the existing `role:<name>` and `org:<orgId>` roles.

   > **Status:** the role-provisioning half is already live — `couch-auth.ts`
   > pushes a `facility:<hospitalId>` CouchDB role for every user with a
   > `hospitalId`. What's still outstanding is using it: no `_security`
   > object binds to a `facility:` role yet, and database naming
   > (`tenant-database.ts`) is still per-org (`tamamhealth_<type>--org-<orgId>`),
   > not per-facility.
   >
   > **Operator hazard:** provisioning the role ahead of any database
   > actually checking it is deliberate and safe. Doing it in the other
   > order — pointing `_security` at `facility:<id>` before every relevant
   > CouchDB user carries that role — fails every non-admin read at once.
   > This is the same ordering trap as the `validate_doc_update` rollout
   > (KAN-94).

4. **Route replication per facility** — the client opens one replication per
   entitled facility instead of one per document type. Multi-facility roles
   open several.

5. **Migrate existing documents** into their facility database, keyed by
   `hospitalId`. Documents with no `hospitalId` stay in the shared database.
   Run as a copy-then-verify, never a move: confirm counts per facility match
   the source before deleting anything.

6. **Re-audit `filterByScope` call sites.** After step 4 they become a
   convenience filter rather than the security boundary. Until then, they are
   still load-bearing for the threats marked "No" above and must not be
   removed.

## Verifying

`src/__tests__/security/replication-selector.test.ts` evaluates the generated
selector against documents directly, with no UI filtering applied — so a pass
means exclusion happened at the replication layer, not at render time.

To verify against a real deployment: sign in as a facility-scoped user, then
inspect the local database in devtools (Application → IndexedDB →
`_pouch_tamamhealth_patients`). Every document should carry that user's
`hospitalId` or none at all.
