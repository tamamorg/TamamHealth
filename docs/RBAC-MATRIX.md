# TamamHealth — Role-Based Access Control (RBAC) Matrix

_Last updated: August 2026. Source of truth: `platform/src/lib/role-routes.ts` (route gating),
`platform/src/lib/permissions.ts` (navigation), `platform/src/lib/hooks/usePermissions.ts`
(capabilities). This document is a human-readable summary — code wins if they ever disagree._

The design principle is **strict least privilege grounded in real-world scope of practice**:
each role gets only the features its real job justifies. Clinicians don't handle money,
non-clinicians don't author clinical/vital records, and oversight roles see aggregates rather
than individual patient records.

## Roles at a glance (25 total)

Every role below exists in the `UserRole` union in `platform/src/lib/db-types.ts`.
Capability cells verified against code 2026-07-27 (KAN-120, KAN-121); the 25-role roster
re-checked against `UserRole` and `ROLE_PERMISSIONS` on 2026-08-18 and still matches.

**Clinical:** doctor, clinical_officer, clinician, nurse, midwife, medical_superintendent,
nutritionist, radiologist
**Diagnostics & pharmacy:** lab_tech, pharmacist
**Front office & finance:** front_desk, cashier, medical_biller
**Clinical-flow workstations:** central_registration_clerk, clinic_clerk, triage_nurse,
rooming_nurse, records_hmis_officer
**Records & data:** hrio, data_entry_clerk
**Oversight / government:** county_health_director, government, hospital_manager
**Administration:** super_admin, org_admin

> **Removed from this document, not from the product backlog.** `boma_health_worker`,
> `community_health_volunteer` and `payam_supervisor` were listed here but have never
> existed in `UserRole`, so nothing could hold them and no guard could grant them
> anything. The community-health tier they belonged to was deleted from the platform on
> 2026-06-15 (commit `9c6f26e5`, plus migration `0007_drop_boma_visits.sql`). Documenting
> permissions for roles that cannot be assigned is worse than omitting them: it reads as
> an access-control statement while granting nothing, and an auditor reviewing this matrix
> would believe community workers had scoped access they do not have. If the BHW/CHV tier
> returns, add the roles to `UserRole` first and re-derive this table from the code.

## Capability matrix (key permissions)

| Role | Consult/ Prescribe | Dispense | Enter lab results | Vital events (birth/death) | Collect payments | Manage claims | DHIS2 export | Patient records |
|------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| doctor | ✅ | — | — | ✅ | — | — | — | ✅ RW |
| clinical_officer | ✅ | — | — | ✅ | — | — | — | ✅ RW |
| nurse | — | — | — | ✅ | — | — | — | ✅ RW |
| **midwife** | — | — | — | ✅ (maternal/perinatal) | — | — | — | ✅ RW |
| medical_superintendent | ✅ | — | — | ✅ | ✅ | ✅ | — | ✅ RW |
| nutritionist | — | — | — | — | — | — | — | ✅ R |
| radiologist | — | — | (imaging) | — | — | — | — | ✅ R |
| lab_tech | — | — | ✅ | — | — | — | — | — |
| pharmacist | — | ✅ | — | — | — | — | — | — |
| front_desk | — | — | — | — | — | — | — | ✅ RW (register) |
| **cashier** | — | — | — | — | ✅ | — | — | ✅ R (lookup) |
| medical_biller | — | — | — | — | ✅ | ✅ | — | ✅ R |
| hrio | — | — | — | ✅ (register) | — | — | ✅ | ✅ R |
| data_entry_clerk | — | — | — | ✅ (data entry) | — | — | — | — |
| **county_health_director** | — | — | — | — | — | — | ✅ | — (aggregate only) |
| government | — | — | — | — | — | — | ✅ | — (aggregate only) |
| hospital_manager | — | — | — | — | — | ✅ | ✅ | ✅ R |
| org_admin | — | — | — | — | ✅ | ✅ | — | — |
| super_admin | — (read QA) | — | — | — | ✅ | — | ✅ | ✅ R |

RW = read/write, R = read-only. "Vital events" = authoring births/deaths; clinicians and
midwives certify, HRIO/data-entry register.

The clinical-flow workstation roles (`central_registration_clerk`, `clinic_clerk`,
`triage_nurse`, `rooming_nurse`, `clinician`, `records_hmis_officer`) are capability-gated
stations rather than cadres, so they are not broken out in the matrix above — see
`clinical-flow/roles.ts` for their capability sets. `clinician` carries full
consult/prescribe authority and signs independently (KAN-19, KAN-20).

## What changed in this revision

**New roles**

- **Midwife** — ANC, deliveries, postnatal/newborn, maternity ward, obstetric referrals,
  maternal/perinatal vital events. Distinct from general nurse (justified by ICM scope of
  practice and the platform's heavy maternal-and-child-health focus).
- **Cashier** — point-of-service collections, receipts, payment plans, patient/visit lookup.
  No insurance-claim adjudication (that's the biller) and no clinical access.
- **County Health Director** — sub-national oversight tier between national government and
  payam: surveillance, outbreaks, MCH analytics, vital statistics, facility assessments,
  data quality, reports, and DHIS2 export. Aggregate views only.

**Removals (features a role should NOT have)**

- clinical_officer, nurse — removed payment processing (clinicians don't handle money).
- front_desk — removed payments, insurance claims, and ward/bed management (→ cashier, biller, nursing).
- nutritionist — removed immunization administration (a nursing task, not dietetics).
- receipts/billing APIs — removed front_desk, added cashier (separation of duties).

**Additions (features a role SHOULD have)**

- hrio — added DHIS2 export (HRIOs own HMIS reporting).
- midwife & cashier wired through every relevant API guard so they actually function.

## Least-privilege revision (African/LMIC scope-of-practice pass)

Each cadre's menu was trimmed to only the pages it actually operates, grounded in
documented scope of practice. The capability layer (`usePermissions.ts`) already
denied the underlying actions for these roles — these changes remove the dead
nav/route entries so the UI matches what the role can do.

- **midwife** — removed the Laboratory operations page. Midwives conduct deliveries,
  provide ANC/postnatal/newborn care, and refer (ICM scope); ANC lab results are
  reviewed inside the patient/ANC record, not the lab orders queue. Midwives never
  had lab-ordering capability, so this only removes a page they couldn't use.
- **triage_nurse** — removed the Laboratory page. Triage records presenting complaint,
  vitals, and acuity, then routes the patient; orders are placed by the clinician.
- **nutritionist** — removed Antenatal Care. Antenatal clinical care is a
  midwife/nurse/clinician function; maternal-nutrition data is reviewed via MCH
  analytics and the patient record. (Vaccine administration was already removed.)
- **hospital_manager** — removed Laboratory and Pharmacy work queues. A manager sees
  service utilisation through reports, not the live operational queues run by lab
  techs and pharmacists.

> `facility_administrator` previously appeared in this list. The role was **retired**
> in commit `273d869f` and is not in `UserRole`; its non-clinical facility-management
> responsibilities are covered by `hospital_manager` and `org_admin`. Kept as a note
> rather than a bullet so the history is legible without implying the role is grantable.

CHW/BHW scope was verified against the South Sudan Boma Health Initiative package
(iCCM for child illness, malnutrition screening, immunisation promotion, birth/death
and maternal-death reporting, disease surveillance) and left unchanged — it already
matches.

## Where this is enforced

The table above answers "what may this role reach". That is only one of **four
independent axes**, and a permission question is not answered until all four are.
Conflating them is how a control ends up looking complete while granting more than
intended.

| # | Axis | Question | Enforced by |
|---|------|----------|-------------|
| 1 | **Tenant** | Which organisation's data? | Physical tenant database + the `org:` claim in `validate_doc_update` + `filterByScope` |
| 2 | **Facility** | Which hospital within that org? | Replication selector (`facility-entitlements.ts`) + `filterByScope` on read. **Not enforced on write** — see the gap note below |
| 3 | **Role → document type** | May this cadre touch this kind of record? | `DOC_WRITE_ROLES` in `sync/write-permissions.ts` |
| 4 | **Lifecycle** | May an existing record be changed at all? | `IMMUTABLE_FIELDS`, `APPEND_ONLY_TYPES` and `DOC_UPDATE_ONLY_ROLES`, same file |

### Authoring vs amending

Axis 3 has two grades, because several workflows write a document without
creating it. `DOC_WRITE_ROLES` is authorship: create, amend and delete.
`DOC_UPDATE_ONLY_ROLES` grants amendment alone — the role may change a document
that already exists, and may never create or delete one. CouchDB passes the
validator `oldDoc`, which is what makes the distinction enforceable rather than
merely intended.

Today it carries one row, `prescription`:

| Role | May | May not |
|------|-----|---------|
| `pharmacist` | advance the dispensing lifecycle on an existing order | author an order, delete one |
| `nurse`, `midwife`, `triage_nurse`, `rooming_nurse` | append a `MedicationAdministration` from the ward MAR | author an order, delete one |

Both of those were previously refused outright, so the pharmacy could not
dispense and no dose recorded on the MAR ever replicated. Granting them
authorship instead would have been worse: `createPrescription` carries no
prescriber check of its own — only `/api/prescriptions` does, and UI writes
never reach it — so the write row is the only thing standing between a nurse and
a medication order.

### The layers, in the order a request actually meets them

1. **Page navigation** — Edge middleware via `ROLE_ROUTE_TABLE` (`role-routes.ts`).
2. **Sidebar/menus** — `ROLE_PERMISSIONS` nav items (`permissions.ts`).
3. **Capabilities/UI affordances** — `usePermissions.ts`.
4. **API route guards** — per-endpoint `READ_ROLES`/`WRITE_ROLES`/`CREATE_ROLES` arrays in
   `platform/src/app/api/**/route.ts`, plus `VALID_ROLES` in `user-service.ts`.
5. **CouchDB `validate_doc_update` (authoritative for writes)** — generated from
   `DOC_WRITE_ROLES` by `buildValidateDocUpdateFn()` and installed by
   `npm run setup:couchdb:validators`.

> **Layer 5, not layer 4, is the authoritative one.** The browser writes to its local
> PouchDB replica and replication carries the change upstream — that path **never touches
> an API route**, so layers 1–4 are all advisory for any client that chooses to skip them.
> The validator is the only guard on the offline write path, which is why it is generated
> from the same table the route guards read rather than hand-written beside them.

### Deletes and append-only trails

A **delete is a write** and is checked against the same role row as a create. A tombstone
carries no body, so it is judged entirely on the revision it destroys (`oldDoc`) — a body
sent alongside it cannot relabel what is being deleted. The one deletion accepted without a
role check is a tombstone for a document the database does not hold: it destroys nothing,
and replication depends on it being accepted.

Three document types are **append-only** — creatable by their role row, then never
modifiable or deletable by anyone below `_admin`:

| Type | Database | Why |
|------|----------|-----|
| `audit_log` | `tamamhealth_audit_log` | Written by every staff role, so it must not be amendable by the staff it records |
| `controlled_substance_log` | `tamamhealth_controlled_substance_log` | Narcotics chain of custody |
| `ledger_entry` | `tamamhealth_ledger` | Patient financial chain; a correction is a new reversing entry |

Enforced in three places, kept in parity by `src/__tests__/sync/append-only-parity.test.ts`:
the validator (refuses amendment and deletion), the sync gateway (refuses to forward any
deletion to those databases), and `TABLE_CONFLICT_POLICY` in `db/postgres.ts` (refuses to
overwrite or delete the national projection). `sync_event` is deliberately *not* append-only
— it is updated in place when a change lands.

### Known gap — axis 2 is read-only

There is no facility check on **writes**. The validator compares `orgId` and never
`hospitalId`, so a user at one facility can create a record stamped with another facility in
the same organisation. The `facility:<id>` claim needed to close this is already provisioned
onto every CouchDB user by `ensureCouchUser()`; nothing reads it yet. Closing it needs a
per-type decision about which facility field is the owning one — a referral's
`toHospitalId` and a message's `recipientHospitalId` legitimately name somewhere else.

On the read side, `facility-entitlements.ts` documents its own limit: the replication
selector is supplied by the client, so it prevents bulk exposure rather than being an
authorization boundary. Per-facility databases are the real fix (`docs/FACILITY-ISOLATION.md`).

### The station shim, and why layer 5 must be checked separately

`hasRole` in `api-auth.ts` applies a **compatibility shim**: a clinical-flow station role
also satisfies an allow-list naming its legacy equivalent, so `triage_nurse` passes a guard
listing `nurse`. **The CouchDB validator has no shim** — it matches `role:` claims exactly.

That gap is not cosmetic. A role the shim admits and the matrix omits gets the form, fills
it in, and writes the document to its local replica, where it looks saved. Replication then
rejects it and the record never leaves the device. Nothing in the UI reports this, because
the local write succeeded.

An audit in Aug 2026 found eight workflows in that state and repaired them:

| Workflow | Role(s) that could not sync |
|----------|------------------------------|
| Patient registration | `central_registration_clerk`, `clinic_clerk`, `triage_nurse`, `rooming_nurse` |
| Triage assessment | `triage_nurse` — its own primary function |
| Referral intake | `front_desk`, `central_registration_clerk` (the `proxy_referral_capture` capability) |
| Imaging report | `radiologist` |
| Dispensing | `pharmacist` |
| Ward MAR | `nurse`, `midwife`, `triage_nurse`, `rooming_nurse` |
| Vital-event registers | `hrio`, `records_hmis_officer`, `triage_nurse`, `rooming_nurse` |
| Facility assessment | `hrio` |
| Audit trail + sync events | `government`, `county_health_director` — the two broadest-read roles had **no** server-side audit trail |

`src/__tests__/rbac/workflow-write-parity.test.ts` now asserts the contract directly: for
every capability the UI grants, every role holding it must be able to write the document
types that workflow produces. It also reads `usePermissions.ts` and fails if a flag stops
naming the roles the table expects, so the restated lists cannot drift.

The other suites: `middleware-routes` and `permissions` assert nav links can never point at a
route the middleware would block; `validate-doc-update` executes the generated validator the
way CouchDB does; `api-role-guard` spot-checks the separation-of-duties invariants
(clinicians don't handle money, clerks don't author clinical records).
