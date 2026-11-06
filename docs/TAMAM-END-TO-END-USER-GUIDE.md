# Tamam Health: end-to-end user guide

Version 2.0 · 5 November 2026 · Application reference: working tree of 5 November 2026 (base commit `4f6ededc`, plus that day's uncommitted interface changes)

Audience: reception, clinical teams, diagnostics, pharmacy, finance, records, facility leadership, administrators, public-health teams, and patients.

## About this guide

This guide explains how work moves through Tamam, who performs each action, how to check that it succeeded, and what to do when the normal path fails. Tamam is currently being tested at Iteru Hospital, Juba; the guide is written for that testing and for training, and is based on the application as it stood on 5 November 2026.

**Verification boundary:** on 5 November 2026 the complete outpatient example in section 3 was walked in a browser, one role at a time, against the demo build (registration, walk-in check-in, triage, rooming, consultation note, signed orders, laboratory result, clinician review, payment, dispensing, post-consultation nursing and checkout). The other role sections were checked against the application code and spot-checked on screen. This is not a claim that every role, screen, integration, or production deployment has passed an acceptance test. Facility settings, your role and the installed release change which buttons you see. Appendix B records what was checked and the problems found.

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

Ask your facility administrator for the correct Tamam address, your individual account, assigned role and facility, support contact, and downtime procedure. Confirm that service catalogues, clinicians, rooms, clinic hours and payment methods required by your job are configured. A training account must point to a training environment.

1. Open the facility-provided address. The staff sign-in page asks for **Username or Staff ID** and **Password**.
2. Leave **Role** alone unless your administrator told you otherwise; only the platform super administrator can sign in under a different role.
3. If this is the first sign-in on an account an administrator created for you, you will be asked to choose a new password. Tamam has no staff text-message or authenticator code; do not share your password with anyone.
4. Check the name, role, facility, and date shown after sign-in (your initials sit in the round account button at the top right; the facility name is in the centre of the top bar). Stop if they are wrong.
5. The first sign-in on a device can show "Initializing offline database…" or "Loading TamamHealth…" for a while. Wait for it to finish before deciding that a list is empty.
6. A first-time sign-in may offer a short setup and a guided tour. You can skip both.

Use **Forgot password** on the sign-in page for the recovery flow available at your site. If recovery cannot be delivered, contact the administrator; repeated guesses lock the account for a while (five attempts per account per 15 minutes). A locked screen and an expired sign-in are different problems: use the displayed unlock or sign-in action, not someone else's credentials.

An invitation, pending account or patient registration does not by itself grant staff access. Staff accounts are created by an administrator (section 12); there is no public "request an account" form.

### Find the right patient before doing anything else

Use the **Search patient name, ID, …** box in the top bar, or the **Patients** list. Search by hospital number first when available, then confirm at least two identifiers under facility policy. Compare the full chart identity with the person and the intended visit. A shortened list name is not sufficient when two people have similar names.

Family members may share a phone number. They must still have separate patient records, patient numbers, visits, and clinical histories. A shared number is not permission to merge records or reveal one family member's information to another.

### The patient chart

A patient's chart has four parts:

- **Header:** name, sex, age, facility ID, phone and location, an **Allergies** line, the **Balance** due, an **Actions** menu (for example Refer patient, Transfer patient, Add visit, Message patient, Visit summary, Print chart, Edit details) and an **×** that closes the chart and returns you to the list you came from.
- **Left panel:** the chart's sections, for example Patient summary, Vitals & Biometrics, Medications, Orders, Results, Visits & timeline, Notes, Messages, Allergies, Conditions, Medical history, Immunizations, Procedures, Programs, Care plan, Documents, Appointments, Care coordination, Demographics and Billing history. The section you are in is shown in solid blue. Roles without clinical access see only the sections their work needs (for example reception sees Patient summary, Documents, Appointments, Care coordination, Demographics and Billing history; the laboratory sees the patient and the results).
- **Right rail:** buttons that open work beside the chart: **Order basket**, **Visit note**, **Task list**, **Clinical forms** and **Patient lists**. Station roles also see their own button (for example Dispense, New lab request).
- **Work panel:** what you open from the rail opens in a panel on the right and squeezes the chart. It stays open when you change chart sections; it closes only with its own **×**, **Cancel**, **Save**, the Escape key, or the rail button. The expand button makes it full screen; the → arrow goes back one step inside the panel.

**Allergies line:** read it as a prompt, not a finding. A patient registered at reception can show "No known allergies" before anyone has asked (see section 15 and Appendix B). Confirm allergies with the patient at triage and in the Allergies section.

### Shared navigation and forms

- **Dashboard:** work appropriate to your role; it is not necessarily every visit in the facility. Lists are split into **Waiting**, **In service** and **Finished** (station roles see their own lanes, for example To collect / On the bench / Resulted). The right-hand **Outstanding items** box opens lists such as Rooming queue, Documents to sign or Post-consultation nursing.
- **Status pills:** the coloured status on a list row is a dropdown. Choosing a new status opens a slider that explains the change and asks for a reason when the patient is leaving the visit (No show, Cancelled, Rescheduled). Your role decides which statuses you can choose.
- **Notifications (bell):** attention items such as "lab result ready" or referral progress. Opening one does not complete the underlying clinical task.
- **My tasks, Messages, Announcements:** coordination tools, not substitutes for signed notes, orders, results, or a documented handoff.
- **Search, filters, and pagination:** apply to the current list. Clear them before concluding that a record is missing. Column headings can be clicked to sort.
- **Sliders and forms:** most actions open a slider from the right. Confirm patient and visit context, complete required fields (marked with a red asterisk), review, submit once, and check the result. Long forms have a **Jump to** list on the left; the section you are in is marked by blue text and a blue ↳ arrow.
- **Typed text is kept:** if you close a slider with **×** or Escape, or the page reloads, Tamam keeps what you typed on this device for up to 24 hours and offers it again. **Cancel** or **Save** clears it. Tamam asks before a reload that would lose typing. Passwords, PINs and card details are never kept.
- **Saved records open locked:** clicking a saved note or vitals reading shows it read-only. Use **Edit** (shown only if you are allowed) to change a draft; signed notes change only by addendum.
- **Messages from Tamam** (saved, not saved, errors) appear at the bottom left of the screen and fade. A message that says something was not saved means it was not saved.
- **Number fields** have − and + buttons; sentence fields grow as you type and can be dragged taller.
- **Back:** the Back link sits in the top bar or at the head of the form, and the browser's Back button closes the top slider first.

Read labels and error text rather than relying on colour or icon shape. English and Juba Arabic layouts may differ. On small screens, scroll tables and slider bodies to find additional fields and actions.

**Four different confirmations:** a visible entry may be a draft; a successful save may be local to this device; synchronization may still be pending; a clinical handoff is complete only when the receiving workflow or person has accepted responsibility.

### Screen lock, shared screens and problem reports

- **Screen lock:** Settings → Security → **Lock the screen when idle**. When your administrator has made the lock mandatory, the setting shows "Required" instead of a switch. Unlocking uses a PIN registered on this device.
- **Shared screens:** Settings → Security → **Hide patient identifiers on shared screens** masks phone numbers and locations on lists and search results (not on the chart itself). Changes take effect only after **Save changes**.
- **Report a problem:** in the account menu (your initials, top right). It records which screen you were on and goes to the facility's **Reported issues** list.

## 2. Which instructions apply to my role?

These are the 25 staff roles in the current routing configuration, listed by the name Tamam shows on screen. A visible page does not grant every action on that page; action permissions and data scope still apply.

| Role (on screen) | Usual starting workspace | Main work and handoff |
|---|---|---|
| Receptionist (`front_desk`) | Reception dashboard (`/dashboard/front-desk`) | Register, book, check in, assign care team, checkout → nursing/clinician |
| Registration Clerk | Reception dashboard | Establish identity and arrival, correct demographics → clinic team |
| Clinic Clerk | Reception dashboard | Manage clinic arrivals, scheduling and routing → rooming/clinician |
| Nurse | Clinical workspace (`/dashboard`) | Triage, rooming, post-consultation nursing, ward care → next responsible team |
| Nurse (triage) | Clinical workspace | Assess and record triage, choose destination → rooming or emergency team |
| Nurse (rooming) | Clinical workspace | Prepare the visit and mark it ready → clinician; receive post-consult tasks |
| Doctor | Clinical workspace | Assess, document, prescribe, order investigations, choose disposition → next station |
| Clinical Officer | Clinical workspace | Authorized consultation and orders → nursing/diagnostics/pharmacy |
| Doctor (`clinician`) | Clinical workspace | Authorized consultation and orders → appropriate receiving team |
| Medical Superintendent | Clinical workspace | Clinical work and permitted operational oversight → service leads |
| Nurse (`midwife`) | Clinical workspace | ANC and maternity records, nursing/maternity handoffs → appropriate clinical team |
| Lab Tech | Laboratory workspace (`/dashboard/lab`) | Collect, process and report tests → requesting clinician |
| Radiologist | Radiology workspace (`/dashboard/radiology`) | Perform and report studies → requesting clinician |
| Pharmacist | Pharmacy workspace (`/dashboard/pharmacy`) | Review and dispense prescriptions, manage stock → patient/clinical team |
| Nutritionist | Nutrition workspace (`/dashboard/nutrition`) | Screen, record nutrition care and follow-up → clinical/referral team |
| Cashier | Bills & Claims (`/payments`) | Collect and reconcile payments → receipt and outstanding-balance follow-up |
| Medical Biller | Bills & Claims (`/payments`) | Billing, claims and permitted collections → payer/cashier/finance lead |
| Data Entry Clerk | Data Entry Dashboard | Authorized capture and record-quality work → records lead |
| Health Records (HRIO) | Records Dashboard | Health information quality and reporting → facility/public-health reporting chain |
| Records / HMIS Officer | Data Entry Dashboard | Record quality, reporting, authorized exports → reporting recipients |
| Hospital Manager | Facility management | Operational, resource and financial oversight → department owners |
| County Health Director | County Overview (`/dashboard/state`) | Scoped aggregate oversight and reporting → public-health management |
| Government | National dashboard (`/government`) | Aggregate reporting and surveillance oversight → reporting/action owners |
| Org Admin | Facility management | Organization/facility setup, users and permitted configuration → local operators |
| Super Admin | Administration (`/admin`) | Platform-wide configuration, security and recovery → responsible organization/operator |

The laboratory, pharmacy, radiology and nutrition workspaces use the same layout as the clinical workspace: a day list with status pills, the patient's chart one click away, and their own right-hand rail.

Reception roles manage care-team assignment. Clinical staff (and the nutritionist and radiologist) can book appointments; reception confirms, reschedules and cancels them and checks patients in. Cashiers and medical billers do not gain booking authority just because they can open an appointment-related page. Laboratory and pharmacy chart access is limited to the sections their work needs. Aggregate public-health roles must not be treated as unrestricted patient-chart accounts.

Super-administrator capabilities are broad in the current implementation. Do not use that account for routine care or to work around a missing staff permission. Refer access changes to an authorized administrator.

## 3. Complete outpatient example

**Training case:** Amina Example brings her child Sami Example for a visit. They share a household phone. Sami needs triage, a consultation, a laboratory test, a medicine, payment, nursing follow-up and checkout. Clinical decisions in this example are placeholders, not treatment recommendations.

The normal path is:

**Find/register → check in → triage → rooming → clinician → laboratory and pharmacy orders → payment → dispensing → nurse follow-up → checkout → follow-up.**

Laboratory, pharmacy and payment can run in parallel. They are not always a single fixed queue.

| Step and owner | Action in Tamam | Evidence before handing over |
|---|---|---|
| 1. Reception | Search for Sami. If he is not found, **Register New Patient**: fill the required fields, **Review**, then **Register Patient** (or **Register & Check In**). Give the portal sign-in slip if one is printed | Toast "Sami Example registered — Hospital No. …"; one new hospital number; Amina's record unchanged |
| 2. Reception | Check Sami in: for a walk-in use **Register Walk-In** (patient, department, priority, reason); for a booked patient set the row's status to **Checked In** and complete the check-in slider | "Walk-in registered and added to the queue"; the visit appears on the reception board |
| 3. Nurse (triage) | **Outstanding items → Rooming queue**, open Sami (**Continue rooming**), then **Triage**. The chart opens with the **Triage / ETAT assessment** form. Record what you measured, mark what was not taken, choose destination, clinic and receiving provider, **Save Triage** | Triage shown under Latest observations on the Patient summary, with priority and handoff |
| 4. Nurse (rooming) | On the rooming page: **Arrived**, type a room and **Assign**, take **Vitals** if needed, then **Ready** | Toast "Ready for the clinician"; the doctor's list shows "Awaiting consultation" |
| 5. Clinician | Open Sami from the clinical workspace. **Notes → Create note** opens a Consultation note already filled from triage. Complete Assessment and Plan, then **Sign** | Notes list shows the note as Signed |
| 6. Clinician | **Order basket**: under Lab orders **Add** a test; under Drug orders **Add**, search, **Order form**, fill dose, frequency, duration, quantity and indication, **Save order**; then **Sign and close** | Toast "Orders signed: 2."; the orders show as Pending in the basket |
| 7. Laboratory | In the lab workspace, set Sami's pill to **Collect specimen**, choose the container, **Save**; then **Enter result**, record the result, **Save** | "Specimen marked collected", then "Result filed"; the report shows the result |
| 8. Clinician | Results → open the result → **Mark reviewed** (and **Mark acted upon** when you have acted) | The result shows "Reviewed by clinician" with your name and time |
| 9. Cashier | Chart **Billing history** (or **Bills & Claims**) → **Billing actions → Collect payment**; choose method, enter the amount actually received, **Record** | "Payment recorded" with a receipt number; Outstanding balance updated |
| 10. Pharmacy | In the pharmacy workspace set Sami's pill to **Fill prescription**, check the safety review and batch, **Dispense** | Toast "Dispensed". If a balance is due, dispensing stops and says so (section 7) |
| 11. Nurse | **Outstanding items → Post-consultation nursing**, open Sami's **Care plan** section, **Accept handoff**, then record each task's outcome | All four tasks recorded; the visit moves to "Ready for clinic checkout" |
| 12. Reception | Set the visit's status to **Completed**. For a booked visit this opens **Final checkout**, which lists anything unresolved and asks for the disposition | Patient leaves the active board; the disposition says what actually happened |

At the end, search the patient again. Confirm this is one patient record with one intended visit, not a new record at each station. Check that the clinical outcome, financial outcome, and next appointment each say what actually happened.

**Known problem at the time of writing (Appendix B):** in the 5 November walkthrough, a walk-in's **Completed** choice on the reception board closed the visit with a plain status slider instead of **Final checkout**, so the checkout checks were not shown. Until this is fixed, reception should confirm the clinician, laboratory, pharmacy, nursing and payment steps on the chart before marking a walk-in Completed.

## 4. Reception, registration, and appointments

### Register a new patient

1. Search before choosing **Register New Patient** (reception dashboard, or the person icon in the top bar). Try hospital number, full name, and other identifying details.
2. The form has five sections, listed under **Jump to**: Demographics, Biometrics (optional), Contact & Location, Next of Kin, and Payment Coverage (optional). Required fields are marked with a red asterisk: First Name, Date of Birth or Estimated Age, Gender, Primary Language, State and County, and one next-of-kin contact (Full Name, Relationship, Phone Number).
3. If the birth date is unknown, leave **Date of Birth** empty and use **Estimated Age**. Do not invent a precise date or ID to satisfy a field.
4. Record whose phone it is. A shared household phone is allowed.
5. **Payment Coverage** defaults to Out of Pocket. A stated insurer or programme is not verified coverage or a paid bill.
6. Choose **Review**. Read the read-back of every section; use **Edit** beside a section to correct it.
7. Choose **Register Patient** to save, or **Register & Check In** to save and go straight to the walk-in check-in.
8. If **Create a portal account for this patient** was ticked, a **Portal sign-in slip** appears with a username and one-time activation code (valid 14 days). The code is shown once: **Print slip** or **Copy slip** before **Done**. A lost slip can be replaced from the chart's Demographics section.

Registration does not ask about allergies or medical history; those are taken at triage.

**Duplicates:** the service allows shared phones and checks other identity details, including national ID and combinations of name/birth date. If warned, compare the records through authorized access. Do not change an ID just to defeat validation. If a possible match is outside your scope, ask the records team to resolve it without expanding your own access.

**Returning patient with incomplete details:** open the existing chart, verify identity, update permitted missing information (Demographics → Edit), and create the new visit. Do not create a replacement patient simply because the old record is incomplete.

### Book and confirm an appointment

1. Choose **Book appointment** on the dashboard or in **Appointments**, or **Add** on the chart's Appointments section.
2. Select or confirm the patient, facility, department, clinician, reason, date, duration and an available slot. A visit can repeat (a series of 2 to 12 visits); Tamam books each occurrence and tells you which ones clashed.
3. Review and submit once. Tamam checks every person on the booking for clashes, including the clinician's bookings at other facilities when the server can be reached.
4. Check the booking's status. A request awaiting confirmation is not a confirmed appointment.
5. Requests patients make in the portal appear in reception's **Appointment requests** panel with **Confirm**, **Edit** and **Decline** (a reason is required to decline). Call or text the patient before confirming.
6. Clinic hours (working day, breaks, repeat) are set per clinician and shown to reception under **Clinic hours** on the Appointments page; slots are never offered inside a break. Times follow the facility's clock (Juba time), not the device's.

The final save checks conflicts again. If another user takes the slot first, choose a new one and recheck the summary.

**Reschedule, cancel, no-show:** set the row's status pill to Rescheduled, Cancelled or No Show; the slider asks for a reason. Do not mark a patient no-show just because a filter hides their arrival.

### Check-in, walk-ins and care-team assignment

- **Booked patient:** set the row's status pill to **Checked In**. The check-in slider asks for visit type, visit setting, attendance and who pays (paying or not, method, insurer or scheme, exemption reason). Check-in records the payer only; it does not post a charge.
- **Walk-in:** **Register Walk-In** (from **Register & Check In**, or the Appointments page) takes an existing patient, Department, Priority (Routine, Urgent, Emergency), Reason for Visit and Notes, and checks the patient in. A walk-in form is not a new-patient registration form.
- **Care team:** use the row's assign action. You can assign a doctor, nurse, or staff at the Lab, Pharmacy, Radiology or Nutrition stations. Assign only an eligible person offered for the correct facility; if the list fails to load, escalate the directory problem rather than choosing an unrelated clinician.
- **Needs close-out:** a reception tile lists visits still open from earlier days. Review each one; **Close as LWBS** only when the patient has truly left. Visits that saw a clinician need checkout instead.

Reception completion check: correct identity, one intended visit, correct destination, visible arrival, and a receiving team. Front-desk access does not automatically permit collecting money.

## 5. Nursing: triage, rooming, and return from the doctor

Nurses start on the shared clinical workspace. The list shows patients assigned to you, ward patients and the rooming queue; **Outstanding items** opens Medications due, Handoffs to acknowledge, Rooming queue, Follow-ups due and Post-consultation nursing.

### Triage

1. Open **Outstanding items → Rooming queue**. A checked-in patient shows "Awaiting triage". Choose **Continue rooming**, check identity on the rooming page, then **Triage**. (You can also open the chart and choose **Clinical forms → Triage / ETAT Assessment**.)
2. The form opens beside the chart, with sections Presenting complaint, ETAT assessment, Vital signs, History and visit, and Handoff and notes.
3. Answer Airway, Breathing, Circulation and Consciousness (AVPU), danger signs and presentation from the dropdowns.
4. For each vital sign, enter the value you measured. If you did not measure it, change its "Measured" dropdown to the reason it was not taken (equipment unavailable, patient condition, patient declined). Never enter zero or an invented normal value.
5. Read the computed **Triage priority**. You may raise it with the dropdown below it; you cannot lower it.
6. Record known allergies, current medications, mode of arrival and symptom duration as told to you.
7. Under Handoff choose the **Destination**, **Clinic or service** and **Receiving provider** (or "Assign provider later"), add a handoff note, and **Save Triage**.
8. Check the Patient summary: Latest observations shows the priority, complaint, ABCC findings and handoff.

Incomplete triage must not be interpreted as a completed, reassuring assessment. If the patient leaves before being seen, use the visit's **Left without being seen** action rather than completing fictitious care.

### Rooming

The rooming page (from the Rooming queue) moves the patient step by step: **Arrived** → type a room number and **Assign** → **Vitals** (optional rooming vitals) → **Ready**. "Ready for the clinician" moves the patient onto the doctor's list as "Awaiting consultation". Use the route button beside a patient to send them to a different clinic, with a reason, rather than deleting the visit.

Other actions on a visit (in its **More** menu on the worklist): **Return to reception** (the visit stays open, leaves the clinical lists, and reception is told), **Escalate to emergency care** (with a reason), **Left without being seen**, and **End assignment**.

### Recording medicines a patient already takes

Nurses record medicines the patient reports (Medications section). These are history, marked "patient-reported"; they are not orders and do not reach the pharmacy. Only prescribers order medicines.

### After the clinician: post-consultation nursing

1. Open **Outstanding items → Post-consultation nursing** and choose the patient, or open the chart's **Care plan** section. The panel is absent if no nursing step was created.
2. Read the latest clinical plan and choose **Accept handoff**. You become the responsible staff member.
3. The four tasks are: care plan, medicines and teach-back with patient/caregiver; review ordered treatments and administration records; coordinate investigations and result follow-up; confirm instructions, referrals and follow-up arrangements. Open linked notes, medicines, laboratory and procedures as needed; a checklist item does not replace these records.
4. Open a task, write the completion evidence, and **Record task outcome** only after doing it.
5. To defer a task, tick **Defer with a named owner and review date**, choose the owner and due time, and record the reason.
6. To hand over, use **Transfer responsibility**, choose the recipient and give a reason. The new owner must accept.
7. If the clinician changes orders or signed notes afterwards, the panel says so and offers **Review changed plan**. Review the new plan before recording more outcomes.
8. When all tasks are recorded the visit moves to "Ready for clinic checkout".

A clinician can record "no separate nursing step needed" with a reason when nothing is required. Do not use that as a routine shortcut around outstanding nursing work.

**Example:** Sami's result returns after the first nursing instructions. The clinician updates the plan; the panel shows the change. The nurse reviews the revised instructions instead of completing the old checklist unchanged.

## 6. Doctors and other prescribing clinicians

1. Open the patient from the clinical workspace (Waiting / In service lanes; "Awaiting consultation" means the patient is ready). Clicking the name opens the chart. Confirm patient, visit, allergies, triage (Patient summary → Latest observations) and relevant previous records.
2. **Write the note:** **Notes → Create note**, or **Clinical forms → Consultation**. A new Consultation note opens already filled from today's triage (complaint, history, findings), marked "From triage". If you already have an unsigned draft, Tamam asks whether to **Continue draft** or **Start a new note**. Other note types (H&P, Procedure, Discharge Summary, Nurse Visit, OB Evaluation and more) are chosen in the note's **Note type** field.
3. The note's sections are listed on the left; the bottom bar has **Cancel**, **Save** and **Sign**. The note also saves itself as you type. **Visit note** on the right rail is a short version (diagnosis, a paragraph and images) that adds to the same visit's draft.
4. **Sign:** the confirmation explains that signing locks the note and lets you request a co-signature. After signing, corrections are addenda. A saved draft opens read-only; use **Edit** to continue it.
5. **Orders:** open **Order basket** on the right rail. Each group (Drug orders, Lab orders) opens and closes with its heading; Tamam remembers this per device.
   - **Lab:** **Add**, search, then **Add to basket** (or **Order form** for details).
   - **Medicine:** **Add**, search, **Order form**. Fill dose and unit, route, frequency, duration, quantity to dispense and indication. The form shows whether the facility's pharmacy has stock. **Save order** puts it in the basket.
   - Review the basket, then **Sign and close**. Nothing reaches the laboratory or pharmacy until it is signed.
   - A severe or unknown allergy match, or a contraindicated combination, needs a written reason before the order can be signed. Milder warnings are shown and recorded.
6. **Signed orders** stay in the basket. A signed prescription's ⋮ menu offers **Open prescription**, **Modify order** (puts a copy marked "Modify" in the basket; signing it writes the new order and stops the old one) and **Discontinue** (a reason is required). An open lab order's ⋮ offers **Open result**. Lab orders cannot be cancelled from the basket.
7. **Results:** the bell tells you when a result is ready. In **Results**, a row's ⋮ offers **View report** and **Open result**. In the result, choose **Mark reviewed**, then **Mark acted upon** when you have acted. Result availability does not prove it has been reviewed, and the patient portal shows a result only after clinician review.
8. **Tasks and lists:** **Task list** on the rail holds this patient's tasks; each shows its due date and a status (Queued, Overdue, Done, Cancelled) with ⋮ actions (Edit, Mark done, Cancel task; Add again for closed ones). **Patient lists** shows My patients and Assigned to me.
9. Choose the true disposition and next station; arrange follow-up through **Book appointment**. Header **Actions** has Refer patient, Transfer patient, Visit summary and Print chart.
10. Where the facility has no on-site pharmacy, prescriptions become scripts for an outside pharmacy; give the patient a printed (or, when texting is set up, texted) copy.

**Completion check:** the current plan is recorded and signed, orders are intentional and signed, relevant results have been reviewed or assigned for follow-up, and the receiving person or service knows what is required.

An unresolved procedure or post-consult item can block checkout. Review the underlying item; do not cancel a valid clinical order merely to obtain a completed status. When two users edit the visit, reload the latest revision and reconcile changes before saving again.

## 7. Laboratory, radiology, pharmacy, and blood bank

### Laboratory technician

1. The lab workspace lists today's work in three lanes: **To collect**, **On the bench** and **Resulted**. Each row's status pill is a dropdown of the next steps.
2. Verify the patient, test, specimen and the accession number shown in the slider.
3. **Collect specimen:** choose the container, confirm who collected it, **Save**. Do not treat an uncollected specimen as a completed test.
4. **Enter result:** record the result value, unit, reference range and interpretation, check specimen condition, **Save**. Tamam records receipt and processing at the same time and shows "Result filed".
5. **Reject specimen** is available once a specimen is collected; record why and coordinate recollection.
6. The filed result opens as a report with **Amend result** and **Print report**. The requesting clinician is told through the bell; critical results also raise a task. Communicate urgent findings by the facility escalation procedure as well; a notification alone is not closed-loop communication.
7. **New lab request** (top of the lab workspace) records tests for patients sent from other facilities or walk-in clients, including new patients (all registration-required details are asked). Their reports are released with **Mark report released** rather than by a clinician review. **Batch Entry** enters several results at once.

If a finalized result is wrong, use **Amend result** and notify the clinical team; do not silently replace its meaning.

### Radiologist / imaging team

Imaging work opens in the chart's **Imaging report** form (from the radiology workspace or the patient's chart). Verify identity and the study requested, use **Start study** when work begins, attach images (each under 5 MB) where supported, enter the report and save. The ordering clinician is told. An uploaded image without a completed report is not a completed diagnostic workflow. Handle wrong attachments and report corrections through authorized actions with clinical notification.

### Pharmacist

1. The pharmacy workspace lanes are **To fill**, **On hold** and **Dispensed**. A row's pill offers **Fill prescription**, **Send back to prescriber** and **Record stock-out**.
2. **Fill prescription** opens the prescription: medication, directions, prescriber, quantity for the course, substitution rule, clinical context and a **Safety review** of allergies, interactions and duplicates against active medicines.
3. Enter the quantity actually handed over and check the batch and expiry Tamam picked (earliest expiry first). **Dispense**.
4. **Payment hold:** if the patient has a balance due, Tamam refuses to dispense and says "… not dispensed: SSP … is due. Send … to the cashier, then dispense once it is paid." Life-sustaining (Tier 1) medicines are not held. If the balance cannot be checked, dispensing also stops; try again.
5. **Allergy review:** a severe or unknown allergy match, or a contraindicated combination nobody answered, needs your written review before dispensing.
6. Provide counselling under professional practice and communicate substitutions, shortages, deferrals or referrals to the responsible clinician. Prescriptions for an outside pharmacy never appear in your queue.

Do not record a full dispense for a partial supply. Do not repeat a dispense after a slow response without checking whether the first succeeded. Concurrent dispensing and over-dispensing are guarded in the tested service.

Payment difficulties affecting urgent or life-sustaining care require clinical and administrative escalation, not an unrecorded abandonment of the patient.

### Blood bank and controlled substances

Authorized blood-bank users (**Blood bank**) record stock with unit identity and expiry, reserve it for the correct patient, record crossmatch outcome, and record transfusion or discard with the required reason. Reservation is not transfusion. An incompatible or expired unit must not be treated as available simply because it remains in a list. Tamam does not replace bedside identity, compatibility and transfusion checks.

Authorized users use the **Controlled substances** register (the pharmacy workspace's **Controlled** button) and its accountability process. Follow local witness, reconciliation and correction policy; never adjust the ordinary inventory alone to conceal a discrepancy. These two modules were not walked on screen for this edition.

## 8. Maternity, nutrition, immunization, and inpatient care

### Midwife and maternity team

Find the mother's existing chart and open **Clinical forms → ANC Visit** (or the chart's ANC record). Review prior information, enter actual observations, screening and the care plan, save the visit, and arrange the next attendance or referral. Use available chart results without assuming maternity access permits laboratory result editing or general prescribing.

For a birth, verify mother/baby linkage and record the event accurately. A newborn needs a distinct identity; sharing a guardian's number does not combine their records. Record maternal and newborn outcomes separately.

### Birth and death registers

**Births** and **Deaths** list registered events. **Register Birth** and **Register Death** are available to clinical staff, records staff and data-entry clerks. Opening a row shows the record in a slider with a print button:

- **Print birth notification** prints a **Notification of Birth**. This is the facility's notification to the Civil Registry, not a birth certificate; the Civil Registry issues certificates.
- **Print death certificate** prints the WHO international Medical Certificate of Cause of Death (ICD-11). Blanks print where the register lacks a field; complete them by hand only as facility policy allows.

These are sensitive records. Only authorized users should enter or amend them, following facility review and reporting procedures. A clinical outcome and an official registration are not interchangeable.

### Nutritionist

The nutrition workspace lists patients assigned to you and screenings due. **Nutrition Screening** opens in the patient's chart (also from **Clinical forms**). Enter actual measurements with correct units and age context, review the displayed classification against professional assessment, record treatment or referral and follow-up, and save. **Supplies** shows stock entries. Use **Book appointment** for a new screening visit.

If a measurement is missing or implausible, recheck it rather than treating an automatically displayed category as definitive.

### Immunization staff

Verify patient, age, prior history, vaccine and the event being recorded. Enter actual administration details in **Immunizations** (chart section or module), save, and check the patient's history and next due date. Distinguish historical doses from doses given today; do not record an extra dose solely because an unsynchronized history is missing.

### Inpatient nurses and ward teams

1. Admission is requested with **Clinical forms → Ward Admission** (or from **Wards**). The ward list reads real bed availability. Outpatient **Admitted** is a handoff to inpatient care, not discharge home.
2. Review the admission and active orders; accept the patient using the local handover process.
3. Document nursing care and use the medication administration record (MAR, under Wards) for actual administrations: one row per prescription, one column per scheduled time.
4. Record the truthful MAR outcome: **Given**, **Missed**, **Refused**, or **Held** (with a reason). Controlled medicines ask for a witness. Use the correction workflow when needed. Do not record administration in advance.
5. At shift change, use the ward handoff (shift handover) and communicate outstanding actions and risks to the incoming team.
6. At transfer or discharge, reconcile outstanding work, medicines, instructions and follow-up; verify the disposition and bed/ward status.

When no bed is available, escalate capacity and record the actual placement plan. A pharmacy dispense and a bedside administration are separate events.

## 9. Referrals and transfers

**Referrals:** from the chart choose **Actions → Refer patient**. Specify destination, purpose, urgency and supporting information in the slider; review and submit. The referral appears in the chart's **Care coordination** section and in **Referrals**.

The receiving team works the referral in **Referrals**: **Accept**, **Decline** (a reason is required; the referring facility is told) and, when care is finished, **Complete Referral** with the patient outcome. Only the receiving side completes a referral. The sending clinician is told of progress (received, accepted, completed) through the bell, and the Care coordination row shows the status and when it changed. A referral being sent does not prove acceptance, transport, arrival, consultation, or a returned outcome; the sending team follows up unacknowledged or overdue referrals.

**Transfers between hospitals:** **Actions → Transfer patient** opens the transfer slider (expand it for a full page). The receiving hospital accepts it under **Transfers**. While it waits, the chart shows a "Transfer awaiting acceptance" banner; its **×** hides that banner for you on this device for good, and the transfer stays listed under Care coordination. Each side sees "To …" or "From …"; your own hospital is not named. The receiving hospital sees a transfer summary of the patient's medicines and vitals, not the sending hospital's whole chart.

**Example:** a facility requests an imaging service elsewhere. The originating clinician documents the reason; the receiving service accepts; the patient is received and the outcome recorded. The originating team reviews it and completes follow-up. If transmission is unavailable, use the approved alternate handoff channel and reconcile the digital record when connectivity returns.

If the wrong destination was selected, coordinate a correction rather than creating several uncontrolled referrals. Keep ownership explicit while a patient is in transit or waiting for acceptance.

## 10. Billing, payments, claims, and financial review

### Understand the separate records

- A **charge** records a service item. Signed laboratory and pharmacy orders post their own charges; **Add services** posts other services.
- An **invoice** groups billable items and amounts.
- A **payment/receipt** records money received and its allocation.
- An **insurance claim** requests payer settlement; submitted or approved does not mean settled.
- A **payment plan** schedules repayment; creating it does not collect money.
- A **waiver** documents an authorized reduction/exception; it is not cash received.
- **Visit financial review** evaluates evidence for a particular encounter. No invoice or a displayed zero balance is not automatically financial approval.

Clinical progress, appointment status and financial status are separate. The visit financial review screen states that it "does not block triage, emergency treatment or clinical discharge. Service-clearance enforcement is not enabled." One payment check does exist: the pharmacy will not dispense non-life-sustaining medicines while the patient has a balance due (section 7). Emergency care, triage and clinical discharge must not be confused with a cashier's receipt workflow.

### The chart's billing section

Open the chart's **Billing history**. The top shows Total Billed, Total Paid, Outstanding balance, Insurance Coverage, Last Payment and Payment Plan. **Billing activity** lists one line per visit; payments update that line. A line's menu has **View details** (everything on the line, in a slider), **Collect payment** and, for permitted roles, **Adjustment / write-off**.

**Billing actions** opens: Collect payment, Add services, Add Insurance, Create Payment Plan, Visit financial review, Send payment link and Print Statement, plus Issue refund and Adjustment / write-off for roles allowed to manage billing.

### Add services and collect payment

1. Verify the patient, visit and currency.
2. **Billing actions → Add services**: select services and quantities, review, **Post charges**. **Continue to payment** stays disabled until the charges have posted.
3. **Collect payment** shows the amount due. Choose the **Method** (only the methods your facility enabled are offered; Insurance / Waiver is always offered) and complete its fields.
4. Enter the amount actually received, not the invoice total. The button reads **Record {amount} {currency}**.
5. **Payment recorded** shows the receipt number, date, method and who processed it, with **Print Receipt**, **Email Receipt** and **Done**. Check the balance afterwards.

An encounter-specific review and a patient-wide activity list can show different totals. Confirm their scope before deciding there is a discrepancy.

### Payment method instructions

| Method | Before recording | Enter and verify in Tamam | Completion evidence |
|---|---|---|---|
| Cash | Count actual money received | Amount and an optional receipt number. Tamam does not calculate change | Receipt and correct balance; cash reconciles |
| Mobile Money | Verify the provider's successful transaction | Provider (M-Pesa, Airtel, MTN MoMo), phone number, transaction reference | Saved receipt matched to provider evidence |
| Card | Verify success on the approved terminal | Last 4 digits and authorization code only | Terminal evidence and Tamam receipt agree |
| Bank Transfer | Verify receipt through the authorized finance process | Bank name, transfer reference, date of transfer | Reconciled receipt; a promised transfer is not collected cash |
| Insurance / Waiver → Insurance | Verify coverage and the actual claim stage | Payor, payer name, claim reference | Claim outcome is accurate; settlement recorded only when received |
| Insurance / Waiver → Waiver | Obtain the authorized approval | Reason for waiver and who approved it | Traceable waiver, not a fictitious payment |

Every method has a Notes field. Do not enter full card numbers, PINs or CVVs anywhere. Selecting a method does not itself prove that Tamam processed a real transaction with a provider.

### Worked payment example

In training, Sami's bill is **SSP 15,500** (a laboratory test and a medicine). Amina pays **SSP 5,000** cash. Record SSP 5,000, not the full bill. The Outstanding balance becomes **SSP 10,500** and the medicine line shows "Part paid". When the remaining SSP 10,500 is paid, record it once; both lines show "Paid" and the balance is SSP 0. (Both payments were recorded this way in the 5 November walkthrough.) A plan for a remainder is a plan, not a second receipt. Do not use an SSP overpayment to mark a separate USD invoice paid without an authorized currency/allocation process.

### Cashier: daily work

Cashiers start on **Bills & Claims** (`/payments`). The top shows today's collections by method, invoices, patients with a balance and unbilled visits. The **Patient accounts** tab lists each patient's payments, plans, last activity, visit status and balance; a row opens the patient's billing detail (payment methods, invoices, payment history, claims, plans). Collect only against the correct patient. Print or share a receipt through the authorized channel, then reconcile the day's payments by method and currency. Escalate unmatched transactions, incorrect allocations or reversal requests.

### Medical biller: claims and exceptions

Medical billers also have the **Insurance claims** tab (and **New insurance claim** in the Actions menu). Verify coverage, invoice items, payer, references and supporting information. Track the actual outcome and record allowed amounts and payments accurately. Resolve rejected claims with corrected evidence rather than duplicating them. A cashier's role does not include claims management.

### Financial review and corrections

Select the exact visit before reviewing invoice evidence (**Billing actions → Visit financial review**). Its statuses are Not reviewed, Awaiting payment, Authorization review needed, Invoice payment verified and Reconciliation needed. Reversed receipts, draft invoices, stale totals and duplicate receipt identifiers require reconciliation; they are not valid settlement evidence.

For an erroneous receipt, use **Reverse** (void) or **Undo** (refund) in the payment history on Bills & Claims; a reason is required before **Confirm**. **Issue refund** in the chart asks for the refund amount and reason. Reversing a record is not proof that money was returned through a bank or mobile provider. Never delete financial evidence to make totals look right.

If a payment-plan installment is recorded (**Record payment** on the plan), verify both plan progress and the account balance. If only one updates, stop and ask finance support to reconcile before collecting again.

**Payment links:** **Send payment link → Generate link** creates a link the patient opens at the facility's `/checkout/…` page. A payment made there stays pending until the provider confirms it.

## 11. Records, reporting, and public health

### Data entry clerk

The **Data Entry Dashboard** holds the daily census (**New Census**) and the authorized capture tasks. Verify the source and the patient or event identity, capture accurately, distinguish event time from entry time, save, then check the record and any validation errors. Do not invent missing clinical information or sign clinical decisions on another professional's behalf.

### HRIO and records/HMIS officer

**Data quality** shows Completeness, Timeliness, Possible outliers and Quality scores, plus the duplicate-record review. Investigate duplicates through the approved process and correct permitted demographic/reporting errors with an audit trail. Select the correct facility, reporting period and report definition; review unexpected totals against source records. Generate permitted reports and exports and verify the output before distributing it. **Vital statistics** summarizes births and deaths.

**DHIS2 export** (HRIO, hospital manager, county and government users) has Data elements, HMIS reports, Aggregate data, Export, Sync log and **Sync now**. Confirm mappings, reporting period, facility identifiers and local approval. Creating or sending an export is not proof that the national system accepted it. Record submission and acknowledgement through the facility reporting procedure.

### County health director and government users

County directors start on **County Overview**; government users on the **National dashboard** (with alerts, briefing, equity and programme pages). Use surveillance, programme, vital events and report pages within your scope. Confirm geographic scope, reporting period, freshness and completeness before interpreting trends.

The **Alerts** page is a table with a search box, **Severity** and **Type** filters and counts of critical, warning and information alerts; a row opens the module that handles it. Review alerts and assign follow-up through the established public-health process. Missing reports are not zero disease incidence, and a software alert is not a confirmed outbreak.

Aggregate access does not authorize opening individual clinical records. Request corrections or investigation from the responsible facility through approved channels.

## 12. Management and administration

Management roles have a short menu of task groups; choosing a group shows its pages as tabs at the top. For example, a hospital manager has Dashboard, Messages, Facilities, Workforce (shift schedule, leave requests, payroll), Patients (patients, appointments, reported issues, referrals, transfers), Operations (beds and wards, departments, assets), Billing & Payments, Surveillance and Reports (reports, facility statistics, data quality, vital statistics, DHIS2 export, public statistics). The medical superintendent's menu adds Clinical Services (pharmacy, laboratory, blood bank, controlled substances) and Emergency preparedness. Your administrator decides which groups you see.

### Hospital manager

At the start of the day, review facility operations, staffing, resource availability, outstanding financial work and permitted reports. Dashboard tiles open the page behind them. Assign action owners for exceptions. Review and confirm changes; a draft roster or leave request is not an approved staffing plan. Use **Reported issues** to follow up problems staff have reported.

End the cycle by checking whether the responsible department completed the action and whether the dashboard reflects current data. Management access does not imply permission to operate every clinical queue.

### Medical superintendent

Use the clinical workspace for personal care work and the permitted operational, scheduling and financial pages for oversight. Review unresolved clinical handoffs and escalation items. Distinguish clinical authority from reporting/export permissions; do not assume every managerial capability is included.

### Organization administrator

Org admins and super administrators create staff accounts and facilities from the management console (**Facilities & people**). **Add staff member** opens the new-user page; at the end Tamam shows the new account's credentials once, for handing to the staff member, and the person must choose a new password at first sign-in. An emailed invitation can be used instead. **Add facility** creates a facility. Hospital managers and superintendents can view the staff list but not create accounts.

Verify the organization and facility before configuring users, departments, pricing, branding or other permitted settings. Grant the minimum role and facility scope required. Departments are chosen from a fixed list. Have the staff member verify their own dashboard and allowed actions after provisioning. Removing access or changing roles must follow the organization's approval procedure.

Before a facility starts work, validate clinicians and clinic hours, rooms, service catalogue and prices, currencies, enabled payment methods, whether the facility has an on-site pharmacy (Settings → Clinical policy → **On-site pharmacy**; when off, prescriptions are given to patients for an outside pharmacy), and contact/support details. Test notifications and external integrations in an approved test environment; configuration on a screen does not prove delivery works. Text messages to patients need an SMS provider configured on the server; without one, texts report "not connected".

### Super administrator / technical operator

Use **Administration** for authorized platform configuration, audit and security review (including **Screen lock mandatory** under security), sync and conflict investigation, and recovery. Keep routine patient care in appropriately scoped staff accounts. Investigate record conflicts and replication failures without deleting unsynchronized device data.

Backups, restores, tenant configuration, production releases and security incidents belong to the operator runbooks and approved change process. Verify restore tests and recovery responsibilities; do not experiment on live databases from a user guide. See [Operator runbook](OPERATOR-RUNBOOK.md) and [backup operations](operations/backups.md).

## 13. Patients, guardians, and public booking

### Patient portal

Use the facility-provided patient portal (`/patient-portal`), not staff sign-in.

1. **Activate:** choose **I have an activation code**, enter the 16-character code from the sign-in slip given at registration (four groups of four, valid 14 days), choose a password and type it again, then **Activate my account**. Staff can issue a new code from the chart's Demographics section (**Patient portal access**).
2. **Sign in:** **Patient sign in** with Username and Password, then **Log in**.
3. If the facility has switched on text-message codes, a screen asks for the 6-digit code sent to the registered number; it expires in 5 minutes and five wrong attempts cancel it. Do not share it with anyone claiming to be support.

After sign-in the sections are Overview, Medical Records, Prescriptions, Lab Results, Radiology & Imaging, Immunizations, Appointments, Billing & Payments, Messages and My Profile. Visibility depends on available records and access rules; laboratory results appear only after a clinician has reviewed them.

A shared household phone is not shared portal authorization. Guardians need the facility's approved access arrangement; registration of a guardian's contact number alone does not grant access to all relatives' charts.

If a result is confusing, ask the care team. Do not interpret an empty results page as a negative test. Portal messages reach the care team through the chart's **Messages** section, but portal messaging is not an emergency service.

### Booking from the portal

Under Appointments the patient picks a visit reason and then a time from the facility's real openings, or asks the facility to call. A patient can have at most three requests waiting. Reception sees the request in **Appointment requests**, contacts the patient and confirms, edits or declines it. Do not assume a requested time is reserved until the facility confirms it.

### Public booking pages and payment links

A facility can publish a public booking page (`/book/…`) only when online booking has been switched on for it; otherwise the page does not exist. At the time of writing there is no staff screen for switching it on, so most facilities will not have one.

For a payment link, verify the official address, patient/invoice context and amount before using it. The page offers the facility's payment options and records the payment as pending until the provider confirms it. Keep the payment evidence and contact finance if the bill does not update. Do not pay repeatedly because a page is slow.

**Example:** Amina requests Sami's follow-up in the portal. Reception calls her, confirms the clinician and time, and confirms the request. Amina checks the confirmed appointment rather than relying only on the original request.

## 14. Offline work, messages, and end-of-shift handover

### What offline means

Tamam keeps a copy of the facility's records on each device for many staff workflows, but not everything works without a network. First-time sign-in, expired or missing offline credentials, portal requests, external payment services, SMS, email, cross-device delivery and records not yet downloaded may require connectivity.

An offline sign-in may be possible only when the device has a valid cached credential for that user. A different user on a shared device, a cleared browser, or an expired cache can require reconnecting. A password changed elsewhere can also require online sign-in.

### Safe outage procedure

1. Identify whether the problem is internet, facility network, application server, device power, or a single failed action.
2. Preserve the current device and unsynchronized work. Do not clear browser storage, reinstall, or switch repeatedly between browsers as a first troubleshooting step.
3. Continue only supported local workflows and use the approved downtime process for unavailable ones.
4. Communicate urgent handoffs directly through the approved channel; do not assume another device received an offline notification.
5. On reconnection, check sync status (the signal icon in the top bar; reception also sees a **Pending sync** count), failed records and duplicates. Reconcile downtime entries before re-entering them.
6. Escalate conflicts to the designated operator/records lead. Do not automatically keep the newest-looking record without review.

### Messages, notifications, tasks and announcements

Use the correct recipient and the minimum necessary patient information. Link the patient where supported rather than copying clinical data into free text. Messages are a retained record: removing a message leaves a visible "removed" marker and the original is kept; edits keep the earlier wording. Conversations can be archived for yourself but not deleted. Read announcements relevant to your work. Complete the underlying task before marking your coordination item done. For urgent results or handoffs, confirm receipt and responsibility explicitly.

### End every shift with a handover

- Review arrivals not yet seen, active consultations, pending tests, undispensed medicines, post-consult tasks and referrals awaiting acknowledgement.
- Assign each unresolved item to a named person/team and communicate the next action and due time.
- Finish or explicitly hand over drafts (unsigned notes appear under **Documents to sign**); do not make an unfinished visit appear discharged.
- Finance staff reconcile receipts, reversals and balances by currency/method.
- Check pending synchronization and report unresolved failures.
- Lock or sign out according to facility policy; leave no patient printouts or exported files exposed.

## 15. Troubleshooting and edge cases

| Situation | What to check and do | What not to do / escalation |
|---|---|---|
| "Patient does not exist" although a row is visible | Verify patient ID, facility/scope, loading/sync state and whether the row references an old record; reopen the actual chart | Do not create a replacement patient automatically; send the record ID/error to authorized support |
| Phone already belongs to a family member | Shared numbers are permitted; verify distinct identity | Do not invent a phone number or merge family members |
| Name/date/ID duplicate warning | Compare identity carefully through permitted access; ask records staff to resolve uncertain or out-of-scope matches | Do not alter an ID to bypass validation |
| No ID or exact birth date | Leave Date of Birth empty and use Estimated Age; document uncertainty | Do not invent official identifiers or precise dates |
| Header says "No known allergies" for a new patient | Registration does not ask about allergies, yet the header can read "No known allergies". Ask the patient and record the answer in Allergies or at triage | Do not treat the header as an assessed answer until someone has asked |
| Patient unknown or urgent | Activate emergency/downtime identification and care procedure; reconcile identity later | Do not delay emergency response to finish routine registration/payment |
| Empty clinician picker | Check facility, eligible staff setup, clinic hours, data loading and directory errors | Do not select someone from another facility as a workaround |
| Available slot rejected at save | Another booking or cross-facility commitment may conflict; choose another time | Do not keep clicking save or double-book outside the authorized process |
| Appointment missing | Check save result, requested/confirmed state, day, facility, filters and lane (Waiting / In service / Finished) | A nurse's personal list is not proof a facility booking is absent |
| Reception sees visit; doctor does not | Verify assigned clinician, facility access and synchronization; the doctor's list shows the patient once rooming marks them Ready | Do not broaden patient access to hide an assignment error |
| "You have an unsigned draft" when creating a note | Choose **Continue draft** unless you really need a second note | Do not start duplicate notes for the same visit |
| A saved note or vitals will not let you type | Saved records open locked; use **Edit** if you have permission | Signed notes change only by addendum |
| Slider closed before saving | Reopen the same form; your typing on this device is offered back for 24 hours | Do not retype into a different patient's form |
| Required reason or clinical value missing | Complete truthful information or choose the "Not taken" reason | Do not enter dummy text, zero vitals or a false normal value |
| Order needs a written reason | A severe/unknown allergy or contraindicated combination needs 10+ characters of justification | Do not type filler to get past it |
| Lab order placed in error | Lab orders cannot be cancelled from the basket; tell the laboratory, which can reject the specimen with a reason | Do not order a duplicate to "replace" it |
| Pharmacy says "not dispensed: … is due" | Send the patient to the cashier; Tier 1 medicines are not held | Do not record a dispense that did not happen |
| Save returns conflict/stale revision | Reload the latest record and reconcile with the other user's work | Do not blindly overwrite or repeat a financial/dispensing action |
| Slider closes but result is unclear | Read the bottom-left message; reopen the list/history and check for the record before retrying | Closing alone is not evidence of success |
| Nurse cannot finish post-consult work | Check you accepted the handoff, the evidence field, deferral owner/due time, and whether the plan changed | Do not mark unfinished care done |
| Final checkout lists unresolved items | Resolve them, or have a signed-in clinician override with a reason | Reception cannot sign for someone else |
| Walk-in marked Completed without Final checkout | Known problem (Appendix B). Check the chart for open orders, undispensed medicines, nursing tasks and balance before choosing Completed | Do not rely on the status alone as proof the visit was safely closed |
| Result is pending or critical | Assign follow-up and use the clinical escalation/acknowledgement path | Do not assume a notification means the clinician reviewed it |
| Patient leaves before care is complete | Use **Left without being seen** or **Return to reception** and record outstanding work | Do not create completed assessments or a routine discharge retrospectively |
| Prescription unavailable/partial | Record actual supply; use **Record stock-out** or **Send back to prescriber** | Do not record full dispensing or substitute without authorization |
| No invoice or zero balance | Inspect visit-specific evidence and whether anything was billed | Do not label it approved just because there is nothing to pay |
| Insurance approved but no settlement | Keep approval/claim state distinct from funds received | Do not record cash or settled status without evidence |
| Provider says paid, Tamam uncertain | Check provider reference and existing receipt; reconcile once | Do not charge the patient again while investigating |
| Payment reversed | Review remaining valid receipts and balance; coordinate actual refund if needed | Do not assume a database reversal refunded external funds |
| Mixed SSP/USD | Reconcile each currency and invoice separately | Do not offset amounts by treating currencies as equal |
| Plan says paid but balance unchanged | Inspect installment receipt and allocation; escalate reconciliation | Do not collect the installment a second time |
| Offline sign-in refused | Reconnect if no valid cached credential exists; check changed password if relevant | Repeated password guesses will not populate an absent cache |
| Sync pending on another station | Preserve local data; confirm network and receiving station scope; use approved handoff | Do not clear storage or promise immediate cross-device visibility |
| Patient portal code missing/expired | Issue a new activation code from Demographics → Patient portal access; confirm the registered contact | Do not share codes or use another family member's account |
| Missing action or access denied | Confirm role/facility and request approved access correction | Do not share an administrator's login |
| Report totals differ | Check date/time zone, facility, filters, definitions, exclusions and sync freshness | Do not edit clinical records merely to force totals to match |
| Print/export empty | Check selected rows/list, filters, pagination and print settings | Verify content before sharing; do not export broader patient data unnecessarily |

For support, use **Report a problem** in the account menu, or give the module, role, facility, approximate time, exact message, expected/actual result and relevant record reference through an approved private channel. Redact unrelated patient information. Never send passwords, codes, card secrets or a full database export in a routine support message.

## 16. Training scenarios and completion checks

Run these only in an approved training environment with clearly labelled synthetic records. Have each participant use their own role. Passing a scenario requires saved evidence and the receiving role's confirmation, not just a success message.

| Exercise | Participants | Pass condition |
|---|---|---|
| New child sharing parent's phone | Reception + records | Two separate identities; child registers without changing valid household phone |
| Returning patient, missing demographics | Reception | Existing record updated; one new visit, no duplicate patient |
| Walk-in → triage → rooming → doctor → lab → pharmacy → nurse → checkout (section 3) | Reception, nurse, clinician, lab, cashier, pharmacist | Each step's evidence in section 3 seen; one visit; accurate final disposition |
| Clinician double-booking | Reception | Conflicting slot rejected; one valid booking after correction |
| Clinician from wrong facility | Reception + administrator | Ineligible assignment is prevented or corrected without widening chart access |
| Emergency arrival | Reception + clinical team | Escalation documented; routine payment does not replace clinical response |
| Doctor changes plan during nursing work | Clinician + nurse | **Review changed plan** used; stale checklist is not completed unchanged |
| Pending lab at departure | Lab, clinician, checkout | Result follow-up has named ownership; pending status is truthful |
| Medicine held for payment | Pharmacist + cashier | Dispense refused with balance due; dispensed after payment; Tier 1 not held |
| Partial dispense and second user attempt | Pharmacists | Actual quantity recorded; no duplicate/over-dispense |
| Partial payment, plan, final installment | Cashier + biller | Receipts, plan progress and balances reconcile |
| Rejected insurance claim | Biller | Corrected claim tracked without fictitious settlement or duplicate billing |
| Offline handoff and reconnection | Two staff stations + operator | Local work preserved; other station receives it after sync; conflicts reconciled |
| Referral to receiving facility | Sending/receiving teams | Request, acceptance, outcome distinguishable; sender notified |
| Ward medication refused | Nurse | Refusal and follow-up recorded; not falsely marked Given |
| Patient portal activation problem | Portal test user + reception | New code issued from Demographics; no family-account sharing |

### Facility sign-off

Before using this guide as a formal training standard, record a local reviewer for reception, nursing, clinical care, diagnostics/pharmacy, finance, records and administration. Each reviewer should confirm the installed release, exact menu labels, enabled integrations, escalation contacts, and approved exception policies. Record unresolved gaps and teach the temporary safe process explicitly.

## Appendix A. What the statuses mean

The app tracks different objects. Always ask: "Status of the appointment, encounter, order, task, invoice, or synchronization?"

| Encounter stage (words you may see on lists) | Typical meaning and next responsibility |
|---|---|
| Scheduled / Checked in / Arrived | Booking, identity and arrival exist; reception routes the patient |
| Awaiting triage / In triage | Nursing assessment is pending or underway |
| Triaged awaiting destination | Assessment saved; routing still required |
| Escalated to emergency | Emergency team takes clinical responsibility |
| Not yet arrived / Waiting for a room / Awaiting rooming / In room | Clinic preparation and handoff underway |
| Awaiting consultation / With clinician | Consultation can start or is active |
| Consultation paused draft | Unfinished clinical documentation/work remains |
| Awaiting labs / imaging / pharmacy / procedure | A downstream service is outstanding; others may also be pending |
| Post-consultation nursing | Nursing tasks after the consultation are open |
| Ready for clinic checkout / In clinic checkout | Clinic completion checks are being performed |
| Clinic complete awaiting next station | This clinic is done; the entire facility visit may not be |
| Awaiting facility checkout / In facility checkout | Final cross-station checks and disposition remain |
| Admitted | Outpatient pathway handed to inpatient care, not discharge home |
| Referred out | Referral created/clinical disposition selected; coordination may remain |
| Discharged / Discharged with referral / Discharged with pending items | Different final outcomes; pending items still require explicit follow-up |
| Left without being seen / Dismissed without formal checkout / Deceased | Exceptional outcomes requiring truthful documentation and local procedure |

Station lanes are separate words for the order, not the visit: laboratory **To collect / On the bench / Resulted**; pharmacy **To fill / On hold / Dispensed**. Basket orders show **New** (unsigned) or **Pending** (signed, not yet done). Tasks show **Queued / Overdue / Done / Cancelled**.

Not every transition is allowed from every stage. An appointment's completed status does not prove a bill is settled; a paid invoice does not prove a consultation was completed. Colours are supplementary cues only.

## Appendix B. Review evidence and limitations

### What was checked on 5 November 2026

- **Browser walkthrough (section 3).** On a local demo build (standalone demo data, sync between devices switched off, so every role signed in on the same browser profile), each role was signed in with its own demo account at Juba Teaching Hospital and the outpatient example was carried through: reception registered a new child (portal slip shown), registered a walk-in; the nurse found him in the Rooming queue, saved a Triage / ETAT assessment with "not taken" reasons, then Arrived → room → Ready; the doctor saw "Awaiting consultation", continued the triage-prefilled Consultation draft, signed it, and signed a laboratory test and a medicine from the Order basket; the laboratory collected and resulted the test; the doctor marked it reviewed; the pharmacist's first dispense was refused for an SSP 15,500 balance; the cashier recorded SSP 5,000 and then SSP 10,500 cash; the pharmacist dispensed; the nurse accepted the post-consultation handoff and recorded all four tasks; reception set the visit Completed. The signed-order menus (Open prescription / Modify order / Discontinue; Open result), Task list, Patient lists, Clinical forms list, chart Actions menu, staff sign-in page (with its demo-account list) and patient-portal sign-in page were also viewed. No real patient or payment was involved.
- **Code review** (working tree of 5 November 2026) for every other section: role routes and labels, chart section access by role, registration fields, check-in and walk-in services, rooming, post-consultation nursing, order basket, laboratory, imaging, pharmacy payment hold and allergy review, billing workspace and payment methods, financial review, birth/death sliders and printouts, alerts table, management menus, user and facility creation, patient portal activation, OTP and booking, message retention, and screen-lock and shared-screen settings.
- **Not walked on screen for this edition:** radiology, nutrition, maternity/ANC, wards and the MAR, blood bank, controlled substances, referrals and transfers between two live hospitals, claims, reversals and payment plans, DHIS2 export, county/government dashboards, offline sign-in, and real synchronization between devices. Earlier sessions verified transfers and sync on a live CouchDB (31 October to 1 November 2026); this edition did not repeat that.
- The September edition's six Jest suites were not re-run for this edition.

### Problems found during the 5 November walkthrough

1. **Allergy line can claim "No known allergies" before anyone asked.** Registration stores a "None known" placeholder; the chart header then reads "No known allergies", while the order form says "Allergies: Unknown" and the note says no allergy history is documented. Steps: register a patient → open the chart. Treat the header with caution (section 1, section 15) until fixed.
2. **Walk-in checkout can skip Final checkout.** On a device whose clock is not set to Juba time, the walk-in's own booking was dated the Juba day (6 November) while the reception board showed the device's day (5 November). The board's row then had no booking, and choosing **Completed** opened a plain "Change visit status" slider instead of **Final checkout**; the patient left the board without the checkout checks being shown. Steps: on a device outside the Juba time zone, at a time when the two dates differ, register a walk-in, carry the visit through, then set it Completed from the reception board. The same plain slider is used for any queue row that has no booking. The accession number on the laboratory specimen also used the Juba date.
3. **"Triaged" shown before triage.** Immediately after a walk-in check-in, the Patient flow / Patient progress feeds said "Sami Example — triaged" although no triage had been recorded.
4. **Billing "one line per visit" showed two lines.** For one visit, the laboratory test and the medicine appeared as two Billing activity lines (Visits: 2), although the help text says one line per visit. Totals and balances were correct.
5. **Pharmacy counts disagree.** The pharmacy workspace showed "Today's counter: 386 scripts, To fill 386" beside a To fill lane of 66.

### Important corrections to older guidance

- Do not describe all features as available offline.
- Patient-portal sign-in uses an activation code, then a username and password; an SMS code is asked only if the facility has switched it on.
- Shared phone numbers are not sufficient grounds to reject or merge patient records.
- A role's menu access is not the same as permission to perform every action.
- Nurses, laboratory, pharmacy, radiology and nutrition staff work from the shared clinical-style workspace; station work (triage, collection, results, dispensing) opens in sliders or in the patient chart.
- The chart's SBAR section was removed; triage findings flow into the consultation note and the Patient summary. The nurse shift handover is a separate feature.
- There is no voice or AI note-writing ("scribe"), no video visits, no staff text-message or authenticator codes, and no public account-request form.
- No invoice, a draft invoice, an insurance approval, and a zero displayed balance are not interchangeable settlement evidence.
- A screenshot or local change does not establish that production has been deployed with that behaviour.

### Source map for maintainers

- [Role routing](../platform/src/lib/role-routes.ts) and [role labels](../platform/src/lib/role-display.ts)
- [Chart section access](../platform/src/lib/chart-tabs.ts) and [chart form access](../platform/src/components/ehr/chart/panels/role-form-access.ts)
- [Registration form](../platform/src/components/patients/registration/PatientRegistrationForm.tsx)
- [Check-in service](../platform/src/lib/services/check-in-service.ts) and [reception dashboard](../platform/src/app/(dashboard)/dashboard/front-desk/page.tsx)
- [Rooming](../platform/src/components/nurse/RoomingWorkflow.tsx) and [nurse workspace](../platform/src/components/dashboards/NurseHomeView.tsx)
- [Encounter journey](../platform/src/lib/clinical-flow/encounter-journey.ts)
- [Post-consult panel](../platform/src/modules/post-consult/components/PostConsultPanel.tsx)
- [Order basket](../platform/src/components/ehr/chart/panels/OrderBasketPanel.tsx)
- [Payment panel](../platform/src/components/payments/PaymentPanel.tsx) and [billing workspace](../platform/src/components/payments/BillingWorkspace.tsx)
- [Birth and death sliders](../platform/src/components/vital-events/VitalRecordSliders.tsx)
- [Patient portal sign-in](../platform/src/components/patient-portal/PatientLogin.tsx)
- [Offline sign-in tests](../platform/src/__tests__/auth/offline-login-refusal.test.ts)
- [Older user journeys, historical context only](USER-JOURNEYS.md)

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
| On-site pharmacy (yes/no) and SMS provider (configured/not) | ____________________ |
| Referral acceptance and transport process | ____________________ |
| Reporting periods, recipients and submission approval | ____________________ |
| Patient portal activation / guardian-access process | ____________________ |

**Final rule:** finish the real-world task, record it against the correct identity and encounter, verify the saved evidence, and hand the next action to an accountable person. Do not let a convenient status label stand in for care, payment, or communication that has not actually happened.
