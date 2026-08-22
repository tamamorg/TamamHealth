# Clinical Flow Implementation — mapping the architecture document to the system

This tracks how "EHR Clinical Flow — Architecture Document (v1)" is implemented
in the platform, and the phased plan to redesign the system to match it exactly
and restrict it to the documented workflows.

## What restricts the system to the workflows

A new authoritative spec layer lives at `platform/src/lib/clinical-flow/`. It is
a faithful, pure-TypeScript encoding of the document — state machines, roles,
capabilities, payment model, and patient identity. Every UI station and API
guard must validate moves against this layer (e.g. `canTransition()`), so an
encounter or order can never enter a state the document doesn't allow.

Guarded by `platform/src/__tests__/clinical/encounter-state-machine.test.ts`
(closed-machine + invariant checks). It moved there from
`__tests__/clinical-flow/state-machines.test.ts`; this line went on naming the
old path for long enough to be worth saying out loud, because a doc that cites
a test file nobody can open is indistinguishable from one citing coverage that
does not exist.

## Phase 0/1 — DONE this iteration (spec layer)

| Document section | Module | What it encodes |
|---|---|---|
| §6 Patient Journey, Stages 1–11 | `encounter-journey.ts` | All encounter statuses, legal transitions, stage map, facility-checkout gate + Tier-1 safety rule |
| §4 Staff Roles + §2.3 capabilities | `roles.ts` | The 11 roles, capability set per role, central-vs-clinic clerk matrix, role behavior, mapping to existing `UserRole` |
| §6 Stages 6/7/8 | `order-lifecycles.ts` | Lab order, procedure, and prescription sub-state-machines; result-review SLAs; pharmacy priority rule |
| §10 BHW workflow | `bhw-workflow.ts` | BHI context, visit types, task/visit/surveillance state machines, multi-channel referral + merge, supervision chain |
| §5 Payment Model; §2.11; §2.9 | `payment-model.ts` | Payor types + rules, medication criticality tiers, acuity-weighted/time-aged queue scoring |
| §2.7 / §2.7.1 | `patient-identity.ts` | Geocode ID `BOMA-{bomaCode}-HH{householdNumber}-{patientSuffix}`, temp/unknown IDs, stability assumptions |

### Role reconciliation note

The document defines 11 *functional* roles (registration clerk, clinic clerk,
triage nurse, rooming nurse, clinician, lab tech, pharmacist, cashier,
records/HMIS officer, facility administrator, BHW). The platform's existing
`UserRole` union (22 clinical-title roles) is **retained and mapped** onto these
via `mapsToUserRoles` rather than renamed in a single breaking change. Migration
to capability-based checks happens in Phase 2.

## Phase 2 — Capability-based access (NEXT)

- Replace title-based permission checks with capability checks
  (`hasCapability`) in `usePermissions.ts`, `role-routes.ts`, and the API
  `READ/WRITE/CREATE_ROLES` arrays.
- Add **active-role-per-session** to auth/session (multi-role users; the active
  role is logged with every action — §4 role behavior).
- Add the **central vs. clinic clerk** split (today both map to `front_desk`).

## Phase 3 — Encounter engine + stations

- Persist `encounterStatus` on the visit/encounter doc; expose a single
  `transitionEncounter()` service that enforces `ENCOUNTER_TRANSITIONS` and
  writes an audit entry (status, role-at-time, station, channel).
- Build the per-stage station screens described in §6 ("Interface — …"):
  registration (Stage 2), triage (Stage 3), rooming (Stage 4), clinician
  (Stage 5), lab (Stage 6), procedures (Stage 7), pharmacy (Stage 8), clinic
  checkout (Stage 9), facility checkout (Stage 10 gate).
- Acuity-weighted, time-aged queues (`queuePriorityScore`) for every queue.

## Phase 4 — Orders, pharmacy, payment

- Wire the lab/procedure/prescription lifecycles to the order docs; enforce
  "every result is reviewed" with the review SLAs and escalation.
- Per-service payor tagging + facility payor registry + exemption auth workflow;
  checkout bill summary; Tier-1 medication safety flag.

## Phase 5 — BHW community workflow (mobile)

- Catchment dashboard, household detail, visit templates per `BHW_VISIT_TYPES`,
  task/visit/surveillance state machines, offline-first with opportunistic sync,
  multi-channel referral capture (incl. front-desk proxy via BHW ID code),
  channel-preserving merge, supervision dashboards.

## Phase 6 — Cross-cutting & printing

- Printing as a first-class channel (§2.6) for every patient-facing artifact.
- Post-visit workflows (§6 Stage 11): result return, recall, referral tracking,
  adherence monitoring, BHW follow-up, surveillance/HMIS aggregation.
- Deferred dedicated modules (§7): EPI/immunization, family planning, GBV,
  adolescent confidentiality, mass campaigns, inpatient, mortality review.

## Constraints / status
- The workspace shell is down this session, so `tsc`/tests/build were not run
  locally; the spec layer is additive pure-TS and the CI pipeline
  (lint + tsc + tests + build) will validate it on push.
- Sections 12–17 of the document are marked "to be written"; cross-cutting
  flows, feature inventory, role-by-role interface summaries, the encounter
  state diagram, interoperability, and the reporting layer will be encoded when
  those sections land.
