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

1. **Page navigation** — Edge middleware via `ROLE_ROUTE_TABLE` (`role-routes.ts`).
2. **Sidebar/menus** — `ROLE_PERMISSIONS` nav items (`permissions.ts`).
3. **Capabilities/UI affordances** — `usePermissions.ts`.
4. **Data layer (authoritative)** — per-endpoint `READ_ROLES`/`WRITE_ROLES`/`CREATE_ROLES`
   arrays in `platform/src/app/api/**/route.ts`, plus `VALID_ROLES` in `user-service.ts`.

All four layers are kept in sync; the `middleware-routes` and `permissions` test suites assert
that nav links can never point at a route the middleware would block (136 tests passing).
