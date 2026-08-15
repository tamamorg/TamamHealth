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
    image: "/assets/doctor-nurse-consultation.jpg",
    imageAlt: "Hospital clinicians coordinating patient care",
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
    image: "/assets/african-nurse.jpg",
    imageAlt: "Health worker helping a patient access their records on a phone",
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
    fix: "One patient record, held on the device and replicated when a connection appears — searchable by name, hospital number, geocode, QR card or fingerprint.",
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
    fix: "The chart opens with vitals, diagnoses, prescriptions, results and the plan from every previous visit already there.",
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
    image: "/assets/images/pediatric-ward-interior.jpeg",
    imageAlt: "A crowded ward with patients waiting",
    short: "People are seen in the order they arrived, not the order their condition demands.",
    d: "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z",
    d2: "M12 7v5l4 2",
    body: "A paper queue cannot rank itself. A child in respiratory distress waits behind a routine review because the register has no way to say which is which, and no one at the desk can see the whole room at once.",
    cost: "The sickest patients wait the longest, and nobody finds out until it is late.",
    fix: "Check-in assigns acuity, triage derives RED / YELLOW / GREEN from ETAT vitals, and the live queue sorts itself by urgency.",
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
    fix: "Prescribing runs interaction, allergy and duplicate checks against the patient's active medicines, and dispensing writes back to the same record.",
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
    fix: "Results release straight into the chart, critical values require two-eyes confirmation and message the ordering clinician, and unreviewed results breach a visible SLA.",
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
    image: "/assets/images/community-medication-distribution.jpeg",
    imageAlt: "Medication being recorded in a paper register",
    short: "The shelf is the only inventory system, and it reports late.",
    d: "M20 7.5 12 3 4 7.5v9L12 21l8-4.5z",
    d2: "M4 7.5 12 12v9",
    body: "Medicines are counted by eye during a busy shift, expiry dates are checked when someone remembers, and a stock-out is discovered at the counter with a prescription already in hand. Reorder decisions rest on guesswork.",
    cost: "Patients are turned away from drugs the facility owned but let expire.",
    fix: "Live stock status, batch and expiry tracking with first-expiry-first-out, reorder alerts and a printable purchase order — plus an append-only two-signature register for controlled medicines.",
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
    fix: "Referral bundles a transfer package of the record; accepting it opens an intake encounter with handover notes, and completion sends a structured outcome back.",
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
    image: "/assets/african-nurse.jpg",
    imageAlt: "A nurse completing facility paperwork",
    short: "National figures are transcribed from tally sheets weeks after the fact.",
    d: "M4 20V10m5 10V4m5 16v-7m5 7V7",
    d2: "",
    body: "Facility staff spend days copying registers into monthly summaries. Numbers arrive late, incomplete, and impossible to check against the visits that produced them — which is precisely the gap the Ministry names in its own review of the system.",
    cost: "Planning and outbreak response run on data that is already out of date.",
    fix: "Every visit tallies as it happens, data-quality scoring runs before export, and DHIS2-ready reports — Monthly HMIS 105, Weekly Epi, Immunization Coverage — are generated, not retyped.",
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
  { tone: "#015697", level: "Community — Boma Health Initiative", role: "Promotion, screening & referral", product: "Registry & referral", image: "/assets/images/community-medication-distribution.jpeg", alt: "A health worker recording medication in a paper register" },
  { tone: "#015697", level: "Primary Health Care Unit (PHCU)", role: "First formal point of care", product: "CMS", image: "/assets/community-health-worker.jpg", alt: "Community health worker at a primary care clinic" },
  { tone: "#015697", level: "Primary Health Care Centre (PHCC)", role: "Expanded primary & maternity care", product: "CMS", image: "/assets/african-nurse.jpg", alt: "Health worker helping a patient on a phone" },
  { tone: "#015697", level: "County Hospital", role: "First referral & inpatient care", product: "HMIS", image: "/assets/images/pediatric-ward-interior.jpeg", alt: "A crowded pediatric ward" },
  { tone: "#015697", level: "State Hospital", role: "Secondary & specialised care", product: "HMIS", image: "/assets/doctor-nurse-consultation.jpg", alt: "Hospital clinicians coordinating patient care" },
  { tone: "#015697", level: "Referral / Tertiary Hospital", role: "Tertiary & teaching care", product: "HMIS", image: "/assets/doctor-tablet-review.jpg", alt: "Clinician reviewing records on a tablet" },
];

/** Sidebar label for a care level — "Community" for the Boma tier, otherwise the level minus its parenthetical. */
export const careLevelLabel = (c: CareLevel) =>
  c.product === "Registry & referral" ? "Community" : c.level.replace(/ \(.*\)/, "").replace(" — Boma Health Initiative", "");

export const SYSTEM_STATS = [
  { accent: "#015697", value: "4%", label: "of facilities have a computer with internet", source: "SARA / EHSP 2025" },
  { accent: "#015697", value: "13%", label: "have any on-site power source", source: "SARA / EHSP 2025" },
  { accent: "#015697", value: "1.42", label: "health facilities per 10,000 people — against a national target of 2", source: "EHSP 2025" },
  { accent: "#015697", value: "7.6", label: "health workers per 10,000 people — the WHO norm is 44.5", source: "EHSP 2025" },
  { accent: "#015697", value: "38.7", label: "UHC service-coverage index, out of 100", source: "EHSP 2025" },
];

export const TEAM = [
  { accent: "#015697", name: "Teny Makuach", role: "Founder & Developer", image: "/assets/founder-teny.jpg" },
  { accent: "#015697", name: "Ekow Williams", role: "Community & Partnerships", image: "/assets/founder-ekow.jpg" },
  { accent: "#015697", name: "Toye Adebayo", role: "Project Manager", image: "/assets/founder-toye.jpg" },
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
  /** Route the hero's "Learn more" resolves to. */
  href: string;
}

export const HEROES: Hero[] = [
  {
    kicker: "The Problem",
    title: "No power. No records. No history.",
    body: "Most of South Sudan's clinics run on paper-based records that get lost, damaged, or destroyed — and when the paper goes, the patient's story goes with it. Tamam brings digital records that work offline, so care never starts from zero.",
    image: "/assets/new-landing.png",
    alt: "A South Sudanese midwife examining a child with a stethoscope at a rural clinic",
    accent: "#015697",
    stripKicker: "The Problem",
    stripTitle: "1,223 maternal deaths per 100,000 live births",
    href: "/about#crisis",
  },
  {
    kicker: "Ground Truth",
    title: "The daily reality inside South Sudan's facilities",
    body: "Documented across South Sudanese facilities, from the wards to the waiting line — the same failures repeat on both sides of the consultation desk: lost histories, duplicate treatment, and very slow clinical flow.",
    image: "/assets/images/pediatric-ward-interior.jpeg",
    alt: "A crowded pediatric ward",
    accent: "#015697",
    stripKicker: "Ground Truth",
    stripTitle: "The daily reality inside South Sudan's facilities",
    href: "/about#crisis",
  },
  {
    kicker: "National Alignment",
    title: "Built around South Sudan's own health system",
    body: "The Ministry of Health's 2025 Essential Health Services Package organises the country's care into six levels — and names fragmented, paper-bound data as one of its biggest gaps. Tamam is shaped to fit that system, not replace it — and the same six-tier structure runs through most sub-Saharan health systems, so what fits here travels.",
    image: "/assets/doctor-nurse-consultation.jpg",
    alt: "Hospital clinicians coordinating patient care",
    accent: "#015697",
    stripKicker: "National Alignment",
    stripTitle: "Built around South Sudan's own health system",
    href: "/health-system",
  },
  {
    kicker: "The Goal",
    title: "Our goal is to prove it works, then bring it to every clinic that needs it",
    body: "We're raising $100,000 to launch TamamHealth in 10 clinics across Juba and greater South Sudan — proof that offline-first digital records can work in the hardest conditions, and the model we take across sub-Saharan Africa.",
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

export const LANGUAGES = ["English", "Arabic (Juba)", "Dinka", "Nuer", "Shilluk", "Bari", "Murle", "Zande"];

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
   Locally: set NEXT_PUBLIC_PLATFORM_URL=http://localhost:3000 in .env.local. */
export const PLATFORM_URL = process.env.NEXT_PUBLIC_PLATFORM_URL ?? "https://tamamhealth-v6.vercel.app";

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

export const PLATFORM_PANELS = [
  { t: "Today's schedule", b: "Every booked patient with time, care team, contact and status — scheduled, in office, finished — so the desk can see the whole day at once." },
  { t: "Patient flow", b: "A live list of who has been triaged and how long ago, next to counts for emergency, urgent and routine arrivals." },
  { t: "Register and check in", b: "Register a new patient, open an intake form, or check in someone already on the record, from the same bar." },
  { t: "Day activity", b: "Active against completed visits for the week, so a facility can see its own throughput without a report request." },
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

/* ── National alignment page ── */

export const ALIGN_FACTS = [
  { k: "EHSP 2025", v: "The Ministry's own service package defines the tiers Tamam is built to" },
  { k: "Six tiers", v: "Community through referral hospital, one record across all of them" },
  { k: "DHIS2 & IDSR", v: "Facility activity rolls up into the national reporting channels already in use" },
];

/* ── News & updates ── */

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
  link?: { label: string; href: string };
}

/** Newest first — the home band shows the first four, /news shows all. */
export const NEWS: NewsItem[] = [
  {
    slug: "a-new-home-on-the-web",
    tag: "Announcement",
    date: "August 2026",
    dateISO: "2026-08",
    title: "A new tamamhealth.org, built the way we build the platform",
    image: "/assets/dashboard-live.png",
    imageAlt: "The TamamHealth facility dashboard",
    summary:
      "The site you are reading is new — six products, the six levels of care, and the pilot, drawn in the same design language as the platform itself.",
    body: [
      "We have relaunched tamamhealth.org. The new site walks through all six products — hospital, clinic, laboratory, radiology, pharmacy and the patient portal — and through the health system they are built for, level by level, from the Boma health worker to the referral hospital.",
      "It also shows the work plainly: the deployment footprint across South Sudan, the problems paper records create, and exactly what the $100,000 pilot buys. If you want to see the platform on a real patient day, ask for a demo and we will walk you through one.",
    ],
    link: { label: "Request a demo", href: "/contact" },
  },
  {
    slug: "pilot-campaign-live",
    tag: "The pilot",
    date: "August 2026",
    dateISO: "2026-08",
    title: "$100,000, ten clinics: the Juba pilot campaign is live",
    image: "/assets/african-nurse.jpg",
    imageAlt: "Health worker helping a patient access their records on a phone",
    summary:
      "We are raising $100,000 to launch TamamHealth in 10 clinics across Juba and greater South Sudan — devices, solar power, training and twelve months of support.",
    body: [
      "The pilot is designed to be measured, not asserted: ten clinics across Juba and greater South Sudan, equipped with tablets, solar charging and fingerprint readers, their teams trained on one shared patient record across registration, consultation, lab and pharmacy.",
      "Every gift is earmarked for the pilot, from $50 that powers a clinic day to $10,000 that launches an entire facility. Clean records roll up into facility dashboards and DHIS2-ready national reports — donors see the same numbers the Ministry sees.",
    ],
    link: { label: "Donate to the pilot", href: "/donate" },
  },
  {
    slug: "six-products-one-record",
    tag: "Product",
    date: "July 2026",
    dateISO: "2026-07",
    title: "One record, six products: the platform grows into a full suite",
    image: "/assets/platform-receptionist.png",
    imageAlt: "The front-desk view of the TamamHealth platform",
    summary:
      "What began as a single offline-first EMR is now six connected products — HMIS, CMS, LIS, RIS, PMS and the patient portal — sharing one patient record.",
    body: [
      "TamamHealth now covers the full facility day: hospital management for referral and county hospitals, clinic management for single-site PHCUs and private practices, laboratory and radiology systems with real order lifecycles, pharmacy with batch and expiry tracking, and a portal where patients read their own records.",
      "Every product writes to the same offline-first record, so a lab result, a dispensed medicine or a referral is never a separate paper life — it lands back in the encounter it came from, even when the network is down.",
    ],
    link: { label: "View all products", href: "/products" },
  },
  {
    slug: "tufts-new-ventures-win",
    tag: "Competition",
    date: "April 2026",
    dateISO: "2026-04",
    title: "TamamHealth wins the Healthcare track at the Tufts New Ventures Competition",
    image: "/assets/community-health-worker.jpg",
    imageAlt: "Community health worker at a primary care clinic",
    summary:
      "Our first venture competition, and a $10,000 award — funding tablets, solar power and training for the first pilot clinics.",
    body: [
      "TamamHealth won the Healthcare & Life Science track of the Tufts New Ventures Competition, run through the Derby Entrepreneurship Center — our first time entering a venture competition.",
      "We pitched what we build: an offline-first record system designed from South Sudan's constraints outward — no reliable connectivity, no national IDs, facilities where 13% have any on-site power. The judges saw a working platform, not a slide deck.",
      "The $10,000 award goes directly into the pilot: tablets, solar charging and training for the first clinics.",
    ],
    link: { label: "Meet the team", href: "/about#team" },
  },
  {
    slug: "expert-validation",
    tag: "Field research",
    date: "February 2026",
    dateISO: "2026-02",
    title: "Every feature tested against the real system, with someone who has run it",
    image: "/assets/images/community-medication-distribution.jpeg",
    imageAlt: "A health worker recording medication in a paper register",
    summary:
      "In-depth consultation with a South Sudan health-system professional — with experience at every level from Boma village to Ministry — shaped the product's core decisions.",
    body: [
      "Before writing more code, we sat down with a South Sudan health-system expert with direct experience at every level of the system, from Boma volunteers to the Ministry of Health, and tested every assumption we had made.",
      "The geocode household ID (because “this one is Deng, this is Deng, this is Deng”), binary choices instead of free text, unobtrusive voice capture, and real-time immunization defaulter tracking — “even if you don't do these other things, do THIS” — all came out of those conversations and went straight into the product.",
    ],
  },
  {
    slug: "mvp-in-six-weeks",
    tag: "Milestone",
    date: "February 2026",
    dateISO: "2026-02",
    title: "From first commit to a working record system in six weeks",
    image: "/assets/Dashboard.png",
    imageAlt: "An early build of the TamamHealth dashboard",
    summary:
      "Thirty-one functional modules, nine role-based dashboards and a fully offline record — built in six weeks, running in the browser on any device.",
    body: [
      "TamamHealth's first working build came together in six weeks of concentrated work: registration, triage, consultation, lab, pharmacy, billing and reporting — thirty-one modules across nine role-based dashboards, with automated tests behind the clinical flows.",
      "It ran offline from day one. Every screen reads and writes a local database on the device and syncs when a connection appears — because a record system for South Sudan that assumes connectivity is a record system that fails there.",
    ],
    link: { label: "How the platform works", href: "/platform" },
  },
];

export const newsBySlug = (slug: string) => NEWS.find((n) => n.slug === slug);

/* ── Footer / shared ── */

export const SUPPORT_EMAIL = "support.tamam@gmail.com";
export const SUPPORT_PHONE = "+211 92 000 0000";
export const SUPPORT_PHONE_HREF = "tel:+211920000000";

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
      { label: "DHIS2 reporting", href: "/health-system" },
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
