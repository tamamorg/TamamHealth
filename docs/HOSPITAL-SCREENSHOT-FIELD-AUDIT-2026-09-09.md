# Hospital-system reference audit

Date: 2026-09-09. Tamam baseline inspected: c7c0c59d. Audit only; no application changes or deployment.

## Scope and confidence

Seven user-supplied Sanitas HMIS screenshots: S1/S2 registration, S3 queue configuration, S4/S5 continuation of clinic list, S6 selected clinic/charges/cover, S7 invoice worklist. S1 and S2 largely overlap. Patient names, identifiers, contact details and financial records are intentionally not reproduced or used as fixtures.

This captures visible controls, not the complete hospital system. Unopened tabs, collapsed menus, off-screen rows, permissions, validations and dropdown option sets remain unverified. Screenshot labels are workflow evidence, not legal requirements or an approved pricing catalogue. No access to the hospital's private network was attempted.

Status vocabulary: **Present** = found in inspected Tamam model/form; **Partial** = related capability exists but mapping or integration is incomplete; **Gap** = not found in inspected relevant model/form; **Unverified** = screenshot or code path insufficient to establish behavior. Present does not mean tested end to end.

## Priority findings

1. **High: mixed-currency account totals.** `platform/src/components/payments/BillingWorkspace.tsx`, patientLines aggregation, keys only by patientId and adds totalAmount, amountPaid and balanceDue without currency grouping. Account displays can combine USD and SSP. `platform/src/lib/services/billing-service.ts`, getBillingSummary, also sums across currencies while labeling the result with the first bill's currency. Group by currency; do not silently convert. Test USD + SSP for the same patient and facility. Payment settlement itself has a same-currency filter; this finding does not establish cross-currency settlement.
2. **High: undocumented negative clinical findings.** `registration/build-patient-doc.ts` writes allergies=['None known'] and chronicConditions=['None'] although its comment says these are not asked at registration. Preserve unknown/not-assessed explicitly and inspect downstream readers before migration. Do not bulk reinterpret genuinely assessed historical negatives.
3. **Medium: payment-only account fallback is incomplete.** In BillingWorkspace, when there are no bill totals, the first nonzero posted payment sets totalCollected; subsequent payments fail the zero-total condition. Multiple posted payments without bills can be underrepresented. Reconcile totals and reversals per currency with dedicated tests.
4. **Medium: registration coverage is not policy enrollment.** RegistrationForm.payorCoverageType offers out-of-pocket/program/exemption/ngo. InsurancePolicyDoc separately supports member, policy, employer/group and validity details. Registration/check-in must select and link the actual policy/coverage record; an NGO name or free-text payer is not verified eligibility.
5. **Medium: clinic vocabulary is incomplete for this reference.** The fixed DepartmentCode catalogue does not individually represent all 23 visible clinics. Some services exist elsewhere, such as ANC; that does not prove directory, routing, staffing and tariff integration. Do not create one new dashboard per screenshot clinic.
6. **Medium: visit settings are dispersed.** CheckInInput has department, arrival mode, attendance type and notes, but not the reference's complete pricing/authorization/referral configuration. CheckInModal chiefly confirms appointment arrival and new/repeat attendance. Extend existing encounter-linked intake, rather than creating a second queue.

## Registration: complete visible field inventory

| Reference field | Tamam evidence/status | Required treatment |
|---|---|---|
| Patient number | Present: hospitalNumber | Read-only identifier; collision-safe offline creation and searchable legacy mapping |
| Visit number | Partial: encounter _id and links | Distinct human-readable visit reference; never reuse patient number |
| First name, surname, other name | Present: firstName/surname/middleName | Preserve legal/full name and search aliases; do not rearrange stored identity from display formatting |
| Birth date | Present: dateOfBirth, estimatedAge | Preserve known versus estimated date/age; never invent January 1 for unknown dates |
| Date-picker and adjacent DOB icon | Picker/age support present; icon meaning unverified | Ask what the second hospital control does |
| Gender | Present: gender limited to Male/Female | Confirm intended meaning and approved unknown/other handling; screenshot options not visible |
| Nationality | Gap in registration form/model inspected | Country-coded optional field unless approved facility policy requires it |
| Document type | Gap | Configured identity-document vocabulary, including no document/unknown where applicable |
| ID/passport number | Partial: nationalId only | Pair number with type/issuer; preserve leading zeroes; duplicate checks must consider identifier namespace |
| Marital status | Gap | Optional, approved vocabulary, age-appropriate presentation |
| Category | Gap; meaning unknown | Obtain hospital category dictionary; do not conflate with payer or clinical acuity |
| Photo/select photo | Present: photoUrl capture flow | Consent, size limits, access control, edit/remove behavior and offline persistence testing |
| Phone and country-code selector | Partial: normalized phone fields | Explicit international-number input; +211 default may be useful but must remain editable |
| Email | Present | Optional; distinguish patient's address from guardian's |
| City/town | Partial: address and administrative geography | Add explicit locality if required; don't overload county |
| Sub-county/estate | Partial: county/payam/boma/address | Obtain mapping; label does not establish a one-to-one South Sudan administrative unit |
| Postal address | Partial: address only | Separate mailing address if required, otherwise optional |
| Postal code | Gap | Optional; do not force fictitious postal codes |
| Next-of-kin name | Present: nokName | Separate from patient identity |
| Next-of-kin phone/country code | Present phone, partial country-code UI | International validation; shared household numbers must be allowed |
| Next-of-kin relationship | Present: relationship options | Current options: spouse, parent, child, sibling, uncle, aunt, cousin, friend, other. Explicit guardian relationship missing from this list |
| Next-of-kin email | Gap | Optional; contact consent/preferences must be explicit |
| Next-of-kin ID/passport | Gap | Collect only if operationally justified; do not make universally mandatory |
| Debtor account | Gap in patient registration | Link authorized sponsor/account record, not a free-text financial promise |
| Department in Account section | Partial: clinical assignment exists | Hospital must clarify whether this is employer/staff or clinical department |
| Staff account | Gap in registration | Controlled staff-benefit linkage, not automatic clinical access |
| Legacy number | Gap | Preserve source system + facility + original ID; no replacement of Tamam internal ID |
| Operating currency | Present on bills, absent as registration preference | Optional default only; each invoice/payment must retain its own currency |
| Tax PIN | Gap | Optional conditional billing identity; obtain applicable business requirement |

S1/S2 mark first name, surname, birth date, gender, nationality and phone with asterisks. This shows the hospital UI's marking, not verified server-side rules. Tamam also requires primary language and geography in its inspected registration validation; phone is facility-configurable and DOB can use estimated age. Resolve these policy differences explicitly.

### Registration tabs and commands

Visible tabs: Patient Information, Medical Cover, Emergency Contact, Relationships, Other Information. Only Patient Information content is shown. The separate emergency tab may support additional contacts; its fields cannot be inferred from the inline primary next-of-kin fields.

Visible commands: Merge Other Patients, Imaging Exam, Laboratory Investigation, Minor Procedure, Family Health, Ancillary Care, Print Details, Add To Queue, Submit, Close, and success notification. Tamam has related chart/orders/print/queue capabilities, but exact parity and role authorization are unverified. Merge requires identity review, audit and preservation of linked orders/bills; never a simple destructive patient deletion. Clinical orders must retain encounter context and cannot become unrestricted registration toolbar actions.

Navigation visible: Patient Register, Patient Queue, Admissions; Appointments, Reminders, Clinic Planner; collapsed Configuration, Reports and Enquiries. Their hidden contents are not captured.

## Queue and visit intake

### All 23 distinct visible clinic names

| Reference clinic | Tamam mapping assessment |
|---|---|
| Speech Therapy | No dedicated code in inspected department catalogue; separate from physiotherapy |
| Antenatal Care | Existing ANC domain; verify configured queue and staffing |
| Cardiology | Catalogue match |
| Child Welfare Clinic (CWC) | Child-health functions exist; separate preventive clinic mapping required |
| Comprehensive Care Clinic (CCC) | Meaning/program scope must be supplied by hospital |
| Dental | Catalogue match |
| Dermatology | Catalogue match |
| Ear, Nose and Throat | No dedicated code in inspected catalogue |
| Family Planning | Separate clinic/program mapping required |
| Gynaecology Clinic | Related combined obstetrics_gynaecology code; subclinic mapping needed |
| Medical Outpatient Clinic (MOPC) | Related internal medicine; do not silently equate with general OPD |
| Minor Theater | Related operation_theatre/procedures; service scope must be confirmed |
| Maxillofacial Clinic | No dedicated code; do not assume equivalent to general dental |
| Orthopaedic | orthopaedic_surgery match/alias; confirm nonsurgical service routing |
| Out Patient (OPD) | Existing check-in default; distinct from specialty internal medicine |
| Paediatric Outpatient Clinic (POPC) | Related paediatrics code; outpatient service mapping needed |
| Physiotherapy | Catalogue match |
| Postnatal Care | Maternal-health workflow mapping required |
| Psychiatry | Catalogue match |
| Sexually Transmitted Infections | Dedicated program/clinic mapping and access review needed |
| Surgical Outpatient Clinic (SOPC) | Separate service mapping; theatre is not an outpatient clinic |
| TB and Leprosy | Dedicated service/program mapping needed |
| Urology | No dedicated code in inspected catalogue |

The overlapping screenshots show **23 distinct named clinics**. Additional off-screen clinics remain unknown.

Visible visit-type values: SICK, PHYSIOTHERAPY, 1ST ANC VISIT (0–12 WEEKS). Speech Therapy appears beside PHYSIOTHERAPY: flag this as a possible source-system configuration mismatch, not a mapping to copy. Visit reason/service type, new/repeat attendance and acuity are three separate concepts.

### Panels and fields

| Visible control | Required mapping/behavior |
|---|---|
| Clinic and visit-type rows; row/header checkboxes | Facility-managed active services; determine whether multiple clinics may be selected and whether that creates child visits or queue tasks |
| Applicable charges: charge, cost, row/header checkboxes | Existing FeeScheduleDoc/BillLineItem are starting points; show currency, effective tariff, quantity and source |
| General consultation and revisit charges, OPTIONAL label | Confirm mutual exclusivity, optional/mandatory rules and new/repeat pricing. Do not copy screenshot amounts |
| Clinician name; patients seen today; selection | Existing staff/encounter assignment; derive workload for facility-local day and distinguish waiting/in service/completed |
| No doctors available | Explicit unassigned workflow; do not fabricate assignment or silently hide staffing failure |
| Medical scheme | Select existing policy/payer coverage; scope by patient, facility, service date and eligibility |
| Authorization code and adjacent icon | Store authorization separately from eligibility; icon action and issuing system unverified |
| Applicable waiver | Approved waiver catalogue, reason, authorized approver and audit; not an arbitrary discount |
| Token number | Clarify queue ticket versus insurer token; separate identifiers |
| Pricing package | Facility/payer contract reference and effective version; snapshot applied prices on visit/bill |
| Currency | Explicit invoice/charge/payment units; changing preference must not relabel old amounts |
| Referring facility | Link existing referral/facility record; permit documented external source |
| Referring physician | Link staff/external clinician reference; preserve source referral |
| Notes | Visit-scoped text, not permanent patient demographic data |
| Mode of arrival | Existing triage/check-in vocabulary; expose without duplicating data |
| Brought by | New intake contact/reference as needed, distinct from permanent next of kin |
| Facility reference number | Source referral/legacy visit identifier with namespace |
| Visit Settings / Questionnaire tabs | Questionnaire contents not shown; obtain exact template and required answers |
| Consent menu | Actions/content not shown; link existing consent/directives only after purpose is defined |
| Save To Queue / Close Form | Existing check-in service; idempotent retry, clear local-save versus synced feedback, unsaved-change warning |

S6 shows a selected outpatient clinic, two available charges, one charge checked, a selected sponsor scheme/package, and no clinicians available. It also shows charge currency differing from visit currency. This does not prove conversion behavior: obtain exchange-rate and billing rules before replicating it.

## Invoice/payment worklist: complete visible inventory

### Columns and row details

- Client details: avatar, patient name, patient number, age in years/months.
- Visit number, invoice number, currency.
- Invoice amount, paid amount, pending amount.
- Status (visible OPEN and PAID), creation date/time, billing stage (visible OP).
- Settlement mode and package: cash versus named cover, authorization/reference details, package label and icons.

Existing BillingDoc supplies invoice number, patient, optional encounter link, currency, totals, paid/balance and status. Human visit number, billing-stage display and contract/package linkage need explicit mapping. OPEN must be defined against Tamam pending/partial/insurance states; it is not safe to collapse every unpaid state into one status. Age must be calculated from an actual or estimated DOB, not stored as a stale display string. Do not infer sex from avatar colour.

### Search and filters

Patient number; visit number; patient name; invoice number; status; billing stage; currency; created start/end date; paid start/end date; sorting order; search and refresh buttons; expandable filter affordance. Tamam's account-level worklist is not equivalent to this invoice-level register. Preserve both account and invoice views while linking them.

Paid-date filtering needs a definition for partial installments, final settlement, refunds and insurer remittance. Use facility-local date boundaries. Active filters must be visible, clearable and applied consistently to exports, totals and pagination.

### Toolbar, navigation and footer

- Toolbar: Post Invoice, Create Invoice, Print Preview dropdown, Settlement Summary, Create Debtor Tracking Account, Documents, Miscellaneous Actions dropdown, Next Token dropdown.
- Receivables: Sale Invoice, Claim/Debt Schedule, Receive Payment, Billing Audit, Refund/Disbursement, Voiding Requests, Deposit, Medical Cover, Pro Forma Invoice.
- Collapsed groups: Payables, Petty/Payment Ops., Reports, Enquiries.
- Footer: first/previous/next/last page controls, current page and page count, refresh, invoice/paid/pending totals with currency labels, displayed row range/total, items-per-page selector.

Tamam already has billing finalization, payment, claims, refund/void and deposit functionality in code. Pro forma, debtor-account management, approval routing, settlement summaries and hidden menu contents need a separate parity walkthrough. Buttons being present does not prove ledger reconciliation, permissions or printing correctness.

The reference shows a worklist with over twenty thousand invoices. Tamam's inspected billing load fetches all scoped bills/payments/claims/plans. Benchmark large local datasets; use indexed/filterable queries and bounded rendering. A row limit alone does not fix full-dataset loading cost.

## Visual system and accessibility

Use the hospital screenshots' information density and recognisable grouped actions, not their dated gradients or tiny controls. Retain Tamam's existing tokens, typography and icon library. Apply restrained colour by module, separate semantic status colours, and always include text labels. Blue action / green complete / amber pending / red error are proposed conventions, not inferred hospital policy. Avoid assigning meanings to the reference's pink/blue avatars or unfamiliar icons without confirmation.

Use scrollable full-page registration with section anchors, patient/visit context fixed where useful, labelled required/optional inputs, keyboard operation and visible focus. Keep table headers when empty. A successful local save, pending replication, conflict and server failure require distinct messages. Phone, ID and email absence must not automatically block urgent intake; exact policies require clinic approval.

Accessibility references: https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html and https://www.w3.org/WAI/tutorials/forms/instructions/ . The audit does not certify WCAG compliance.

## Required implementation chain

For every added field: vocabulary/configuration → form and validation → typed record → scoped create/update → offline persistence/replication validators → chart/review/edit → search/report/print where appropriate → access controls/audit → tests. Additive optional fields preserve older records; no destructive migration of existing patient IDs or chart data.

Keep patient demographics, encounter intake, coverage policy, eligibility/authorization, fee schedules/contracts, invoice snapshots and payments as distinct linked records. Snapshot financial terms used at posting so later tariff edits do not rewrite history. Reuse existing services and role routing.

## Acceptance tests required before parity sign-off

1. Register with known DOB and with estimated age; save/reopen/edit offline; names and leading-zero identifiers preserved.
2. No phone/ID/email, international number, guardian contact, multiple next-of-kin, unknown demographics and duplicate candidate handling.
3. Old patient records load without invented nationality, category or negative clinical findings.
4. One check-in produces one encounter/queue entry despite double-click, timeout and reconnect retry.
5. Clinic selection drives allowed visit types, configured fees and eligible staff; unavailable clinician has a deliberate fallback.
6. Multiple-clinic behavior follows an approved model; unrelated services do not share misleading visit types.
7. Expired or unverified cover stays unverified offline; authorization requires provenance; waivers require permitted roles.
8. USD and SSP invoices remain separate in account totals, summaries, exports, refunds and receipts. No-bill multiple payments reconcile correctly.
9. New/revisit fees, tariff effective dates, partial payments, insurance/patient split, finalization, void/refund and replayed transactions reconcile.
10. Invoice filters work together, including local-day boundaries, created/paid dates and pagination. Totals reflect documented filter scope.
11. Reception, nurse, clinician, cashier and administrator permissions verified at service/sync level, not just disabled UI.
12. Large-dataset performance, keyboard access, narrow screens, en/apd layout, printing and offline conflict recovery tested.

## Hospital evidence still needed

Request de-identified screen walkthroughs of Medical Cover, Emergency Contact, Relationships, Other Information, Questionnaire, Consent and all toolbar dropdowns; complete option exports with stable codes; clinic/visit-type mappings; effective tariffs/packages and currency rules; required-field rules; staff roles and approval matrix; example blank receipts/invoices and daily reconciliation reports; legacy-ID and export schemas. Obtain meanings of CCC, Category, Account Department, Token, Facility reference and OP billing stage. Screenshots alone cannot establish API integration, insurer contracts, tax requirements or full operational parity.

## Inspected code evidence

- platform/src/components/patients/registration/registration-form.ts
- platform/src/components/patients/registration/build-patient-doc.ts
- platform/src/components/patients/registration/PatientRegistrationForm.tsx
- platform/src/data/mock.ts (Patient interface, not patient fixtures)
- platform/src/lib/db-types.ts (PatientDoc/EncounterDoc)
- platform/src/lib/services/check-in-service.ts
- platform/src/components/front-desk/CheckInModal.tsx
- platform/src/modules/departments/core/types.ts and catalog.ts
- platform/src/lib/db-types-billing.ts and db-types-payments.ts
- platform/src/components/payments/InsurancePolicyModal.tsx
- platform/src/components/payments/BillingWorkspace.tsx and BillingFilterMenu.tsx
- platform/src/lib/services/billing-service.ts

Audit limitations: source inspection and supplied screenshots; no new runtime transaction, new production mutation, new benchmark or full clinical-safety certification performed in this pass.
