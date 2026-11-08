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
  /** Short room/audience label under the acronym in the explorer rail. */
  sector: string;
  tagline: string;
  description: string;
  /** Three one-line proof points shown above the module grid. */
  highlights: string[];
  modules: string[];
  image: string;
  imageAlt: string;
  /** Short scene label overlaid on the explorer photograph. */
  imageCaption: string;
}

export const PRODUCTS: Product[] = [
  {
    slug: "hmis",
    accent: "#015697",
    acronym: "HMIS",
    title: "Hospital Management System",
    sector: "Hospitals",
    tagline: "For State, County & Referral hospitals",
    description:
      "A connected facility platform for OPD, IPD, ward management, laboratory, imaging, pharmacy, billing, HR, and reporting, all tied to the same patient record.",
    highlights: [
      "One patient record across OPD, IPD and every department",
      "Facility-scoped department worklists and clinic schedules",
      "Wards, laboratory, imaging and pharmacy on the same chart",
      "Billing and DHIS2 reporting drawn from the same visit",
    ],
    modules: ["Patient Registry", "Department Worklists", "Clinic Schedules", "Outpatient & Inpatient", "Ward & Bed Management", "Laboratory", "Imaging", "Pharmacy", "Billing & Payments", "Reporting & BI", "DHIS2 Sync", "Specialty workflows (planned)"],
    image: "/assets/doctor-at-workstation.jpg",
    imageAlt: "A doctor at a workstation, reading a patient's record on screen",
    imageCaption: "Hospital floor",
  },
  {
    slug: "cms",
    accent: "#015697",
    acronym: "CMS",
    title: "Clinic Management System",
    sector: "Clinics & PHCUs",
    tagline: "For PHCUs, private practices & faith-based clinics",
    description:
      "Everything a single-site clinic needs to run a full patient day: registration, consultation, prescriptions, basic lab, dispensing, billing, all offline-first.",
    highlights: [
      "A full patient day from registration to dispensing",
      "Consultation, prescriptions and basic lab in one place",
      "Runs offline-first on a single site",
    ],
    modules: ["Patient Registry", "Outpatient Consultation", "Lab Orders", "Pharmacy Dispensing", "Billing", "DHIS2 Sync"],
    image: "/assets/community-health-worker.jpg",
    imageAlt: "Community health worker at a primary care clinic",
    imageCaption: "Primary care clinic",
  },
  {
    slug: "lis",
    accent: "#015697",
    acronym: "LIS",
    title: "Laboratory Information System",
    sector: "Laboratory",
    tagline: "For diagnostic centres & hospital labs",
    description:
      "Receive orders from any clinician, run bench workflows, capture results, validate, and release them back into the encounter.",
    highlights: [
      "Orders arrive from any clinician on the record",
      "Specimen tracked from intake to validated result",
      "Released results flow straight back into the encounter",
    ],
    modules: ["Order Intake", "Specimen Tracking", "Result Capture", "Quality Control", "TAT Dashboards", "Critical Result Alerts"],
    image: "/assets/doctor-writing-notes.jpg",
    imageAlt: "Lab staff recording results",
    imageCaption: "Diagnostic lab",
  },
  {
    slug: "ris",
    accent: "#015697",
    acronym: "RIS",
    title: "Radiology Information System",
    sector: "Radiology",
    tagline: "For radiology centres & imaging departments",
    description:
      "Schedule modalities, accession studies, capture findings, and deliver reports back to the ordering clinician, connected to the same record.",
    highlights: [
      "Modality scheduling and study worklists in one place",
      "Structured findings captured at the workstation",
      "Reports delivered back to the ordering clinician",
    ],
    modules: ["Modality Scheduling", "Study Worklist", "Structured Reporting", "PACS Integration (planned)", "DICOM Export (planned)"],
    image: "/assets/doctor-tablet-review.jpg",
    imageAlt: "Radiologist reviewing imaging on a workstation",
    imageCaption: "Imaging suite",
  },
  {
    slug: "pms",
    accent: "#015697",
    acronym: "PMS",
    title: "Pharmacy Management System",
    sector: "Pharmacy",
    tagline: "For retail & hospital pharmacies",
    description:
      "Medicines are tracked from delivery to dispensing: batches and expiry dates are recorded on the ledger, electronic prescriptions are filled without transcription, and reorder decisions are based on recorded consumption rather than visual shelf checks.",
    highlights: [
      "First-expiry-first-out proposed at every dispense",
      "Reorder alerts before a stock-out reaches the counter",
      "Controlled medicines on an append-only two-signature register",
    ],
    modules: ["Inventory & Batches", "Expiry Tracking", "Reorder Alerts", "Electronic Rx Dispensing", "POS for OTC", "Supplier Orders"],
    image: "/assets/doctor-prescription.jpg",
    imageAlt: "Pharmacist preparing a prescription",
    imageCaption: "Hospital pharmacy",
  },
  {
    slug: "pps",
    accent: "#015697",
    acronym: "PPS",
    title: "Patient Portal",
    sector: "Patients",
    tagline: "For patients and caregivers",
    description:
      "Patients use a separate web portal to see their own records, prescriptions, lab results and visit history, and to share feedback with the facility. SMS can be configured for login codes and reminders; it does not carry the full record.",
    highlights: [
      "Records, prescriptions and results on a phone",
      "Web portal with optional SMS login codes and reminders",
      "Patient feedback flows back to the facility",
    ],
    modules: ["My Records", "Prescriptions & Results", "Visit History", "Appointment Reminders", "Feedback & Follow-up"],
    image: "/assets/clinician-with-tablet.jpg",
    imageAlt: "A patient reading their own health record on a tablet",
    imageCaption: "Patient access",
  },
];

export const productBySlug = (slug: string) => PRODUCTS.find((p) => p.slug === slug);

/* "Why six, not one" — the three things every product shares underneath, shown
   below the explorer on /products. The products differ; the record does not. */
export const PRODUCT_UNITY: { title: string; body: string }[] = [
  {
    title: "One patient identity",
    body: "Each patient is identified by the same six methods in every product, so a referral continues the existing record instead of starting a new one.",
  },
  {
    title: "One offline engine",
    body: "Every product stores its data locally and synchronises in both directions. None of them requires a server or a continuous connection.",
  },
  {
    title: "One reporting path",
    body: "In every department, each visit counts towards the same indicators and is exported in DHIS2-ready form.",
  },
];

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
      "The core facility system: one record for each patient, from arrival at the facility to the closing and reporting of the visit.",
    stepsTitle: "A patient day, step by step",
    steps: [
      { t: "Register", b: "A 6-step wizard: demographics, contact and location (the household number derives a geocode, BOMA-[code]-HH[number]), next of kin, biometrics (patient photo and consent-gated fingerprint enrolment), payment coverage, then review. A hospital number is assigned on submit." },
      { t: "Check in the arrival", b: "Arrival mode (walk-in, ambulance, referral, police), symptom duration, chief complaint, known allergies, then acuity: Routine, Priority or Emergency. Submitting creates a pending triage entry (the queue token) and marks any same-day appointment as checked in." },
      { t: "Room and assign", b: "The front-desk queue merges triaged walk-ins, arrived appointments and open checkouts, sorted RED → YELLOW → GREEN. Reception assigns an exam room and a provider; the patient then appears in that clinician's worklist. This is the reception-to-clinical handoff." },
      { t: "Triage", b: "The nurse records chief complaint, ETAT ABCC (airway, breathing, circulation, consciousness) and full vitals including GCS, MUAC and glucose. Priority auto-derives: obstructed airway, absent breathing or circulation, or unresponsive → RED; distressed or impaired → YELLOW; otherwise GREEN." },
      { t: "Consultation", b: "A 6-step wizard: intake (complaint and vitals) → examination by system → assessment with ICD-11 coded diagnoses → orders (prescriptions with interaction, allergy and duplicate checks, plus lab and imaging orders) → plan and disposition → summary with a charge preview. Drafts auto-save encrypted." },
      { t: "Departments work the orders", b: "Lab results, imaging reports and dispensed drugs are returned to the chart. Sending a patient to the lab during a visit marks the encounter as awaiting labs and returns the clinician to the dashboard; the visit resumes later with results attached." },
      { t: "Disposition", b: "Checkout runs the facility checkout gate (prescriptions dispensed, critical labs reviewed, documents generated, payment determined) or the visit becomes an admission (ward, bed, medication administration record) or a referral with a bundled transfer package." },
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
      "Everything a single-site clinic needs to run a full patient day on one tablet, without a server room or a reliable connection.",
    stepsTitle: "A clinic day, step by step",
    steps: [
      { t: "Find or register the patient", b: "Three identity lookups: text (hospital ID, geocode, national ID), a camera scan of the patient's QR card, or a 1:N fingerprint match, which runs offline against locally-replicated templates." },
      { t: "Check in", b: "Chief complaint, symptom duration, known allergies and acuity. Optional quick vitals: temperature, pulse, respiratory rate, SpO₂, blood pressure, weight." },
      { t: "Consult", b: "The same 6-step wizard the hospitals use: intake, examination, ICD-11 assessment, orders, plan, summary, with drug interaction, allergy and duplicate checks on every prescription." },
      { t: "Order basic lab work", b: "Orders go to the clinic's own bench and return to the same encounter; in the meantime, the visit is marked as awaiting labs." },
      { t: "Dispense on site", b: "Prescriptions are filled from the clinic's stock: quantity for the full course, a stock gate that refuses on insufficient stock, then an interaction check against the patient's other active medicines." },
      { t: "Charge or exempt", b: "Out-of-pocket, program, exemption or NGO coverage. Unpriced lines are skipped rather than charged at zero, and public facilities can run fee-free while still tracking cost for donor reporting." },
      { t: "Sync when connected", b: "The day's records replicate upward when a connection appears. Sync can be paused, resumed or force-run, and conflicts surface for a human to resolve." },
    ],
    lifecycleTitle: "Visit lifecycle",
    lifecycle: ["pending triage", "in consult", "orders out", "awaiting labs", "checkout", "synced"],
    roles: ["Clinical Officer", "Nurse / Midwife", "Clinic Clerk", "Pharmacist (dispensing)", "Facility Administrator"],
    safeguards: [
      { t: "Runs on a single tablet", b: "The clinic runs on the same offline-first record as a referral hospital: no local server, no permanent line." },
      { t: "Auto-lock", b: "The screen locks when the tab is hidden and after 10 minutes idle. Unlock is a 4-digit PIN; log out is always available from the lock screen." },
      { t: "Referral out, records with it", b: "Referring bundles a transfer package of the patient's records; the receiving facility gets an intake encounter with handover notes." },
    ],
  },
  LIS: {
    intro:
      "A complete order workflow, from the clinician's test request to the communication of the result to the patient, with the safety controls a laboratory requires.",
    stepsTitle: "Working the bench, step by step",
    steps: [
      { t: "The order arrives", b: "Filed from a consultation onto the lab worklist. STAT orders arrive already in process and flagged critical." },
      { t: "Collect the specimen", b: "The technician works through the queue in order; collection is recorded on the order." },
      { t: "Receive at lab, or reject", b: "A rejected specimen enters a recollection loop rather than disappearing: rejected, needs recollection → re-collect." },
      { t: "Start processing", b: "The order moves to in-process and the turnaround clock is visible to the ordering clinician." },
      { t: "Enter the result", b: "Value, unit, reference range, abnormal and critical flags. Entered values are auto-scored against a critical-value table." },
      { t: "Confirm a critical result", b: "A critical value requires a two-eyes confirmation and fires a high-priority message to the ordering clinician." },
      { t: "Release to the chart", b: "The result is posted to the patient's Results tab and resumes the clinician's paused awaiting-labs visit. Results overdue for review trigger an SLA banner: 24 hours for critical, 7 days for routine." },
    ],
    lifecycleTitle: "Order lifecycle",
    lifecycle: ["ordered", "specimen_collected", "received_at_lab", "in_process", "resulted", "reviewed_by_clinician", "acted_upon", "communicated_to_patient"],
    roles: ["Lab Technician", "Ordering clinician (review)", "Medical Superintendent (oversight)"],
    safeguards: [
      { t: "Analyzer import, never auto-saved", b: "LIS-2A and HL7 payloads are parsed for review by a human before anything is written to a chart." },
      { t: "Batch entry and turnaround analytics", b: "Results can be entered in batches by test type, with turnaround time tracked per test." },
      { t: "Integrated blood bank", b: "Availability by blood group, unit intake with component type and shelf life, and expiry warnings at seven days." },
    ],
  },
  RIS: {
    intro:
      "Imaging orders share the laboratory's order store and are filtered onto the radiology worklist, so every study remains part of the electronic record.",
    stepsTitle: "A study, step by step",
    steps: [
      { t: "The order reaches the worklist", b: "Imaging orders are filtered onto the radiology worklist automatically, carrying the modality and body region requested." },
      { t: "Open the study", b: "The radiographer or radiologist picks it up from the worklist; the patient's chart context travels with it." },
      { t: "Attach images", b: "Images or DICOM files are attached and saved to the patient's documents, so the ordering clinician sees exactly what the reporter saw." },
      { t: "Enter findings", b: "Structured findings are recorded against the study." },
      { t: "Submit the report", b: "Submitting completes the order and returns the findings to the chart for the ordering clinician." },
    ],
    lifecycleTitle: "Study lifecycle",
    lifecycle: ["ordered", "in_process", "images attached", "reported", "reviewed_by_clinician"],
    roles: ["Radiologist", "Radiographer", "Ordering clinician (review)"],
    safeguards: [
      { t: "One record, not a second system", b: "Imaging shares the order store with the laboratory, so a study cannot drift out of the encounter it belongs to." },
      { t: "Department panels", b: "Modality breakdown, body region, completion rate and average turnaround time." },
      { t: "Reports returned to the chart", b: "Findings return into the chart, and the clinician's paused visit resumes with them attached." },
    ],
  },
  PMS: {
    intro:
      "The dispensing queue, the stock room and the controlled-substance register in one place, with checks that prevent the wrong medicine from being dispensed.",
    stepsTitle: "Dispensing, step by step",
    steps: [
      { t: "The prescription arrives", b: "Prescriptions arrive from consultations in a priority queue: life-sustaining medicines first, with items of immediate urgency placed at the top." },
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
      { t: "Append-only controlled register", b: "Inspection-grade: every movement (intake, dispense, waste, reconciliation, transfer) needs an operator and a distinct witness, a positive quantity and a non-negative running balance. Entries can never be edited or deleted." },
      { t: "Reliable stock control", b: "Live status (adequate, low, critical, expired), stock received against batch and expiry, first-expiry-first-out tracking, reorder quantities and a printable purchase order." },
      { t: "Charged once", b: "Medicines sent to pharmacy mid-visit are charged at send time, so completing the consultation does not bill them twice." },
    ],
  },
  PPS: {
    intro:
      "The patient's own web window into their care, separate from staff login and read-only where it should be. SMS is limited to configured login codes and reminders.",
    stepsTitle: "What a patient can do",
    steps: [
      { t: "Sign in", b: "With a hospital ID and phone number, or name, date of birth and phone. The session is separate from staff login and clears on sign out." },
      { t: "See the record", b: "Medical records, prescriptions, lab results, radiology reports and immunisations, read-only. Pending lab work carries a pending badge rather than an empty space." },
      { t: "Book an appointment", b: "Date, morning or afternoon, department, and reason. The request arrives as requested for facility staff to confirm." },
      { t: "Pay a bill", b: "Real invoices, with anything over thirty days flagged overdue. Payment by mobile money, card or bank transfer arrives pending for facility verification." },
      { t: "Message the facility", b: "A conversation with a facility department; staff replies appear in the same thread." },
      { t: "Keep details current", b: "Patients view and update their own demographics, which reduces re-entry by the front desk at the next visit." },
    ],
    lifecycleTitle: "Booking lifecycle",
    lifecycle: ["requested", "confirmed", "checked_in", "in_progress", "completed"],
    roles: ["Patients", "Caregivers", "Front Desk (confirming)", "Cashier (verifying payments)"],
    safeguards: [
      { t: "No installation required", b: "Reached from a phone or facility browser. Optional SMS reminders can point patients back to the portal; no app store is required." },
      { t: "Payments are verified", b: "Portal payments arrive pending and are approved or rejected by a cashier before they post to the ledger." },
      { t: "Booking before arrival", b: "Patients can request an appointment before arrival. Staff review the request before it becomes a confirmed booking." },
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
    short: "A patient's history is held in a single paper ledger, in one building, on one shelf.",
    d: "M4 4h4l2 3h10a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z",
    d2: "M9 14h6",
    body: "Paper files remain where they were written. If the folder is at another facility, in a locked office, or lost to flooding, the treating clinician has no record to consult. Staff search the shelves while patients wait.",
    cost: "Time spent searching for files is time taken from patient care.",
    fix: "**One patient record**, held on the device and **replicated when a connection appears**: searchable by name, hospital number, geocode, QR card or fingerprint.",
    products: ["HMIS", "CMS", "PPS"],
    steps: [
      { t: "Register once, keep the identity", b: "The front desk registers the patient once. The record carries a hospital number, a geocode down to the boma, and optionally a QR card or fingerprint, so the same person is found again without a folder." },
      { t: "Find the patient in seconds", b: "Search by any of those identifiers. The result is the whole record: every past encounter, prescription, result and referral attached to that person." },
      { t: "Hold it on the device", b: "The record lives on the facility device, so a power cut or a dropped connection does not remove access to the history in front of the clinician." },
      { t: "Replicate when a connection appears", b: "When bandwidth returns, changes sync in both directions. The record is then available at any facility where the patient presents." },
    ],
  },
  {
    slug: "histories-rebuilt-from-memory",
    title: "Histories rebuilt from memory",
    image: "/assets/doctor-writing-notes.jpg",
    imageAlt: "A clinician writing notes by hand",
    short: "Each visit begins without a history, which must be rebuilt by questioning the patient again.",
    d: "M3 12a9 9 0 1 0 3-6.7",
    d2: "M3 4v5h5",
    body: "Without a record of the last visit, the clinician must take the history again: what was diagnosed, what was prescribed and whether it worked. The patient answers from memory, and the recollection of an unwell patient is not a reliable clinical record.",
    cost: "Consultations take longer and begin with incomplete information.",
    fix: "The chart opens with vitals, diagnoses, prescriptions, results and the plan from **every previous visit already there**.",
    products: ["HMIS", "CMS", "PPS"],
    steps: [
      { t: "Open the chart, not a blank page", b: "Starting a consultation loads the patient's timeline: previous diagnoses, medicines, results, vitals and the plan left by the last clinician." },
      { t: "Record the encounter as structured data", b: "Vitals, complaint, examination, diagnosis and plan are captured in fields, not prose, so the next clinician can read them without interpretation." },
      { t: "Carry the plan forward", b: "Follow-up instructions and review dates persist on the record and surface at the next visit instead of relying on the patient's recall." },
      { t: "Give the patient access", b: "Through the patient portal, patients can read their own visit history, prescriptions and results, which provides a second copy of the record." },
    ],
  },
  {
    slug: "queues-with-no-order-of-urgency",
    title: "Queues with no order of urgency",
    image: "/assets/medical-unit-male-ward.jpg",
    imageAlt: "Patients waiting on a crowded hospital ward",
    short: "Patients are seen in order of arrival, not in order of clinical need.",
    d: "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z",
    d2: "M12 7v5l4 2",
    body: "A paper queue cannot be prioritised. A child in respiratory distress may wait behind a routine review because the register does not record urgency, and staff at the desk cannot see every waiting patient at once.",
    cost: "The most seriously ill patients may wait the longest, and the delay is often identified too late.",
    fix: "Check-in assigns acuity, triage derives **RED / YELLOW / GREEN** from ETAT vitals, and the **live queue sorts itself by urgency**.",
    products: ["HMIS", "CMS"],
    steps: [
      { t: "Check in against the record", b: "Arrival is logged on the patient's record, so waiting patients form an ordered list." },
      { t: "Take vitals at triage", b: "Weight, temperature, pulse, respiratory rate and oxygen saturation are entered at the triage station." },
      { t: "Derive acuity from ETAT", b: "The system applies ETAT criteria to those vitals and assigns RED, YELLOW or GREEN rather than leaving the judgement to whoever is at the desk." },
      { t: "Re-sort the queue automatically", b: "The live queue orders by acuity and waiting time, and the whole room is visible on one screen to the clinician in charge." },
    ],
  },
  {
    slug: "treatment-repeated-or-missed",
    title: "Treatment repeated, or missed",
    image: "/assets/doctor-prescription.jpg",
    imageAlt: "A prescription being prepared",
    short: "Without a record of the last prescription, the next one is written without full information.",
    d: "M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7z",
    d2: "M8.5 8.5l7 7",
    body: "Tests are re-ordered because earlier results cannot be seen. Medicines are re-prescribed because earlier dispensing cannot be seen. Interactions and allergies go undetected until they cause harm.",
    cost: "Scarce drugs and reagents are used twice, and avoidable adverse reactions occur.",
    fix: "Prescribing runs **interaction, allergy and duplicate checks** against the patient's active medicines, and dispensing writes back to the same record.",
    products: ["HMIS", "CMS", "PMS"],
    steps: [
      { t: "Prescribe from the active medicine list", b: "The prescriber sees what the patient is already taking, when it was dispensed and by whom." },
      { t: "Run the safety checks", b: "Interaction, allergy and duplicate-therapy checks run against that list before the prescription can be issued." },
      { t: "Dispense against the prescription", b: "The pharmacy fills the electronic prescription (without transcription or reading handwriting) and records the batch dispensed." },
      { t: "Write it back to the record", b: "The dispense event closes the loop on the same patient record, so the next clinician sees what was received, not what was intended." },
    ],
  },
  {
    slug: "results-that-never-reach-the-clinician",
    title: "Results that never reach the clinician",
    image: "/assets/doctor-tablet-review.jpg",
    imageAlt: "A clinician reviewing results",
    short: "Paper lab slips must be carried by hand from the laboratory to the clinician.",
    d: "M9 3h6v5l4 9a2 2 0 0 1-2 3H7a2 2 0 0 1-2-3l4-9z",
    d2: "M9 3h6",
    body: "Results are written on paper slips and carried by hand to the ordering clinician. Critical values are delayed by this process, and a lost slip means the result never reaches the clinician.",
    cost: "Abnormal and critical findings remain unread after the patient has gone home.",
    fix: "Results release straight into the chart, critical values require **two-eyes confirmation** and message the ordering clinician, and unreviewed results **breach a visible SLA**.",
    products: ["LIS", "HMIS", "RIS"],
    steps: [
      { t: "Order electronically", b: "The clinician orders from within the encounter; the lab receives it as a worklist item tied to that patient and that visit." },
      { t: "Track the specimen", b: "Collection, receipt and analysis are stamped, so anyone can see where a sample is instead of asking." },
      { t: "Release into the chart", b: "Validated results are published directly to the ordering clinician's inbox and to the patient's record. No paper slip needs to be carried." },
      { t: "Escalate the critical ones", b: "Critical values require two-eyes confirmation and notify the ordering clinician directly; results left unreviewed breach a visible turnaround SLA." },
    ],
  },
  {
    slug: "stock-counted-after-it-has-run-out",
    title: "Stock counted after it has run out",
    image: "/assets/ward-supplies-distribution.jpg",
    imageAlt: "Supplies being handed out on a ward round, counted by hand from the trolley",
    short: "Stock is tracked only by checking the shelf, which identifies shortages late.",
    d: "M20 7.5 12 3 4 7.5v9L12 21l8-4.5z",
    d2: "M4 7.5 12 12v9",
    body: "Medicines are counted by eye during busy shifts, expiry dates are checked irregularly, and stock-outs are discovered at the counter when a prescription is presented. Reorder decisions are made without reliable data.",
    cost: "Patients go without medicines that the facility held but allowed to expire.",
    fix: "**Live stock status**, batch and expiry tracking with **first-expiry-first-out**, reorder alerts and a printable purchase order, plus an append-only two-signature register for controlled medicines.",
    products: ["PMS", "HMIS"],
    steps: [
      { t: "Receive stock into batches", b: "Deliveries are entered by batch number and expiry date, so the shelf has a ledger behind it." },
      { t: "Dispense first-expiry-first-out", b: "The system proposes the batch closest to expiry, which reduces losses to expiry." },
      { t: "Watch levels and dates continuously", b: "Reorder points and expiry windows raise alerts before a stock-out reaches the counter." },
      { t: "Order based on consumption", b: "A printable purchase order is generated from real consumption; controlled medicines run on an append-only two-signature register." },
    ],
  },
  {
    slug: "referrals-that-travel-without-their-record",
    title: "Referrals that travel without their record",
    image: "/assets/community-health-worker.jpg",
    imageAlt: "A community health worker with a patient",
    short: "The patient arrives at the receiving facility with only their own account of their care.",
    d: "M3 12h13",
    d2: "M13 6l6 6-6 6",
    body: "A referral note names a destination but rarely carries the clinical picture. The receiving team starts the workup again, and the referring team never learns what happened to the patient they sent.",
    cost: "Care restarts at each level, and the referring clinician does not receive the outcome.",
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
    body: "Facility staff spend days copying registers into monthly summaries. Figures arrive late and incomplete, and cannot be checked against the visits that produced them. The Ministry identifies this gap in its own review of the system.",
    cost: "Planning and outbreak response run on data that is already out of date.",
    fix: "**Every visit tallies as it happens**, data-quality scoring runs **before** export, and DHIS2-ready reports (Monthly HMIS 105, Weekly Epi, Immunization Coverage) are generated, not retyped.",
    products: ["HMIS", "CMS"],
    steps: [
      { t: "Tally at the point of care", b: "Each visit contributes to the indicators as it is recorded. There is no separate counting exercise." },
      { t: "Score the data before it leaves", b: "Data-quality checks flag missing fields, impossible values and gaps in reporting ahead of submission." },
      { t: "Generate the national reports", b: "Monthly HMIS 105, Weekly Epi and Immunization Coverage reports are produced from the same records, in DHIS2-ready form." },
      { t: "Submit and keep the trail", b: "Submission is logged and traceable back to the encounters that produced each number, so every figure can be verified." },
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
  { tone: "#015697", level: "Community: Boma Health Initiative", role: "Promotion, screening & referral", product: "Registry & referral", image: "/assets/community-malaria-test.jpg", alt: "A community health worker running a malaria rapid test on a small child held by their mother, at a village outreach" },
  { tone: "#015697", level: "Primary Health Care Unit (PHCU)", role: "First formal point of care", product: "CMS", image: "/assets/community-health-worker.jpg", alt: "Community health worker at a primary care clinic" },
  { tone: "#015697", level: "Primary Health Care Centre (PHCC)", role: "Expanded primary & maternity care", product: "CMS", image: "/assets/medical-unit-female-ward.jpg", alt: "The women's side of a health centre's medical unit" },
  { tone: "#015697", level: "County Hospital", role: "First referral & inpatient care", product: "HMIS", image: "/assets/inpatient-ward-beds.jpg", alt: "Mothers and babies on numbered beds under mosquito nets in a hospital inpatient ward" },
  { tone: "#015697", level: "State Hospital", role: "Secondary & specialised care", product: "HMIS", image: "/assets/doctor-nurse-consultation.jpg", alt: "Hospital clinicians coordinating patient care" },
  { tone: "#015697", level: "Referral / Tertiary Hospital", role: "Tertiary & teaching care", product: "HMIS", image: "/assets/doctor-tablet-review.jpg", alt: "Clinician reviewing records on a tablet" },
];

/** Sidebar label for a care level — "Community" for the Boma tier, otherwise the level minus its parenthetical. */
export const careLevelLabel = (c: CareLevel) =>
  c.product === "Registry & referral" ? "Community" : c.level.replace(/ \(.*\)/, "").replace(": Boma Health Initiative", "");

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
  { accent: "#015697", name: "Mark Dosu", role: "Developer", image: "/assets/Mark-Dosu.jpeg" },
  { accent: "#015697", name: "Chinonye Hycent", role: "Research Lead", image: "/assets/chinonye-hycent.jpg" },
  { accent: "#015697", name: "Isaac Kyalo", role: "Technical Lead", image: "/assets/isaac-kyalo.jpg" },
];

/**
 * The advisors listed under Leadership on /about.
 *
 * Deliberately three facts and no paragraph: what they do, where they do it,
 * and the field it comes out of. An advisor who has not sent a portrait is
 * shown as a monogram in the same square frame, so the row keeps its rhythm
 * instead of leaving a hole where a face should be.
 */
export interface Advisor {
  accent: string;
  name: string;
  /** What they do — a title, not a description of it. */
  role: string;
  /** Where they do it. Joined with "·" when there is more than one. */
  institutions: string[];
  /** The field the advice comes out of. */
  industry: string;
  image?: string;
  focus?: string;
}

export const ADVISORS: Advisor[] = [
  {
    accent: "#015697",
    name: "Krista Galleberg",
    role: "Researcher and educator",
    institutions: ["Harvard University"],
    industry: "Education research",
    image: "/assets/krista-galleberg.jpg",
  },
  {
    accent: "#015697",
    name: "David Blair",
    role: "VP of Data & Automation",
    institutions: ["Phoenix Tailings", "Machinery Partner (board)"],
    industry: "Industrial technology",
    image: "/assets/david-blair.jpg",
  },
  {
    accent: "#015697",
    name: "Tim Raphael",
    role: "Professor, Arts, Culture & Media · Director, Newest Americans",
    institutions: ["Rutgers University–Newark"],
    industry: "Arts, culture and media",
    // 684×1024 — the tallest source in the set, and the only one whose face
    // nearly fills the square plate: 203px of a 220px window on tablet, the
    // same ratio on desktop. 42% is where that window centres on the face —
    // "center top" spends the slack above the hair and clips the beard.
    image: "/assets/tim-raphael.jpg",
    focus: "center 42%",
  },
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
    body: "In South Sudan, a patient's history is kept on paper (**one ledger, one building, one shelf**), so when it is lost or damaged, care begins again without it. The same gap affects reporting: information about an outbreak, a stock-out or a missed vaccination rarely reaches those who can act on it. **The data exists**; what has been missing is a record system designed for clinics without reliable power or connectivity. TamamHealth is built to provide it.",
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
    stripTitle: "The data exists but does not reach decision-makers",
    href: "/health-system#reality",
  },
  {
    kicker: "Ground Truth",
    title: "The daily reality inside South Sudan's facilities",
    body: "Across South Sudanese facilities, from the wards to the waiting areas, the same problems recur for patients and clinicians alike: **lost histories, duplicate treatment, and slow clinical flow**.",
    image: "/assets/medical-unit-male-ward.jpg",
    alt: "Patients and clinical staff inside a crowded male medical ward in South Sudan",
    accent: "#015697",
    stripKicker: "Ground Truth",
    /* The failures this card names are the eight challenge cards, and they
       live here. */
    stripTitle: "The daily reality inside South Sudan's facilities",
    href: "/health-system#challenges",
  },
  {
    kicker: "National Alignment",
    title: "South Sudan's healthcare system",
    body: "The Ministry of Health's **2025 Essential Health Services Package** organises the country's care into **six levels**, and identifies fragmented, paper-based data as one of its largest gaps. Tamam is designed to fit that system rather than replace it. Most sub-Saharan health systems share the same six-tier structure, so the approach can be applied across the region.",
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
    title: "Our goal: prove the model, then extend it to every clinic",
    body: "TamamHealth is raising **$100,000** to launch in **10 clinics** across Juba and greater South Sudan, to demonstrate that offline-first digital records can work in the most difficult conditions and to establish a model for sub-Saharan Africa.",
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
  { accent: "#015697", amount: "$250", label: "Equips a front desk", note: "One tablet and a fingerprint reader to identify patients who have no documents." },
  { accent: "#015697", amount: "$1,000", label: "Trains a facility team", note: "Registration, consultation, lab, and pharmacy staff trained on the same record." },
  { accent: "#015697", amount: "$10,000", label: "Launches a clinic", note: "One of the ten pilot clinics: devices, power, training, and twelve months of support." },
];

export const DONATION_STEPS = [
  { accent: "#015697", n: "01", title: "Donation", body: "Donors choose a one-time or monthly amount. Every gift is earmarked for the 10-clinic pilot in Juba and greater South Sudan." },
  { accent: "#015697", n: "02", title: "Equipment", body: "Funds purchase the equipment a clinic needs to adopt digital records: affordable tablets, solar power and fingerprint readers. No server room or IT department is required." },
  { accent: "#015697", n: "03", title: "Deployment and training", body: "Each facility is set up offline-first and its team is trained on one patient record across registration, consultation, lab, and pharmacy." },
  { accent: "#015697", n: "04", title: "Measurement and reporting", body: "Records feed facility dashboards and DHIS2-ready national reports. Donors receive the same figures that are reported to the Ministry." },
];

export const DONATION_FAQ = [
  { q: "How are donations used?", a: "Devices and solar power, deployment and staff training, connectivity and sync, and measurement. The $100,000 pilot goal covers all ten clinics over twelve months, from equipment to measurement and scale." },
  { q: "Can I fund a specific clinic?", a: "Yes. Please state this in your message; your gift will be assigned to one of the ten pilot facilities, and we will report on that facility directly." },
  { q: "Can my organisation partner instead of donating?", a: "Yes. Facilities, NGOs, funders and ministries may write to support.tamam@gmail.com to discuss a deployment." },
  { q: "Can I donate through a registered charity?", a: "Yes. Elimisha Kakuma, a U.S. 501(c)(3) nonprofit organization, serves as TamamHealth's fiscal sponsor. Please contact support.tamam@gmail.com for instructions on giving through Elimisha Kakuma." },
  { q: "How will results be measured?", a: "Every level writes to the same patient record, which feeds DHIS2-ready national reports. The pilot is designed so that its results can be measured and verified." },
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
  /* Three of the four doors land on the same `/login`, so the door travels
     with the link: the platform reads `?portal=` and shows the picture for
     the product being entered rather than a doctor at a workstation to
     everyone. Staff is the default there, so its link stays clean. */
  const door = path === "/login" && role !== "staff" ? `?portal=${role}` : "";
  return `${PLATFORM_URL}${path}${door}`;
}

export const LEGAL = [
  { id: "covers", title: "What these terms cover", paras: [
    "These Terms & Conditions govern use of the TamamHealth platform (the hospital, clinic, laboratory, radiology, pharmacy and patient portal products) together with this website and any related services. By creating an account, signing in, or using the platform on a facility device, you agree to them.",
    "Where a facility, ministry or partner organisation has signed a separate deployment agreement with TamamHealth, that agreement takes precedence over these terms for the users it covers.",
  ]},
  { id: "accounts", title: "Accounts and access", paras: [
    "Accounts are issued by a facility administrator, not self-registered. Each account belongs to one named person, carries one role, and must not be shared. Administrator-issued credentials require a password change on first use.",
    "You are responsible for activity under your account. Report a lost device or suspected compromise to your facility administrator immediately so the session can be revoked.",
  ]},
  { id: "roles", title: "Role-based use", paras: [
    "The platform restricts what each role can see and do: doctor, clinical officer, nurse, laboratory technician, pharmacist, front desk, community health worker, and government administrator. You may only use the functions your role has been granted.",
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
  { n: "03", t: "Consultation", b: "The chart opens with the patient's history already in it: past diagnoses, medicines, results and the plan left by the last clinician." },
  { n: "04", t: "Orders", b: "Lab and imaging orders leave the encounter electronically, arrive on the bench worklist, and return validated results into the same chart." },
  { n: "05", t: "Prescribing and dispensing", b: "Interaction, allergy and duplicate checks run against the active medicine list; pharmacy dispenses against the electronic prescription and records the batch." },
  { n: "06", t: "Admission or referral", b: "Admission opens ward and bed management on the same record. A referral bundles a transfer package and returns a structured outcome to the referring clinician." },
  { n: "07", t: "Reporting", b: "Every visit tallies as it happens. Data-quality scoring runs before export, and Monthly HMIS 105, Weekly Epi and Immunization Coverage reports are generated in DHIS2-ready form." },
];

export const PLATFORM_PILLARS = [
  { t: "Works without a connection", b: "The record lives on the facility device. Registration, triage, consultation, dispensing and reporting all continue offline; changes replicate both ways when bandwidth returns." },
  { t: "Resilient to power loss", b: "Designed for facilities where only 13% have any on-site power source: no work is lost during an outage, and the device resumes where the shift stopped." },
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
  "South Sudan's health system relies on paper records: each visit is written into a ledger kept in one building, on one shelf. This constraint, which results from circumstance rather than choice, causes the record to fail at three levels.";

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
    what: "The history is unavailable",
    body:
      "When a patient arrives, the only history available is what the patient can recall. Allergies, previously failed treatments and abnormal results are not available to the clinician. Tests are repeated, treatments already tried are given again, and recorded warnings are missed. With so few health workers, every repeated test reduces the time available for the next patient.",
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
    what: "The work is not visible",
    body:
      "Community health workers serve patients across thousands of scattered villages and make decisions without a second opinion or any review of their assessments. Supervisors cannot see which workers are active, how many patients they have seen, or which children have missed a vaccine dose, because the records remain in paper notebooks. At this facility density, most care takes place far from any point of review.",
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
    what: "Information arrives too late",
    body:
      "Reports are compiled by hand at month end, copied from ledgers into forms and totalled by available staff. Figures arrive late and incomplete, and cannot be checked against the visits that produced them. Outbreak signals, stock-outs and missed immunisations become visible only weeks after action would have been effective.",
    image: "/assets/facility-banner.jpg",
    imageAlt: "Patients on camp beds under a canvas outbreak-treatment tent, the kind of surge a month-end report announces after the fact",
    focus: "center 55%",
    stat: {
      value: "38.7",
      unit: "UHC service-coverage index, out of 100",
      note: "planned each year from returns that cannot be verified",
      source: "EHSP 2025",
    },
  },
];

export const PROBLEM_WHY_TITLE = "The cause is a lack of suitable tools, not a failure of care";

export const PROBLEM_WHY =
  "Software that requires a server or a continuous connection cannot be used in these conditions, so records continue to be kept on paper, where they cannot be shared. The data exists, but it remains at the point where it is created.";

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
  /**
   * Intrinsic pixel size, rendered as the <img> width/height attributes.
   *
   * Load-bearing in the scrolling strip, not decorative metadata. The frames
   * are sized `height: clamp(...); width: auto`, so a photo that has not
   * downloaded yet has no width to give — the figure collapsed to 2px, its
   * caption (`min-width: 100%`) wrapped to fourteen lines, and every frame in
   * the flex row inherited that height. The result was a 260px photograph
   * sitting in a 533px row. With the attributes present the browser knows the
   * ratio before the bytes arrive and reserves the right width.
   */
  w: number;
  h: number;
}

/** Photos from the Tufts New Ventures Competition, April 10, 2026 — in story
    order. Shared by the /about award section and the news article. */
export const DERBY_PHOTOS: Photo[] = [
  {
    src: "/assets/derby/derby-09.jpg",
    alt: "Toye Adebayo, Teny Makuach and Ekow Williams standing together with competition badges",
    caption: "Toye Adebayo, Teny Makuach and Ekow Williams before the results were announced.",
    w: 1400,
    h: 933,
  },
  {
    src: "/assets/derby/derby-13.jpg",
    alt: "Teny Makuach pitching with a microphone, the live record system on the projector behind him",
    caption: "Teny Makuach presenting a live demonstration of the record system.",
    w: 1400,
    h: 933,
  },
  {
    src: "/assets/derby/derby-07.jpg",
    alt: "Ekow Williams presenting with a microphone beside the lectern",
    caption: "Ekow Williams presenting in the Healthcare & Life Science track.",
    w: 1400,
    h: 933,
  },
  {
    src: "/assets/derby/derby-12.jpg",
    alt: "A team member answering questions with a microphone during the pitch",
    caption: "Five minutes of questions from the judges followed the five-minute pitch.",
    w: 1400,
    h: 933,
  },
  {
    src: "/assets/derby/derby-08.jpg",
    alt: "The team demoing the platform on a laptop at a standing table during the reception",
    caption: "Demonstrating the record system between sessions.",
    w: 1400,
    h: 933,
  },
  {
    src: "/assets/derby/derby-10.jpg",
    alt: "Ekow Williams in conversation at the reception",
    caption: "Ekow Williams discussing the pilot.",
    w: 1400,
    h: 933,
  },
  {
    src: "/assets/derby/derby-01.jpg",
    alt: "The team called up through an applauding audience as the results are announced",
    caption: "The announcement of the results.",
    w: 1400,
    h: 933,
  },
  {
    src: "/assets/derby/derby-02.jpg",
    alt: "The team receiving the oversized $10,000 check on stage",
    caption: "Receiving the award on stage.",
    w: 1400,
    h: 933,
  },
  {
    src: "/assets/derby/derby-11.jpg",
    alt: "The team holding the $10,000 check together with the competition judges",
    caption: "The team with the judges and the $10,000 check.",
    w: 1400,
    h: 933,
  },
  {
    src: "/assets/derby/derby-04.jpg",
    alt: "Founders laughing together while holding the check",
    caption: "The founders after the announcement.",
    w: 1400,
    h: 933,
  },
  {
    src: "/assets/derby/derby-03.jpg",
    alt: "The team posing with the check while a guest takes a photo",
    caption: "Photographs with the award check.",
    w: 1400,
    h: 933,
  },
  {
    src: "/assets/derby/derby-05.jpg",
    alt: "Toye Adebayo, Teny Makuach and Ekow Williams holding the $10,000 check in front of the Derby Entrepreneurship Center banner",
    caption: "The founding team with the award.",
    w: 1400,
    h: 933,
  },
  {
    src: "/assets/derby/derby-06.jpg",
    alt: "The three founders standing full-length with the check in front of the Derby Entrepreneurship Center banner",
    caption: "At the Derby Entrepreneurship Center at Tufts.",
    w: 933,
    h: 1400,
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
  /** A partner's own logo, shown at the head of the panel. Used as the
      organisation supplies it, never redrawn. */
  logo?: { src: string; alt: string; w: number; h: number };
  /** The partner's own site or page, linked under the rows. */
  link?: { label: string; href: string };
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

/** Newest first — the home band shows the first four as its card strip (a
    single story runs as a full-width feature instead), /news lists them all.
    The next update is one more entry at the top of this array. */
export const NEWS: NewsItem[] = [
  {
    slug: "iteru-medical-center-testing",
    tag: "Field testing",
    date: "November 2026",
    dateISO: "2026-11",
    title: "TamamHealth begins platform testing at Iteru Medical Center in Juba",
    image: "/assets/news/iteru-medical-center-logo-cover.jpg",
    imageAlt: "The Iteru Medical Center logo",
    summary:
      "Iteru Medical Center in Juba, South Sudan, is testing the TamamHealth platform ahead of its planned launch at the facility.",
    body: [
      "TamamHealth has begun testing its platform at Iteru Medical Center, a private medical facility in Juba, South Sudan. Iteru Medical Center is the first hospital to test the platform with its own staff.",
      "Testing covers patient registration, triage, consultation, laboratory orders and results, pharmacy dispensing, and end-of-day reporting. Issues identified during testing will be resolved before the platform is launched at the facility.",
      "Following the completion of testing, TamamHealth plans to launch the platform at Iteru Medical Center and to extend it to additional facilities. Further updates will be published here.",
    ],
    explainer: {
      title: "About Iteru Medical Center",
      intro: "Iteru Medical Center is a private medical facility in Juba, South Sudan.",
      rows: [
        { k: "Location", v: "Juba, South Sudan" },
        { k: "Relationship", v: "Testing partner" },
        { k: "Scope of testing", v: "Registration, triage, consultation, laboratory, pharmacy and reporting" },
        { k: "Next step", v: "Launch at Iteru Medical Center following the completion of testing" },
      ],
      logo: { src: "/assets/partners/iteru-medical-center-logo.jpg", alt: "Iteru Medical Center logo", w: 720, h: 720 },
      link: { label: "Iteru Medical Center on Facebook", href: "https://www.facebook.com/p/Iteru-Medical-Center-100078338706817/" },
    },
    link: { label: "Learn about the platform", href: "/platform" },
  },
  {
    slug: "elimisha-kakuma-fiscal-sponsor",
    tag: "Partnership",
    date: "November 2026",
    dateISO: "2026-11",
    title: "TamamHealth announces fiscal sponsorship by Elimisha Kakuma",
    image: "/assets/news/elimisha-kakuma-logo-cover.jpg",
    imageAlt: "The Elimisha Kakuma logo, a tree, above the organization's name",
    summary:
      "Elimisha Kakuma, a U.S. 501(c)(3) nonprofit organization, is now the fiscal sponsor of TamamHealth.",
    body: [
      "TamamHealth is pleased to announce that Elimisha Kakuma, a U.S. 501(c)(3) nonprofit organization, has become its fiscal sponsor.",
      "Under this arrangement, Elimisha Kakuma may receive grants and donations in support of TamamHealth's charitable activities.",
      "Elimisha Kakuma was founded in 2021. It provides access to higher education for high school graduates in Kakuma Refugee Camp, Kenya, through academic preparation, mentorship, and college counseling.",
      "Donors who wish to give through Elimisha Kakuma may contact TamamHealth at support.tamam@gmail.com for details.",
    ],
    explainer: {
      title: "About Elimisha Kakuma",
      intro: "Elimisha Kakuma provides access to higher education opportunities for high school graduates in Kakuma Refugee Camp through academic preparation, mentorship, and college counseling.",
      rows: [
        { k: "Founded", v: "2021" },
        { k: "Location", v: "Kakuma Refugee Camp, Kenya" },
        { k: "Status", v: "U.S. 501(c)(3) nonprofit organization" },
        { k: "Relationship", v: "Fiscal sponsor of TamamHealth" },
      ],
      logo: { src: "/assets/partners/elimisha-kakuma-logo.png", alt: "Elimisha Kakuma logo, a tree", w: 500, h: 500 },
      link: { label: "Visit elimishakakuma.org", href: "https://elimishakakuma.org" },
    },
    link: { label: "Support the 10-clinic pilot", href: "/donate" },
  },
  {
    slug: "incorporated-in-massachusetts",
    tag: "Milestone",
    date: "November 2026",
    dateISO: "2026-11",
    title: "TamamHealth incorporates in Massachusetts",
    image: "/assets/news/massachusetts-cover.jpg",
    imageAlt: "TamamHealth mark above the words incorporated in Massachusetts",
    summary:
      "TamamHealth is now registered as a corporation in the Commonwealth of Massachusetts.",
    body: [
      "TamamHealth is now officially registered as a corporation in the Commonwealth of Massachusetts.",
      "TamamHealth was founded at Tufts University and develops offline-first digital health infrastructure for South Sudan and sub-Saharan Africa.",
    ],
    link: { label: "Meet the team", href: "/about#team" },
  },
  {
    slug: "tufts-new-ventures-competition",
    tag: "Competition",
    date: "April 2026",
    dateISO: "2026-04",
    title: "TamamHealth places second in the Healthcare & Life Science track at the Tufts New Ventures Competition",
    image: "/assets/derby/derby-05.jpg",
    imageAlt: "Toye Adebayo, Teny Makuach and Ekow Williams holding the $10,000 check at the Derby Entrepreneurship Center at Tufts",
    summary:
      "TamamHealth received a $10,000 award at its first venture competition, where it presented a working offline-first record system.",
    body: [
      "On April 10, 2026, TamamHealth placed second in the Healthcare & Life Science track of the Tufts New Ventures Competition, held at the Derby Entrepreneurship Center at Tufts, and received a $10,000 award. It was the first venture competition TamamHealth had entered.",
      "TamamHealth's founder, Teny Makuach, grew up in Kakuma refugee camp, where he observed the problems the platform is designed to address: queues without prioritisation, clinicians rebuilding a patient's history from the patient's memory, and treatments given twice because earlier treatment could not be seen. He developed the first version of TamamHealth in response. Ekow Williams and Toye Adebayo joined him, having observed the same failures first-hand.",
      "The team presented a live demonstration of the record system, running a full patient day with the network disconnected: registration, triage, consultation, laboratory orders, dispensing, and the reports submitted to the Ministry. The demonstration used the working system, not a mock-up, and required no connection.",
      "The judges assessed eight criteria, including whether the team is suited to solving the problem. The presentation also set out the operating conditions: 4% of South Sudan's facilities have a computer with internet, 13% have any on-site power, and there are 7.6 health workers per 10,000 people against a WHO norm of 44.5. For this reason, TamamHealth is designed to operate without a connection.",
      "The competition was the first external assessment of the platform. TamamHealth's next objective is a pilot in ten clinics in Juba and greater South Sudan, sharing one patient record.",
    ],
    /* Set against the paragraph each one belongs to: the three founders beside
       the origin story, the pitch beside what we pitched, the Q&A beside the
       judging, the award beside the close. */
    bodyPhotos: [
      { after: 1, photos: [derby("derby-09")] },
      { after: 2, photos: [derby("derby-13"), derby("derby-07")] },
      { after: 3, photos: [derby("derby-12")] },
      { after: 4, photos: [derby("derby-02"), derby("derby-11")] },
    ],
    link: { label: "Meet the team", href: "/about#team" },
    galleryTitle: "April 10, 2026: Tufts New Ventures Competition",
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
      label: `${p.acronym}: ${p.title.replace(" System", "")}`,
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
      { label: "Who we are", href: "/about#who-we-are" },
      { label: "The Goal", href: "/donate" },
      { label: "Our Leadership", href: "/about#leadership" },
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

/* ── Site header navigation ──
   These lived in SiteHeader.tsx until the site gained a second language. They
   are copy, and copy belongs where the translation extractor looks — a nav
   label hidden in a component was the one class of string it could not see. */

export type MenuKey = "products" | "platform" | "system" | "about";

export interface MenuLink {
  label: string;
  note: string;
  href: string;
}

/* Six links. Contact is deliberately not among them: the amber "Get in touch"
   button beside this list is the route to /contact, and listing it twice made
   the row's one call to action compete with a plain link to the same page.
   The About mega menu and the footer still carry it. */
export const NAV_ITEMS: { label: string; href: string; menu: MenuKey | null }[] = [
  // Platform leads: it is the argument — one record, and what that fixes. The
  // six products are how that argument is packaged, which only reads once the
  // reader knows what they are packaging.
  { label: "Platform", href: "/platform", menu: "platform" },
  { label: "Products", href: "/products", menu: "products" },
  { label: "The health system", href: "/health-system", menu: "system" },
  { label: "About", href: "/about", menu: "about" },
  { label: "News & updates", href: "/news", menu: null },
  // "Goal" rather than "Donate": the page opens on what the money is for —
  // $100,000, ten clinics, twelve months — and the ask follows from it. The
  // route stays /donate so existing links and the widget's return URLs hold.
  { label: "Goal", href: "/donate", menu: null },
];

export const MENU_DATA: Record<MenuKey, { title: string; blurb: string; allLabel: string; allHref: string; links: MenuLink[] }> = {
  products: {
    title: "Products",
    blurb: "Six products for every tier of care: hospital, clinic, laboratory, radiology, pharmacy, and the patient's own portal.",
    allLabel: "View all products",
    allHref: "/products",
    links: PRODUCTS.map((p) => ({ label: p.title, note: p.tagline, href: `/products/${p.slug}` })),
  },
  system: {
    title: "The health system",
    blurb: "Six levels of care from the Boma health worker to the teaching hospital, and how Tamam fits the Ministry's own structure rather than replacing it.",
    allLabel: "National alignment",
    allHref: "/health-system",
    links: [
      { label: "Six levels of care", note: "Community, PHCU, PHCC, county, state, referral", href: "/health-system#levels" },
      { label: "National alignment", note: "Shaped around the 2025 EHSP", href: "/health-system" },
      { label: "Deployment footprint", note: "Pilot and planned sites across South Sudan", href: "/#footprint" },
      { label: "DHIS2 reporting", note: "Records that roll up into national reports", href: "/platform#how-it-works" },
      { label: "Operating conditions", note: "4% have internet, 13% have power", href: "/health-system#reality" },
      { label: "The Ministry's own diagnosis", note: "Parallel, disconnected systems", href: "/health-system#diagnosis" },
    ],
  },
  platform: {
    title: "The platform",
    blurb: "One offline-first record behind every product, designed for use from the front desk to national reporting.",
    /* The panel's headline link stays inside the section it heads, like the
       other three menus. The two portal links below already carry log-in. */
    allLabel: "The platform",
    allHref: "/platform",
    links: [
      { label: "How it works", note: "A patient day, end to end", href: "/platform#how-it-works" },
      { label: "Offline-first by design", note: "Power cuts, network gaps, role-based access", href: "/platform#offline" },
      { label: "Where care breaks down", note: "The paper problem the platform replaces", href: "/health-system#challenges" },
      { label: "Staff log in", note: "Clinicians, lab, pharmacy, front desk", href: platformHref("staff") },
      { label: "Patient portal", note: "Records, prescriptions and results", href: platformHref("patient") },
      { label: "Get in touch", note: "Request a demonstration", href: "/contact" },
    ],
  },
  about: {
    title: "About TamamHealth",
    blurb: "A nonprofit organization building offline-first health records for South Sudan: who we are, our leadership and our team.",
    allLabel: "About TamamHealth",
    allHref: "/about",
    links: [
      { label: "Who we are", note: "A nonprofit, first", href: "/about#who-we-are" },
      { label: "The Goal", note: "$100K pilot across 10 clinics", href: "/donate" },
      { label: "Our Leadership", note: "The advisors to TamamHealth", href: "/about#leadership" },
      { label: "The Team", note: "The founders and developers", href: "/about#team" },
      { label: "Contact", note: "Contact TamamHealth", href: "/contact" },
    ],
  },
};

// Straight to the platform, not through this origin's /login redirect — see
// platformHref. These are the links a reader clicks expecting to arrive at a
// sign-in form, so they should cost one navigation, not two.
export const PORTAL_LINKS = [
  { label: "Staff log in", note: "Clinicians, lab, pharmacy, front desk", href: platformHref("staff") },
  { label: "Patient portal", note: "Your records, prescriptions and results", href: platformHref("patient") },
  { label: "Ministry dashboard", note: "National reporting and DHIS2 export", href: platformHref("ministry") },
  { label: "Platform admin", note: "Organisations, provisioning and governance", href: platformHref("superadmin") },
];

export const SEARCH_SUGGESTIONS = [
  { label: "Offline-first records", href: "/platform#offline" },
  { label: "HMIS for hospitals", href: "/products/hmis" },
  { label: "DHIS2 reporting", href: "/platform#how-it-works" },
  { label: "Pilot clinics", href: "/#footprint" },
  { label: "News & updates", href: "/news" },
  { label: "Goal", href: "/donate" },
  { label: "Get in touch", href: "/contact" },
];


/* ── Deployment-map vocabulary ──
   The footprint card renders whatever the map iframe (public/map-south-sudan.html)
   posts up to it, so those strings are looked up dynamically — `t(site.tier)` —
   and the translation extractor cannot see them at the call site. Listing them
   here is what keeps them translated: the extractor walks this array, so a new
   site added to the map shows up as a missing translation instead of silently
   rendering English inside an otherwise Arabic card.

   Keep in step with the `sites` array in public/map-south-sudan.html. */
export const FOOTPRINT_MAP_VOCABULARY = [
  // Site names
  "Aweil", "Bentiu", "Bor", "Juba", "Kajo-keji", "Kuajok", "Malakal", "Rumbek",
  "Torit", "Wau", "Yambio",
  // States
  "Central Equatoria", "Eastern Equatoria", "Jonglei", "Lakes",
  "Northern Bahr el Ghazal", "Unity", "Upper Nile", "Warrap",
  "Western Bahr el Ghazal", "Western Equatoria",
  // Tiers
  "PHCU / community tier", "Referral / teaching tier", "State hospital tier",
  // Notes
  "Geocode household pilot: patient IDs in the form BOMA-KJ-HH1001.",
  "Pilot launch site: 10-clinic pilot begins in Juba and greater South Sudan.",
  "Secondary and specialised care: HMIS.",
];

/* ── Contact form copy ──
   Moved out of ContactForm.tsx / contact/page.tsx for the same reason the nav
   was: these render through `t(value)`, so the string never appears literally
   at the call site and the extractor cannot find it there. Here it can. */

export const CONTACT_SUBJECTS = ["Subject of inquiry","Book a demo", "Deploy Tamam in a facility", "Fund the pilot", "Partner or integrate", "Other"];

/** The Ministry's six tiers, plus the answer for everyone who isn't a facility. */
export const CONTACT_LEVELS = [
  "Level of care",
  "Community: Boma Health Initiative",
  "Primary Health Care Unit",
  "Primary Health Care Centre",
  "County or State Hospital",
  "Referral / Tertiary Hospital",
  "Not a facility",
];

export const CONTACT_PLACES = ["Location", "Juba", "Elsewhere in South Sudan", "Elsewhere in sub-Saharan Africa", "Outside Africa"];


/** What a demo actually gets you — the reason to fill the form in. */
export const CONTACT_POINTS = [
  "A demonstration of the system running offline through a full facility day",
  "A deployment plan suited to your level of care",
  "Direct discussion with the team that built the system",
  "Guidance on operating without reliable power or connectivity",
  "The cost of a pilot and the steps involved in the first month",
];
