# CouchDB → PostgreSQL writeback: per-table conflict policy

This document describes how the platform resolves conflicts when an offline
CouchDB document is replayed into the national analytics PostgreSQL store, and
what residual risks remain.

## Why this matters

The clinical edge runs offline-first on CouchDB. A single row's history can
look like this:

1. Clinician A drafts a lab order on a tablet at 09:00.
2. Clinician B finalizes the same order on a different tablet at 11:00.
3. Tablet A only reaches the network at 13:00 and sends its 09:00 snapshot.

If the writeback applies the 13:00-arriving 09:00 snapshot last, the
finalized record is silently rolled back to a draft. The same shape of
problem applies to demographics (a stale push erasing a clinician's note),
audit log (a duplicate replay overwriting a write the user actually made),
and disease-surveillance status (a closed alert reopened by an old doc).

A naive `INSERT … ON CONFLICT (id) DO UPDATE SET …` is wrong for every one
of these. We resolve conflicts per table, with a small typed enum.

## The three policies

Defined in [`lib/db/postgres.ts`](../../src/lib/db/postgres.ts) as the
`ConflictPolicy` value object and the `TABLE_CONFLICT_POLICY` map.

### `LAST_WRITE_WINS`

```
INSERT INTO <table> (...) VALUES (...)
ON CONFLICT (id) DO UPDATE SET ...
```

The default. Used when each push from a client carries the entire current
state of the row and there is no clinical-grade status to roll back — or
when the underlying workflow can legitimately re-open a row that looks
"finalized" (e.g. a problem gets un-resolved, a lost-to-follow-up
enrollment resumes), which rules out `CLINICAL_FINALIZED`'s terminal-status
guard.

30 tables carry this policy today:

| Table | Why |
|---|---|
| `patients` | Demographics; latest snapshot is the source of truth. (A future `MERGE_NOTES` policy variant will protect narrative columns.) |
| `hospitals`, `organizations`, `facility_assessments` | Reference data + assessment scores. |
| `sync_metadata` | Bookkeeping for the sync runner itself. |
| `immunizations`, `anc_visits` | Each row is its own visit; no terminal status semantic. |
| `problems`, `follow_ups`, `program_enrollments` | Status can legitimately re-open (a problem un-resolves, a follow-up plan gets updated after "completed", an enrollment resumes after lapsing) — `CLINICAL_FINALIZED` would wrongly block that. |
| `messages` | Canonical doc lives in CouchDB and is rarely edited after send; no rollback risk. |
| `pharmacy_inventory`, `wards`, `nutrition_screenings`, `blood_bank`, `assets`, `staff_schedules`, `leave_requests`, `payroll_entries`, `patient_feedback`, `emergency_plans`, `fee_schedule`, `insurance_policies`, `eligibility_checks`, `payment_plans` | Mutable lookup / state snapshots — latest push wins. |

`beds`, `admissions`, `prescriptions`, and `shift_handoff` documents are not
safe state snapshots. A losing revision can double-book a bed, reopen/erase an
admission disposition, lose a medication administration, or erase receipt of a
handoff. Browser replication therefore places their CouchDB conflicts in the
high-risk reconciliation queue; they must not be silently auto-resolved.
| `payments`, `refunds`, `adjustments` | Financial transactions identified one-row-per-transaction; a correction is a new row, not a rewrite of an old one. |

`boma_visits` used to carry this policy but the table itself was dropped —
see [migration 0007](../../src/lib/db/migrations/0007_drop_boma_visits.sql)
— and no longer appears in `TABLE_CONFLICT_POLICY` or `ALLOWED_TABLES`.

### `APPEND_ONLY`

```
INSERT INTO audit_log (...) VALUES (...)
ON CONFLICT (id) DO NOTHING
```

| Table | Why |
|---|---|
| `audit_log` | An audit row is immutable once written. If the same `id` arrives twice from the sync feed the second is a duplicate to be silently dropped, never an overwrite. Compromising the audit log defeats the rest of the platform's incident-response posture. |
| `controlled_substance_log` | Regulatory chain of custody for controlled substances — identical reasoning to `audit_log`. |
| `ledger_entries` | Append-only patient financial ledger; a correction is a new reversing entry, never a rewrite of an old one. |

### `CLINICAL_FINALIZED`

```
INSERT INTO <table> (...) VALUES (...)
ON CONFLICT (id) DO UPDATE SET ...
WHERE (
  <table>.status IS NULL OR
  <table>.status NOT IN ('closed','resolved','cancelled','finalized')
) AND (
  $<updated_at>::timestamptz >=
  COALESCE(<table>.updated_at, '1970-01-01'::timestamptz)
)
```

Two guards, but the first only fires for tables that actually have a
`status` column:

- The existing row is not in a terminal status (`closed`/`resolved`/
  `cancelled`/`finalized`) — emitted only for `lab_results`, `referrals`,
  `disease_alerts`, `prescriptions`, `immunizations`.
- The incoming `updated_at` is monotonic — a 09:00 snapshot cannot overwrite
  an 11:00 one regardless of when it arrives. Emitted for every
  `CLINICAL_FINALIZED` table.

14 tables carry this policy today:

| Table | Why | Status guard? |
|---|---|---|
| `medical_records` | Encounter notes. Older snapshot must not erase a newer one. | No status column — `updated_at` guard only. |
| `lab_results` | Once `status='resolved'` the result is signed off. | Yes. |
| `prescriptions` | Once `status='cancelled'` the order must not silently un-cancel. | Yes. |
| `births`, `deaths` | CRVS records. The certificate number is part of an external register; the row must not silently downgrade. | No status column — `updated_at` guard only. |
| `referrals` | Once `status='closed'` the referral has been actioned. | Yes. |
| `disease_alerts` | Once `status='resolved'` an outbreak should not silently re-open. | Yes. |
| `triage_events` | Once discharged/admitted/referred it should not re-open. | No — its status vocabulary (`admitted`/`discharged`/…) doesn't match the shared terminal-status set, so only the `updated_at` guard applies. |
| `appointments` | Once completed/cancelled/no_show it should not roll back to scheduled. | No — same reason as `triage_events`. |
| `telehealth_sessions` | Once completed/cancelled/no_show it should not roll back. | No — same reason. |
| `billing`, `charges`, `claims`, `invoices` | Revenue-cycle rows that close when paid/cancelled/voided/denied. | No — those values aren't in the shared terminal-status set, so only the `updated_at` guard applies; still correct, since a stale snapshot still can't overwrite a fresher row. |

So in practice only five tables (`lab_results`, `referrals`,
`disease_alerts`, `prescriptions`, and `immunizations` — though
`immunizations` itself is `LAST_WRITE_WINS`, not `CLINICAL_FINALIZED`) ever
get the terminal-status half of the guard; every `CLINICAL_FINALIZED` table
gets the `updated_at` half. See `TABLES_WITH_STATUS_COLUMN` in
[`lib/db/postgres.ts`](../../src/lib/db/postgres.ts) for the authoritative
list.

The `updated_at` guard relies on a covering index — see [migration
0002](../../src/lib/db/migrations/0002_finalized_status_index.sql) — so the
per-change writeback latency stays flat as the tables grow.

## What this does *not* defend against

- **A genuinely newer doc with a worse status transition.** If clinician B
  legitimately reverts a finalized lab result by issuing a fresher doc that
  resets `status` to `pending`, the policy treats that as the new truth. The
  guard is against stale or replayed snapshots, not against a clinician with
  a pen.
- **Field-level merge.** The current `LAST_WRITE_WINS` for `patients` still
  overwrites every column. A planned follow-up adds a `MERGE_NOTES` variant
  that uses `COALESCE(EXCLUDED.note, patients.note)` so a server push that
  omits the notes column does not blank it.
- **Clock skew between edge devices.** The `updated_at` guard assumes
  reasonably-synchronised tablet clocks. Severe skew (>1 hour) can let a
  stale snapshot win. The mitigation is at the device layer — NTP /
  CouchDB-side timestamping.
- **An attacker forging the writeback feed.** Out of scope for this
  document. The webhook is authenticated by
  [`verifySyncMachineRequest`](../../src/lib/sync-auth.ts) — an HMAC-SHA-256
  signature over `timestamp\nnonce\nMETHOD\npathname\nbody`, checked with
  `crypto.timingSafeEqual`, plus a ±300s timestamp-freshness window and a
  single-use nonce (reserved in Upstash, or an in-memory map outside
  production) to stop replay. In production without Upstash configured, the
  route refuses the request (503) rather than allowing an unprotected
  replay window. See [`/api/sync` route](../../src/app/api/sync/route.ts)
  for where it's wired in.

## Not to be confused with: CouchDB/PouchDB document-revision conflicts

This document is only about the CouchDB→Postgres analytics writeback. A
different, unrelated conflict concept exists one layer down: when
replication produces sibling revisions of the *same CouchDB document* (two
tablets editing the same record offline), PouchDB's default is
most-recent-revision-wins, which is unsafe for a handful of high-risk
clinical fields.

That's handled by a separate subsystem:

- [`lib/services/conflict-service.ts`](../../src/lib/services/conflict-service.ts)
  — a `tamamhealth_conflict_queue` DB with risk tiering
  (`HIGH_RISK_RESOURCES`: allergy, referral, discharge, medication_allergy,
  adverse_event; `MEDIUM_RISK_RESOURCES`: prescription, medication,
  problem_list, diagnosis).
- Detection is wired into pull replication in
  [`lib/sync/sync-service.ts`](../../src/lib/sync/sync-service.ts)
  (`surfaceHighRiskConflicts` inspects `_conflicts` on newly-landed docs and
  queues only the high-risk types; low/medium fall through to PouchDB's
  default).
- `CONFLICT_RESOLUTION_ROLES` in
  [`lib/permissions.ts`](../../src/lib/permissions.ts) gates who can act on
  the queue (`super_admin`, `org_admin`, `medical_superintendent`, `hrio`)
  at `/admin/conflicts` (UI) and `/api/admin/conflicts[/id]` (API).

If you're looking for "what happens when two tablets edit the same patient
offline," that's the doc to write — it doesn't exist yet.

## What the operator must do

- Run migration `0002` before deploying the new conflict policy. The runner
  in [`lib/db/migrate.ts`](../../src/lib/db/migrate.ts) applies it
  automatically at boot, but the indexes can be slow to build on a populated
  database — schedule the deploy during a low-write window if the analytics
  store is large.
- When adding a new clinical table, decide its policy at the same time it is
  added to `ALLOWED_TABLES` (a module-private allowlist local to
  [`lib/db/postgres.ts`](../../src/lib/db/postgres.ts) — there is no
  separate exported list to update elsewhere). The runtime will refuse to
  upsert into a table that has no entry in `TABLE_CONFLICT_POLICY` — see
  `assertPolicyForTable` — fail-fast is intentional and a missing policy
  must not silently degrade to last-write-wins.

## Tests

There is currently no dedicated test file for this dispatch logic — a real
coverage gap, not just a doc-freshness issue. `buildUpsertSql`,
`TABLE_CONFLICT_POLICY`, `assertSafeTable`, and `upsertDocument` have no
test coverage anywhere in `src/__tests__`. Worth writing:

- A `buildUpsertSql` unit test asserting the SQL shape per policy —
  `DO NOTHING` for `APPEND_ONLY`, the WHERE-clause guard (with and without
  the status-terminal half) for `CLINICAL_FINALIZED`, and the plain
  `DO UPDATE SET` for `LAST_WRITE_WINS`.
- An identifier-allowlist test confirming `assertSafeTable`/
  `assertSafeColumn` reject unknown tables and poisoned column names.
