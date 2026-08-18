# TamamHealth — Complete User Journeys

**How every user moves through the platform, module by module, step by step.**
Generated from the codebase on 2026-07-14 (branch `web-v2`). Route paths are under `platform/src/app/`; page routes in `(dashboard)/` unless noted. Sibling docs: `RBAC-MATRIX.md`, `CLINICAL-WORKFLOW-SPEC-2026-06.md`, `ARCHITECTURE.md`.

---

## 0. How the platform works (one paragraph)

TamamHealth is an offline-first hospital information system. Every screen reads and writes a local PouchDB in the browser (seeded on first load), optionally syncing to CouchDB when online — so registration, triage, consultation, dispensing, and billing all work with no network. Access is role-based: each of the 25 roles has a route allow-list and a default landing dashboard (`src/lib/role-routes.ts`, enforced by `RoleGuard` and the Edge proxy — `src/proxy.ts`, Next.js 16's middleware layer). Every mutation writes an audit entry and a sync event. Clinical work is modeled as a document chain: **TriageDoc → EncounterDoc → LabResultDoc / PrescriptionDoc → MedicalRecordDoc → BillingDoc/PaymentDoc**, with explicit status state machines (`src/lib/clinical-flow/order-lifecycles.ts`, `encounter-journey.ts`).

---

## 1. Getting in: login, security, and the shell

### 1.1 Staff login (`/login`)

1. **App boot** — on first load the app seeds the offline PouchDB; the login screen shows *"Initializing offline database…"* and the submit button stays disabled until it finishes (can take tens of seconds on a fresh browser).
2. **Choose your account** — demo mode shows an account picker grouped by function (*Front desk & billing → Clinical care → Diagnostics & pharmacy → Records & administration → Sub-national oversight → National & platform*), plus **"Sign in as a patient"** (→ patient portal) and **"Other account"** (manual username form). Production mode (`NEXT_PUBLIC_DEMO_MODE=false`) shows a single sign-in form.
3. **Password screen** — two-pane "Welcome back" with name/role/facility and password (show/hide toggle).
4. **Submit** — tries `POST /api/auth/login` (httpOnly cookie session); on network failure it **falls back to local PouchDB verification**, so previously-seen users can log in fully offline.
5. **Post-login gates**, in order: loading splash → **forced password change** (full-screen, if an admin issued a temp password; min 8 chars) → **PIN lock screen** (see below) → redirect to the role's landing dashboard → first-visit **"Get Started" onboarding card** on the home dashboard.

### 1.2 Session security

- **Auto-lock** — the screen locks immediately when the tab is hidden and after 10 min idle (configurable per facility/org). Unlock is a 4-digit PIN (set up on first lock; stored as a salted hash). Log out is always available from the lock screen.
- **Offline indicator** — a slide-down `ConnectivityNotice` banner announces online/offline flips and sync errors; sync can be paused/resumed and force-run from **Settings → Facility Sync**.

### 1.3 The shell every staff user lives in

- **Top rail** (`EhrTopRail`): brand logo (→ role home), the **module menu** (per-role nav grouped by section), up to 6 shortcut actions, calendar button, **global patient search** (name / hospital number / phone, top-6 live results), **register-patient** button (permission-gated), **My Tasks / Notifications / Announcements**, and the user menu (Profile, Settings, Tour, Log out).
- **Messaging dock** — a floating chat launcher on every screen; full staff chat at `/messages` (direct + group conversations, @mentions, reactions, read receipts, presence). National roles (`super_admin`, `government`) are not messageable.
- **Mobile** — role-matched app shell with a bottom tab bar (Dashboard / Patients / Calendar / Inbox) and a center create button.
- **Settings** (`/settings`) — Preferences (profile, density, language, notifications, lock PIN), plus permission-gated tabs: Facility Settings, User Management (create/reset/deactivate staff), Hospital Management, Facility Sync.

---

## 2. Role directory — who lands where and sees what

| Role | Landing page | Scope in one line |
|---|---|---|
| Doctor / Clinician / Clinical Officer | `/dashboard` | Full clinical: consult, orders, wards, referrals, telehealth, vital events |
| Medical Superintendent | `/dashboard` | Clinical + facility oversight, payments, HR, equipment, checkout |
| Nurse / Triage Nurse / Rooming Nurse | `/dashboard` | Triage, ward board, MAR, handoff, ANC, immunizations — same shared workspace as doctors, role-adapted |
| Midwife | `/dashboard` | Nurse scope focused on ANC, births, deaths |
| Lab Technician | `/dashboard/lab` | Lab bench, blood bank |
| Pharmacist | `/dashboard/pharmacy` | Dispensing queue, inventory, controlled substances |
| Radiologist | `/dashboard/radiology` | Imaging worklist, reporting |
| Nutritionist | `/dashboard/nutrition` | CMAM screening, therapeutic supplies |
| Front Desk (Receptionist) | `/dashboard/front-desk` | Registration, check-in, queue, appointments, referrals, intake |
| Central Registration Clerk / Clinic Clerk | `/dashboard/front-desk` | Registration/scheduling subsets |
| Cashier | `/payments` | Point-of-service collections, receipts |
| Medical Biller | `/payments` | Collections + insurance/NGO claims |
| HRIO / Records-HMIS Officer / Data Entry Clerk | `/dashboard/data-entry` | Census data entry, births/deaths, data quality, DHIS2, reports |
| Hospital Manager | `/facility-management` | Facility ops, HR, equipment, finance oversight |
| Org Admin | `/facility-management` | Multi-facility org: hospitals, users, branding, pricing |
| County Health Director | `/dashboard/state` | Sub-national aggregate oversight (no patient-level access) |
| Government (MoH) | `/government` | National oversight, surveillance, DHIS2 |
| Super Admin | `/admin` | Platform: organizations, users, system, tenant billing, sync conflicts |

Navigating to a route outside the allow-list shows an **"Access Restricted"** screen with a button back to the role's home. (Full mapping: `src/lib/permissions.ts` / `role-routes.ts`; also `docs/RBAC-MATRIX.md`.)

---

## 3. The spine: one patient's journey through a facility

This is the core flow every other module hangs off:

1. **Register** (front desk) → patient chart exists, hospital number assigned
2. **Check in** (front desk) → a `pending` triage entry is created; today's appointment flips to `checked_in`
3. **Room & assign** (front desk) → exam room + assigned provider on the live queue
4. **Triage** (nurse) → ETAT assessment, vitals, RED/YELLOW/GREEN priority
5. **Consultation** (clinician, 6-step wizard) → diagnoses (ICD-11), lab/imaging orders, prescriptions, plan
6. **Departments work the orders** — lab results, imaging reports, dispensed drugs flow back to the chart
7. **Disposition** — checkout (→ facility checkout gate + payment), **admit** (→ wards, MAR), or **refer** (→ another facility with a transfer package)
8. **Records & reporting** — the visit feeds charges, vital statistics, census tallies, and DHIS2 exports

Everything below details each stop.

---

## 4. Front desk & patient access

### 4.1 Patient registry (`/patients`)

Searchable, filterable table (gender, state, registration date, allergies, chronic conditions, recently visited, assigned-to-me, outstanding balance). Row click opens the chart. **Find Patient** modal offers three identity lookups:
1. **Text lookup** — hospital ID, geocode, national ID.
2. **QR scan** — camera scan of the patient's QR card.
3. **Fingerprint identify** — 1:N match via the local fingerprint-bridge scanner (feature-flagged; works offline against locally-replicated templates; org-scoped so tenants can't leak).

### 4.2 Register a new patient (`/patients/new`) — 6-step wizard

| Step | What's captured |
|---|---|
| 1. Demographics | Names, DOB **or** estimated age, gender, tribe, primary language |
| 2. Contact & Location | State/county/payam/boma, household number (derives geocode `BOMA-<code>-HH<n>`), phones, national ID, address |
| 3. Next of Kin | Primary NOK (name/relationship/phone required) + up to 3 more |
| 4. Biometrics | **Patient photo** — centered camera-capture popup (take photo, retake, or upload ≤5 MB) — and **fingerprint enrollment** (consent-gated, up to 10 fingers, quality-checked) |
| 5. Payment Coverage | out-of-pocket / program / exemption / NGO (+ conditional detail fields) |
| 6. Review | Summary incl. photo; submit as **Register Patient** or **Register & Check In** |

Each step validates before advancing. Submission creates the patient doc (hospital number auto-assigned, shown in a toast), then best-effort enrolls fingerprints. **Register & Check In** creates a walk-in appointment and routes to `/appointments?walkIn=<id>`. The same form is embedded in the front-desk dashboard's Register dialog.

### 4.3 Check in an arrival — `CheckInModal`, from the front-desk queue or `/appointments`

There is no standalone check-in page or wizard — the old `/check-in` module is retired. Checking a patient in is an action on their appointment:

1. Open **Check In** on an appointment row (front-desk dashboard or `/appointments`) → `CheckInModal` shows the appointment's time, reason, and department.
2. Confirm **visit type**: New visit or Re-attendance (auto-derived from whether the patient has any prior medical record or closed encounter; staff can override).
3. **Check In** → records the arrival as a `pending` triage-queue entry, opens the visit's arrival encounter, and flips the appointment to `checked_in`. A walk-in with no matching appointment gets one created for it at this moment. Undo is available (reverses a plain check-in back to scheduled) as long as the visit hasn't progressed past arrival.
4. Full ETAT assessment and acuity (RED/YELLOW/GREEN) happen next, at triage (§5.1) — check-in itself no longer captures vitals or acuity.

### 4.4 Front-desk dashboard (`/dashboard/front-desk`) — the command center

A **unified live queue** merges three sources: triaged walk-ins, **arrived** appointments (`checked_in`+), and open checkout encounters/recent registrations. Rows are sorted RED → YELLOW → GREEN → normal and show status chips (WAITING / IN CONSULT / ADMITTED / REFERRED / DONE). The desk's checklist: *Register patient → Check in arrivals → Assign provider → Room walk-ins → Close completed visits.*

Per-row actions:
- **Check In** pending appointments (undo available).
- **Assign room** — Room 1–6 / Bay A–D (or facility-configured rooms) on triage rows.
- **Assign provider** (`AssignDoctorModal`) — hospitals assign a doctor, primary-care facilities a nurse; writes `assignedDoctor` on the patient and a handoff stamp on the triage. The patient then appears in that clinician's worklist. *This is the reception → clinical handoff.*
- **Start consultation** (if permitted) or open **Records**.
- **Checkout** on DONE rows — runs the **Stage-10 facility checkout gate** (prescriptions dispensed? critical labs reviewed? documents generated? payment determined?), discharges the encounter (flagging pending items if unmet), and completes the appointment / discharges the triage. Undo supported.

### 4.5 Appointments (`/appointments`)

List or full calendar (month/week/day). Lifecycle: `requested → scheduled → confirmed → checked_in → in_progress → completed` (+ `cancelled`, `no_show`); accidental transitions are reversible. Creating an appointment checks **provider slot conflicts** and supports type (general, follow-up, ANC, immunization, lab, telehealth, surgical, dental, mental health…), priority, department, and recurrence. **Walk-in** creates an already-`checked_in` appointment. Providers publish bookable windows via the **Availability** modal. Deep link `?new=1&patientId=` pre-fills the form from a chart.

### 4.6 Referrals (`/referrals`)

**Outgoing:** from a chart or consultation, staff create a referral (destination facility, department, urgency routine/urgent/emergency, reason, attachments) — the service bundles a **transfer package** of the patient's records. Status: `sent → received → seen → completed` (or `cancelled`).
**Incoming:** expanding a new referral marks it `received`. **Accept** re-homes the patient to the receiving facility, drops an idempotent **intake encounter** into the receiver's EHR (visit type `referral`, with handover notes), and marks it `seen`. **Decline** requires a reason. **Complete with outcome** sends a structured disposition + summary back to the referring facility.

---

## 5. Nursing

All nurse stations are tabs of `/dashboard/nurse` (Ward / MAR / Triage / Handoff) and standalone routes.

### 5.1 Triage (`/dashboard/nurse/triage`)

1. Pick the patient (walk-ins arrive as `pending` from check-in; deep link `?patient=`).
2. Record chief complaint, **ETAT ABCC** (Airway/Breathing/Circulation/Consciousness-AVPU), full vitals (incl. GCS, MUAC, glucose), and context (arrival mode, duration, referral source, allergies).
3. **Priority auto-derives**: any obstructed airway / absent breathing / absent circulation / unresponsive → **RED**; distressed/impaired → **YELLOW**; else **GREEN**.
4. Save → triage record updated (edits reuse the same document for audit stability).
5. From "Recent Triages", disposition rows: `pending → seen | admitted | referred | discharged`.

### 5.2 Ward board (`/dashboard/nurse/ward`)

Acuity-sorted patient roster. Row actions: **Vitals** (quick entry — persists a real medical record with vital signs and fluid balance, visible on chart trends), **Triage** (re-triage deep link), **Assign doctor**.

### 5.3 Medication administration — MAR

- **Rounds list** (`/dashboard/nurse/mar`): every scheduled dose across patients as rows with **overdue / due / upcoming / given** status (overdue = >1 h past). Quick "Given", or a detail modal (actual dose, route, witness, notes); **Undo** voids an administration (append-only).
- **Bedside time-grid** (`/wards/mar/[admissionId]`): one admission's meds × dose times; each cell records **GIVEN / MISSED / REFUSED / HELD** (non-given requires a reason; controlled drugs require a witness). Allergy + isolation banners; printable.

### 5.4 Shift handoff (`/dashboard/nurse/handoff`)

Auto-detects the shift (day/evening/night), lists critical (RED) patients with a per-patient **SBAR** editor plus task list, and shows shift KPIs (census, critical count, overdue/due MAR). **Sign off** creates a signed handoff document; the oncoming nurse **acknowledges** it. One handoff per shift; printable.

---

## 6. Clinician

### 6.1 Clinician dashboard (`/dashboard`)

Worklist of **assigned patients** (with today's triage acuity) plus queues that demand action: **Documents to sign** (co-sign inbox), Phone notes, Open referrals, Patient intake reviews, **Awaiting labs** (paused visits, resume link), and today's telehealth visits. A calendar view is one click away.

### 6.2 Consultation (`/consultation`) — the 6-step visit wizard

1. **Intake** — patient picker (`?patientId=` deep link), chief complaint + symptom catalog, vitals. *Gate: complaint entered and (vitals present or a triage exists today).*
2. **Examination** — findings by system (general, cardio, respiratory, abdominal, neuro). *Gate: ≥1 system.*
3. **Assessment** — diagnoses with **ICD-11 coded search**; each carries type (primary/secondary), certainty, severity. *Gate: ≥1 diagnosis.*
4. **Orders** — prescriptions (dose/route/frequency/duration/urgency, with **drug-interaction, allergy, and duplicate checks**) and lab/imaging orders from the facility catalog.
5. **Plan & checkout** — treatment plan, attachments, follow-up date, **disposition: checkout / referred / admitted** (+ referral details if referring).
6. **Summary** — read-only review with a **superbill/charge preview** of what completing will post.

Extras: the **AI Clinical Scribe** records or accepts pasted dictation, extracts vitals/complaint/meds/diagnoses/SOAP, and fills the form on approval. Drafts **auto-save encrypted** (24 h TTL). **Send to Lab** mid-visit files the orders, bills them, parks the encounter as `awaiting_labs`, and returns the clinician to the dashboard — the visit resumes later from "Awaiting labs" with results attached. **Send to Pharmacy** works the same for prescriptions.

**Completing the visit** writes the medical record (vitals, exam, ICD-11 diagnoses, prescriptions, labs, plan, follow-up), optionally **signs** it (providers sign final; supervised trainees route for co-signature), posts charges (consultation + labs + drugs, idempotent), updates the triage row, closes the encounter by disposition, and routes: **admitted** → `/wards` pre-filled, **referred** → outgoing referrals, else → the patient chart.

### 6.3 Patient chart (`/patients/[id]`) — OpenMRS O3-style

Three-column shell: left tab rail, main content under a sticky header (avatar/photo, triage badge, pregnancy pill, "Active Visit" chip, balance), right icon rail opening slide-in workspace panels.

- **Tabs:** Patient summary, Vitals & Biometrics, Medications, Orders, Results, Visits, Allergies, Conditions, Immunizations, Procedures, Attachments, Programs, Appointments, Billing (+ Notes, Care Checklist, Recall under "More"). Non-clinical roles (e.g. medical biller) see only admin tabs.
- **Workspace panels:** Order basket (drug + lab orders), Visit note, Task list, Clinical forms, Patient lists.
- **Header actions:** message patient, print, patient education, +Note (→ consultation), Scripts (prescribe), Orders (labs), Exchange (referral), Edit demographics, book appointment.
- Deep links from other modules land here: `?tab=labs&focus=<orderId>` highlights and scrolls to a specific result.

### 6.4 Wards & admissions (`/wards`)

**Admit** (deep-linked from consultation with diagnosis pre-filled): admitting diagnosis, severity, ward + bed, isolation flag → admission created, bed count decremented. **Discharge**: type (normal / against medical advice / transfer / death / absconded) + summary + follow-up flag → closes the admission, releases the bed; a death discharge routes to the death register. KPIs: occupancy by ward.

### 6.5 Telehealth (`/telehealth/visit/[appointmentId]`)

Booked from the appointments calendar (the `/telehealth` route redirects there). Room phases: **entering → waiting room (patient knocks, consent captured) → in call → ended**. Provider controls: mic/camera, screen share, chat, and **"Chart note"** which opens the consultation in picture-in-picture. Session status is tracked (`waiting_room → in_session → completed` with duration).

### 6.6 Antenatal care (`/anc`)

Mothers grouped with latest visit + risk level (low/moderate/high). A visit captures gravida/parity, gestational age, BP, weight, fundal height, fetal heart rate, Hb, urine protein, blood group/Rh, HIV/malaria/syphilis screens, iron-folate, tetanus, IPTp, risk factors, birth plan, and the next-visit date. Feeds the ANC continuum funnel, MCH analytics, DHIS2, and links to birth registration.

### 6.7 Clinical alerts (`/alerts`)

A unified severity-bucketed feed from three live sources — surveillance outbreak alerts, **critical/abnormal lab results**, and overdue immunizations — each with a jump-link into the owning module.

---

## 7. Diagnostics & pharmacy

### 7.1 Laboratory (`/lab` bench + `/dashboard/lab` worklist) — role: lab tech

Order lifecycle (a real state machine): `ordered → specimen_collected → received_at_lab → in_process → resulted → reviewed_by_clinician → acted_upon → communicated_to_patient`, with a rejection loop (`rejected_needs_recollection → re-collect`).

The tech works the queue row by row: **Collect specimen → Receive at lab** (or Reject) **→ Start processing → Enter result** (value/unit/reference range/abnormal/critical flags). Safety rails:
- Entered values are auto-scored against a critical-value table; a critical result requires a **two-eyes confirmation modal** and fires a high-priority message to the ordering clinician.
- **Analyzer import** parses LIS-2A/HL7 payloads for review — never auto-saved.
- The dashboard adds **batch result entry** by test type and turnaround-time analytics.
- Results overdue for clinician review breach an SLA banner (24 h critical / 7 days routine).

Rows deep-link to the chart (`?tab=labs&focus=`), closing the loop with the clinician's "Awaiting labs" resume flow. STAT orders arrive already in-process and flagged critical.

### 7.2 Radiology (`/dashboard/radiology`) — role: radiologist/radiographer

Imaging orders share the lab store (`specimen: 'Imaging'`) and are filtered onto this worklist automatically. Steps: open a study → **attach images/DICOM** (≤5 MB, saved to the patient's documents so the ordering clinician sees them) → **enter findings → Submit report** (completes the order, findings return to the chart). Panels: modality breakdown, body region, completion rate, average TAT.

### 7.3 Pharmacy (`/pharmacy` + `/dashboard/pharmacy`) — role: pharmacist

Prescriptions arrive from consultations into a priority queue (life-sustaining tier first; `immediate` urgency floats up). Tabs: **Queue, Overview, Inventory, Reorder Needed, Expiry Tracker, Patient Med History**.

Dispensing steps: quantity for the full course → **stock gate** (refuses if insufficient) → **drug-interaction check** against the patient's other active meds → for controlled drugs, a **witness picker** records the two-signature register movement *first* → stock decremented → prescription marked `dispensed` → audit. Lifecycle: `prescribed → received_in_pharmacy_queue → under_review → cleared_for_dispensing → dispensed → counseled → complete` (with hold/clarification/stockout branches).

Inventory: live stock status (adequate/low/critical/expired), receive stock with batch + expiry, FEFO expiry tracker, reorder quantities with a printable purchase order, CSV export everywhere.

### 7.4 Controlled substances (`/controlled-substances`)

An **append-only, two-signature register** (SSDFCA-inspection grade). Movements: intake / dispense / waste / reconciliation / transfer. Every entry requires operator + distinct witness, positive quantity, and a non-negative running balance; entries can never be edited or deleted. Pharmacy dispensing of scheduled drugs writes into this same register automatically; a daily reconciliation function supports shift close-out.

### 7.5 Blood bank (`/blood-bank`)

Availability-by-blood-group grid (scarcity color-coded) + a units table with expiry warnings (≤7 days). Staff register donated units (auto-suggested unit IDs, component type, 42-day default shelf life). Unit lifecycle: `available → reserved → crossmatched → transfused` (+ expired/discarded). *Note: reserve/crossmatch/transfuse are fully implemented in the service and API (audited, with compatibility helpers) but not yet exposed as buttons on this page — the current UI journey is unit intake + inventory monitoring.*

### 7.6 Immunizations (`/immunizations`)

Tabs: **Records** (per-child schedule: BCG, OPV, Penta, PCV, Rota, Measles, Yellow Fever, Vit A), **By Vaccine** (coverage analytics incl. an age-cohort heatmap — managers/government only), **Defaulters**. Recording a dose: link the child (≤15 y, or `?patientId=` from a chart) → vaccine, dose #, date, next-due, batch, site, adverse-reaction flag → saved as completed (corrections edit in place, never delete). **Defaulter tracking** flags doses past next-due with urgency tiers (>30 d critical), and supports per-row **"Send SMS recall"** and bulk **"Remind all"** to caregivers (patient phone → next-of-kin fallback).

### 7.7 Nutrition (`/dashboard/nutrition`)

CMAM-style screening: name/age/sex, MUAC, weight/height, edema, ANC toggle → live classification **SAM / MAM / At Risk / Underweight / Normal**. Worklist filters by classification. A supplies panel tracks therapeutic stock (RUTF, F-75/F-100, ReSoMal, Vitamin A, MUAC tapes…) with reorder-level statuses and +/− adjustments.

### 7.8 Equipment (`/equipment`)

Asset register: register an asset (tag, serial, category, condition, department, donor, cost, warranty, **service interval**), **log service** (inspection/service/repair/calibration with cost — drives next-service-due), and **mark operational** after repair. KPIs include "service due soon" (30-day lookahead).

---

## 8. Money: billing, cashier, claims, patient payments

### 8.1 Where charges come from

Org admins maintain the **service price catalog** (`/org-admin/pricing`: category + service code + unit price). Consultation checkout calls `chargeForServices` with one line per service (consultation fee, each lab, each prescription; mid-visit lab sends are charged at send time to avoid double billing). Unpriced lines are **skipped, not charged at zero**. Bills (`INV-YYYYMMDD-NNNN`) mirror into an append-only ledger; an active insurance policy stamps coverage and nets the balance to patient responsibility. Public/government facilities can run fee-free while still tracking costs for donor reporting.

### 8.2 Cashier (`/payments`)

Patient-account ledger sorted outstanding-first, with A/R aging buckets. Steps:
1. **Collect payment** (header button, or deep-linked from front-desk checkout): pick patient → payment panel → tender (cash, mobile money — m-Gurush/M-Pesa/MTN/Airtel —, bank transfer, insurance, credit, waiver) → payment posts and credits the ledger.
2. **Print/email receipt.**
3. **Verify pending payments** — pay-by-link and portal payments arrive `pending`; approve (→ posted) or reject.
4. **Payment plans** — record installments; void/refund posted payments with confirmation.
5. **Waive** a bill (exemption path, reason required).

### 8.3 Medical biller — claims (`/payments/claims`)

KPIs (billed/pending/approved/denied) and payer mix (self-pay, NHIS, CBHI, donor/NGO, government, private, employer). Steps: **submit claim → adjudicate** (allowed/paid amounts, denial reason) **→ appeal → resubmit**.

### 8.4 Pay-by-link (`/payments/portal` + public `/checkout/[linkId]`)

Staff generate and send a payment link. The patient opens it (no login), sees the amount, picks a method (mobile money asks for a phone number), confirms → payment recorded **pending** with a reference. Real confirmation arrives via provider **webhooks** (M-Pesa/Airtel/Flutterwave) which flip it to posted/failed. Expired or used links show terminal states.

---

## 9. Records, vital statistics & HMIS (HRIO / data officer)

1. **Daily census entry** (`/dashboard/data-entry`) — OPD attendance, admissions, deliveries, immunizations given, bed occupancy, disease counts.
2. **Register births** (`/births`) — child + parents + birth details; certificate number auto-generated (`SS-B-…`); links the mother's chart when she's a registered patient.
3. **Register deaths** (`/deaths`) — decedent details, cause, certificate number. (Ward "death" discharges route here.)
4. **Vital statistics** (`/vital-statistics`) — read-only rollups: sex ratios, crude rates, monthly trends.
5. **Data quality** (`/data-quality`) — completeness/timeliness/consistency scoring before export.
6. **DHIS2 export** (`/dhis2-export`) — pick period + level (facility → national; national gated to MoH/superadmin), **sync** to DHIS2 or download JSON/CSV, with a persisted sync log. Standard South Sudan report catalog: Monthly HMIS 105, Weekly Epi, Quarterly HIV, Monthly Maternal, Immunization Coverage.
7. **Monthly reports** (`/reports`) and **MCH analytics** (`/mch-analytics`) — downloadable facility reports and maternal/child indicator dashboards.

---

## 10. Public health & government oversight

- **National dashboard** (`/government`, MoH): facility network status (online/offline), beds/staff/utilization by state, trends, drill-downs, DHIS2 handoff.
- **State/county dashboard** (`/dashboard/state`, county health director): jurisdiction-scoped MCH, births/deaths, immunization coverage, facilities — aggregate only, no patient-level access.
- **Surveillance** (`/surveillance`): notifiable-disease counts across the 28 states, create outbreak alerts, export line lists.
- **Epidemic intelligence** (`/epidemic-intelligence`): signal detection, outbreak risk, hotspot mapping.
- **Emergency preparedness** (`/emergency-preparedness`): create/activate/deactivate response plans.
- **Facility assessments** (`/facility-assessments`): supervisor scorecards; facilities self-submit via **My Facility → Submit to MoH**.
- **Public stats** (`/public-stats`): de-identified public indicators.

---

## 11. Administration

### 11.1 Super admin (`/admin/*`)
Platform dashboard (orgs, users, patients, audit log, DB health, backups) → **Organizations** (create/deactivate tenants) → **Users** (cross-tenant: add, change role, activate/deactivate) → **System** (platform + DHIS2 config, manual sync push) → **Billing** (tenant subscriptions) → **Analytics** (cross-tenant) → **Conflicts** (resolve/dismiss offline-sync conflicts; also open to org admin, superintendent, HRIO).

### 11.2 Org admin (`/org-admin/*`)
Org dashboard → **Hospitals** (create facilities) → **Users** (create staff, reset passwords — issues temp credentials that force a change at next login — deactivate) → **Branding** (logo, theme) → **Settings** → **Analytics** → **Pricing** (the fee schedule powering billing).

### 11.3 Facility managers
- **Facility management** (`/facility-management`, manager home): reviews score, today's appointments, enquiries, staff shortcuts.
- **Hospitals** (`/hospitals` directory + `/hospitals/[id]/manage`): per-facility console — quick-create wards, staff, stock; edit facility details.
- **Facility settings** (`/facility-settings`): payment methods offered, tax rate, rooms, feature flags (e.g. fingerprint).
- **My facility** (`/my-facility`): self-profile + submit assessment/census to MoH.
- **HR** (`/hr` + `/dashboard/hr`): shifts, leave requests, payroll, CSV export.

---

## 12. Patient portal (`/patient-portal`)

Separate from staff login. A patient signs in with **hospital ID + phone** or **name + DOB + phone** (bearer-token session). Tabs:

- **Overview** — summary + quick actions.
- **Medical records, prescriptions, lab results, radiology, immunizations** — read-only history (labs show a pending badge).
- **Appointments** — view and **book** (date, morning/afternoon, department, reason, in-person or telehealth video/audio; arrives as `requested` for staff to confirm).
- **Billing & payments** — real invoices (>30 days flagged overdue); the patient can **pay** via mobile money/card/bank — payments arrive **pending** for facility verification, same as pay-by-link.
- **Messages** — chat with a facility department; staff replies appear in-thread.
- **Profile** — view/update own demographics. Sign out clears the session.

---

## 13. Cross-cutting behaviors worth knowing

- **Deep-link pattern**: modules link into the chart with `?tab=<tab>&focus=<docId>` (wired for labs); charts link out with `?patientId=` pre-fills.
- **Two views per department**: `dashboard/<dept>` is the role's greeting/worklist; the top-level route is the full operational registry with exports and modals.
- **Corrections, not deletions**: clinical records (immunizations, triage, controlled-substance register, MAR) are edited in place or voided append-only to preserve audit and offline sync.
- **Everything is audited** and tenant-scoped; controlled-substance and (API-level) transfusion actions carry two signatures.
- **Known gaps** (as of this writing): blood-bank crossmatch/transfusion has no UI buttons yet (backend complete); some newer registration strings (Biometrics/Payment Coverage) are hard-coded English rather than i18n keys.
