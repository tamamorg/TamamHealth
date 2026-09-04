# Form Prefill and Dropdown Improvement Plan

**Status:** In progress  
**Audit date:** 2026-09-04  
**Scope:** Interactive forms under `platform/src/app`, `platform/src/components`, and `platform/src/modules`

## Outcome

Make forms faster without manufacturing clinical facts. Tamam Health should prefill verified context (the current patient, facility, user, date, and previously confirmed stable facts), derive deterministic workflow values, and require an explicit choice for observations, diagnoses, outcomes, and other safety-sensitive data.

## Decision rules

Every field should use one of four behaviors:

| Behavior | Use when | Examples |
|---|---|---|
| Verified prefill | The value comes from the signed-in session or selected record | Facility, clinician, patient phone, primary insurance |
| Derived suggestion | The system can calculate it and the user can review it | ANC visit number, gestational age estimate, vaccine dose due |
| Explicit selection | A default could be mistaken for an observation | Sex, risk level, blood group, cause of death, delivery type |
| Explicit absent state | The workflow permits missing/not-performed data | Unknown, not assessed, not tested, not applicable |

Additional rules:

- Never represent “not recorded” as `0`, `false`, “negative”, “normal”, or the first option.
- Reset modal state after success and cancellation so values cannot leak between patients.
- Resolve dropdown options from the relevant destination and organization, not from a convenient local list.
- Use a searchable picker when a list is likely to exceed 15 items; display at least two patient identifiers.
- Preserve an “Other / specify” route where the maintained value set cannot be exhaustive.
- Persist stable IDs alongside display labels so renaming a department, product, or staff member does not break history.
- Make conditional dependencies explicit: Rh is meaningful after blood group assessment; witness is required for controlled-drug events; transfer department belongs to the destination facility.

## Audited backlog

### P0 — Prevent silently false records

| Area | Current risk | Target behavior | Delivery |
|---|---|---|---|
| ANC registration | Age, gravida, gestational age, negative labs, O+, interventions, and low risk are preselected | Blank observations; explicit not-tested/unknown options; derive visit number and estimated GA only from a linked active pregnancy; inherit confirmed blood group/Rh | **Slice 1 delivered** |
| Birth registration | Male, 3000 g, singleton, normal delivery, and nationality are asserted before entry | Require sex, birth weight, birth type, and delivery type; link/select mother to prefill verified demographics | Next |
| Death registration | Male, natural cause, and “notified” are asserted | Require sex and manner/cause; use a positive action for notification rather than a checked default | Next |
| Immunization | Male, BCG dose 1, left arm, and completed status are asserted | Derive dose due from history/schedule; source vaccine/batch from inventory; explicitly record administered/not-done | Next |
| Blood bank | O+, whole blood, 450 ml, and calculated 42-day expiry are assumed | Require component/product and confirmed typing; calculate expiry from the selected product policy | Next |
| Ward admission | Moderate severity is preselected | Start unassessed and require classification when the workflow requires it | Next |
| Nutrition | Female is preselected | Prefill from a linked patient or require a choice including unknown | Next |
| Surveillance / emergency preparedness | “Increasing”, “watch”, cholera, level 2, and preparedness are preselected | Use no-selection placeholders unless the value is derived from evidence | Next |

### P1 — Populate choices from authoritative records

| Workflow | Change |
|---|---|
| Referral | Load departments/services from the destination facility; keep destination ID and department ID |
| Triage disposition | Replace first-option/free-text fallback with a required configured destination plus “Other / specify” |
| Room reroute | Replace `window.prompt` with the same destination picker and a reason field |
| Nursing handoff | Select active on-duty staff; persist `incomingNurseId` and name |
| Controlled substances | Select controlled inventory item, unit, patient, operator, and witness from records; derive opening balance |
| Ward patient | Replace the first-200 truncation with searchable, scoped patient retrieval and two identifiers |
| Shifts | Select department/location from facility settings; selecting shift type should propose configured times |
| Facility administration | Maintain town and connection-type value sets, with “Other” where appropriate |
| Prescribing | Populate service location and dispensing pharmacy from organization/facility configuration |

### P2 — Add safe convenience prefills

| Workflow | Change |
|---|---|
| Appointment booking | Suggest current clinician when eligible; select primary active insurance; derive new/returning from history |
| Payments | Prefill verified contact details and payer identity; date bank transfers explicitly; select waiver approver from authorized staff |
| Claims | Auto-select only when exactly one eligible primary policy or bill exists; otherwise present an explicit choice |
| Facility assessments | Default to the signed-in user’s facility, while allowing authorized cross-facility assessment |
| Leave requests | Initialize non-approvers to their own user ID and remove the redundant picker |
| Surveillance | Prefill state/county/facility from the reporting context while keeping occurrence location editable |
| User/facility creation | Remove “nurse” and “hospital” guesses; require role and facility type; default only operational settings that are policy-backed |

## Architecture and implementation

1. Add pure form-policy modules under `src/lib/forms/`. They own initial state, derivation, and validation independently of React, so safety rules are unit testable.
2. Keep patient/facility/staff/inventory queries in existing offline-first hooks and services. Do not introduce direct API calls into forms.
3. Standardize picker payloads as `{ id, label, secondaryLabel }`; store IDs and snapshot labels where the document schema needs both.
4. Add explicit absence values to constrained clinical value sets. Where the persisted schema currently overloads zero/false, migrate fields to nullable/absent-reason representations before changing reporting semantics.
5. Add dependent-option hooks for facility departments, staff by role/shift, inventory by product status, patient insurance, and vaccine history.
6. Instrument validation failures, manual overrides of derived suggestions, searches with no result, and time-to-complete without collecting clinical values in analytics.

## Delivery sequence

### Slice 1 — ANC safety baseline (delivered)

- Pure initial-state/derivation/validation policy with unit tests.
- Blank unsafe observations and classifications.
- Explicit unknown/not-tested choices.
- Linked-patient demographic prefill, confirmed blood group/Rh inheritance, visit-number derivation, and reviewable GA estimate.
- Reset the form after save/cancel.

### Slice 2 — Vital events and immunization

- Apply the same explicit-choice policy to birth and death registration.
- Add a mother picker to birth registration and a patient picker to death registration.
- Calculate immunization suggestions from patient history and select batches from available inventory.

### Slice 3 — Operational dictionaries

- Destination-facility department picker for referrals/triage/reroute.
- Staff picker for handoff, controlled substances, approvals, and shifts.
- Inventory-backed medication, vaccine, blood-product, and unit selectors.

### Slice 4 — Finance, HR, and administration

- Insurance/payment/claim prefills.
- Self-service leave and current-facility assessment defaults.
- Facility/user creation dictionaries and required placeholders.

### Slice 5 — Schema cleanup and rollout

- Replace sentinel `0`/`false` values with nullable data plus absent-reason codes.
- Backfill legacy records conservatively; do not reinterpret historical zeros or negatives without provenance.
- Release behind per-workflow flags if migrations are required, monitor validation friction, then remove flags.

## Acceptance checks

- A newly opened safety-sensitive form contains no value that could be interpreted as an observed clinical fact.
- Known context is filled only after its source record is selected and remains editable where clinically appropriate.
- Derived values are visibly reviewable and never overwrite manual edits unexpectedly.
- Every required select starts with a disabled prompt or an explicit semantically valid absent state.
- Patient selectors show at least name plus hospital number/DOB or age.
- Long lists are searchable, scoped, and are not silently truncated.
- Cancel, successful submit, and switching patients clear patient-specific state.
- Unit tests cover initial state, derivation boundaries, validation, and missing-data behavior.
- ESLint, focused Jest tests, TypeScript/build, i18n validation, and browser verification pass before release.

## Evidence used

- AHRQ’s EHR usability framework describes defaults as useful accelerators while warning that they can create pseudo-data when accepted without review: <https://digital.ahrq.gov/file/26269/download?token=KqxW_WMc>
- GOV.UK advises against preselecting answers to questions and recommends selects only for familiar, constrained lists: <https://design-system.service.gov.uk/components/select/>
- USWDS recommends a combo box for long lists and a standard select for roughly 7–15 choices: <https://designsystem.digital.gov/components/combo-box/> and <https://designsystem.digital.gov/components/select/>
- The ONC Patient Identification SAFER Guide recommends using multiple identifiers rather than names alone: <https://healthit.gov/wp-content/uploads/2025/01/Safer-Guide-6.-Patient-Identification-Final.pdf>
- WHO SMART Guidelines publish computable ANC/immunization data dictionaries and decision logic suitable for maintained clinical value sets: <https://smart.who.int/>, <https://smart.who.int/dak-immz/dictionary.html>, and <https://smart.who.int/dak-immz/decision-logic.html>
- HL7 FHIR provides standard absent-reason concepts such as unknown, asked-unknown, not-asked, and not-performed: <https://www.hl7.org/fhir/R5/valueset-data-absent-reason.html>
- ISMP’s electronic medication communication guidance treats unsafe defaults as a medication-safety concern: <https://www.ismp.org/system/files/resources/2019-03/Electronic-Guidelines-2019.pdf>

## Progress log

- 2026-09-04: Source audit completed across 162 form-bearing TSX files.
- 2026-09-04: External guidance mapped into the decision rules above.
- 2026-09-04: Slice 1 implementation started with ANC registration.
- 2026-09-04: Slice 1 completed with a pure policy module, explicit clinical choices, safe linked-patient derivation, reset behavior, and unit coverage.
