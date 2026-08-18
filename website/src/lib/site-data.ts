/* ═══════════════════════════════════════════════════════════════════
   TamamHealth website data — ported 1:1 from the Claude Design project
   "TamamHealth Website", file "TamamHealth Website.dc.html" (2026-08-13
   revision). Copy lives here verbatim; only the shape changed (slugs and
   hrefs added so the design's in-canvas screen switching becomes real
   routes, and asset paths mapped onto /public).
   ═══════════════════════════════════════════════════════════════════ */

export interface Product {
  slug: string;
  accent: string;
  acronym: string;
  title: string;
  tagline: string;
  description: string;
  modules: string[];
  image: string;
  imageAlt: string;
}

export const PRODUCTS: Product[] = [
  {
    slug: "hmis",
    accent: "#015697",
    acronym: "HMIS",
    title: "Hospital Management System",
    tagline: "For State, County & Referral hospitals",
    description:
      "A connected facility platform for OPD, IPD, ward management, laboratory, imaging, pharmacy, billing, HR, and reporting, all tied to the same patient record.",
    modules: ["Patient Registry", "Outpatient & Inpatient", "Ward & Bed Management", "Laboratory", "Imaging", "Pharmacy", "Billing & Payments", "Reporting & BI", "DHIS2 Sync"],
    image: "/assets/doctor-at-workstation.jpg",
    imageAlt: "A doctor at a workstation, reading a patient's record on screen",
  },
  {
    slug: "cms",
    accent: "#015697",
    acronym: "CMS",
    title: "Clinic Management System",
    tagline: "For PHCUs, private practices & faith-based clinics",
    description:
      "Everything a single-site clinic needs to run a full patient day: registration, consultation, prescriptions, basic lab, dispensing, billing — offline-first.",
    modules: ["Patient Registry", "Outpatient Consultation", "Lab Orders", "Pharmacy Dispensing", "Billing", "DHIS2 Sync"],
    image: "/assets/community-health-worker.jpg",
    imageAlt: "Community health worker at a primary care clinic",
  },
  {
    slug: "lis",
    accent: "#015697",
    acronym: "LIS",
    title: "Laboratory Information System",
    tagline: "For diagnostic centres & hospital labs",
    description:
      "Receive orders from any clinician, run bench workflows, capture results, validate, and release them back into the encounter.",
    modules: ["Order Intake", "Specimen Tracking", "Result Capture", "Quality Control", "TAT Dashboards", "Critical Result Alerts"],
    image: "/assets/doctor-writing-notes.jpg",
    imageAlt: "Lab staff recording results",
  },
  {
    slug: "ris",
    accent: "#015697",
    acronym: "RIS",
    title: "Radiology Information System",
    tagline: "For radiology centres & imaging departments",
    description:
      "Schedule modalities, accession studies, capture findings, and deliver reports back to the ordering clinician — connected to the same record.",
    modules: ["Modality Scheduling", "Study Worklist", "Structured Reporting", "PACS Integration", "DICOM Export"],
    image: "/assets/doctor-tablet-review.jpg",
    imageAlt: "Radiologist reviewing imaging on a workstation",
  },
  {
    slug: "pms",
    accent: "#015697",
    acronym: "PMS",
    title: "Pharmacy Management System",
    tagline: "For retail & hospital pharmacies",
    description:
      "Track medicines from stock to dispense, manage batches and expiry, fill electronic prescriptions, and keep pharmacy activity visible.",
    modules: ["Inventory & Batches", "Expiry Tracking", "Reorder Alerts", "Electronic Rx Dispensing", "POS for OTC", "Supplier Orders"],
    image: "/assets/doctor-prescription.jpg",
    imageAlt: "Pharmacist preparing a prescription",
  },
  {
    slug: "pps",
    accent: "#015697",
    acronym: "PPS",
    title: "Patient Portal",
    tagline: "Patients' window into their own care",
    description:
      "Patients see their own records, prescriptions, lab results, and visit history — on a phone, by SMS, or at a kiosk — and share feedback that flows back to the facility.",
    modules: ["My Records", "Prescriptions & Results", "Visit History", "Appointment Reminders", "Feedback & Follow-up"],
    image: "/assets/clinician-with-tablet.jpg",
    imageAlt: "A patient reading their own health record on a tablet",
  },
];

export const productBySlug = (slug: string) => PRODUCTS.find((p) => p.slug === slug);

interface ProductDetailStep {
  t: string;
  b: string;
}

export interface ProductDetail {
  intro: string;
  stepsTitle: string;
  steps: ProductDetailStep[];
  lifecycleTitle: string;
  lifecycle: string[];
  roles: string[];
  safeguards: { t: string; b: string }[];
}

export const PRODUCT_DETAIL: Record<string, ProductDetail> = {
  HMIS: {
    intro:
      "The full facility spine. One patient, one record, from the moment they arrive at the gate to the moment the visit is closed and reported.",
    stepsTitle: "A patient day, step by step",
    steps: [
      { t: "Register", b: "A 6-step wizard: demographics, contact and location (the household number derives a geocode, BOMA-[code]-HH[number]), next of kin, biometrics — patient photo and consent-gated fingerprint enrolment — payment coverage, then review. A hospital number is assigned on submit." },
      { t: "Check in the arrival", b: "Arrival mode (walk-in, ambulance, referral, police), symptom duration, chief complaint, known allergies, then acuity: Routine, Priority or Emergency. Submitting creates a pending triage entry — the queue token — and flips any same-day appointment to checked in." },
      { t: "Room and assign", b: "The front-desk queue merges triaged walk-ins, arrived appointments and open checkouts, sorted RED → YELLOW → GREEN. Reception assigns an exam room and a provider; the patient then appears in that clinician's worklist. This is the reception-to-clinical handoff." },
      { t: "Triage", b: "The nurse records chief complaint, ETAT ABCC (airway, breathing, circulation, consciousness) and full vitals including GCS, MUAC and glucose. Priority auto-derives: obstructed airway, absent breathing or circulation, or unresponsive → RED; distressed or impaired → YELLOW; otherwise GREEN." },
      { t: "Consultation", b: "A 6-step wizard: intake (complaint and vitals) → examination by system → assessment with ICD-11 coded diagnoses → orders (prescriptions with interaction, allergy and duplicate checks, plus lab and imaging orders) → plan and disposition → summary with a charge preview. Drafts auto-save encrypted." },
      { t: "Departments work the orders", b: "Lab results, imaging reports and dispensed drugs flow back into the chart. Sending to lab mid-visit parks the encounter as awaiting labs and returns the clinician to the dashboard; the visit resumes later with results attached." },
      { t: "Disposition", b: "Checkout runs the facility checkout gate — prescriptions dispensed, critical labs reviewed, documents generated, payment determined — or the visit becomes an admission (ward, bed, medication administration record) or a referral with a bundled transfer package." },
      { t: "Records and reporting", b: "The visit feeds charges, vital statistics, daily census tallies and DHIS2 exports: Monthly HMIS 105, Weekly Epi, Quarterly HIV, Monthly Maternal, Immunization Coverage." },
    ],
    lifecycleTitle: "Appointment lifecycle",
    lifecycle: ["requested", "scheduled", "confirmed", "checked_in", "in_progress", "completed"],
    roles: ["Doctor / Clinical Officer", "Nurse / Triage Nurse / Midwife", "Front Desk", "Medical Superintendent", "Cashier & Medical Biller", "HRIO / Records Officer", "Hospital Manager"],
    safeguards: [
      { t: "Works with no network", b: "Every screen reads and writes a local database in the browser, syncing when a connection appears. Registration, triage, consultation, dispensing and billing all work offline." },
      { t: "Role-based access", b: "Each role has a route allow-list and a default landing dashboard. Navigating outside it shows an access-restricted screen." },
      { t: "Corrections, not deletions", b: "Clinical records are edited in place or voided append-only, so the audit trail and offline sync stay intact." },
    ],
  },
  CMS: {
    intro:
      "Everything a single-site clinic needs to run a full patient day, on one tablet, with no server room and no assumption of connectivity.",
    stepsTitle: "A clinic day, step by step",
    steps: [
      { t: "Find or register the patient", b: "Three identity lookups: text (hospital ID, geocode, national ID), a camera scan of the patient's QR card, or a 1:N fingerprint match — which runs offline against locally-replicated templates." },
      { t: "Check in", b: "Chief complaint, symptom duration, known allergies and acuity. Optional quick vitals: temperature, pulse, respiratory rate, SpO₂, blood pressure, weight." },
      { t: "Consult", b: "The same 6-step wizard the hospitals use: intake, examination, ICD-11 assessment, orders, plan, summary — with drug interaction, allergy and duplicate checks on every prescription." },
      { t: "Order basic lab work", b: "Orders go to the clinic's own bench and come back onto the same encounter, with the visit parked as awaiting labs in the meantime." },
      { t: "Dispense on site", b: "Prescriptions are filled from the clinic's stock: quantity for the full course, a stock gate that refuses on insufficient stock, then an interaction check against the patient's other active medicines." },
      { t: "Charge or exempt", b: "Out-of-pocket, program, exemption or NGO coverage. Unpriced lines are skipped rather than charged at zero, and public facilities can run fee-free while still tracking cost for donor reporting." },
      { t: "Sync when connected", b: "The day's records replicate upward when a connection appears. Sync can be paused, resumed or force-run, and conflicts surface for a human to resolve." },
    ],
    lifecycleTitle: "Visit lifecycle",
    lifecycle: ["pending triage", "in consult", "orders out", "awaiting labs", "checkout", "synced"],
    roles: ["Clinical Officer", "Nurse / Midwife", "Clinic Clerk", "Pharmacist (dispensing)", "Facility Administrator"],
    safeguards: [
      { t: "One tablet is enough", b: "The clinic runs on the same offline-first record as a referral hospital — no local server, no permanent line." },
      { t: "Auto-lock", b: "The screen locks when the tab is hidden and after 10 minutes idle. Unlock is a 4-digit PIN; log out is always available from the lock screen." },
      { t: "Referral out, records with it", b: "Referring bundles a transfer package of the patient's records; the receiving facility gets an intake encounter with handover notes." },
    ],
  },
  LIS: {
    intro:
      "A real order state machine from the moment a clinician files a test to the moment the result is communicated to the patient — with the safety rails a lab needs.",
    stepsTitle: "Working the bench, step by step",
    steps: [
      { t: "The order arrives", b: "Filed from a consultation onto the lab worklist. STAT orders arrive already in process and flagged critical." },
      { t: "Collect the specimen", b: "The tech works the queue row by row; collection is stamped on the order." },
      { t: "Receive at lab — or reject", b: "A rejected specimen enters a recollection loop rather than disappearing: rejected, needs recollection → re-collect." },
      { t: "Start processing", b: "The order moves to in-process and the turnaround clock is visible to the ordering clinician." },
      { t: "Enter the result", b: "Value, unit, reference range, abnormal and critical flags. Entered values are auto-scored against a critical-value table." },
      { t: "Confirm a critical result", b: "A critical value requires a two-eyes confirmation and fires a high-priority message to the ordering clinician." },
      { t: "Release to the chart", b: "The result lands on the patient's Results tab and resumes the clinician's paused awaiting-labs visit. Results overdue for review breach an SLA banner: 24 hours for critical, 7 days for routine." },
    ],
    lifecycleTitle: "Order lifecycle",
    lifecycle: ["ordered", "specimen_collected", "received_at_lab", "in_process", "resulted", "reviewed_by_clinician", "acted_upon", "communicated_to_patient"],
    roles: ["Lab Technician", "Ordering clinician (review)", "Medical Superintendent (oversight)"],
    safeguards: [
      { t: "Analyzer import, never auto-saved", b: "LIS-2A and HL7 payloads are parsed for review by a human before anything is written to a chart." },
      { t: "Batch entry and turnaround analytics", b: "Results can be entered in batches by test type, with turnaround time tracked per test." },
      { t: "Blood bank alongside", b: "Availability by blood group, unit intake with component type and shelf life, and expiry warnings at seven days." },
    ],
  },
  RIS: {
    intro:
      "Imaging orders sit on the same order store as the lab, filtered onto the radiology worklist — so a study is never a separate paper life.",
    stepsTitle: "A study, step by step",
    steps: [
      { t: "The order reaches the worklist", b: "Imaging orders are filtered onto the radiology worklist automatically, carrying the modality and body region requested." },
      { t: "Open the study", b: "The radiographer or radiologist picks it up from the worklist; the patient's chart context travels with it." },
      { t: "Attach images", b: "Images or DICOM files are attached and saved to the patient's documents, so the ordering clinician sees exactly what the reporter saw." },
      { t: "Enter findings", b: "Structured findings are recorded against the study." },
      { t: "Submit the report", b: "Submitting completes the order and returns the findings to the chart, where they close the clinician's loop." },
    ],
    lifecycleTitle: "Study lifecycle",
    lifecycle: ["ordered", "in_process", "images attached", "reported", "reviewed_by_clinician"],
    roles: ["Radiologist", "Radiographer", "Ordering clinician (review)"],
    safeguards: [
      { t: "One record, not a second system", b: "Imaging shares the order store with the laboratory, so a study cannot drift out of the encounter it belongs to." },
      { t: "Department panels", b: "Modality breakdown, body region, completion rate and average turnaround time." },
      { t: "Reports go where they are needed", b: "Findings return into the chart, and the clinician's paused visit resumes with them attached." },
    ],
  },
  PMS: {
    intro:
      "The dispensing queue, the stock room and the controlled-substance register in one place — with the checks that stop the wrong medicine leaving the counter.",
    stepsTitle: "Dispensing, step by step",
    steps: [
      { t: "The prescription arrives", b: "Prescriptions land from consultations into a priority queue: life-sustaining medicines first, immediate urgency floating to the top." },
      { t: "Quantity for the full course", b: "The pharmacist confirms the quantity that completes the prescribed course." },
      { t: "Stock gate", b: "Dispensing is refused outright if stock is insufficient, rather than silently going negative." },
      { t: "Interaction check", b: "The medicine is checked against the patient's other active prescriptions before it can be cleared." },
      { t: "Controlled drugs: witness first", b: "For scheduled medicines a witness picker records the two-signature register movement before any stock moves." },
      { t: "Dispense", b: "Stock is decremented, the prescription is marked dispensed, and the movement is audited." },
      { t: "Counsel and close", b: "Counselling is recorded and the prescription completes; hold, clarification and stock-out branches keep unfinished items visible." },
    ],
    lifecycleTitle: "Prescription lifecycle",
    lifecycle: ["prescribed", "received_in_pharmacy_queue", "under_review", "cleared_for_dispensing", "dispensed", "counseled", "complete"],
    roles: ["Pharmacist", "Pharmacy Technician", "Medical Superintendent (register oversight)"],
    safeguards: [
      { t: "Append-only controlled register", b: "Inspection-grade: every movement — intake, dispense, waste, reconciliation, transfer — needs an operator and a distinct witness, a positive quantity and a non-negative running balance. Entries can never be edited or deleted." },
      { t: "Stock you can trust", b: "Live status (adequate, low, critical, expired), stock received against batch and expiry, first-expiry-first-out tracking, reorder quantities and a printable purchase order." },
      { t: "Charged once", b: "Medicines sent to pharmacy mid-visit are charged at send time, so completing the consultation does not bill them twice." },
    ],
  },
  PPS: {
    intro:
      "The patient's own window into their care — on a phone, by SMS, or at a kiosk — separate from staff login and read-only where it should be.",
    stepsTitle: "What a patient can do",
    steps: [
      { t: "Sign in", b: "With a hospital ID and phone number, or name, date of birth and phone. The session is separate from staff login and clears on sign out." },
      { t: "See the record", b: "Medical records, prescriptions, lab results, radiology reports and immunisations, read-only. Pending lab work carries a pending badge rather than an empty space." },
      { t: "Book an appointment", b: "Date, morning or afternoon, department, reason, and in-person or telehealth. The request arrives as requested for facility staff to confirm." },
      { t: "Pay a bill", b: "Real invoices, with anything over thirty days flagged overdue. Payment by mobile money, card or bank transfer arrives pending for facility verification." },
      { t: "Message the facility", b: "A conversation with a facility department; staff replies appear in the same thread." },
      { t: "Keep details current", b: "Patients view and update their own demographics, which reduces the front desk's re-keying at the next visit." },
    ],
    lifecycleTitle: "Booking lifecycle",
    lifecycle: ["requested", "confirmed", "checked_in", "in_progress", "completed"],
    roles: ["Patients", "Caregivers", "Front Desk (confirming)", "Cashier (verifying payments)"],
    safeguards: [
      { t: "Nothing new to install", b: "Reached from a phone browser, by SMS reminder, or at a facility kiosk — no app store, no smartphone requirement." },
      { t: "Payments are verified, not assumed", b: "Portal payments arrive pending and are approved or rejected by a cashier before they post to the ledger." },
      { t: "Intake before arrival", b: "Form packets sent by SMS come back for staff review, then merge into the chart field by field on approval." },
    ],
  },
};

export interface Challenge {
  slug: string;
  title: string;
  image: string;
  imageAlt: string;
  short: string;
  /** Icon path data for the 24×24 outline glyph on the challenge card. */
  d: string;
  d2: string;
  body: string;
  cost: string;
  fix: string;
  products: string[]; // acronyms
  steps: { t: string; b: string }[];
}

export const CHALLENGES: Challenge[] = [
  {
    slug: "records-that-cannot-be-found",
    title: "Records that cannot be found",
    image: "/assets/images/reviewing-health-records.jpeg",
    imageAlt: "A family reviewing paper health records",
    short: "A patient's history exists in exactly one ledger, in one building, on one shelf.",
    d: "M4 4h4l2 3h10a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z",
    d2: "M9 14h6",
    body: "Paper files live where they were written. If the folder is at another facility, in a locked office, or lost to flooding, the clinician in front of the patient has nothing to read. Staff search shelves while a queue builds outside the door.",
    cost: "Time spent looking for a file is time taken from the patient in front of you.",
    fix: "**One patient record**, held on the device and **replicated when a connection appears** — searchable by name, hospital number, geocode, QR card or fingerprint.",
    products: ["HMIS", "CMS", "PPS"],
    steps: [
      { t: "Register once, keep the identity", b: "The front desk registers the patient once. The record carries a hospital number, a geocode down to the boma, and optionally a QR card or fingerprint, so the same person is found again without a folder." },
      { t: "Find the patient in seconds", b: "Search by any of those identifiers. The result is the whole record — every past encounter, prescription, result and referral attached to that person." },
      { t: "Hold it on the device", b: "The record lives on the facility device, so a power cut or a dropped connection does not remove access to the history in front of the clinician." },
      { t: "Replicate when a connection appears", b: "When bandwidth returns, changes sync both ways. The file is no longer in one building on one shelf — it exists wherever that patient presents." },
    ],
  },
  {
    slug: "histories-rebuilt-from-memory",
    title: "Histories rebuilt from memory",
    image: "/assets/doctor-writing-notes.jpg",
    imageAlt: "A clinician writing notes by hand",
    short: "Every visit starts from scratch, reconstructed by asking the patient again.",
    d: "M3 12a9 9 0 1 0 3-6.7",
    d2: "M3 4v5h5",
    body: "Without the last visit in hand, the clinician takes the story again: what was diagnosed, what was prescribed, whether it worked. The patient answers from memory, and the memory of an unwell person under pressure is an unreliable clinical record.",
    cost: "Consultations run long and start incomplete — the second visit knows less than the first.",
    fix: "The chart opens with vitals, diagnoses, prescriptions, results and the plan from **every previous visit already there**.",
    products: ["HMIS", "CMS", "PPS"],
    steps: [
      { t: "Open the chart, not a blank page", b: "Starting a consultation loads the patient's timeline: previous diagnoses, medicines, results, vitals and the plan left by the last clinician." },
      { t: "Record the encounter as structured data", b: "Vitals, complaint, examination, diagnosis and plan are captured in fields, not prose, so the next clinician can read them without interpretation." },
      { t: "Carry the plan forward", b: "Follow-up instructions and review dates persist on the record and surface at the next visit instead of relying on the patient's recall." },
      { t: "Let the patient see it too", b: "Through the patient portal, the person can read their own visit history, prescriptions and results — a second copy of the truth." },
    ],
  },
  {
    slug: "queues-with-no-order-of-urgency",
    title: "Queues with no order of urgency",
    image: "/assets/medical-unit-male-ward.jpg",
    imageAlt: "Patients waiting on a crowded hospital ward",
    short: "People are seen in the order they arrived, not the order their condition demands.",
    d: "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z",
    d2: "M12 7v5l4 2",
    body: "A paper queue cannot rank itself. A child in respiratory distress waits behind a routine review because the register has no way to say which is which, and no one at the desk can see the whole room at once.",
    cost: "The sickest patients wait the longest, and nobody finds out until it is late.",
    fix: "Check-in assigns acuity, triage derives **RED / YELLOW / GREEN** from ETAT vitals, and the **live queue sorts itself by urgency**.",
    products: ["HMIS", "CMS"],
    steps: [
      { t: "Check in against the record", b: "Arrival is logged on the patient's record, so the room is a list rather than a crowd with no order." },
      { t: "Take vitals at triage", b: "Weight, temperature, pulse, respiratory rate and oxygen saturation are entered at the triage station." },
      { t: "Derive acuity from ETAT", b: "The system applies ETAT criteria to those vitals and assigns RED, YELLOW or GREEN rather than leaving the judgement to whoever is at the desk." },
      { t: "Let the queue re-sort itself", b: "The live queue orders by acuity and waiting time, and the whole room is visible on one screen to the clinician in charge." },
    ],
  },
  {
    slug: "treatment-repeated-or-missed",
    title: "Treatment repeated, or missed",
    image: "/assets/doctor-prescription.jpg",
    imageAlt: "A prescription being prepared",
    short: "Without the last prescription, the next one is a guess.",
    d: "M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7z",
    d2: "M8.5 8.5l7 7",
    body: "Tests are re-ordered because no one can see yesterday's result. Medicines are re-prescribed because no one can see what was dispensed. Interactions and allergies stay invisible until they present as harm.",
    cost: "Scarce drugs and reagents are spent twice, and avoidable reactions get through.",
    fix: "Prescribing runs **interaction, allergy and duplicate checks** against the patient's active medicines, and dispensing writes back to the same record.",
    products: ["HMIS", "CMS", "PMS"],
    steps: [
      { t: "Prescribe from the active medicine list", b: "The prescriber sees what the patient is already taking, when it was dispensed and by whom." },
      { t: "Run the safety checks", b: "Interaction, allergy and duplicate-therapy checks run against that list before the prescription can be issued." },
      { t: "Dispense against the prescription", b: "The pharmacy fills the electronic prescription — no transcription, no guessing at handwriting — and records the batch actually given out." },
      { t: "Write it back to the record", b: "The dispense event closes the loop on the same patient record, so the next clinician sees what was received, not what was intended." },
    ],
  },
  {
    slug: "results-that-never-reach-the-clinician",
    title: "Results that never reach the clinician",
    image: "/assets/doctor-tablet-review.jpg",
    imageAlt: "A clinician reviewing results",
    short: "A lab slip has to survive a walk across the compound.",
    d: "M9 3h6v5l4 9a2 2 0 0 1-2 3H7a2 2 0 0 1-2-3l4-9z",
    d2: "M9 3h6",
    body: "The bench produces a number, writes it on a slip, and hopes it finds the person who ordered it. Critical values travel at the speed of whoever is carrying them, and a slip that goes missing is a result that was never taken.",
    cost: "Abnormal and critical findings sit unread while the patient goes home.",
    fix: "Results release straight into the chart, critical values require **two-eyes confirmation** and message the ordering clinician, and unreviewed results **breach a visible SLA**.",
    products: ["LIS", "HMIS", "RIS"],
    steps: [
      { t: "Order electronically", b: "The clinician orders from within the encounter; the lab receives it as a worklist item tied to that patient and that visit." },
      { t: "Track the specimen", b: "Collection, receipt and analysis are stamped, so anyone can see where a sample is instead of asking." },
      { t: "Release into the chart", b: "Validated results publish straight to the ordering clinician's inbox and onto the patient's record. Nothing has to be carried across the compound." },
      { t: "Escalate the critical ones", b: "Critical values require two-eyes confirmation and notify the ordering clinician directly; results left unreviewed breach a visible turnaround SLA." },
    ],
  },
  {
    slug: "stock-counted-after-it-has-run-out",
    title: "Stock counted after it has run out",
    image: "/assets/ward-supplies-distribution.jpg",
    imageAlt: "Supplies being handed out on a ward round, counted by hand from the trolley",
    short: "The shelf is the only inventory system, and it reports late.",
    d: "M20 7.5 12 3 4 7.5v9L12 21l8-4.5z",
    d2: "M4 7.5 12 12v9",
    body: "Medicines are counted by eye during a busy shift, expiry dates are checked when someone remembers, and a stock-out is discovered at the counter with a prescription already in hand. Reorder decisions rest on guesswork.",
    cost: "Patients are turned away from drugs the facility owned but let expire.",
    fix: "**Live stock status**, batch and expiry tracking with **first-expiry-first-out**, reorder alerts and a printable purchase order — plus an append-only two-signature register for controlled medicines.",
    products: ["PMS", "HMIS"],
    steps: [
      { t: "Receive stock into batches", b: "Deliveries are entered by batch number and expiry date, so the shelf has a ledger behind it." },
      { t: "Dispense first-expiry-first-out", b: "The system proposes the batch closest to expiry, which is how stock stops ageing out unnoticed." },
      { t: "Watch levels and dates continuously", b: "Reorder points and expiry windows raise alerts before a stock-out reaches the counter." },
      { t: "Order on evidence", b: "A printable purchase order is generated from real consumption; controlled medicines run on an append-only two-signature register." },
    ],
  },
  {
    slug: "referrals-that-travel-without-their-record",
    title: "Referrals that travel without their record",
    image: "/assets/community-health-worker.jpg",
    imageAlt: "A community health worker with a patient",
    short: "The patient arrives at the next facility carrying only their own account.",
    d: "M3 12h13",
    d2: "M13 6l6 6-6 6",
    body: "A referral note names a destination but rarely carries the clinical picture. The receiving team starts the workup again, and the referring team never learns what happened to the patient they sent.",
    cost: "Care restarts at every level, and the loop back to the referring clinician is never closed.",
    fix: "Referral bundles **a transfer package of the record**; accepting it opens an intake encounter with handover notes, and completion **sends a structured outcome back**.",
    products: ["HMIS", "CMS"],
    steps: [
      { t: "Refer with the record attached", b: "The referral bundles a transfer package: history, vitals, results, medicines and the reason for referral." },
      { t: "Accept and open an intake", b: "The receiving facility accepts the referral, which opens an intake encounter already populated with handover notes." },
      { t: "Continue rather than restart", b: "The receiving team reads the workup that has already been done instead of repeating it." },
      { t: "Close the loop", b: "On completion, a structured outcome is sent back to the referring clinician, so the person who sent the patient learns what happened." },
    ],
  },
  {
    slug: "reports-assembled-by-hand-at-month-end",
    title: "Reports assembled by hand at month end",
    image: "/assets/outreach-blood-pressure.jpg",
    imageAlt: "A health worker writing a blood-pressure reading onto a paper form at an outreach clinic",
    short: "National figures are transcribed from tally sheets weeks after the fact.",
    d: "M4 20V10m5 10V4m5 16v-7m5 7V7",
    d2: "",
    body: "Facility staff spend days copying registers into monthly summaries. Numbers arrive late, incomplete, and impossible to check against the visits that produced them — which is precisely the gap the Ministry names in its own review of the system.",
    cost: "Planning and outbreak response run on data that is already out of date.",
    fix: "**Every visit tallies as it happens**, data-quality scoring runs **before** export, and DHIS2-ready reports — Monthly HMIS 105, Weekly Epi, Immunization Coverage — are generated, not retyped.",
    products: ["HMIS", "CMS"],
    steps: [
      { t: "Tally at the point of care", b: "Each visit contributes to the indicators as it is recorded. There is no separate counting exercise." },
      { t: "Score the data before it leaves", b: "Data-quality checks flag missing fields, impossible values and gaps in reporting ahead of submission." },
      { t: "Generate the national reports", b: "Monthly HMIS 105, Weekly Epi and Immunization Coverage reports are produced from the same records, in DHIS2-ready form." },
      { t: "Submit and keep the trail", b: "Submission is logged and traceable back to the encounters that produced each number, so a figure can be checked rather than trusted." },
    ],
  },
];

export const challengeBySlug = (slug: string) => CHALLENGES.find((c) => c.slug === slug);

export interface CareLevel {
  tone: string;
  level: string;
  role: string;
  product: string;
  image: string;
  alt: string;
}

export const CARE_LEVELS: CareLevel[] = [
  { tone: "#015697", level: "Community — Boma Health Initiative", role: "Promotion, screening & referral", product: "Registry & referral", image: "/assets/community-malaria-test.jpg", alt: "A community health worker running a malaria rapid test on a small child held by their mother, at a village outreach" },
  { tone: "#015697", level: "Primary Health Care Unit (PHCU)", role: "First formal point of care", product: "CMS", image: "/assets/community-health-worker.jpg", alt: "Community health worker at a primary care clinic" },
  { tone: "#015697", level: "Primary Health Care Centre (PHCC)", role: "Expanded primary & maternity care", product: "CMS", image: "/assets/medical-unit-female-ward.jpg", alt: "The women's side of a health centre's medical unit" },
  { tone: "#015697", level: "County Hospital", role: "First referral & inpatient care", product: "HMIS", image: "/assets/inpatient-ward-beds.jpg", alt: "Mothers and babies on numbered beds under mosquito nets in a hospital inpatient ward" },
  { tone: "#015697", level: "State Hospital", role: "Secondary & specialised care", product: "HMIS", image: "/assets/doctor-nurse-consultation.jpg", alt: "Hospital clinicians coordinating patient care" },
  { tone: "#015697", level: "Referral / Tertiary Hospital", role: "Tertiary & teaching care", product: "HMIS", image: "/assets/doctor-tablet-review.jpg", alt: "Clinician reviewing records on a tablet" },
];

/** Sidebar label for a care level — "Community" for the Boma tier, otherwise the level minus its parenthetical. */
export const careLevelLabel = (c: CareLevel) =>
  c.product === "Registry & referral" ? "Community" : c.level.replace(/ \(.*\)/, "").replace(" — Boma Health Initiative", "");

/* The two infrastructure figures that carry the closing argument on the
   health-system page: they are the reason offline-first is a requirement and
   not a feature. The other EHSP/SARA numbers are attached to the part of the
   problem they evidence, in PROBLEM_BREAKS below. */
export const TOOLING_STATS = [
  { value: "4%", label: "of facilities have a computer with internet", source: "SARA / EHSP 2025" },
  { value: "13%", label: "have any on-site power source", source: "SARA / EHSP 2025" },
];

export interface TeamMember {
  accent: string;
  name: string;
  role: string;
  image: string;
  /** object-position for the square portrait crop. The default, "center top",
      suits a roughly square or landscape source; a tall portrait needs the
      window pulled down or the crop lands on the wall above the subject. */
  focus?: string;
}

export const TEAM: TeamMember[] = [
  { accent: "#015697", name: "Teny Makuach", role: "Founder & Developer", image: "/assets/founder-teny.jpg" },
  { accent: "#015697", name: "Ekow Williams", role: "Community & Partnerships", image: "/assets/founder-ekow.jpg" },
  // 1080×1920 — the tallest source in the set; "center top" would crop 840px
  // of empty wall. 50% puts the head about an eighth down the square.
  { accent: "#015697", name: "Toye Adebayo", role: "Project Manager", image: "/assets/founder-toye.jpg", focus: "center 50%" },
  { accent: "#015697", name: "Mark Dosu", role: "Software Developer", image: "/assets/Mark-Dosu.jpeg" },
  { accent: "#015697", name: "Chinonye Hycent", role: "Research Lead", image: "/assets/chinonye-hycent.jpg" },
  { accent: "#015697", name: "Isaac Kyalo", role: "Technical Lead", image: "/assets/isaac-kyalo.jpg" },
];

export const GOALS = [
  { accent: "#015697", value: "$100K", label: "pilot goal to launch across 10 clinics" },
  { accent: "#015697", value: "10", label: "clinics in Juba and greater South Sudan" },
  { accent: "#015697", value: "12mo", label: "from equipment to measurement, then regional scale" },
];

export interface Hero {
  kicker: string;
  title: string;
  body: string;
  image: string;
  alt: string;
  accent: string;
  stripKicker: string;
  stripTitle: string;
  /**
   * Where the strip claim is actually set out in full. Every one of these must
   * land on a section that expounds THIS card's number — not merely a related
   * page — because that is what the card promises when it is clicked.
   */
  href: string;
  /**
   * object-position for the full-bleed crop, when "center 35%" cuts this
   * particular photograph badly. The hero band is far wider than any of the
   * source images, so the crop is decided vertically and one setting cannot
   * suit every composition.
   */
  focus?: string;
}
/* No source line on the strip cards: the attribution belongs with the figure
   itself, which is what "Learn more" resolves to — the reality grid on
   /health-system carries the EHSP 2025 credit per statistic. */

export const HEROES: Hero[] = [
  {
    kicker: "The Problem",
    /* The headline is the promise; the strip card and the body below it carry
       the diagnosis. No terminal full stop — none of the four hero titles
       takes one. */
    title: "Transforming fragmented records into connected care",
    body: "In South Sudan, a patient's history lives on paper — **one ledger, one building, one shelf** — so when it is lost or damaged, care begins again from nothing. The same break runs upward: what a facility knows about an outbreak, a stock-out or a missed vaccination rarely reaches anyone who can act on it. **The data exists**; what has been missing is a record built for a clinic with no power and no signal. That is what Tamam is.",
    /* The paper record itself, in the hands of the two people the platform is
       for. The left third of the frame is bare wall, which is exactly where
       the hero card sits — the clinicians and the file stay in view beside it. */
    image: "/assets/doctor-nurse-consultation.jpg",
    alt: "A doctor and a nurse reading a patient's paper file together, in front of a wall of paper folders",
    /* Both clinicians stand high in this frame: the default 35% cuts the top
       of the doctor's head on a 900px-tall screen. 27% keeps both heads whole
       and still carries the folder rack and the green file. */
    focus: "center 27%",
    accent: "#015697",
    stripKicker: "The Problem",
    /* The mission's own statement of the problem (VISION-MINDMAP.md). A single
       health-outcome figure read as one statistic among many; the failure this
       venture actually addresses is that the record never travels. */
    stripTitle: "The data exists — it never makes it up the chain",
    href: "/health-system#reality",
  },
  {
    kicker: "Ground Truth",
    title: "The daily reality inside South Sudan's facilities",
    body: "Documented across South Sudanese facilities, from the wards to the waiting line — the same failures repeat on both sides of the consultation desk: **lost histories, duplicate treatment, and very slow clinical flow**.",
    image: "/assets/images/pediatric-ward-interior.jpeg",
    alt: "A crowded pediatric ward",
    accent: "#015697",
    stripKicker: "Ground Truth",
    /* Not /about#crisis — that is the origin story. The failures this card
       names are the eight challenge cards, and they live here. */
    stripTitle: "The daily reality inside South Sudan's facilities",
    href: "/health-system#challenges",
  },
  {
    kicker: "National Alignment",
    title: "South Sudan's healthcare system",
    body: "The Ministry of Health's **2025 Essential Health Services Package** organises the country's care into **six levels** — and names fragmented, paper-bound data as one of its biggest gaps. Tamam is shaped to fit that system, not replace it — and the same six-tier structure runs through most sub-Saharan health systems, so what fits here travels.",
    /* Takes the frame the problem card gave up. The carousel shows four
       photographs; two of them being the same one made it read as a stall
       rather than a change of subject. A rural clinic also sits at the tier
       this card is about — the primary level the EHSP builds up from. */
    image: "/assets/new-landing.png",
    alt: "A South Sudanese midwife examining a child with a stethoscope at a rural clinic",
    accent: "#015697",
    stripKicker: "National Alignment",
    stripTitle: "South Sudan's healthcare system",
    /* The six tiers this card names are the levels section, not the top of the
       page. */
    href: "/health-system#levels",
  },
  {
    kicker: "The Goal",
    title: "Our goal is to prove it works, then bring it to every clinic that needs it",
    body: "We're raising **$100,000** to launch TamamHealth in **10 clinics** across Juba and greater South Sudan — proof that offline-first digital records can work in the hardest conditions, and the model we take across sub-Saharan Africa.",
    image: "/assets/community-health-worker.jpg",
    alt: "Community health worker at a primary care clinic",
    accent: "#015697",
    stripKicker: "The Goal",
    stripTitle: "$100,000 to launch across 10 clinics",
    href: "/donate",
  },
];

export const DONATION_TIERS = [
  { accent: "#015697", amount: "$50", label: "Powers one clinic day", note: "Solar charging and data for a tablet running a full patient day offline." },
  { accent: "#015697", amount: "$250", label: "Equips a front desk", note: "One tablet plus the fingerprint reader that gives undocumented patients an identity." },
  { accent: "#015697", amount: "$1,000", label: "Trains a facility team", note: "Registration, consultation, lab, and pharmacy staff trained on the same record." },
  { accent: "#015697", amount: "$10,000", label: "Launches a clinic", note: "One of the ten pilot clinics — devices, power, training, and twelve months of support." },
];

export const DONATION_STEPS = [
  { accent: "#015697", n: "01", title: "You give", body: "Choose an amount, one-time or monthly. Every gift is earmarked for the 10-clinic pilot in Juba and greater South Sudan." },
  { accent: "#015697", n: "02", title: "We equip", body: "Funds buy the physical things a clinic needs to go digital: affordable tablets, solar power, fingerprint readers — no server room, no IT department." },
  { accent: "#015697", n: "03", title: "We deploy and train", body: "Each facility is set up offline-first and its team is trained on one patient record across registration, consultation, lab, and pharmacy." },
  { accent: "#015697", n: "04", title: "We measure and report back", body: "Clean records roll up into facility dashboards and DHIS2-ready national reports. Donors get the same numbers the Ministry sees." },
];

export const DONATION_FAQ = [
  { q: "Where exactly does the money go?", a: "Devices and solar power, deployment and staff training, connectivity and sync, and measurement. The $100,000 pilot goal covers all ten clinics over twelve months, from equipment to measurement and scale." },
  { q: "Can I fund a specific clinic?", a: "Yes. Tell us in the message and we will assign your gift to one of the ten pilot facilities and report on that facility directly." },
  { q: "Can my organisation partner instead of donating?", a: "Facility, NGO, funder, or ministry — write to support.tamam@gmail.com and we will scope a deployment with you." },
  { q: "How do I know it worked?", a: "Every level writes to the same patient record and rolls up into DHIS2-ready national reports — the pilot is designed to be measured, not asserted." },
];

/**
 * The languages the site and the platform are actually translated into.
 *
 * This used to list eight South Sudanese languages, none of which the site
 * could render — the picker set a state variable and nothing else. A language
 * belongs here only once its dictionary exists end to end; the canonical list
 * now lives in `@/lib/i18n` (SUPPORTED_LOCALES) and this re-exports the display
 * names for prose that talks about language support.
 */
export const LANGUAGES = ["English", "Arabic (Juba)"];

export const STAFF_USERS = [
  { name: "Doctor", scope: "Consultation, orders, admissions, discharge" },
  { name: "Clinical Officer", scope: "Consultation and prescribing at clinic level" },
  { name: "Nurse", scope: "Vitals, ward care, medication administration" },
  { name: "Triage Nurse", scope: "Vitals, ETAT acuity, the waiting queue" },
  { name: "Midwife", scope: "ANC, delivery and postnatal care" },
  { name: "Laboratory Technician", scope: "Specimens, bench workflow, results" },
  { name: "Radiologist", scope: "Study reporting and review" },
  { name: "Radiographer", scope: "Modality worklist and image capture" },
  { name: "Pharmacist", scope: "Prescription review, dispensing, counselling" },
  { name: "Pharmacy Technician", scope: "Stock, batches, expiry, reorder" },
  { name: "Front Desk", scope: "Registration, check-in, scheduling" },
  { name: "Clinic Clerk", scope: "Single-site registration and records" },
  { name: "Cashier & Medical Biller", scope: "Invoices, payments, insurance claims" },
  { name: "HRIO / Records Officer", scope: "Coding, registers, HMIS returns" },
  { name: "Community Health Worker", scope: "Household visits, referrals, geocoded households" },
  { name: "Medical Superintendent", scope: "Clinical oversight and controlled registers" },
  { name: "Hospital Manager", scope: "Facility performance and staffing" },
  { name: "Facility Administrator", scope: "Accounts, roles, devices, sync" },
  { name: "Government Administrator", scope: "National reporting and DHIS2 export" },
];

/* The real platform deployment this site hands sign-ins over to. The site
   itself holds no session — auth, seeded demo accounts and the one-tap
   roster (front desk through Super Admin) all live on the platform.
   Locally: set NEXT_PUBLIC_PLATFORM_URL=http://localhost:3000 in .env.local.

   The fallback is PRODUCTION, not the demo. Every login entry point on this
   site now redirects through this value, so a default pointing at the v6 demo
   would have sent staff who clicked "Staff log in" to a seeded sandbox and
   let them try facility credentials against it. An unset variable should fail
   safe toward the real deployment. */
export const PLATFORM_URL = process.env.NEXT_PUBLIC_PLATFORM_URL ?? "https://app.tamamhealth.org";

export interface LoginRole {
  key: "staff" | "patient" | "ministry" | "superadmin";
  label: string;
  idLabel: string;
  idPlaceholder: string;
  cta: string;
  /** Path on the platform this portal's sign-in continues to. */
  path: string;
}

export const ROLES: LoginRole[] = [
  {
    key: "staff",
    label: "Facility staff",
    idLabel: "Username",
    idPlaceholder: "dr.wani",
    cta: "Log in to the platform",
    path: "/login",
  },
  {
    key: "patient",
    label: "Patient",
    idLabel: "Geocode ID or phone",
    idPlaceholder: "BOMA-KJ-HH1001",
    cta: "Open my records",
    path: "/patient-portal",
  },
  {
    key: "ministry",
    label: "Ministry",
    idLabel: "Official email",
    idPlaceholder: "name@moh.gov.ss",
    cta: "Open national dashboard",
    path: "/login",
  },
  {
    key: "superadmin",
    label: "Platform admin",
    idLabel: "Username",
    idPlaceholder: "superadmin",
    cta: "Open the admin console",
    path: "/login",
  },
];

/**
 * The platform URL a portal link should open directly.
 *
 * Links on this site point at this rather than at `/login`, because `/login`
 * is a redirect: an internal <Link> to it makes the browser fetch this origin
 * first, wait to be told to leave, and only then load the platform. That shows
 * up as a stall and a flash on every click — a hop the reader pays for and
 * nothing needs. `/login` stays for bookmarks, printed material and anything
 * already pointing there.
 */
export function platformHref(role: LoginRole["key"] = "staff"): string {
  const path = ROLES.find(r => r.key === role)?.path ?? "/login";
  return `${PLATFORM_URL}${path}`;
}

export const LEGAL = [
  { id: "covers", title: "What these terms cover", paras: [
    "These Terms & Conditions govern use of the TamamHealth platform — the hospital, clinic, laboratory, radiology, pharmacy and patient portal products — together with this website and any related services. By creating an account, signing in, or using the platform on a facility device, you agree to them.",
    "Where a facility, ministry or partner organisation has signed a separate deployment agreement with TamamHealth, that agreement takes precedence over these terms for the users it covers.",
  ]},
  { id: "accounts", title: "Accounts and access", paras: [
    "Accounts are issued by a facility administrator, not self-registered. Each account belongs to one named person, carries one role, and must not be shared. Administrator-issued credentials require a password change on first use.",
    "You are responsible for activity under your account. Report a lost device or suspected compromise to your facility administrator immediately so the session can be revoked.",
  ]},
  { id: "roles", title: "Role-based use", paras: [
    "The platform restricts what each role can see and do — doctor, clinical officer, nurse, laboratory technician, pharmacist, front desk, community health worker, and government administrator. You may only use the functions your role has been granted.",
    "Attempting to reach records outside your role or your facility is a breach of these terms and is recorded in the audit log.",
  ]},
  { id: "patient-data", title: "Patient data and confidentiality", paras: [
    "Patient records are confidential. You may access a record only where you have a clinical, administrative or public-health reason to do so, and only for as long as that reason lasts.",
    "Records are identified primarily by geocode household ID rather than national ID. Photographs, fingerprints and other identifying material may be captured only with the patient's or guardian's knowledge, and only for identification and continuity of care.",
  ]},
  { id: "offline", title: "Offline operation and sync", paras: [
    "The platform is offline-first: it is designed to work without connectivity and to synchronise when a connection returns. Data entered offline is held on the device until sync completes.",
    "You must not wipe, reinstall or dispose of a facility device with unsynchronised records on it. Logging out clears the local database, so sync before you sign out for the last time on a shared device.",
  ]},
  { id: "reporting", title: "Reporting and government use", paras: [
    "Aggregate, de-identified data may be exported for DHIS2 and IDSR reporting and for national and international public-health reporting, consistent with Ministry of Health requirements.",
    "Notifiable diseases coded in a record are flagged for mandatory reporting automatically. You should not suppress or alter a diagnosis to avoid a report.",
  ]},
  { id: "licence", title: "Licence and intellectual property", paras: [
    "TamamHealth grants your facility a non-exclusive, non-transferable licence to use the platform for the delivery of health services for the term of its agreement. The software, its interfaces, and its clinical content sets remain the property of TamamHealth.",
    "You may not copy, resell, decompile or repurpose the platform, or remove its notices, without written permission.",
  ]},
  { id: "availability", title: "Availability and support", paras: [
    "We aim to keep server-side services available and to publish maintenance in advance. Because the platform is offline-first, clinical work is designed to continue when those services are unavailable.",
    "Support is provided through the channel named in your facility's agreement, or at support.tamam@gmail.com for pilot deployments.",
  ]},
  { id: "liability", title: "Clinical responsibility and liability", paras: [
    "The platform supports clinical decisions; it does not make them. Diagnostic suggestions, alerts and risk flags are aids, and the treating clinician remains responsible for every clinical decision and record entry.",
    "To the extent permitted by law, TamamHealth is not liable for indirect or consequential loss arising from use of the platform, and nothing in these terms limits liability that cannot lawfully be limited.",
  ]},
  { id: "termination", title: "Suspension and termination", paras: [
    "A facility administrator may suspend or remove an account at any time. We may suspend access where use threatens patient confidentiality, data integrity or the security of the deployment.",
    "On termination, patient records remain the property of the facility and the ministry and are handed over in an exportable form.",
  ]},
  { id: "law", title: "Governing law", paras: [
    "These terms are governed by the laws of the Republic of South Sudan. Where a deployment sits under a different jurisdiction, that jurisdiction is named in the deployment agreement.",
  ]},
  { id: "changes", title: "Changes to these terms", paras: [
    "We may update these terms as the platform and its deployments change. Material changes will be notified to facility administrators, and continued use after the effective date means acceptance.",
  ]},
  { id: "questions", title: "Questions", paras: [
    "Write to support.tamam@gmail.com with any question about these terms, a data request, or a security concern.",
  ]},
];

/* ── Platform page ── */

export const PLATFORM_FACTS = [
  { value: "1 record", label: "One patient identity carried across every facility, product and level of care." },
  { value: "Offline-first", label: "Full clinical work continues through power cuts and network gaps, then syncs." },
  { value: "DHIS2-ready", label: "National reports are generated from the same records, not retyped at month end." },
];

export const PLATFORM_FLOW = [
  { n: "01", t: "Arrival and identification", b: "The patient is registered once, or found again by name, hospital number, geocode, QR card or fingerprint. No folder has to be located." },
  { n: "02", t: "Triage", b: "Vitals are entered at the triage station and ETAT criteria assign RED, YELLOW or GREEN. The queue re-sorts itself by urgency rather than arrival order." },
  { n: "03", t: "Consultation", b: "The chart opens with the patient's history already in it — past diagnoses, medicines, results and the plan left by the last clinician." },
  { n: "04", t: "Orders", b: "Lab and imaging orders leave the encounter electronically, arrive on the bench worklist, and return validated results into the same chart." },
  { n: "05", t: "Prescribing and dispensing", b: "Interaction, allergy and duplicate checks run against the active medicine list; pharmacy dispenses against the electronic prescription and records the batch." },
  { n: "06", t: "Admission or referral", b: "Admission opens ward and bed management on the same record. A referral bundles a transfer package and returns a structured outcome to the referring clinician." },
  { n: "07", t: "Reporting", b: "Every visit tallies as it happens. Data-quality scoring runs before export, and Monthly HMIS 105, Weekly Epi and Immunization Coverage reports are generated in DHIS2-ready form." },
];

export const PLATFORM_PILLARS = [
  { t: "Works without a connection", b: "The record lives on the facility device. Registration, triage, consultation, dispensing and reporting all continue offline; changes replicate both ways when bandwidth returns." },
  { t: "Survives power loss", b: "Designed for facilities where 13% have reliable power — no work is lost to a cut, and the device resumes where the shift stopped." },
  { t: "Role-based and audited", b: "Accounts are issued by facility administrators against a role. Every view and change is stamped, and logging out clears the local copy from the device." },
];

/* ── The problem, set out in full ──
   The strip's "The Problem" card resolves here, so this is where the claim has
   to actually be argued. Sourced from the project's own vision documents
   (docs/VISION-MINDMAP.md, docs/EXPERT-FEEDBACK.md — a February 2026
   conversation with a South Sudan health-system expert who has worked every
   level from Boma to national). Each break carries the one EHSP 2025 / SARA
   figure that evidences it, rather than a detached statistics strip; the
   structural account around the numbers is field observation, stated as such. */

export const PROBLEM_LEAD =
  "A health system is only as good as what it can remember. South Sudan's runs on paper: a visit is written into a ledger that lives in one building, on one shelf. That single choice — made by circumstance, not by anyone's preference — breaks the record in three places at once.";

export interface ProblemBreak {
  where: string;
  what: string;
  body: string;
  image: string;
  imageAlt: string;
  /** object-position for the banner crop — these three sources put their
      subject well above centre, and the default would cut the heads. */
  focus: string;
  /** The figure this break rests on. `note` says what the number means for
      the argument beside it, so the statistic reads as evidence and not decor. */
  stat: { value: string; unit: string; note: string; source: string };
}

export const PROBLEM_BREAKS: ProblemBreak[] = [
  {
    where: "At the bedside",
    what: "The history is gone",
    body:
      "A patient arrives and their past is whatever they can remember out loud. Allergies, the drug that failed last time, the result that came back abnormal — none of it is in the room. So the clinician starts from nothing: tests already done get repeated, treatment already tried gets tried again, and a warning already recorded goes unseen. Where clinicians are this thin on the ground, every repeated test is time the next patient in the queue does not get.",
    image: "/assets/images/reviewing-health-records.jpeg",
    imageAlt: "Two health workers reading through wide paper registers, page by page, with more ledgers stacked on the floor behind them",
    focus: "center 26%",
    stat: {
      value: "7.6",
      unit: "health workers per 10,000 people",
      note: "the WHO norm is 44.5",
      source: "EHSP 2025",
    },
  },
  {
    where: "At the supervisor's desk",
    what: "The work is invisible",
    body:
      "Community health workers see patients across thousands of scattered villages and decide alone — no second opinion, no one reviewing whether the assessment was right. Their supervisor cannot see which of them are active this week, how many patients they have seen, or which children have missed a vaccine dose, because nothing they write travels any further than the notebook they write it in. At this density, most care happens nowhere near a desk that could review it.",
    image: "/assets/outreach-blood-pressure.jpg",
    imageAlt: "A health worker in a surveillance-and-response vest writing on a paper form at a village outreach table, having just taken a woman's blood pressure",
    focus: "center 30%",
    stat: {
      value: "1.42",
      unit: "health facilities per 10,000 people",
      note: "the national target is 2",
      source: "EHSP 2025",
    },
  },
  {
    where: "At the Ministry",
    what: "The picture arrives too late",
    body:
      "Reports are assembled by hand at month end, copied from ledgers into forms and totalled by whoever is free that day. Numbers arrive incomplete, late, and impossible to check back against the visits that produced them. An outbreak signal, a stock-out, a run of missed immunisations — all of it is visible in the paper, weeks after the moment when acting on it would have mattered.",
    image: "/assets/facility-banner.jpg",
    imageAlt: "Patients on camp beds under a canvas outbreak-treatment tent, the kind of surge a month-end report announces after the fact",
    focus: "center 55%",
    stat: {
      value: "38.7",
      unit: "UHC service-coverage index, out of 100",
      note: "planned each year from returns nobody can check",
      source: "EHSP 2025",
    },
  },
];

export const PROBLEM_WHY_TITLE = "None of this is a failure of care. It is a failure of tooling.";

export const PROBLEM_WHY =
  "Software that assumes a server, a live connection or a stable socket was never going to be used here — so the record keeps being written in the one place it cannot travel from. The data exists. It is simply trapped at the point where it is created.";

/* ── National alignment page ── */

export const ALIGN_FACTS = [
  { k: "EHSP 2025", v: "The Ministry's own service package defines the tiers Tamam is built to" },
  { k: "Six tiers", v: "Community through referral hospital, one record across all of them" },
  { k: "DHIS2 & IDSR", v: "Facility activity rolls up into the national reporting channels already in use" },
];

/* ── News & updates ── */

export interface Photo {
  src: string;
  alt: string;
  caption: string;
}

/** Photos from the Tufts New Ventures Competition, April 10, 2026 — in story
    order. Shared by the /about award section and the news article. */
export const DERBY_PHOTOS: Photo[] = [
  {
    src: "/assets/derby/derby-09.jpg",
    alt: "Toye Adebayo, Teny Makuach and Ekow Williams standing together with competition badges",
    caption: "Toye Adebayo, Teny Makuach and Ekow Williams before the results were announced.",
  },
  {
    src: "/assets/derby/derby-13.jpg",
    alt: "Teny Makuach pitching with a microphone, the live record system on the projector behind him",
    caption: "Teny pitching from the product itself — the live record system on screen, not a slide deck.",
  },
  {
    src: "/assets/derby/derby-07.jpg",
    alt: "Ekow Williams presenting with a microphone beside the lectern",
    caption: "Ekow making the case in the Healthcare & Life Science track.",
  },
  {
    src: "/assets/derby/derby-12.jpg",
    alt: "A team member answering questions with a microphone during the pitch",
    caption: "Taking the judges' questions — five minutes of them, after a five-minute pitch.",
  },
  {
    src: "/assets/derby/derby-08.jpg",
    alt: "The team demoing the platform on a laptop at a standing table during the reception",
    caption: "Demoing the record system between sessions.",
  },
  {
    src: "/assets/derby/derby-10.jpg",
    alt: "Ekow Williams in conversation at the reception",
    caption: "Ekow talking through the pilot.",
  },
  {
    src: "/assets/derby/derby-01.jpg",
    alt: "The team called up through an applauding audience as the results are announced",
    caption: "The moment the results were read out.",
  },
  {
    src: "/assets/derby/derby-02.jpg",
    alt: "The team receiving the oversized $10,000 check on stage",
    caption: "Receiving the award on stage.",
  },
  {
    src: "/assets/derby/derby-11.jpg",
    alt: "The team holding the $10,000 check together with the competition judges",
    caption: "The team with the judges and the $10,000 check.",
  },
  {
    src: "/assets/derby/derby-04.jpg",
    alt: "Founders laughing together while holding the check",
    caption: "Letting it sink in.",
  },
  {
    src: "/assets/derby/derby-03.jpg",
    alt: "The team posing with the check while a guest takes a photo",
    caption: "Photos with the check.",
  },
  {
    src: "/assets/derby/derby-05.jpg",
    alt: "Toye Adebayo, Teny Makuach and Ekow Williams holding the $10,000 check in front of the Derby Entrepreneurship Center banner",
    caption: "The founding team with the award.",
  },
  {
    src: "/assets/derby/derby-06.jpg",
    alt: "The three founders standing full-length with the check in front of the Derby Entrepreneurship Center banner",
    caption: "At the Derby Entrepreneurship Center at Tufts.",
  },
];

/** One photo (or a side-by-side pair) set into the story after the body
    paragraph at index `after`. */
export interface BodyPhotos {
  after: number;
  photos: Photo[];
}

/** A framed aside under the story — the background a reader needs but that
    would bury the narrative if it were written out as prose. */
export interface NewsExplainer {
  title: string;
  intro: string;
  rows: { k: string; v: string }[];
}

export interface NewsItem {
  slug: string;
  /** Short category chip on the card — "Competition", "Milestone", … */
  tag: string;
  /** Display date, month-level. */
  date: string;
  /** ISO value for <time dateTime>. */
  dateISO: string;
  title: string;
  image: string;
  imageAlt: string;
  /** One-sentence card summary. */
  summary: string;
  /** Full paragraphs for the /news page. */
  body: string[];
  /** Photos set between the body paragraphs, at most two abreast. */
  bodyPhotos?: BodyPhotos[];
  /** Background panel under the story. */
  explainer?: NewsExplainer;
  link?: { label: string; href: string };
  /** Optional scrolling photo strip under the body. The article drops any
      frame already used as the hero or set into the body, so the strip is
      the rest of the set rather than a second run of the same pictures. */
  gallery?: Photo[];
  /** Heading above the gallery strip. */
  galleryTitle?: string;
}

/** A frame from the competition set, by file number — so a story can pull
    "derby-13" without hard-coding an index into DERBY_PHOTOS. Throws at build
    time on a typo rather than rendering a hole. */
const derby = (file: string): Photo => {
  const p = DERBY_PHOTOS.find((x) => x.src.endsWith(`/${file}.jpg`));
  if (!p) throw new Error(`No competition photo named ${file}`);
  return p;
};

/** Newest first — the home band leads on the first item (and returns to its
    four-up strip once there are several), /news lists them all. One story for
    now; the next update is one more entry at the top of this array. */
export const NEWS: NewsItem[] = [
  {
    slug: "tufts-new-ventures-competition",
    tag: "Competition",
    date: "April 2026",
    dateISO: "2026-04",
    title: "Second place in the Healthcare & Life Science track at the Tufts New Ventures Competition",
    image: "/assets/derby/derby-05.jpg",
    imageAlt: "Toye Adebayo, Teny Makuach and Ekow Williams holding the $10,000 check at the Derby Entrepreneurship Center at Tufts",
    summary:
      "Our first venture competition, and a $10,000 award — judged on a working offline-first record system rather than a slide deck, and spent on the first pilot clinics.",
    body: [
      "On April 10, 2026, at the Derby Entrepreneurship Center at Tufts, TamamHealth took second place in the Healthcare & Life Science track of the Tufts New Ventures Competition, and a $10,000 award with it. It was the first venture competition we had ever entered.",
      "The story we told the judges does not start in a lab or a lecture hall. It starts in Kakuma refugee camp, where our founder, Teny Makuach, grew up. The failures this platform is built to fix were never an abstraction to him — they were a queue with no order to it, a clinician rebuilding a history by asking the patient to remember it, a treatment given twice because nobody could see what had already been given. He built the first version of TamamHealth out of that. Ekow Williams and Toye Adebayo joined him having watched the same system fail the same way, first-hand. None of the three of us needed the problem explained.",
      "So we pitched from the product rather than about it. The live record system was on the screen behind us, running a full patient day with the network switched off: registration, triage, consultation, lab orders, dispensing, and the reports that go back to the Ministry. Nothing in the demo was a mock-up, and nothing in it required a connection.",
      "The judges score eight things, and one of them is whether this is the right team to solve this problem. That was the easiest answer we had. The rest came from the constraint rather than the ideal: 4% of South Sudan's facilities have a computer with internet, 13% have any on-site power, and there are 7.6 health workers per 10,000 people against a WHO norm of 44.5. A record system that assumes connectivity is a record system that fails there, so ours does not assume it.",
      "The $10,000 goes straight into the pilot — tablets, solar charging, fingerprint readers and training for the first of ten clinics in Juba and greater South Sudan. It is the first funded step toward the $100,000 that launches all ten.",
    ],
    /* Set against the paragraph each one belongs to: the three founders beside
       the origin story, the pitch beside what we pitched, the Q&A beside the
       judging, the award beside what it pays for. */
    bodyPhotos: [
      { after: 1, photos: [derby("derby-09")] },
      { after: 2, photos: [derby("derby-13"), derby("derby-07")] },
      { after: 3, photos: [derby("derby-12")] },
      { after: 4, photos: [derby("derby-02"), derby("derby-11")] },
    ],
    explainer: {
      title: "What the Tufts New Ventures Competition is",
      intro:
        "The flagship venture competition at Tufts, run by the Derby Entrepreneurship Center. It is open to the whole university rather than to business students alone, and it is judged live.",
      rows: [
        {
          k: "Who can enter",
          v: "Teams of one to five, led by a matriculated Tufts undergraduate or graduate student, a full-time postdoc, research fellow or resident, or an alum who graduated within the last five years. Faculty- and staff-led ventures qualify when at least one executive cofounder meets that bar.",
        },
        {
          k: "Three tracks",
          v: "General, for new ventures in any sector. Healthcare & Life Science, for biotech, digital health and healthcare IT. Social Impact, for ventures solving societal problems in for-profit or non-profit form, based in the US and in emerging markets. We entered the healthcare track.",
        },
        {
          k: "The stage it is for",
          v: "Early. A team must not have raised more than $250,000 in combined grants, fellowships, notes or equity by the application deadline, must be serious about building the venture full time, and cannot have already won with the same venture.",
        },
        {
          k: "How it runs",
          v: "A written application with a two-minute video pitch, screened by a panel of judges. Those chosen pitch live at the semi-finals in March and the finalists pitch again at the finals in April — five minutes each time, then five minutes of questions. Workshops, pitch practice and one-to-one coaching run alongside.",
        },
        {
          k: "How it is judged",
          v: "Eight criteria: the problem, the solution, the go-to-market strategy, financial sustainability, impact, the team, the presentation, and a wildcard for anything else that impresses the judges — traction, ambition, or cross-functional work.",
        },
        {
          k: "What is on offer",
          v: "Per track, $20,000, $10,000 and $5,000 for first, second and third, plus a Cummings Properties credit worth $25,000 in a year of free office space. Add-on awards run once a year: the $15,000 Ricci Prize for an interdisciplinary engineering team, and $2,500 each for a creative arts and a small business team. Over $250,000 across all prizes.",
        },
        {
          k: "The next cycle",
          v: "Applications open February 1, 2027 and close February 21. Semi-finals are on March 19 and the finals and celebration on April 9, 2027.",
        },
      ],
    },
    link: { label: "Meet the team behind it", href: "/about#team" },
    galleryTitle: "April 10, 2026 — the night the pilot got its first funding",
    gallery: DERBY_PHOTOS,
  },
];

export const newsBySlug = (slug: string) => NEWS.find((n) => n.slug === slug);

/* ── Footer / shared ── */

export const SUPPORT_EMAIL = "support.tamam@gmail.com";
/* Shown in the header utility row as plain text. There is deliberately no
   `tel:` href — the number is published for reference, not as a call button. */
export const SUPPORT_PHONE = "+1 973 566 4336";

export interface FooterLink {
  label: string;
  href: string;
  external?: boolean;
}

export const FOOTER_COLS: { accent: string; title: string; links: FooterLink[] }[] = [
  {
    accent: "#015697",
    title: "Products",
    links: PRODUCTS.slice(0, 5).map((p) => ({
      label: `${p.acronym} — ${p.title.replace(" System", "")}`,
      href: `/products/${p.slug}`,
    })),
  },
  {
    accent: "#015697",
    title: "The system",
    links: [
      { label: "The platform", href: "/platform" },
      { label: "The six levels of care", href: "/health-system#levels" },
      { label: "National alignment", href: "/health-system" },
      { label: "Deployment footprint", href: "/#footprint" },
      { label: "DHIS2 reporting", href: "/platform#how-it-works" },
    ],
  },
  {
    accent: "#015697",
    title: "About",
    links: [
      { label: "The Problem", href: "/about#crisis" },
      { label: "The Goal", href: "/about#goal" },
      { label: "The Team", href: "/about#team" },
      { label: "News & updates", href: "/news" },
    ],
  },
  {
    accent: "#015697",
    title: "Get involved",
    links: [
      { label: "Donate to the pilot", href: "/donate" },
      { label: "Get in touch", href: "/contact" },
      { label: SUPPORT_EMAIL, href: `mailto:${SUPPORT_EMAIL}`, external: true },
      { label: "Partner with us", href: "/contact" },
    ],
  },
];

/* Web3Forms access key — carried over from the previous site revision.
   Web3Forms is designed for browser-side submission; the key is public by
   design (it only routes mail to the account that owns it). */
export const WEB3FORMS_ACCESS_KEY = "e45ff797-cfa3-459e-80db-cda054dd35ea";
