/**
 * Encounter Journey — facility-based patient flow state machine.
 *
 * Faithful encoding of "EHR Clinical Flow — Architecture Document (v1)",
 * Section 6 (Patient Journey, Stages 1–11). This module is the authoritative
 * source of truth that RESTRICTS the system to the documented workflow: every
 * encounter status and every legal transition between statuses is defined here,
 * and application code (station UIs, API guards, queues) must validate moves
 * against `canTransition()` / `nextStatuses()`.
 *
 * Design notes from the document that this module embodies:
 *   - Walk-in is the default; scheduled appointments are a variation (Stage 1).
 *   - Stages 6 (Diagnostics), 7 (Procedures), 8a (clinic-embedded dispensing)
 *     may occur in flexible order within the clinic visit; 8b (central pharmacy)
 *     typically follows clinic checkout. See order-lifecycles.ts for the
 *     per-order sub-state-machines that run in parallel with the encounter.
 *   - Facility checkout (Stage 10) is a GATE that confirms all loops are closed,
 *     not a sequential step. See `FACILITY_CHECKOUT_GATE`.
 *   - Statuses written "[clinic]" / "[destination]" / "[next station]" in the
 *     document are parameterised; the canonical key is generic and the concrete
 *     target (clinic id, station) is carried as encounter metadata.
 */

/** The 11 stages of the facility-based patient journey (Section 6). */
export const ENCOUNTER_STAGES = [
  { stage: 1, key: 'pre_arrival', label: 'Pre-Arrival' },
  { stage: 2, key: 'arrival_registration', label: 'Arrival & Registration' },
  { stage: 3, key: 'triage', label: 'Triage' },
  { stage: 4, key: 'clinic_intake_rooming', label: 'Clinic Intake / Rooming' },
  { stage: 5, key: 'clinical_consultation', label: 'Clinical Consultation' },
  { stage: 6, key: 'diagnostics', label: 'Diagnostics' },
  { stage: 7, key: 'procedures', label: 'Treatment / In-Clinic Procedures' },
  { stage: 8, key: 'pharmacy', label: 'Pharmacy (8a clinic-embedded, 8b central)' },
  { stage: 9, key: 'clinic_checkout', label: 'Clinic Checkout' },
  { stage: 10, key: 'facility_checkout', label: 'Facility Checkout' },
  { stage: 11, key: 'post_visit', label: 'Post-Visit' },
] as const;

export type EncounterStageKey = (typeof ENCOUNTER_STAGES)[number]['key'];

/**
 * Every encounter status named in Section 6 of the document, verbatim (slugged).
 * Parameterised destinations (clinic / station) ride alongside as metadata.
 */
export type EncounterStatus =
  // Stage 1–2 — Pre-arrival & Registration
  | 'scheduled'
  | 'registered'
  | 'arrived_at_facility'
  | 'awaiting_next_station'
  // Stage 3 — Triage
  | 'awaiting_triage'
  | 'in_triage'
  | 'triaged_awaiting_destination'
  | 'escalated_to_emergency'
  | 'lwbs' // Left Without Being Seen
  // Stage 4 — Clinic Intake / Rooming
  | 'routed_to_clinic'
  | 'arrived_at_clinic_awaiting_rooming'
  | 'in_rooming'
  | 'ready_for_clinician'
  | 'transferred_to_other_clinic'
  // Stage 5 — Clinical Consultation
  | 'with_clinician'
  | 'awaiting_labs'
  | 'awaiting_imaging'
  | 'awaiting_pharmacy'
  | 'awaiting_procedure'
  | 'ready_for_clinic_checkout'
  | 'referred_out'
  | 'admitted'
  | 'deceased'
  | 'consultation_paused_draft'
  // Stage 9 — Clinic Checkout
  | 'in_clinic_checkout'
  | 'clinic_complete_awaiting_next_station'
  // Stage 10 — Facility Checkout
  | 'awaiting_facility_checkout'
  | 'in_facility_checkout'
  | 'discharged'
  | 'discharged_with_referral'
  | 'discharged_with_pending_items'
  | 'dismissed_without_formal_checkout';

/**
 * Allowed forward transitions per status, exactly as the "Status transitions"
 * lines of Section 6 specify. A move not present here is illegal and must be
 * rejected by callers. Terminal statuses map to an empty array.
 *
 * Cross-stage escape hatches that the document attaches to most clinical
 * statuses (escalate to emergency, transfer clinic, death, admission, LWBS)
 * are added where the document lists them.
 */
export const ENCOUNTER_TRANSITIONS: Readonly<Record<EncounterStatus, readonly EncounterStatus[]>> = {
  // Stage 1–2
  scheduled: ['registered'],
  registered: ['arrived_at_facility'],
  arrived_at_facility: ['awaiting_next_station'],
  awaiting_next_station: ['awaiting_triage', 'routed_to_clinic', 'escalated_to_emergency', 'lwbs'],

  // Stage 3 — Triage
  // Deliberately NO `escalated_to_emergency` here, unlike every other status
  // where the patient is present and unfinished. A patient deteriorating in the
  // waiting room is taken into triage first — `in_triage` is one hop and costs
  // nothing, and it records that somebody actually laid eyes on them before the
  // escalation was called. Escalating straight from the queue would let the
  // system assert an emergency nobody had assessed.
  // Home-care disposition is a documented triage exit: the nurse has assessed
  // the patient and the facility visit can close without opening a clinic
  // encounter. It is recorded as a formal dismissal so the open-visit joiner
  // cannot absorb the patient's next arrival.
  awaiting_triage: ['in_triage', 'lwbs', 'dismissed_without_formal_checkout'],
  in_triage: ['triaged_awaiting_destination', 'escalated_to_emergency', 'lwbs'],
  triaged_awaiting_destination: ['routed_to_clinic', 'escalated_to_emergency', 'lwbs'],
  escalated_to_emergency: ['admitted', 'discharged', 'deceased', 'referred_out'],
  lwbs: [],

  // Stage 4 — Clinic Intake / Rooming
  routed_to_clinic: ['arrived_at_clinic_awaiting_rooming', 'transferred_to_other_clinic', 'escalated_to_emergency', 'lwbs'],
  arrived_at_clinic_awaiting_rooming: ['in_rooming', 'transferred_to_other_clinic', 'escalated_to_emergency', 'lwbs'],
  in_rooming: ['ready_for_clinician', 'escalated_to_emergency', 'transferred_to_other_clinic', 'lwbs'],
  ready_for_clinician: ['with_clinician', 'escalated_to_emergency', 'lwbs'],
  transferred_to_other_clinic: ['arrived_at_clinic_awaiting_rooming'],

  // Stage 5 — Clinical Consultation
  with_clinician: [
    'awaiting_labs',
    'awaiting_imaging',
    'awaiting_pharmacy',
    'awaiting_procedure',
    'ready_for_clinic_checkout',
    'referred_out',
    'admitted',
    'deceased',
    'transferred_to_other_clinic',
    'escalated_to_emergency',
    'consultation_paused_draft',
  ],
  // Diagnostics/procedures/pharmacy run as parallel order lifecycles; when the
  // clinician's in-visit loops resolve the encounter returns toward checkout.
  awaiting_labs: ['with_clinician', 'ready_for_clinic_checkout', 'escalated_to_emergency'],
  awaiting_imaging: ['with_clinician', 'ready_for_clinic_checkout', 'escalated_to_emergency'],
  awaiting_pharmacy: ['with_clinician', 'ready_for_clinic_checkout', 'escalated_to_emergency'],
  awaiting_procedure: ['with_clinician', 'ready_for_clinic_checkout', 'escalated_to_emergency'],
  consultation_paused_draft: ['with_clinician'],
  referred_out: ['ready_for_clinic_checkout', 'awaiting_facility_checkout'],

  // Stage 9 — Clinic Checkout
  ready_for_clinic_checkout: ['in_clinic_checkout'],
  in_clinic_checkout: ['clinic_complete_awaiting_next_station'],
  // After a clinic closes its portion the patient may go to another clinic, a
  // downstream station, or to facility checkout.
  clinic_complete_awaiting_next_station: ['routed_to_clinic', 'awaiting_pharmacy', 'awaiting_labs', 'awaiting_facility_checkout'],

  // Stage 10 — Facility Checkout
  awaiting_facility_checkout: ['in_facility_checkout', 'dismissed_without_formal_checkout', 'admitted', 'deceased'],
  in_facility_checkout: ['discharged', 'discharged_with_referral', 'discharged_with_pending_items', 'admitted', 'deceased'],

  // Terminal / Stage 11 entry
  admitted: [], // transitions to the inpatient (IPD) flow — out of scope of this OPD module
  deceased: [], // death-encounter closure workflow
  discharged: [],
  discharged_with_referral: [],
  discharged_with_pending_items: [],
  dismissed_without_formal_checkout: [],
};

/** Statuses that close the encounter (Stage 11 — post-visit workflows continue separately). */
export const TERMINAL_STATUSES: readonly EncounterStatus[] = [
  'discharged',
  'discharged_with_referral',
  'discharged_with_pending_items',
  'dismissed_without_formal_checkout',
  'admitted',
  'deceased',
  'lwbs',
];

/** Which stage a status belongs to (for station routing & dashboards). */
export const STATUS_STAGE: Readonly<Record<EncounterStatus, EncounterStageKey>> = {
  scheduled: 'pre_arrival',
  registered: 'arrival_registration',
  arrived_at_facility: 'arrival_registration',
  awaiting_next_station: 'arrival_registration',
  awaiting_triage: 'triage',
  in_triage: 'triage',
  triaged_awaiting_destination: 'triage',
  escalated_to_emergency: 'triage',
  lwbs: 'triage',
  routed_to_clinic: 'clinic_intake_rooming',
  arrived_at_clinic_awaiting_rooming: 'clinic_intake_rooming',
  in_rooming: 'clinic_intake_rooming',
  ready_for_clinician: 'clinic_intake_rooming',
  transferred_to_other_clinic: 'clinic_intake_rooming',
  with_clinician: 'clinical_consultation',
  awaiting_labs: 'clinical_consultation',
  awaiting_imaging: 'clinical_consultation',
  awaiting_pharmacy: 'pharmacy',
  awaiting_procedure: 'procedures',
  ready_for_clinic_checkout: 'clinical_consultation',
  referred_out: 'clinical_consultation',
  admitted: 'clinical_consultation',
  deceased: 'clinical_consultation',
  consultation_paused_draft: 'clinical_consultation',
  in_clinic_checkout: 'clinic_checkout',
  clinic_complete_awaiting_next_station: 'clinic_checkout',
  awaiting_facility_checkout: 'facility_checkout',
  in_facility_checkout: 'facility_checkout',
  discharged: 'facility_checkout',
  discharged_with_referral: 'facility_checkout',
  discharged_with_pending_items: 'facility_checkout',
  dismissed_without_formal_checkout: 'facility_checkout',
};

/**
 * Facility checkout gate (Stage 10). Checkout is "the gate that confirms all
 * loops are closed" (Principle 2.12 + Stage 10). `critical` items BLOCK routine
 * dismissal; an override is possible only with reason + authorization (logged)
 * and generates follow-up tasks.
 */
export interface CheckoutGateItem {
  key: string;
  label: string;
  /** Critical items block dismissal unless overridden with reason + auth. */
  critical: boolean;
}

export const FACILITY_CHECKOUT_GATE: readonly CheckoutGateItem[] = [
  { key: 'all_clinic_visits_closed', label: 'All clinic visits closed', critical: true },
  { key: 'prescriptions_dispensed', label: 'All prescriptions dispensed (or deferred/referred)', critical: true },
  { key: 'critical_labs_reviewed', label: 'All same-day critical labs resulted and reviewed (or pending with follow-up plan)', critical: true },
  { key: 'in_clinic_procedures_complete', label: 'In-clinic procedures complete', critical: true },
  { key: 'required_documentation_generated', label: 'All required documentation generated', critical: true },
  { key: 'payment_status_determined', label: 'Payment status determined', critical: false },
  { key: 'pending_items_flagged', label: 'Anything still pending flagged', critical: false },
];

/**
 * Tier-1 medication safety rule (Stage 10): a patient leaving without a
 * life-sustaining medication because of payment is a clinical safety issue
 * regardless of payment status and requires admin intervention.
 */
export const TIER1_CHECKOUT_SAFETY_RULE =
  'A patient leaving without a Tier-1 (life-sustaining) medication is flagged as a clinical safety issue regardless of payment status; requires admin intervention.';

// ── Helpers ────────────────────────────────────────────────────────────────

export function nextStatuses(from: EncounterStatus): readonly EncounterStatus[] {
  return ENCOUNTER_TRANSITIONS[from] ?? [];
}

export function canTransition(from: EncounterStatus, to: EncounterStatus): boolean {
  return nextStatuses(from).includes(to);
}

export function isTerminal(status: EncounterStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function stageOf(status: EncounterStatus): EncounterStageKey {
  return STATUS_STAGE[status];
}

/**
 * Returns the unmet critical gate items given a checklist of satisfied keys.
 * Empty array means routine dismissal is permitted; otherwise an override
 * (reason + authorization, logged) is required to discharge.
 */
export function unmetCriticalGateItems(satisfiedKeys: readonly string[]): CheckoutGateItem[] {
  const satisfied = new Set(satisfiedKeys);
  return FACILITY_CHECKOUT_GATE.filter((g) => g.critical && !satisfied.has(g.key));
}
