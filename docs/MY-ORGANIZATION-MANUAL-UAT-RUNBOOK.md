# TamamHealth Platform Training & Manual UAT Handbook

## My Organization

> **A guided learning manual for administrators, clinical staff, operational teams, and system testers**

| Document item | Value |
|---|---|
| Organization | **My Organization** |
| Training facility | **My Organization Test Hospital** |
| Document type | Training handbook and manual UAT workbook |
| Intended audience | Platform administrators, organization administrators, trainers, facility staff, and testers |
| Recommended environment | Staging or a dedicated test environment |
| Test data policy | Fictional patients only; never use real patient information |
| Learner | ______________________________ |
| Trainer/reviewer | ______________________________ |
| Training dates | ______________________________ |
| Application version/commit | ______________________________ |

---

## About This Handbook

This handbook teaches the overall use of TamamHealth while guiding the learner through a complete manual test. It begins with platform setup, explains how users are scoped, and then follows patient care from registration through consultation, diagnostics, dispensing, billing, reporting, and management oversight.

By the end of the program, the learner should be able to:

1. Explain the relationship between the platform, an organization, a facility, a user role, and a patient record.
2. Create **My Organization**, configure a facility, and provision the correct user accounts.
3. Sign in as each role and recognize what that role may and may not do.
4. Complete the main outpatient, maternity, diagnostic, pharmacy, financial, and reporting workflows.
5. Verify tenant isolation, facility scope, audit history, data accuracy, and safe clinical handoffs.
6. Record defects and decide whether the platform is ready for use.

> [!CAUTION]
> Use staging or a dedicated test environment. If production testing is unavoidable, obtain written approval, prefix every test record with `TEST`, and follow your approved clinical-record retention and correction policy. Never enter real patient information into a training record.

## How to Use This Handbook

The handbook serves three purposes at the same time:

| Mode | How to use it |
|---|---|
| **Learn** | Read the short explanation at the start of each module before using the platform. |
| **Practice** | Perform each numbered exercise with the specified user account. |
| **Validate** | Compare the result with the expected outcome and mark Pass, Fail, or Blocked. |

Use these result labels consistently:

| Result | Meaning |
|---|---|
| **Pass** | The action completed and the observed result matched the expected result. |
| **Fail** | The action completed, but the result was wrong, unsafe, or incomplete. |
| **Blocked** | The learner could not perform the test because a prerequisite, feature, or environment was unavailable. |
| **Not applicable** | The feature is intentionally not enabled for this organization or facility. |

## Suggested Training Schedule

| Session | Modules | Suggested duration | Main outcome |
|---:|---|---:|---|
| 1 | Orientation, setup, and scope | 90 minutes | Organization and facility are ready |
| 2 | User provisioning and access | 120 minutes | All role accounts are created and verified |
| 3 | Registration, check-in, triage, and rooming | 120 minutes | Patient reaches the clinical queue correctly |
| 4 | Consultation, laboratory, imaging, and pharmacy | 180 minutes | Clinical orders are fulfilled safely |
| 5 | Nursing, maternity, nutrition, referral, billing | 180 minutes | Specialty and financial workflows complete |
| 6 | Reporting, management, security, and resilience | 150 minutes | Oversight, isolation, audit, and UI checks pass |
| 7 | Defect retest and sign-off | 60–120 minutes | Evidence is complete and acceptance is decided |

## Contents

1. [Training Preparation](#1-training-preparation)
2. [Understand Roles and Scope](#2-understand-roles-and-scope)
3. [Create the Organization and Facility](#3-create-the-organization-and-facility)
4. [Create the User Accounts](#4-create-the-user-accounts)
5. [Learn the Main Platform Workflow](#5-learn-the-main-platform-workflow)
6. [Baseline Access Test](#6-baseline-access-test-for-every-account)
7. [Guided Outpatient Journey](#7-guided-outpatient-journey)
8. [Separate Maternity Workflow](#8-separate-maternity-workflow)
9. [Billing and Payment Workflow](#9-billing-and-payment-workflow)
10. [Records, Reporting, and Management](#10-records-reporting-and-management-roles)
11. [Aggregate Oversight](#11-aggregate-oversight-roles)
12. [Platform Administration, Audit, and Risk](#12-platform-administration-audit-and-risk)
13. [Resilience, Navigation, and Accessibility](#13-resilience-navigation-and-accessibility)
14. [Assessment and Defect Recording](#14-assessment-and-defect-recording)
15. [Final Approval](#15-final-approval-checklist)
16. [Safe Cleanup](#16-safe-cleanup)

---

## 1. Training Preparation

Use one test run identifier everywhere so records are easy to find:

`UAT-YYYYMMDD-01`

Prepare:

- One private/incognito browser window for the active test user.
- One normal browser window for the administrator.
- A test email inbox for invitations and password-reset tests.
- A spreadsheet or issue tracker with these columns: Test ID, Role, Username, Record ID, Expected, Actual, Pass/Fail/Blocked, Screenshot, Defect ID, Notes.
- A timer for measuring login, search, page-load, and save times.

### Training success targets

- No user can see a page, patient, facility, or action outside their role and scope.
- Patient search responds in under 500 ms; main dashboards and clinical saves complete in under 2 seconds under normal test conditions.
- Each clinical handoff appears in the next role's queue without a manual reload, or after one reload if real-time sync is unavailable.
- Medication is deducted exactly once and cannot be dispensed twice.
- Every important action appears in the audit log with the correct user, organization, facility, time, action, and result.
- No Critical or High defect remains open before approval.

### Learner setup checklist

| Item | Complete | Notes |
|---|:---:|---|
| Test run ID created | ☐ | |
| Administrator browser ready | ☐ | |
| Incognito learner browser ready | ☐ | |
| Test email inbox available | ☐ | |
| Evidence sheet created | ☐ | |
| Staging/test environment confirmed | ☐ | |
| Medication starting stock recorded | ☐ | |

## 2. Understand Roles and Scope

### 2.1 The platform structure

| Level | Example in this handbook | What it controls |
|---|---|---|
| Platform | TamamHealth | Global administration, subscriptions, risks, and cross-platform audit |
| Organization | **My Organization** | Tenant boundary, staff roster, licenses, enabled roles, and facilities |
| Facility | **My Organization Test Hospital** | Local clinical queues, beds, departments, inventory, reports, and staff access |
| User role | Doctor, Pharmacist, Cashier, etc. | Pages and actions the signed-in user is allowed to use |
| Patient record | Fictional UAT patient | Demographics, encounters, orders, medicines, invoices, and reporting events |

### 2.2 Key terms

| Term | Meaning in the platform |
|---|---|
| MRN/hospital number | Facility-issued patient identifier used for search and safe matching |
| Queue | A role-specific list of work waiting for action, such as triage, laboratory, or pharmacy |
| Encounter | A clinical interaction linking the patient, clinician, findings, diagnoses, and plan |
| Order | A request for a laboratory test, imaging study, medicine, or other service |
| Prescription | The prescriber's medication instructions before pharmacy fulfillment |
| Dispensing | Pharmacy confirmation that a specific quantity and lot were supplied |
| MAR | Medication Administration Record used by nursing staff |
| ANC | Antenatal care record used in the maternity workflow |
| HMIS | Health Management Information System reporting and data-quality workflow |
| Tenant isolation | Protection that prevents one organization from seeing another organization's data |
| Audit log | Tamper-evident history of who performed an action, when, where, and with what result |

### 2.3 Scope rules you must follow

The site has 25 roles, but only 22 are assignable to **My Organization**:

- **Global existing account:** Super Admin. Do not attach this account to an organization or facility.
- **Global accounts created by Super Admin only:** Government and County Health Director. Do not attach them to an organization or facility. They are aggregate oversight roles, not patient-care users.
- **Organization-wide:** Org Admin belongs to **My Organization** but does not belong to one facility.
- **Organization and facility scoped:** The remaining 21 roles must belong to **My Organization** and a facility.

| Scope category | Roles | Organization assignment | Facility assignment |
|---|---|:---:|:---:|
| Platform-wide | Super Admin | No | No |
| Aggregate oversight | Government, County Health Director | No | No |
| Organization-wide | Org Admin | **My Organization** | No |
| Facility workforce | All remaining 21 roles | **My Organization** | **My Organization Test Hospital** |

> [!IMPORTANT]
> If you want the complete role roster, create **My Organization** as a **Public** organization. A Private organization intentionally offers a smaller role set. Super Admin, Government, and County Health Director must remain outside organization and facility scope.

## 3. Create the Organization and Facility

### What the learner will understand

An organization is the tenant boundary. A facility belongs to the organization and supplies the local context for patient numbers, work queues, wards, inventory, and reporting. Complete organization setup before creating facility-scoped users.

Perform these steps as the existing **Super Admin**.

1. Sign in and confirm the landing page is `/admin`.
2. Open **Manage** or **Facilities & People**.
3. Open **Organizations** and select **Add Organization**.
4. Enter the name exactly as `My Organization`.
5. Select **Public** organization type for this full-role test.
6. Enable all applicable staff roles.
7. Complete required contact, location, reporting, subscription, and license fields.
8. Save, reload the page, and verify the organization remains visible.
9. Open **Facilities** and select **Add Facility**.
10. Create `My Organization Test Hospital` under **My Organization**.
11. Configure a unique hospital/MRN prefix such as `MYO`.
12. Complete facility location, departments, reporting configuration, readiness state, beds, wards, rooms, and service points.
13. Add at least one outpatient clinic, triage point, consultation room, laboratory, pharmacy, cashier point, imaging service, and inpatient ward.
14. Add a small test medication stock with a known quantity, unit, batch/lot number, and expiry date.
15. Record the starting medication quantity in your evidence sheet.
16. Reload and verify all facility settings persisted.

### Expected result

| Check | Expected outcome | Result |
|---|---|:---:|
| Organization | `My Organization` is active and reloads correctly | ☐ |
| Organization type | Public | ☐ |
| Facility | `My Organization Test Hospital` belongs to the correct organization | ☐ |
| MRN prefix | New patient numbers use `MYO` | ☐ |
| Clinical resources | Clinic, triage, room, lab, pharmacy, cashier, imaging, and ward are available | ☐ |
| Inventory | Test medicine has a known starting quantity and valid lot | ☐ |

### Tenant-isolation exercise — strongly recommended

1. Create `Isolation Control Organization` and `Isolation Control Facility`.
2. Create one test patient there.
3. Never assign a **My Organization** user to that organization.
4. Later, search for this patient's name and ID from every **My Organization** account. The expected result is no match and no direct-record access.

## 4. Create the User Accounts

### What the learner will understand

Every account has an identity, credentials, a role, and a scope. The role grants capabilities; the scope limits where those capabilities apply. Both must be correct.

As Super Admin, open **Manage → People**. Select **My Organization** and **My Organization Test Hospital**, then choose **Add Person**. Complete Identity, Credentials, and Scope for each row below.

For every account:

1. Use the displayed test name and suggested username, or your own unique equivalent.
2. Add a test email address where available.
3. Generate a unique temporary password; never put passwords in the evidence sheet.
4. Select the role.
5. Select **My Organization** when the role requires an organization.
6. Select **My Organization Test Hospital** when the role requires a facility.
7. Save and securely hand the one-time credentials to the tester.
8. Confirm the new user appears with the correct organization and facility.
9. Sign in as that user in the incognito window and change the temporary password when prompted.
10. Sign out before testing the next account.

| # | Role | Suggested username | Required scope | Expected landing page | Primary manual test |
|---:|---|---|---|---|---|
| 1 | Super Admin | Existing account | Global; no org/facility | `/admin` | Provisioning, security, audit, risks |
| 2 | Org Admin | `myorg.admin` | My Organization; no facility | `/facility-management` | Staff, facilities, organization settings |
| 3 | Doctor | `myorg.doctor` | Organization + facility | `/dashboard` | Consultation, diagnosis, orders, prescription |
| 4 | Clinical Officer | `myorg.clinicalofficer` | Organization + facility | `/dashboard` | Consultation and referral |
| 5 | Nurse | `myorg.nurse` | Organization + facility | `/dashboard` | Nursing care, ward, MAR, immunization |
| 6 | Midwife | `myorg.midwife` | Organization + facility | `/dashboard` | ANC, maternity, birth workflow |
| 7 | Lab Technician | `myorg.lab` | Organization + facility | `/dashboard/lab` | Specimen and results workflow |
| 8 | Pharmacist | `myorg.pharmacy` | Organization + facility | `/dashboard/pharmacy` | Verification, dispensing, inventory |
| 9 | Front Desk | `myorg.frontdesk` | Organization + facility | `/dashboard/front-desk` | Patient search, registration, appointment |
| 10 | Cashier | `myorg.cashier` | Organization + facility | `/payments` | Payment and receipt |
| 11 | Government | `test.government` | Global; no org/facility | `/government` | Aggregate national oversight only |
| 12 | County Health Director | `test.county` | Global; no org/facility | `/dashboard/state` | Aggregate county oversight only |
| 13 | Data Entry Clerk | `myorg.data` | Organization + facility | `/dashboard/data-entry` | Register entry and data quality |
| 14 | Medical Superintendent | `myorg.superintendent` | Organization + facility | `/dashboard` | Clinical and facility oversight |
| 15 | HRIO | `myorg.hrio` | Organization + facility | `/dashboard/data-entry` | HMIS quality and reporting |
| 16 | Nutritionist | `myorg.nutrition` | Organization + facility | `/dashboard/nutrition` | Nutrition screening and plan |
| 17 | Radiologist | `myorg.radiology` | Organization + facility | `/dashboard/radiology` | Imaging queue and report |
| 18 | Hospital Manager | `myorg.manager` | Organization + facility | `/facility-management` | Operations and finance overview |
| 19 | Medical Biller | `myorg.biller` | Organization + facility | `/payments` | Invoice and claim workflow |
| 20 | Central Registration Clerk | `myorg.registration` | Organization + facility | `/dashboard/front-desk` | Identity, duplicate check, MRN |
| 21 | Clinic Clerk | `myorg.clinicclerk` | Organization + facility | `/dashboard/front-desk` | Appointment, check-in, clinic queue |
| 22 | Triage Nurse | `myorg.triage` | Organization + facility | `/dashboard` | Acuity, vitals, triage queue |
| 23 | Rooming Nurse | `myorg.rooming` | Organization + facility | `/dashboard` | Rooming and medication reconciliation |
| 24 | Clinician | `myorg.clinician` | Organization + facility | `/dashboard` | Encounter, orders, treatment plan |
| 25 | Records/HMIS Officer | `myorg.records` | Organization + facility | `/dashboard/data-entry` | Completeness, registers, reports |

### Account provisioning record

Do not record passwords in this table.

| Role | Username created | Organization correct | Facility correct | First login complete | Result/notes |
|---|---|:---:|:---:|:---:|---|
| Org Admin | | ☐ | N/A | ☐ | |
| Doctor | | ☐ | ☐ | ☐ | |
| Clinical Officer | | ☐ | ☐ | ☐ | |
| Nurse | | ☐ | ☐ | ☐ | |
| Midwife | | ☐ | ☐ | ☐ | |
| Lab Technician | | ☐ | ☐ | ☐ | |
| Pharmacist | | ☐ | ☐ | ☐ | |
| Front Desk | | ☐ | ☐ | ☐ | |
| Cashier | | ☐ | ☐ | ☐ | |
| Government | | N/A | N/A | ☐ | |
| County Health Director | | N/A | N/A | ☐ | |
| Data Entry Clerk | | ☐ | ☐ | ☐ | |
| Medical Superintendent | | ☐ | ☐ | ☐ | |
| HRIO | | ☐ | ☐ | ☐ | |
| Nutritionist | | ☐ | ☐ | ☐ | |
| Radiologist | | ☐ | ☐ | ☐ | |
| Hospital Manager | | ☐ | ☐ | ☐ | |
| Medical Biller | | ☐ | ☐ | ☐ | |
| Central Registration Clerk | | ☐ | ☐ | ☐ | |
| Clinic Clerk | | ☐ | ☐ | ☐ | |
| Triage Nurse | | ☐ | ☐ | ☐ | |
| Rooming Nurse | | ☐ | ☐ | ☐ | |
| Clinician | | ☐ | ☐ | ☐ | |
| Records/HMIS Officer | | ☐ | ☐ | ☐ | |

## 5. Learn the Main Platform Workflow

TamamHealth separates responsibilities so each user completes a controlled part of the patient's journey. Data should move through queues and linked records; staff should not re-enter information that already exists.

### 5.1 Outpatient journey at a glance

| Stage | Primary role | What the role adds | Handoff/next destination |
|---:|---|---|---|
| 1 | Central Registration Clerk | Identity, demographics, identifiers, insurance, MRN | Clinic Clerk/Front Desk |
| 2 | Clinic Clerk | Appointment, arrival, clinic, check-in | Triage queue |
| 3 | Triage Nurse | Vitals, complaint, acuity, initial assessment | Rooming/clinical queue |
| 4 | Rooming Nurse | History, medication reconciliation, room readiness | Clinician |
| 5 | Clinician/Doctor/Clinical Officer | Clinical note, diagnosis, plan, orders, prescription, referral | Lab, radiology, pharmacy, billing |
| 6 | Lab Technician | Specimen lifecycle and verified result | Patient chart and ordering clinician |
| 7 | Radiologist | Imaging workflow, report, impression | Patient chart and ordering clinician |
| 8 | Pharmacist | Prescription verification, lot selection, dispensing | Patient chart and inventory ledger |
| 9 | Nurse/Nutritionist/Midwife | Ongoing or specialty care | Follow-up/next care team |
| 10 | Medical Biller | Invoice, payer, claim, adjustments | Cashier/payer |
| 11 | Cashier | Payment and receipt | Financial record completion |
| 12 | Records/HMIS/HRIO | Completeness, register, aggregate report | Management and oversight dashboards |
| 13 | Managers/Admins | Operational review, audit, risk, access control | Corrective action and approval |

### 5.2 The handoff principle

At every handoff, verify these five things:

| Verification | Question to ask |
|---|---|
| Correct patient | Do the name, MRN, date of birth, and identifiers match? |
| Correct context | Is this **My Organization Test Hospital**, the correct department, and the correct encounter? |
| Complete information | Did the previous role's data arrive without re-entry or missing fields? |
| Correct state | Did the item leave the old queue and enter the new queue exactly once? |
| Correct authorization | Can this role perform only the permitted action? |

> [!TIP]
> Keep the administrator window open for account and audit checks. Use the incognito window for the active role, sign out after every station, and never share a session between two role tests.

## 6. Baseline Access Test for Every Account

Repeat this checklist for all 25 roles before starting the clinical workflow.

1. Sign in with the correct username and password.
2. Confirm the user reaches the expected landing page shown above.
4. For organization-scoped users, confirm **My Organization** is shown.
5. For facility-scoped users, confirm **My Organization Test Hospital** is shown.
6. Open each visible sidebar item and confirm it loads without a 404 or 500 error.
7. Use browser Back and Forward and verify the page and selected record remain correct.
8. Reload one page and confirm the session remains active.
9. Attempt one forbidden action by entering its URL directly. Examples: Pharmacist opens a consultation action; Nurse opens dispensing; Cashier opens clinical notes; Government opens a patient record. Expect an access-restricted response or safe redirect.
10. Search for the Isolation Control patient if you created one. Expect no result.
11. Sign out and use Back. Confirm protected information does not reappear.
12. Record Pass, Fail, or Blocked and attach evidence.

## 7. Guided Outpatient Journey

### What the learner will understand

This exercise follows one fictional adult patient through a complete visit. Each subsection identifies the active role. Sign out at the end of a subsection, then sign in as the next role to experience the real handoff.

Use one fictional adult patient for Sections 7.1–7.14. Suggested data:

- First name: `TEST-UAT-YYYYMMDD-01`
- Last name: `Patient`
- Phone: leave blank on the first attempt, then add a valid test number
- Identifier/insurance: `UAT-YYYYMMDD-01`
- Complaint: fever and headache
- Test orders: Malaria RDT and FBC
- Test prescription: choose a safe test-only medication that exists in the facility inventory

### 7.1 Central Registration Clerk — identity and MRN

1. Search by test name, phone, and identifier before creating the patient.
2. Confirm no duplicate exists.
3. Attempt to save with a required field missing; verify a clear validation message.
4. Enter names containing a hyphen or apostrophe and verify they are accepted correctly.
5. Test the optional missing-phone path; the application must not invent a phone number.
6. Add demographics, address, identifier, and test insurance details.
7. Upload a small non-sensitive test image if photo upload is supported.
8. Save and record the patient ID and MRN/hospital number.
9. Confirm the MRN begins with the configured `MYO` prefix and remains unchanged after reload.
10. Repeat the same search terms and confirm the newly created patient appears only once.

### 7.2 Clinic Clerk — appointment and check-in

1. Find the patient by MRN.
2. Create or confirm an outpatient appointment.
3. Check the patient in to the correct clinic/department.
4. Confirm the patient enters the expected waiting queue once.
5. Attempt a second check-in and confirm it does not create a duplicate active visit.

### 7.3 Front Desk — registration quality and routing

1. Find the patient by name, phone, and MRN using the top search and patient search.
2. Verify demographics, insurance, appointment, and facility are correct.
3. Correct one harmless field, save, reload, and verify persistence.
4. Confirm the front desk can route the patient but cannot collect payment or edit clinical notes.

### 7.4 Triage Nurse — acuity and queue

1. Open the checked-in patient from the triage queue.
2. Enter temperature, pulse, respiratory rate, blood pressure, oxygen saturation, weight, and height.
3. Verify calculated values such as BMI when applicable.
4. Enter chief complaint, initial assessment, allergies, and acuity/priority.
5. Try one impossible vital value and verify validation prevents it or visibly warns the user.
6. Save and move the patient to the consultation queue.
7. Confirm the patient disappears from pending triage and appears exactly once for the next station.

### 7.5 Rooming Nurse — prepare the encounter

1. Open the patient from the rooming/clinical queue.
2. Verify triage vitals and complaint are already visible.
3. Record medication reconciliation, relevant history, and room assignment.
4. Mark the patient ready for the clinician.
5. Reload and verify the rooming state and notes persist.

### 7.6 Clinician — encounter, orders, and prescription

1. Open the patient from the clinical queue.
2. Confirm demographics, MRN, allergies, vitals, and prior notes belong to the correct patient.
3. Enter history, examination, assessment, and plan.
4. Add a coded primary diagnosis and one secondary diagnosis.
5. Order Malaria RDT and FBC.
6. Create one imaging order if the current workflow supports it.
7. Prescribe the selected in-stock medication with dose, route, frequency, duration, quantity, and instructions.
8. Test allergy and interaction warnings with safe test data; do not override a warning without recording why.
9. Set a follow-up and create a referral if applicable.
10. Save the encounter and record the encounter, lab-order, imaging-order, prescription, and referral IDs.
11. Confirm the patient moves to the correct downstream queues.

### 7.7 Doctor — review and sign-off

1. Open the same patient and review the clinician's note.
2. Verify the full audit trail and authorship are visible and correct.
3. Add a signed review note or conduct a second test encounter.
4. Confirm the Doctor can create diagnoses, lab orders, imaging orders, prescriptions, follow-up, and referral.
5. Leave a harmless edit unsaved, navigate away, and confirm an unsaved-changes warning appears; cancel navigation and verify the text remains.

### 7.8 Clinical Officer — independent encounter test

1. Start a short follow-up encounter for the same patient.
2. Record an assessment and referral.
3. Save, reload, and verify the encounter is separate from the Doctor and Clinician records and preserves correct authorship.

### 7.9 Lab Technician — specimen to result

1. Open the laboratory queue and find both orders by patient name or MRN.
2. Verify the patient, tests, priority, ordering clinician, facility, and timestamp.
3. Accept the orders and confirm their status changes to In Progress.
4. Record specimen collection, specimen ID, collection time, and acceptance.
5. Enter test-only results, reference ranges, flags, and comments.
6. Complete and release the results.
7. Confirm the orders leave the pending queue and appear as Completed.
8. In the clinical account, confirm the results appear on the correct patient without duplicate orders.

### 7.10 Radiologist — imaging report

1. Open the radiology queue and locate the imaging order.
2. Verify patient identity, requested study, priority, and ordering clinician.
3. Accept the study, enter a test report and impression, and finalize it.
4. Confirm the final report appears in the patient's chart and cannot be silently overwritten.
5. If no imaging order can reach this queue, mark the test Blocked and file a defect with screenshots from both roles.

### 7.11 Pharmacist — dispense and deduct inventory

1. Record the selected medicine's starting stock, unit, batch/lot, and expiry.
2. Open the prescription queue and find the patient.
3. Verify patient, allergies, medication, dose, route, frequency, duration, quantity, prescriber, and facility.
4. Select the correct non-expired batch/lot and confirm any unit conversion.
5. Open a second browser tab to the same prescription before dispensing.
6. Dispense in the first tab and record the confirmation and resulting inventory quantity.
7. Attempt to dispense the same prescription from the second stale tab.
8. Expect the second attempt to be rejected without another stock deduction.
9. Reload inventory and confirm the exact dispensed quantity was deducted once.
10. Confirm the chart shows one dispensing event with pharmacist, time, quantity, and batch/lot.

### 7.12 Nurse — ongoing care and medication administration

1. If the test patient is admitted, assign the patient to the configured ward and bed.
2. Create or update a nursing care plan.
3. Review medication orders and document one test administration in the MAR when appropriate.
4. Confirm the same dose cannot be recorded twice for the same scheduled administration without a warning.
5. Record a nursing note and verify authorship after reload.

### 7.13 Nutritionist — assessment and care plan

1. Open the patient's nutrition referral or find the patient.
2. Record anthropometrics and a nutrition screening.
3. Add an assessment, intervention/counselling plan, and follow-up date.
4. Save and confirm the clinical team can view the result while unauthorized financial users cannot edit it.

### 7.14 Referral and transfer

1. Open the referral created during consultation.
2. Verify origin, destination, reason, priority, clinical summary, and status.
3. Accept or reject it using the authorized role and record the state transition.
4. Confirm the patient is not silently moved to a different facility before an accepted transfer.
5. Confirm every status change appears once in the audit history.

### 7.15 Outpatient journey completion record

| Record | Identifier | Verified by | Result |
|---|---|---|:---:|
| Patient/MRN | | | ☐ |
| Appointment/check-in | | | ☐ |
| Triage record | | | ☐ |
| Clinical encounter | | | ☐ |
| Lab orders/results | | | ☐ |
| Imaging order/report | | | ☐ |
| Prescription/dispensing | | | ☐ |
| Referral | | | ☐ |
| Inventory transaction | | | ☐ |

## 8. Separate Maternity Workflow

### What the learner will understand

Maternity care uses a separate longitudinal workflow. The learner will connect ANC visits, observations, risk factors, birth information, follow-up, and referral without mixing the record with the general outpatient exercise.

Use a second fictional patient with appropriate test demographics. Do not reuse the general outpatient patient.

### Midwife

1. Register or open the fictional maternity patient.
2. Create an ANC encounter and record gestational data, history, risk factors, observations, and plan.
3. Schedule the next ANC visit and verify it appears in follow-up.
4. Exercise the maternity/admission workflow with clearly labeled test data.
5. Record a test birth outcome only where the environment permits safe cleanup.
6. Verify the birth record links to the correct mother and is not visible to financial-only roles.
7. Test immunization/referral handoff where supported.

## 9. Billing and Payment Workflow

### What the learner will understand

The Medical Biller prepares and manages charges and claims. The Cashier collects and receipts payments. Separating these duties protects financial accuracy and makes every transaction attributable to the correct user.

### Medical Biller

1. Find the main test encounter.
2. Verify billable consultation, laboratory, imaging, medication, and other services appear once.
3. Create or review the invoice and test insurance/claim information.
4. Confirm totals, adjustments, payer responsibility, and patient balance.
5. Submit or advance the test claim and record its state.
6. Confirm the Biller cannot edit clinical notes or dispense medication.

### Cashier

1. Find the invoice by patient name, MRN, or invoice number.
2. Record a test payment using an available method.
3. Verify paid amount, change, remaining balance, cashier, facility, and timestamp.
4. Generate a receipt and confirm it matches the transaction.
5. Attempt a duplicate payment submission and confirm it does not post twice.
6. Confirm the Cashier cannot edit claims or clinical records.

## 10. Records, Reporting, and Management Roles

### What the learner will understand

These roles convert completed care into clean registers, reports, staffing and facility decisions. They review authorized source information but must not perform clinical, laboratory, dispensing, or cashier actions outside their role.

### Data Entry Clerk

1. Open the relevant register and find the test encounter.
2. Enter or correct permitted non-clinical reportable fields.
3. Run available completeness and validation checks.
4. Confirm the clerk cannot sign clinical notes, release lab results, dispense, or post payments.

### HRIO

1. Review facility data-quality and completeness views.
2. Verify the test encounter is counted once in the correct period and indicator.
3. Resolve a safe test data-quality issue and confirm the audit record.
4. Generate the appropriate HMIS/DHIS2-ready report if enabled.

### Records/HMIS Officer

1. Find the patient and encounter in the registers.
2. Verify demographic, diagnosis, service, outcome, and reporting fields are complete.
3. Run a facility report for the test date and reconcile its count to the source record.
4. Export permitted report data and confirm organization/facility filters are correct.

### Hospital Manager

1. Review facility readiness, staffing, beds, wards, equipment, schedules, revenue, and service indicators.
2. Confirm the test activity updates the relevant operational totals once.
3. Confirm management views are scoped to **My Organization Test Hospital**.
4. Confirm the Manager cannot perform pharmacist or lab-technician completion actions.

### Medical Superintendent

1. Review clinical workload, queues, results, pharmacy, referrals, and facility performance.
2. Find the test encounter and confirm the complete authorized clinical timeline is present.
3. Verify conflict/data-quality tools where available.
4. Confirm oversight actions are audited.

### Org Admin

1. Verify **My Organization** details, enabled roles, facility, subscription tier, user-license usage, and facility limits.
2. Confirm all organization users and their correct facility assignments.
3. Add a second-facility assignment to one suitable test user, verify access to both, then remove it and verify access is removed.
4. Deactivate one non-critical test account and confirm login is blocked.
5. Reactivate it, issue a credential reset, and confirm the new temporary password forces a change.
6. Attempt to create Super Admin, Government, or County Health Director accounts. Expect the Org Admin to be prevented from granting these platform-only roles.

## 11. Aggregate Oversight Roles

### What the learner will understand

Government oversight roles use aggregate information for surveillance and performance monitoring. They are platform-wide by design, but their dashboards must not expose individual patient records.

### Government

1. Sign in and confirm the `/government` landing page.
2. Review national aggregate statistics, facility performance, and disease surveillance.
3. Confirm **My Organization** contributes only the appropriate aggregate test counts.
4. Search for the test patient's name, MRN, phone, and direct record URL. Expect no individual-patient access.
5. Confirm the account cannot create or edit organization users.

### County Health Director

1. Sign in and confirm the `/dashboard/state` landing page.
2. Review the permitted county/state aggregates and facility comparisons.
3. Confirm filters do not expose out-of-scope detailed records.
4. Search for the test patient's name, MRN, phone, and direct record URL. Expect no individual-patient access.
5. Confirm the account cannot edit clinical or financial transactions.

## 12. Platform Administration, Audit, and Risk

### Super Admin

1. Verify organization, subscription tier, license usage, facility count, readiness, and configured limits.
2. Confirm exceeding a user or facility limit is rejected with a clear message and no partial record.
3. Open the audit log and find the complete test chain: account creation, patient registration, check-in, triage, encounters, orders, results, dispensing, invoice, payment, reporting, reset, deactivate/reactivate, and denied access.
4. Verify audit columns start with User and span the card correctly, including Organization and Resolve where applicable.
5. Open the Risks page and verify its columns start with Signal, include Resolve, and span the card correctly.
6. Resolve a harmless test risk and verify the visual status, audit entry, organization, actor, and time.
7. Check that the removed Line chart option is absent and that each remaining chart-form selection changes the visualization.
8. Verify the search bar, table, and Export button align and that exported evidence respects current filters and tenant scope.

## 13. Resilience, Navigation, and Accessibility

Run these checks with representative Front Desk, Clinician, Lab, Pharmacy, and Admin accounts.

1. Resize to desktop, tablet, and mobile widths; confirm no hidden actions or horizontal clipping.
2. Navigate the full page using Tab, Shift+Tab, Enter, Space, and Escape.
3. Confirm every input and icon-only button has an accessible name and visible focus state.
4. Confirm loading, empty, success, warning, disabled, and error states are visually distinct.
5. Start a clinical note, refresh, switch tabs, and use Back; confirm saved drafts persist or a clear unsaved-changes warning appears.
6. Disconnect the network during a safe draft, continue where supported, reconnect, and verify the record syncs exactly once.
7. Force or observe an error and verify a useful message appears without exposing stack traces or private data.
8. Use global search for patient name, MRN, and phone; confirm correct and fast routing to the selected record.

## 14. Assessment and Defect Recording

### 14.1 Learner knowledge check

The learner should be able to answer these questions before sign-off:

| # | Question | Learner answer/reviewer notes | Complete |
|---:|---|---|:---:|
| 1 | What is the difference between a role and a scope? | | ☐ |
| 2 | Which three roles must not be assigned to My Organization? | | ☐ |
| 3 | Which role creates an MRN and which role records triage? | | ☐ |
| 4 | How does a clinician send work to laboratory, radiology, and pharmacy? | | ☐ |
| 5 | What must a pharmacist verify before dispensing? | | ☐ |
| 6 | What is the difference between a Medical Biller and a Cashier? | | ☐ |
| 7 | Why should Government and County users not open patient records? | | ☐ |
| 8 | Where do you verify who performed an important action? | | ☐ |
| 9 | What should happen when an account is deactivated? | | ☐ |
| 10 | What evidence proves organization isolation? | | ☐ |

### 14.2 Practical assessment

| Competency | Demonstrated independently | Trainer initials | Notes |
|---|:---:|---|---|
| Select the correct organization and facility | ☐ | | |
| Create and scope a user safely | ☐ | | |
| Register and find a patient without duplicates | ☐ | | |
| Complete a queue handoff | ☐ | | |
| Create and review clinical orders | ☐ | | |
| Fulfill a diagnostic order | ☐ | | |
| Dispense once and reconcile stock | ☐ | | |
| Reconcile invoice, payment, and receipt | ☐ | | |
| Produce a correctly scoped report | ☐ | | |
| Find an action in the audit log | ☐ | | |
| Recognize and report unauthorized access | ☐ | | |

### 14.3 Test execution record

| Test ID | Role | Action/workflow | Expected | Actual | Result | Evidence/defect |
|---|---|---|---|---|:---:|---|
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |

### 14.4 Defect recording template

For every failure, capture:

- **Defect ID and title**
- **Test run ID**
- **Environment and application version/commit**
- **Role, username, organization, and facility**
- **Patient/MRN/order/prescription/invoice ID** using test identifiers only
- **Exact steps to reproduce**
- **Expected result**
- **Actual result**
- **Time and timezone**
- **Screenshot or short recording** with sensitive data removed
- **Browser/device and network state**
- **Severity:** Critical, High, Medium, or Low

Severity guide:

- **Critical:** Cross-tenant or unauthorized PHI access, corrupted/lost clinical data, duplicate financial transaction, duplicate dispensing, or inability to complete the core care workflow.
- **High:** Major role cannot complete its work, incorrect patient/order linkage, incorrect totals, broken audit trail, or no safe workaround.
- **Medium:** Important function has a safe workaround or inconsistent state/UX.
- **Low:** Cosmetic, wording, alignment, or minor accessibility issue without workflow impact.

## 15. Final Approval Checklist

Do not approve the release until all are true:

- [ ] All 25 role access checks are recorded.
- [ ] All 22 organization-assigned users have the correct **My Organization** scope.
- [ ] All 21 facility-bound users have **My Organization Test Hospital** scope.
- [ ] Super Admin, Government, and County Health Director remain unassigned from organizations/facilities.
- [ ] The registration-to-reporting patient journey completes without a Critical or High defect.
- [ ] Lab and imaging results link to the correct patient and encounter.
- [ ] Pharmacy stock deducts exactly once under the stale-tab concurrency test.
- [ ] Invoice, payment, receipt, and claim amounts reconcile.
- [ ] Aggregate roles cannot open individual patient records.
- [ ] Cross-organization searches and direct URLs reveal no Isolation Control data.
- [ ] Deactivation, reactivation, credential reset, and forced password change work.
- [ ] Audit and risk evidence includes the correct user, organization, facility, action, time, result, and resolution.
- [ ] Navigation, unsaved changes, responsive layout, keyboard access, offline/reconnect, and error states pass.
- [ ] All failures have defect IDs, owners, severity, and retest status.

### Training completion and release decision

| Sign-off | Name | Decision/signature | Date |
|---|---|---|---|
| Learner | | | |
| Trainer/reviewer | | | |
| Clinical lead | | | |
| Organization administrator | | | |
| Release approver | | Approve / Reject / Conditional | |

## 16. Safe Cleanup

After approval:

1. Export and retain the UAT evidence according to policy.
2. In a test environment, remove or archive test patients and transactions using supported application controls.
3. In production, do not delete clinical or financial records casually; follow the approved correction and retention process.
4. Deactivate all temporary role accounts that will not be retained.
5. Remove unnecessary second-facility assignments.
6. Confirm cleanup actions are present in the audit log.
