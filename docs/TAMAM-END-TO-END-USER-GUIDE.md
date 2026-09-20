# Tamam Health: end-to-end user guide

Version 1.0 · 19 September 2026 · Application reference: `d676a8ee`

Audience: reception, clinical teams, diagnostics, pharmacy, finance, records, facility leadership, administrators, public-health teams, and patients.

## About this guide

This guide explains how work moves through Tamam, who performs each action, how to check that it succeeded, and what to do when the normal path fails. It is based on current application routes, permissions, workflow services, interface components, and targeted automated tests—not only on earlier screenshots or the older user manual.

**Verification boundary:** the current code and six workflow test suites were reviewed; all 41 targeted tests passed. The local browser sign-in page was inspected, but remained at offline-database initialization during this review. This is not a claim that every role, screen, integration, or production deployment has passed an interactive acceptance test. Facility-specific settings and the installed release can change the available buttons. Appendix B records these limits.

Examples use fictional training patients and illustrative amounts. Do not enter these examples into a live hospital database. This is software guidance, not a clinical treatment protocol or an authorization to override facility policy.

## Contents

1. [Start here: access and shared controls](#1-start-here-access-and-shared-controls)
2. [Which instructions apply to my role?](#2-which-instructions-apply-to-my-role)
3. [Complete outpatient example](#3-complete-outpatient-example)
4. [Reception, registration, and appointments](#4-reception-registration-and-appointments)
5. [Nursing: triage, rooming, and return from the doctor](#5-nursing-triage-rooming-and-return-from-the-doctor)
6. [Doctors and other prescribing clinicians](#6-doctors-and-other-prescribing-clinicians)
7. [Laboratory, radiology, pharmacy, and blood bank](#7-laboratory-radiology-pharmacy-and-blood-bank)
8. [Maternity, nutrition, immunization, and inpatient care](#8-maternity-nutrition-immunization-and-inpatient-care)
9. [Referrals and transfers](#9-referrals-and-transfers)
10. [Billing, payments, claims, and financial review](#10-billing-payments-claims-and-financial-review)
11. [Records, reporting, and public health](#11-records-reporting-and-public-health)
12. [Management and administration](#12-management-and-administration)
13. [Patients, guardians, and public booking](#13-patients-guardians-and-public-booking)
14. [Offline work, messages, and end-of-shift handover](#14-offline-work-messages-and-end-of-shift-handover)
15. [Troubleshooting and edge cases](#15-troubleshooting-and-edge-cases)
16. [Training scenarios and completion checks](#16-training-scenarios-and-completion-checks)
17. [Appendices: terminology, evidence, and deployment checklist](#appendix-a-what-the-statuses-mean)

## 1. Start here: access and shared controls

### Before your first shift

Ask your facility administrator for the correct Tamam address, your individual account, assigned role and facility, support contact, and downtime procedure. Confirm that service catalogues, clinicians, rooms, and payment methods required by your job are configured. A training account must point to a training environment.

1. Open the facility-provided address and select staff login.
2. Enter the issued username or staff ID and password. Select your role if the login form requires it.
3. Complete any verification challenge presented. Do not share a password, verification code, or another person's session.
4. Check the name, role, facility, and date shown after login. Stop if they are wrong.
5. Confirm whether the app is connected and whether data has finished loading before interpreting an empty queue.

Use **Forgot password** for the recovery flow available at your site. If recovery cannot be delivered, contact the administrator; repeated guesses may cause rate limiting. A locked session and an expired login are different problems: use the displayed unlock or sign-in action, not someone else's credentials.

An invitation, pending account request, or patient registration does not by itself grant staff access. Account provisioning and approval are separate activities.

### Find the right patient before doing anything else

Search by patient number first when available, then confirm at least two identifiers under facility policy. Compare the full chart identity with the person and the intended visit. A shortened list name is not sufficient when two people have similar names.

Family members may share a phone number. They must still have separate patient records, patient numbers, visits, and clinical histories. A shared number is not permission to merge records or reveal one family member's information to another.

### Shared navigation and forms

- **Dashboard:** work appropriate to your role; it is not necessarily every visit in the facility.
- **Patients:** longitudinal records. Open the appropriate chart tab rather than creating a new patient for each visit.
- **Appointments:** scheduled or requested bookings; verify date, facility, clinician, and filters.
- **Notifications:** attention items. Marking one read does not complete the underlying clinical task.
- **My Tasks / Messages / Announcements:** coordination tools, not substitutes for signed notes, orders, results, or a documented handoff.
- **Search, filters, and pagination:** apply to the current list. Clear them before concluding that a record is missing.
- **Popups:** confirm patient and visit context, complete required fields, review, submit once, and verify the saved result. Closing is not saving. Draft preservation varies by form.

Read labels and error text rather than relying on color or icon shape. English and Juba Arabic layouts may differ. On small screens, scroll tables and popup bodies to find additional fields and actions.

**Four different confirmations:** a visible entry may be a draft; a successful save may be local; synchronization may still be pending; a clinical handoff is complete only when the receiving workflow or person has accepted responsibility.

## 2. Which instructions apply to my role?

These are the 25 staff roles in the current routing configuration. A visible page does not grant every action on that page; action permissions and data scope still apply.

| Role | Usual starting workspace | Main work and handoff |
|---|---|---|
| Medical receptionist (`front_desk`) | Reception dashboard | Register, schedule, confirm arrivals, assign care team, coordinate checkout → nursing/clinician |
| Central registration clerk | Reception dashboard | Establish identity and arrival, correct demographics → clinic team |
| Clinic clerk | Reception dashboard | Manage clinic arrivals, scheduling and routing → rooming/clinician |
| Nurse | Clinical dashboard | Nursing assessment, assigned care, post-consult work, ward care → next responsible team |
| Triage nurse | Clinical dashboard / Triage | Assess and record triage, identify destination → rooming or emergency team |
| Rooming nurse | Clinical dashboard / Rooming | Prepare the visit and hand over → clinician; receive post-consult tasks |
| Doctor | Clinical dashboard | Assess, document, prescribe, order investigations, choose disposition → next station |
| Clinical officer | Clinical dashboard | Authorized consultation and orders → nursing/diagnostics/pharmacy |
| Clinician | Clinical dashboard | Authorized consultation and orders → appropriate receiving team |
| Medical superintendent | Clinical dashboard | Clinical work and permitted operational oversight → accountable service leads |
| Midwife | Clinical dashboard / maternity modules | ANC and maternity records, nursing/maternity handoffs → appropriate clinical team |
| Laboratory technician | Laboratory dashboard | Process orders, specimens and results → requesting clinician |
| Radiologist | Radiology dashboard | Perform/report studies → requesting clinician |
| Pharmacist | Pharmacy dashboard | Review and dispense prescriptions, manage medicine workflow → patient/clinical team |
| Nutritionist | Nutrition dashboard | Screen, record nutrition care and follow-up → clinical/referral team |
| Cashier | Payments | Collect and reconcile permitted payments → receipt and outstanding-balance follow-up |
| Medical biller | Payments | Billing, claims and permitted collections → payer/cashier/finance lead |
| Data entry clerk | Data-entry dashboard | Authorized capture and record-quality work → records lead |
| HRIO | Data-entry dashboard | Health information quality and reporting → facility/public-health reporting chain |
| Records/HMIS officer | Data-entry dashboard | Record quality, reporting, authorized exports → reporting recipients |
| Hospital manager | Facility management | Operational, resource and financial oversight → department owners |
| County health director | State dashboard | Scoped aggregate oversight and reporting → public-health management |
| Government user | Government dashboard | Aggregate reporting and surveillance oversight → reporting/action owners |
| Organization administrator | Facility management | Organization/facility setup, users and permitted configuration → local operators |
| Super administrator | Administration | Platform-wide configuration, security and recovery → responsible organization/operator |

Reception roles manage care-team assignment. Clinical roles can request/book appointments where permitted, while confirmation and cancellation are scheduling functions. Cashiers and medical billers do not gain booking authority just because they can open an appointment-related page. Laboratory and pharmacy chart access is limited. Aggregate public-health roles must not be treated as unrestricted patient-chart accounts.

Super-administrator capabilities are broad in the current implementation. Do not use that account for routine care or to work around a missing staff permission. Refer access changes to an authorized administrator.

## 3. Complete outpatient example

**Training case:** Amina Example brings her child Sami Example for a routine visit. They share a household phone. Sami needs assessment, an investigation if ordered by the clinician, nursing follow-up, and checkout. Clinical decisions in this example are placeholders, not treatment recommendations.

The normal path is:

**Find/register → arrival → triage → rooming → clinician → ordered services → nurse follow-up → clinic checkout → facility checkout → follow-up.**

Diagnostics, pharmacy, and financial work can run in parallel. They are not always a single fixed queue.

| Step and owner | Action | Evidence before handing over |
|---|---|---|
| 1. Reception | Search Sami's name and identifiers; reuse the record if found, otherwise register Sami separately from Amina | Correct patient number; shared phone has not merged identities |
| 2. Reception | Create/select today's visit, reason, clinic and eligible care team; record arrival | Correct linked visit appears in the reception workflow |
| 3. Triage nurse | Verify identity, record measured observations and assessment, route appropriately | Saved triage and clear destination; missing data is not marked normal |
| 4. Rooming nurse | Review preparation, allergies and relevant history; complete required rooming information | Visit is ready for the clinician, with an explicit handoff |
| 5. Clinician | Review chart, assess, document, create only indicated orders, save/sign as required | Note, orders and intended disposition are attached to the correct encounter |
| 6. Diagnostics | Process the actual order and record its result | Result is saved and available for clinician review; urgent communication acknowledged |
| 7. Clinician | Review returned results and update the plan | Final/current plan is clear, not an abandoned draft |
| 8. Nurse | Accept post-consult ownership, perform assigned tasks, record evidence | Tasks are completed or explicitly deferred to a named owner with a due time |
| 9. Pharmacy | If prescribed, verify and dispense the authorized quantity | Dispensing record and any remainder/exception are visible |
| 10. Finance | Review charges/invoice, collect or document the actual funding outcome | Receipt/claim/plan/waiver evidence matches reality; balances reconcile |
| 11. Checkout team | Review all clinical stations, pending items and instructions; record disposition | Visit is closed safely or has explicit pending-item ownership; follow-up is booked/requested correctly |

At the end, search the patient again. Confirm this is one patient record with one intended visit, not a new record at each station. Check that the clinical outcome, financial outcome, and next appointment each say what actually happened.

## 4. Reception, registration, and appointments

### Register a new patient

1. Search before choosing **New patient**. Try patient number, full name, and other available identifying details.
2. Enter demographics. Use an estimated-age option where available if the birth date is unknown; do not invent a precise date or government ID to satisfy a field.
3. Complete contact/location and next-of-kin or guardian sections as appropriate. Identify whose phone is recorded.
4. Record coverage and other required registration information. A stated insurer is not verified coverage or a paid bill.
5. Review identity carefully, save once, and confirm that a patient number and chart exist.
6. Start the visit or book an appointment as a separate step.

**Duplicates:** the current service allows shared phones and checks other identity details, including national ID and combinations of name/birth date. If warned, compare the records through authorized access. Do not change an ID just to defeat validation. If a possible match is outside your scope, ask the records team to resolve it without expanding your own access.

**Returning patient with incomplete details:** open the existing chart, verify identity, update permitted missing information, and create the new encounter. Do not create a replacement patient simply because the old record is incomplete.

### Book and confirm an appointment

1. Open **Appointments** or the booking action in the patient's chart.
2. Select/confirm the patient, facility, clinic, eligible clinician, reason, date, duration, and available slot. Select a room if required.
3. Review the summary and submit once.
4. Check the resulting booking status and identifier. A request awaiting confirmation is not a confirmed appointment.
5. Reception/scheduling staff confirm it where required. Verify visibility under the correct day and facility, including the assigned clinician's permitted view.
6. On arrival, check in the existing appointment instead of creating a second walk-in for the same attendance.

The final save checks conflicts again. A clinician's commitment at another facility can make a slot unavailable; room availability is facility-specific. If another user takes the slot first, refresh available times and choose a new one. Preserve patient details, but recheck the final summary.

**Reschedule/cancel/no-show:** use the authorized appointment action and document the reason where requested. Check the new time and downstream notifications. Do not mark a patient no-show just because a filter hides their arrival.

### Walk-ins and care-team assignment

Select an existing patient in the walk-in flow, add the visit reason and destination, and verify the arrival record. A walk-in form is not a new-patient registration form. Assign only an eligible clinician/staff member offered for the correct facility. If the list fails to load, escalate the directory problem; do not select an unrelated clinician to make the form submit.

Reception completion check: correct identity, one intended visit, correct destination, visible arrival, and a receiving team. Front-desk access does not automatically permit collecting money.

## 5. Nursing: triage, rooming, and return from the doctor

### Triage

1. Open the arrival in your scoped dashboard/triage queue and verify identity and encounter.
2. Record observations actually obtained, including units and relevant timestamps. Document inability to obtain a value rather than entering zero or an invented normal value.
3. Record the assessment and priority under the facility's approved clinical protocol.
4. Save and select the appropriate destination: clinic/rooming, emergency escalation, or another supported route.
5. Verify that the next team can identify the patient and see the handoff.

Incomplete triage must not be interpreted as a completed, reassuring assessment. If the patient leaves before being seen, record the actual departure outcome rather than completing fictitious care.

### Rooming

Open the routed visit; confirm triage, allergies, relevant history, and required preparation. Record corrections with attribution. Set the visit ready for the clinician only when the required preparation is done. If assigned incorrectly, use the supported return/reroute process rather than deleting the encounter.

### After the clinician: the return-to-nurse workflow

1. Open the post-consult work associated with the same encounter. The panel may be absent if there are no tasks.
2. Read the latest clinical plan and accept ownership of the work.
3. Open linked notes, prescriptions, investigations, or procedures as needed. A checklist item does not replace these source records.
4. Complete each task only after performing it; enter the evidence/note required by the form.
5. If a task must be deferred, record the reason, an eligible named owner, and the due date/time.
6. For transfer of responsibility, select the recipient and document the reason. Confirm the handoff, not just a message being sent.
7. If the clinician changes the plan, review the updated plan before completing tasks. The application can block completion against an outdated plan revision.
8. Complete the nursing handoff and send the patient to the next required station or checkout.

Do not use a clinician bypass reason as a routine shortcut around outstanding nursing work. If no tasks are clinically required, the authorized clinician must document that decision.

**Example:** Sami's results return after the first nursing instructions. The clinician updates the plan. The nurse reviews the revised instructions instead of completing the old checklist unchanged.

## 6. Doctors and other prescribing clinicians

1. Open the assigned visit from the clinical dashboard. Confirm patient, encounter, facility, allergies, triage and relevant previous records.
2. Start the consultation and document history, findings, assessment and plan in the appropriate fields.
3. Add diagnoses and create any indicated laboratory, imaging, procedure, medication, or referral orders. Check patient, encounter, dose/units where applicable, and destination before submitting.
4. Save a draft if interrupted. A paused draft is not a finished consultation or signed clinical decision.
5. Review returned results and explicitly act on important findings. Result availability does not prove that it has been reviewed.
6. Update the plan, provide nursing/post-consult instructions, and choose the true disposition: next station, referral, admission, or checkout.
7. Complete required documentation and handoffs. Arrange follow-up through the appointment workflow; reception may need to confirm it.

**Completion check:** the current plan is recorded, orders are intentional, relevant results have been reviewed or assigned for follow-up, and the receiving person/service knows what is required.

An unresolved procedure or post-consult conflict can block completion. Review the underlying item; do not cancel a valid clinical order merely to obtain a completed status. When two users edit the visit, reload the latest revision and reconcile changes before saving again.

## 7. Laboratory, radiology, pharmacy, and blood bank

### Laboratory technician

1. Open the laboratory worklist and filter by facility, date and order state.
2. Verify the patient, encounter, requested test, specimen requirements and order identity.
3. Record collection/receipt and processing through the available actions. Do not treat an uncollected specimen as a completed test.
4. Enter results with correct units and required supporting information; review before finalizing.
5. Confirm the result is attached to the original order and visible to the authorized clinical team.
6. Communicate urgent findings using the facility escalation procedure and document acknowledgement; a notification alone is not closed-loop communication.

If a specimen is unsuitable, a test is unavailable, or equipment fails, document the exception and coordinate recollection/referral. If a finalized result is wrong, use the authorized correction procedure and notify the clinical team; do not silently replace its meaning.

### Radiologist / imaging team

Open the ordered study, verify identity and the study requested, then use **Start study** when work begins. Attach appropriate images where supported, enter the report, review, and submit. Confirm completion and availability to the requesting clinician. A uploaded image without a completed report is not necessarily a completed diagnostic workflow. Handle wrong attachments and report corrections through authorized actions with clinical notification.

### Pharmacist

1. Find the prescription in the pharmacy worklist; confirm identity and the active order.
2. Review prescription details, allergies, prior dispensing, available stock and applicable clearance rules.
3. Record the actual medicine, quantity and dispensing details required by the form.
4. Confirm the saved dispensing event and any quantity still outstanding.
5. Provide counselling under professional practice and communicate substitutions, shortages, deferrals or referrals to the responsible clinician.

Do not record a full dispense for a partial supply. Do not repeat a dispense after a slow response without checking whether the first succeeded. Concurrent dispensing and over-dispensing are guarded in the tested service. An uncleared order can be rejected; resolve the actual clearance issue with the responsible team instead of issuing a duplicate order.

Payment difficulties affecting urgent/life-sustaining care require clinical and administrative escalation, not an unrecorded abandonment of the patient.

### Blood bank and controlled substances

Authorized blood-bank users record stock with unit identity and expiry, reserve it for the correct patient, record crossmatch outcome, and record transfusion or discard with the required reason. Reservation is not transfusion. An incompatible or expired unit must not be treated as available simply because it remains in a list. Tamam does not replace bedside identity, compatibility and transfusion checks.

Authorized controlled-substances users use the dedicated register and required accountability process. Follow local witness, reconciliation and correction policy; never adjust the ordinary inventory alone to conceal a discrepancy.

## 8. Maternity, nutrition, immunization, and inpatient care

### Midwife and maternity team

Find the mother's existing chart; select the correct pregnancy/ANC episode and visit. Review prior information, enter actual observations, screening and the care plan, then save the visit and arrange the next attendance or referral. Use available chart results without assuming maternity access permits laboratory result editing or general prescribing.

For a birth, verify mother/baby linkage and record the event accurately. A newborn needs the appropriate distinct identity; sharing a guardian's number does not combine their records. Record maternal and newborn outcomes separately. Correct uncertain information through the records process rather than fabricating identity or event details.

Birth and death registration entries are sensitive records. Only authorized users should enter or amend them, following facility review and applicable reporting procedures. A clinical outcome and an official reporting submission are not interchangeable.

### Nutritionist

Open the nutrition dashboard, find the patient and screening, and enter actual measurements with correct units and age context. Review the displayed classification against professional assessment. Record the selected treatment/referral and follow-up action, then confirm it is saved. Review supply entries and low-stock indicators where part of your duties.

If a measurement is missing or implausible, recheck it rather than treating an automatically displayed category as definitive. A follow-up flag should reflect completed follow-up, not simply an attempted phone call.

### Immunization staff

Verify patient, age, prior history, vaccine and the event being recorded. Enter actual administration details in the immunization module, including the fields required by the site. Save and check the patient's history and next due action. Distinguish historical doses from doses given today; do not give or record an extra dose solely because an unsynchronized history is missing.

### Inpatient nurses and ward teams

1. Confirm an admission exists for the correct patient and receiving ward/bed. Outpatient **Admitted** is a handoff to inpatient care, not discharge home.
2. Review the admission and active orders; accept the patient using the local handover process.
3. Document nursing care and use the medication administration record (MAR) for actual administrations.
4. Record the truthful MAR outcome: **Given**, **Missed**, **Refused**, or **Held**. Use the correction workflow when needed. Do not record administration in advance.
5. At shift change, use the ward handoff workspace and communicate outstanding actions and risks to the incoming team.
6. At transfer or discharge, reconcile outstanding work, medications, instructions and follow-up; verify the correct disposition and bed/ward status.

When no bed is available, escalate capacity and record the actual placement plan. Never claim a patient occupies a bed that has not been assigned. A pharmacy dispense and a bedside administration are separate events.

## 9. Referrals and transfers

The sending team creates the referral/transfer against the correct patient and visit, specifying destination, purpose, urgency and required supporting information. Review and submit; verify that it appears in the referral worklist.

The receiving team acknowledges the referral, records intake, and later records the outcome using permitted actions. The sending team follows up unacknowledged or overdue referrals. A referral being sent does not prove acceptance, transport, arrival, consultation, or a returned outcome.

**Example:** a facility requests an imaging service elsewhere. The originating clinician documents the reason; the receiving service acknowledges; the patient is received and the report/outcome returned. The originating team reviews it and completes follow-up. If transmission is unavailable, use the approved alternate handoff channel and reconcile the digital record when connectivity returns.

If the wrong destination was selected, coordinate a correction rather than creating several uncontrolled referrals. Keep ownership explicit while a patient is in transit or waiting for acceptance.

## 10. Billing, payments, claims, and financial review

### Understand the separate records

- A **charge** records a service item.
- An **invoice** groups billable items and amounts.
- A **payment/receipt** records money received and its allocation.
- An **insurance claim** requests payer settlement; submitted or approved does not mean settled.
- A **payment plan** schedules repayment; creating it does not collect money.
- A **waiver** documents an authorized reduction/exception; it is not cash received.
- **Visit financial review** evaluates evidence for a particular encounter. No invoice or a displayed zero balance is not automatically financial approval.

Clinical progress, appointment status and financial status are separate. The reviewed financial-review interface states that service-clearance enforcement is not enabled; do not assume the app universally blocks patients based on billing. Individual order workflows may have their own checks. Emergency care, triage and clinical discharge must not be confused with a cashier's receipt workflow.

### Add services and proceed to payment

1. Open the patient's **Billing** tab; verify patient, selected encounter and currency.
2. Open the billing actions/service action and choose **Add services**.
3. Select real services from the catalogue. Review quantities and prices; remove accidental items before posting.
4. Post charges once. Check that posting succeeded and inspect the resulting billing activity/invoice evidence.
5. Continue to payment only after successful posting. If the action is disabled, read the outstanding prerequisite rather than submitting charges again.
6. Choose the applicable method in the payment popup and complete its specific fields.
7. Review patient, invoice, amount, currency, method and reference; submit once and check the resulting receipt and balance.

An encounter-specific review and a patient-wide activity list can show different totals. Confirm their scope before deciding there is a discrepancy.

### Payment method instructions

| Method | Before recording | Enter and verify | Completion evidence |
|---|---|---|---|
| Cash | Count actual money received | Amount, currency, tender/change information shown by the form | Receipt and correct invoice balance; cash reconciles |
| Mobile money | Verify the provider's successful transaction | Enabled provider and genuine transaction reference/details | Saved receipt matched to provider evidence |
| Card | Verify success on the approved payment channel/terminal | Only permitted transaction details, such as requested last digits/reference | Terminal evidence and Tamam receipt agree |
| Bank transfer | Verify receipt through the authorized finance process | Bank, transfer reference and required details | Reconciled receipt; a promised transfer is not collected cash |
| Insurance | Verify coverage and the actual claim stage | Correct payer/claim evidence and permitted allocation | Claim outcome is accurate; settlement recorded only when actually received |
| Waiver | Obtain the authorized approval | Reason and approver information requested | Traceable waiver, not a fictitious payment |

Only methods enabled for the facility should be offered. Do not enter full card numbers, PINs or CVVs into notes. Selecting a method does not itself prove that Tamam processed a real transaction with a provider.

### Worked payment example

In training, an invoice is **SSP 12,000**. The patient pays **SSP 5,000** cash. Record that amount, not the full invoice. The expected remaining amount is **SSP 7,000**, assuming no other payments or adjustments. A plan for the remainder is a plan—not a second receipt.

If the remaining SSP 7,000 is later paid by mobile money, verify the transaction, record it once, and check the invoice allocation and account balance. Do not use an SSP overpayment to mark a separate USD invoice paid without an authorized currency/allocation process.

### Cashier: daily work

Open **Payments → Accounts**, search the patient and inspect account details. Review invoices, receipts, plans and outstanding amounts. Collect only against the correct patient/invoice. Print or share a receipt through the authorized channel, then reconcile the day's payments by method and currency. Escalate unmatched transactions, incorrect allocations or reversal requests.

### Medical biller: claims and exceptions

Open the claims workspace, verify the patient's coverage, invoice items, payer, references and required supporting information. Submit through the configured process. Track the actual outcome—pending, partial, rejected, approved or settled as applicable—and record allowed amounts and payments accurately. Resolve rejected claims with corrected evidence rather than duplicating them blindly. A cashier's role does not automatically include claims management.

### Financial review and corrections

Select the exact visit before reviewing invoice evidence. Check finalized invoice items, valid receipts/allocations, adjustments, currency and any conflicts. Reversed receipts, draft invoices, stale totals and duplicate receipt identifiers require reconciliation; they must not be treated as valid settlement evidence.

For an erroneous receipt, use the authorized reversal/correction action with the required reason and approval. Inspect history afterward. Reversing a record is not proof that money was returned through a bank or mobile provider. Never delete financial evidence to make totals look right.

If a payment-plan installment is recorded, verify both plan progress and invoice/account allocation. If only one updates, stop and ask finance support to reconcile before collecting again.

## 11. Records, reporting, and public health

### Data entry clerk

Open the data-entry workspace, choose the authorized task, verify the source and patient/event identity, and capture the information accurately. Distinguish event time from entry time. Review and save, then check the record and any validation errors. Do not invent missing clinical information or sign clinical decisions on another professional's behalf.

### HRIO and records/HMIS officer

Review completeness and data-quality queues, investigate duplicates through the approved process, and correct permitted demographic/reporting errors with an audit trail. Select the correct facility, clinical reporting period and report definition; review unexpected totals against source records. Generate permitted reports/exports and verify the output before distributing it.

For DHIS2-ready exports, confirm mappings, reporting period, facility identifiers and local approval. Creating or downloading an export is not proof that the national system accepted it. Record submission and acknowledgement through the facility reporting procedure.

### County health director and government users

Use the scoped aggregate dashboard, reporting, surveillance and other authorized oversight pages. Confirm geographic scope, reporting period, freshness and completeness before interpreting trends. Review alerts and assign follow-up through the established public-health process. Missing reports are not zero disease incidence, and a software alert is not a confirmed outbreak.

Aggregate access does not authorize opening individual clinical records. Request corrections or investigation from the responsible facility through approved channels.

## 12. Management and administration

### Hospital manager

At the start of the day, review facility operations, staffing, resource availability, outstanding financial work and permitted reports. Assign action owners for exceptions. Use the available HR, leave/schedule, equipment, preparedness and facility-assessment modules within your permissions. Review and confirm changes; a draft roster or leave request is not an approved staffing plan.

End the cycle by checking whether the responsible department completed the action and whether the dashboard reflects current data. Use reporting for diagnostic/pharmacy utilization; management access does not imply permission to operate every clinical queue.

### Medical superintendent

Use the clinical workflow for personal care work and the permitted operational/scheduling/financial controls for oversight. Review unresolved clinical handoffs and escalation items. Distinguish clinical authority from reporting/export permissions—do not assume every managerial capability is included.

### Organization administrator

Verify the organization and facility before configuring users, eligible staff, departments, pricing, branding or other permitted settings. Grant the minimum role and facility scope required. Have the staff member verify their own dashboard and allowed actions after provisioning. Removing access or changing roles must follow the organization's approval procedure.

Before a facility starts work, validate clinician availability, rooms, service catalogue, currencies, enabled payment methods and contact/support details. Test notifications and external integrations in an approved test environment; configuration existing on a screen does not prove delivery works.

### Super administrator / technical operator

Use administration for authorized platform configuration, audit/security review, sync/conflict investigation and recovery. Keep routine patient care in appropriately scoped staff accounts. Investigate record conflicts and replication failures without deleting unsynchronized device data.

Backups, restores, tenant configuration, production releases and security incidents belong to the operator runbooks and approved change process. Verify restore tests and recovery responsibilities; do not experiment on live databases from a user guide. See [Operator runbook](OPERATOR-RUNBOOK.md) and [backup operations](operations/backups.md).

## 13. Patients, guardians, and public booking

### Patient portal

Use the facility-provided patient portal, not staff login. Complete account activation through the offered process. Sign in with the portal username and password; if an SMS challenge is presented, enter the code sent to the registered number. The current interface describes a six-digit code expiring after five minutes. Do not share it with someone claiming to be support.

After login, review the available overview, appointments, records, laboratory results, prescriptions, radiology, immunizations, messages, billing and profile sections. Visibility depends on available records and access rules. Use supported actions to request appointments, communicate or correct contact information, then verify acknowledgement.

A shared household phone is not shared portal authorization. Guardians need the facility's approved access arrangement; registration of a guardian's contact number alone does not grant access to all relatives' charts.

If a result is confusing, ask the care team. Do not interpret an empty results page as a negative test. Portal messaging is not an emergency service.

### Public appointment requests and payment links

Choose the intended facility/service, complete the public booking form accurately, review and submit once. Keep the confirmation/reference shown. A request may still require reception confirmation; do not assume a requested time is reserved until the facility confirms it.

For a payment link, verify the official origin, patient/invoice context and amount before using it. Keep the resulting payment evidence and contact finance if the invoice does not update. Do not pay repeatedly because a page is slow.

**Example:** Amina requests Sami's follow-up. Reception confirms the eligible clinician and time. Amina checks the confirmed information rather than relying only on the original request acknowledgement.

## 14. Offline work, messages, and end-of-shift handover

### What offline means

Tamam uses local browser data for many staff workflows, but not everything works without a network. First-time authentication, expired or missing offline credentials, portal requests, external payment services, SMS, email, cross-device delivery and records not yet downloaded may require connectivity.

An offline login may be possible only when the device has a valid cached credential for that user. A different user on a shared device, a cleared browser, or an expired cache can require reconnecting. A password changed elsewhere can also require reconciliation through online sign-in.

### Safe outage procedure

1. Identify whether the problem is internet, facility network, application server, device power, or a single failed action.
2. Preserve the current device and unsynchronized work. Do not clear browser storage, reinstall, or switch repeatedly between browsers as a first troubleshooting step.
3. Continue only supported local workflows and use the approved downtime process for unavailable ones.
4. Communicate urgent handoffs directly through the approved channel; do not assume another device received an offline notification.
5. On reconnection, check sync status, failed records and duplicates. Reconcile downtime entries before re-entering them.
6. Escalate conflicts to the designated operator/records lead. Do not automatically keep the newest-looking record without review.

### Messages, notifications, tasks and announcements

Use the correct recipient and the minimum necessary patient information. Link the patient where supported rather than copying extensive clinical data into free text. Read announcements relevant to your work. Complete the underlying task before marking your coordination item done. For urgent results or handoffs, confirm receipt and responsibility explicitly.

### End every shift with a handover

- Review arrivals not yet seen, active consultations, pending tests, undispensed medicines, post-consult tasks and referrals awaiting acknowledgement.
- Assign each unresolved item to a named person/team and communicate the next action and due time.
- Finish or explicitly hand over drafts; do not make an unfinished visit appear discharged.
- Finance staff reconcile receipts, reversals and balances by currency/method.
- Check pending synchronization and report unresolved failures.
- Lock or sign out according to facility policy; leave no patient printouts or exported files exposed.

## 15. Troubleshooting and edge cases

| Situation | What to check and do | What not to do / escalation |
|---|---|---|
| “Patient does not exist” although a row is visible | Verify patient ID, facility/scope, loading/sync state and whether the row references an old record; reopen the actual chart | Do not create a replacement patient automatically; send the record ID/error to authorized support |
| Phone already belongs to a family member | Shared numbers are permitted in the reviewed code; verify distinct identity and installed release if blocked | Do not invent a phone number or merge family members |
| Name/date/ID duplicate warning | Compare identity carefully through permitted access; ask records staff to resolve uncertain or out-of-scope matches | Do not alter an ID to bypass validation |
| No ID or exact birth date | Use supported missing-ID/estimated-age fields and document uncertainty | Do not invent official identifiers or precise dates |
| Patient unknown or urgent | Activate emergency/downtime identification and care procedure; reconcile identity later through authorized staff | Do not delay emergency response to finish routine registration/payment |
| Empty clinician picker | Check facility, eligible staff setup, data loading and directory errors | Do not select someone from another facility as a workaround |
| Available slot rejected at save | Another booking or cross-facility commitment may conflict; refresh and choose a valid duration/time | Do not keep clicking save or double-book outside the authorized process |
| Appointment missing | Check save result, requested/confirmed state, day, facility, filters and assigned-provider scope | A nurse's personal queue is not proof a facility booking is absent |
| Reception sees visit; doctor does not | Verify eligible assigned clinician, facility access and synchronization | Do not broaden patient access to hide an assignment error |
| Required reason or clinical value missing | Complete truthful required information or document the supported exception | Do not enter dummy text, zero vitals or a false normal value |
| Save returns conflict/stale revision | Reload the latest record and reconcile with the other user's work | Do not blindly overwrite or repeat a financial/dispensing action |
| Popup closes but result is unclear | Reopen the relevant list/history and check for the record before retrying | Closing alone is not evidence of success |
| Nurse cannot finish post-consult work | Check ownership, required evidence, deferred-owner/due-time fields and whether the plan changed | Do not mark unfinished care done |
| Procedure still in progress at checkout | Resolve/complete it or document an authorized clinical exception with reason | Do not cancel it solely to bypass the gate |
| Result is pending or critical | Assign follow-up and use the appropriate clinical escalation/acknowledgement path | Do not assume a notification means the clinician reviewed it |
| Patient leaves before care is complete | Record the true outcome and outstanding work; notify responsible staff | Do not create completed assessments or a routine discharge retrospectively |
| Prescription unavailable/partial | Record actual supply and remainder; coordinate with clinician and patient | Do not record full dispensing or substitute without authorization |
| No invoice or zero balance | Inspect encounter-specific invoice/evidence and whether anything was billed | Do not label it approved just because there is nothing to pay |
| Insurance approved but no settlement | Keep approval/claim state distinct from funds received | Do not record cash or settled status without evidence |
| Provider says paid, Tamam uncertain | Check provider reference and existing receipt/allocation; reconcile once | Do not charge the patient again while investigating |
| Payment reversed | Review remaining valid receipts and balance; coordinate actual refund if needed | Do not assume a database reversal refunded external funds |
| Mixed SSP/USD | Reconcile each currency and invoice separately | Do not offset amounts by treating currencies as equal |
| Plan says paid but invoice unchanged | Inspect installment receipt and allocation; escalate reconciliation | Do not collect the installment a second time |
| Offline sign-in refused | Reconnect if no valid cached credential exists; check changed password if relevant | Repeated password guesses will not populate an absent cache |
| Sync pending on another station | Preserve local data; confirm network and receiving station scope; use approved handoff | Do not clear storage or promise immediate cross-device visibility |
| Patient portal SMS missing/expired | Confirm registered contact via authorized staff and restart the offered verification flow | Do not share codes or use another family member's account |
| Missing action or access denied | Confirm role/facility and request approved access correction | Do not share an administrator's login |
| Report totals differ | Check date/time zone, facility, filters, definitions, exclusions and sync freshness | Do not edit clinical records merely to force totals to match |
| Print/export empty | Check selected rows/list, filters, pagination and print settings | Verify content before sharing; do not export broader PHI unnecessarily |

For support, provide the module, role, facility, approximate time, exact error, expected/actual result, and relevant record reference through an approved private channel. Redact unrelated patient information. Never send passwords, OTPs, card secrets or a full database export in a routine support message.

## 16. Training scenarios and completion checks

Run these only in an approved training environment with clearly labelled synthetic records. Have each participant use their own role. Passing a scenario requires saved evidence and the receiving role's confirmation, not just a success toast.

| Exercise | Participants | Pass condition |
|---|---|---|
| New child sharing parent's phone | Reception + records | Two separate identities; child registers without changing valid household phone |
| Returning patient, missing demographics | Reception | Existing record updated; one new visit, no duplicate patient |
| Appointment → arrival → doctor → nurse → checkout | Reception, nurse, clinician | Correct booking visibility; linked encounter; post-consult evidence; accurate final disposition |
| Clinician double-booking | Reception | Conflicting slot rejected/refreshed; one valid booking after correction |
| Clinician from wrong facility | Reception + administrator | Ineligible assignment is prevented or corrected without widening chart access |
| Emergency arrival | Reception + clinical team | Emergency escalation documented; routine payment does not replace clinical response |
| Doctor changes plan during nursing work | Clinician + nurse | Updated plan reviewed; stale checklist is not completed unchanged |
| Pending lab at departure | Lab, clinician, checkout | Result follow-up has named ownership and instructions; pending status is truthful |
| Partial dispense and second user attempt | Pharmacists | Actual quantity recorded; no duplicate/over-dispense |
| Partial payment, plan, final installment | Cashier + biller | Receipts, invoice allocation, plan progress and balances reconcile |
| Rejected insurance claim | Biller | Corrected claim tracked without fictitious settlement or duplicate billing |
| Offline handoff and reconnection | Two staff stations + operator | Local work preserved; other station receives it after sync; conflicts reconciled |
| Referral to receiving facility | Sending/receiving teams | Request, acknowledgement, intake and outcome distinguishable |
| Ward medication refused | Nurse | Refusal and appropriate follow-up recorded; not falsely marked Given |
| Patient portal verification problem | Portal test user + support | Recovery uses correct contact/account; no family-account sharing |

### Facility sign-off

Before using this guide as a formal training standard, record a local reviewer for reception, nursing, clinical care, diagnostics/pharmacy, finance, records and administration. Each reviewer should confirm the installed release, exact menu labels, enabled integrations, escalation contacts, and approved exception policies. Record unresolved gaps and teach the temporary safe process explicitly.

## Appendix A. What the statuses mean

The app tracks different objects. Always ask: “Status of the appointment, encounter, order, task, invoice, or synchronization?”

| Encounter stage | Typical meaning and next responsibility |
|---|---|
| Scheduled / Registered / Arrived at facility | Booking/identity/arrival exists; reception routes the patient |
| Awaiting triage / In triage | Nursing assessment is pending or underway |
| Triaged awaiting destination | Assessment saved; routing still required |
| Escalated to emergency | Emergency team takes clinical responsibility |
| Routed to clinic / Awaiting rooming / In rooming | Clinic preparation and handoff underway |
| Ready for clinician / With clinician | Consultation can start or is active |
| Consultation paused draft | Unfinished clinical documentation/work remains |
| Awaiting labs / imaging / pharmacy / procedure | A downstream service is outstanding; other services may also be pending |
| Ready for clinic checkout / In clinic checkout | Clinic completion checks are being performed |
| Clinic complete awaiting next station | This clinic is done; the entire facility visit may not be |
| Awaiting facility checkout / In facility checkout | Final cross-station checks and disposition remain |
| Admitted | Outpatient pathway handed to inpatient care, not discharge home |
| Referred out | Referral created/clinical disposition selected; subsequent coordination may remain |
| Discharged / Discharged with referral / Discharged with pending items | Different final outcomes; pending items still require explicit follow-up |
| Left without being seen / Dismissed without formal checkout / Deceased | Exceptional outcomes requiring truthful documentation and local procedure |

Not every transition is legal from every stage. An appointment's completed status does not prove a bill is settled; a paid invoice does not prove a consultation was completed. Colors are supplementary cues only.

## Appendix B. Review evidence and limitations

### What was examined

- Current role routes and action permissions for all 25 staff roles.
- Patient registration/duplicate handling and appointment scheduling checks.
- Encounter stages, allowed transitions and checkout requirements.
- Post-consult ownership, evidence, deferral, transfer and plan-revision handling.
- Diagnostic, nutrition, blood-bank, MAR, billing and portal interface code.
- Offline authentication exception tests and current patient-portal login flow.
- Earlier supplied screenshots as historical UI context. The older Sanitas screens are reference material, not proof that a similarly named Tamam feature exists.
- Local staff sign-in in the browser. Database initialization prevented an authenticated role-by-role walkthrough during this review; no real patient or payment was created.

### Automated checks run for this guide

The following six Jest suites passed: **41 tests total**.

- `integration/care-journey.test.ts`
- `integration/urgent-walk-in-journey.test.ts`
- `integration/returning-incomplete-patient-journey.test.ts`
- `integration/pharmacy-journey.test.ts`
- `integration/referral-journey.test.ts`
- `billing/financial-evidence.test.ts`

They cover linked care records and validation, urgent/returning-patient paths, pharmacy and checkout exceptions, referral progression, and financial-evidence edge cases. They do not prove production integration delivery, every UI control, or every role's interactive workflow.

### Important corrections to older guidance

- Do not describe all features as available offline.
- Patient-portal login is not simply a demographics lookup; the current form uses credentials and supports an SMS verification challenge.
- Shared phone numbers are not sufficient grounds to reject or merge patient records.
- A role's menu access is not the same as permission to perform every mutation.
- Nurse-family users start on the shared clinical dashboard; do not rely on retired station-dashboard instructions.
- No invoice, a draft invoice, an insurance approval, and a zero displayed balance are not interchangeable settlement evidence.
- A screenshot or local change does not establish that production has been deployed with that behavior.

### Source map for maintainers

- [Role routing](../platform/src/lib/role-routes.ts)
- [Action permissions](../platform/src/lib/hooks/usePermissions.ts)
- [Patient service](../platform/src/lib/services/patient-service.ts)
- [Appointment service](../platform/src/lib/services/appointment-service.ts)
- [Encounter journey](../platform/src/lib/clinical-flow/encounter-journey.ts)
- [Post-consult panel](../platform/src/modules/post-consult/components/PostConsultPanel.tsx)
- [Payment panel](../platform/src/components/payments/PaymentPanel.tsx)
- [Billing workspace](../platform/src/components/payments/BillingWorkspace.tsx)
- [Patient portal login](../platform/src/components/patient-portal/PatientLogin.tsx)
- [Offline sign-in tests](../platform/src/__tests__/auth/offline-login-refusal.test.ts)
- [Older user journeys—historical context only](USER-JOURNEYS.md)

## Appendix C. Site-specific details to fill in before distribution

| Required item | Facility-approved value |
|---|---|
| Facility name and production address | ____________________ |
| Installed release / guide review date | ____________________ |
| Training environment address | ____________________ |
| Reception / scheduling lead | ____________________ |
| Nursing and clinical escalation contacts | ____________________ |
| Diagnostics / pharmacy escalation contacts | ____________________ |
| Finance, waiver and reversal approvers | ____________________ |
| Records / duplicate-resolution lead | ____________________ |
| IT, sync and account-recovery contact | ____________________ |
| Downtime recording and reconciliation process | ____________________ |
| Enabled payment providers, currencies and receipt process | ____________________ |
| Referral acknowledgement and transport process | ____________________ |
| Reporting periods, recipients and submission approval | ____________________ |
| Patient portal activation / guardian-access process | ____________________ |

**Final rule:** finish the real-world task, record it against the correct identity and encounter, verify the saved evidence, and hand the next action to an accountable person. Do not let a convenient status label stand in for care, payment, or communication that has not actually happened.
