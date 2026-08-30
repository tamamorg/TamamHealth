/**
 * Per-patient triage-form draft recovery.
 *
 * Mirrors `patient-registration-draft.ts`: encrypted, ephemeral storage via
 * `draft-storage.ts` (AES-GCM, per-tab key, lazy TTL expiry) so a nurse who
 * loses the tab mid-assessment (crash, accidental reload, tablet sleeping)
 * doesn't lose a partially-completed ETAT. Keyed per patient — `triage:<id>`
 * — rather than per-session, since a station form only ever assesses one
 * patient at a time and the nurse identifies the draft by walking back up to
 * that same patient.
 *
 * Stores only what the triage form itself needs to redraw — no derived
 * values (BMI, computed priority, warnings) are persisted; those are cheap
 * to recompute from the raw fields on restore and storing them risked a
 * stale derived value surviving a restore after the underlying logic changed.
 */

import { dropDraft, loadDraft, saveDraft } from '@/lib/draft-storage';
import type { TriageDisposition } from '@/lib/db-types';

const DRAFT_KEY_PREFIX = 'triage:';

/** A triage draft is short-lived working state, not a hand-off — 24h matches
 *  the general default but is spelled out here so a policy change to the
 *  shared default doesn't silently change this contract too. */
export const TRIAGE_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export type TriageDraftAbcc = {
  airway: 'clear' | 'obstructed' | '';
  breathing: 'normal' | 'distressed' | 'absent' | '';
  circulation: 'normal' | 'impaired' | 'absent' | '';
  consciousness: 'alert' | 'verbal' | 'pain' | 'unresponsive' | '';
  priority: 'RED' | 'YELLOW' | 'GREEN' | '';
};

export type TriageDraftVitals = {
  temperature: string; pulse: string; respiratoryRate: string; systolic: string;
  diastolic: string; oxygenSaturation: string; weight: string; height: string;
  painScore: string; bloodGlucose: string; gcs: string; muac: string;
};

export type TriageDraftContext = {
  modeOfArrival: 'walk-in' | 'ambulance' | 'referral' | 'police' | 'other' | '';
  symptomDuration: string;
  referralSource: string;
  knownAllergies: string;
};

export interface TriageDraft {
  version: 1;
  patientId: string;
  abcc: TriageDraftAbcc;
  vitals: TriageDraftVitals;
  context: TriageDraftContext;
  complaint: string;
  notes: string;
  presentationCategory: 'medical' | 'trauma' | 'obstetric' | 'mental_health' | 'other';
  redCriteria: string[];
  yellowCriteria: string[];
  capillaryRefillSeconds: string;
  pregnancyStatus: 'not_pregnant' | 'pregnant' | 'postpartum' | 'unknown' | 'not_applicable';
  gestationalAgeWeeks: string;
  injuryMechanism: string;
  infectionRiskSigns: string[];
  isolationRequired: boolean;
  preArrivalCare: string;
  immediateInterventions: string;
  disposition: TriageDisposition;
  destinationClinic: string;
  assignedProviderId: string;
  handoffNote: string;
  overrideVitalUrgency: boolean;
  vitalUrgencyOverrideReason: string;
  currentMedications: string;
  chronicConditions: string[];
  unmeasuredVitalReasons: Record<string, string>;
  manualPriorityRaise: 'RED' | 'YELLOW' | '';
  manualUpgradeReason: string;
  /** Bookkeeping so a restored draft doesn't lose which existing record it
   *  resolves against — recomputing this from scratch on restore would risk
   *  landing on a DIFFERENT pending/active triage than the one the nurse was
   *  actually completing when the draft was saved. */
  editingTriageId: string | null;
  resumePendingTriageId: string | null;
  encounterId: string | null;
}

function draftKey(patientId: string): string {
  return `${DRAFT_KEY_PREFIX}${patientId}`;
}

/**
 * Does this draft hold anything a nurse actually entered?
 *
 * The autosave loop runs against whatever the form currently shows — which,
 * right after a mount or a reset, is nothing. Persisting that empty state
 * silently overwrote a real draft, and because a stored draft short-circuits
 * the pending-placeholder lookup on the next load, one empty save could also
 * permanently suppress the walk-in prefill for that patient.
 */
export function triageDraftHasContent(draft: TriageDraft): boolean {
  return Boolean(
    draft.complaint.trim()
    || draft.notes.trim()
    || draft.abcc.airway || draft.abcc.breathing || draft.abcc.circulation || draft.abcc.consciousness
    || Object.values(draft.vitals).some(v => v.trim())
    || draft.redCriteria.length || draft.yellowCriteria.length || draft.infectionRiskSigns.length
    || draft.capillaryRefillSeconds.trim()
    || draft.injuryMechanism.trim()
    || draft.context.symptomDuration.trim() || draft.context.referralSource.trim()
    || draft.context.knownAllergies.trim() || draft.context.modeOfArrival
    || draft.currentMedications.trim() || draft.chronicConditions.length
    || Object.keys(draft.unmeasuredVitalReasons).length
    || draft.handoffNote.trim() || draft.manualUpgradeReason.trim()
    || draft.preArrivalCare.trim() || draft.immediateInterventions.trim(),
  );
}

export async function saveTriageDraft(patientId: string, draft: TriageDraft): Promise<void> {
  if (!patientId) return;
  // An empty form is not a draft — see triageDraftHasContent. Dropping any
  // stored draft here (rather than skipping) keeps "the nurse cleared the
  // form" and "the form just mounted empty" from resurrecting stale content.
  if (!triageDraftHasContent(draft)) return;
  await saveDraft(draftKey(patientId), draft, TRIAGE_DRAFT_TTL_MS);
}

export async function loadTriageDraft(patientId: string): Promise<TriageDraft | null> {
  if (!patientId) return null;
  const raw = await loadDraft<unknown>(draftKey(patientId));
  const draft = normalizeTriageDraft(raw, patientId);
  // A contentless draft (written by a pre-guard build, or a tampered blob
  // normalized down to nothing) must not shadow the pending-placeholder
  // lookup — treat it as no draft at all.
  return draft && triageDraftHasContent(draft) ? draft : null;
}

export async function dropTriageDraft(patientId: string): Promise<void> {
  if (!patientId) return;
  await dropDraft(draftKey(patientId));
}

// ── Untrusted-input normalization ───────────────────────────────────────────
// Decrypted browser storage is still attacker-/corruption-reachable (a
// tampered blob that still passes AES-GCM auth with an old key, a draft
// written by a future version of this form). Never trust its shape.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function bool(value: unknown): boolean {
  return value === true;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

export function normalizeTriageDraft(raw: unknown, expectedPatientId: string): TriageDraft | null {
  if (!isRecord(raw) || raw.version !== 1) return null;
  // A draft only ever restores into the patient it was captured for — a
  // key-namespace bug or a copy/paste of storage between tabs must never
  // apply one patient's in-progress assessment to another's record.
  if (str(raw.patientId) !== expectedPatientId) return null;

  const abccSrc = isRecord(raw.abcc) ? raw.abcc : {};
  const vitalsSrc = isRecord(raw.vitals) ? raw.vitals : {};
  const contextSrc = isRecord(raw.context) ? raw.context : {};

  const vitalField = (key: keyof TriageDraftVitals) => str(vitalsSrc[key]);

  return {
    version: 1,
    patientId: expectedPatientId,
    abcc: {
      airway: oneOf(abccSrc.airway, ['clear', 'obstructed', ''] as const, ''),
      breathing: oneOf(abccSrc.breathing, ['normal', 'distressed', 'absent', ''] as const, ''),
      circulation: oneOf(abccSrc.circulation, ['normal', 'impaired', 'absent', ''] as const, ''),
      consciousness: oneOf(abccSrc.consciousness, ['alert', 'verbal', 'pain', 'unresponsive', ''] as const, ''),
      priority: oneOf(abccSrc.priority, ['RED', 'YELLOW', 'GREEN', ''] as const, ''),
    },
    vitals: {
      temperature: vitalField('temperature'),
      pulse: vitalField('pulse'),
      respiratoryRate: vitalField('respiratoryRate'),
      systolic: vitalField('systolic'),
      diastolic: vitalField('diastolic'),
      oxygenSaturation: vitalField('oxygenSaturation'),
      weight: vitalField('weight'),
      height: vitalField('height'),
      painScore: vitalField('painScore'),
      bloodGlucose: vitalField('bloodGlucose'),
      gcs: vitalField('gcs'),
      muac: vitalField('muac'),
    },
    context: {
      modeOfArrival: oneOf(contextSrc.modeOfArrival, ['walk-in', 'ambulance', 'referral', 'police', 'other', ''] as const, ''),
      symptomDuration: str(contextSrc.symptomDuration),
      referralSource: str(contextSrc.referralSource),
      knownAllergies: str(contextSrc.knownAllergies),
    },
    complaint: str(raw.complaint),
    notes: str(raw.notes),
    presentationCategory: oneOf(raw.presentationCategory, ['medical', 'trauma', 'obstetric', 'mental_health', 'other'] as const, 'medical'),
    redCriteria: stringArray(raw.redCriteria),
    yellowCriteria: stringArray(raw.yellowCriteria),
    capillaryRefillSeconds: str(raw.capillaryRefillSeconds),
    pregnancyStatus: oneOf(raw.pregnancyStatus, ['not_pregnant', 'pregnant', 'postpartum', 'unknown', 'not_applicable'] as const, 'unknown'),
    gestationalAgeWeeks: str(raw.gestationalAgeWeeks),
    injuryMechanism: str(raw.injuryMechanism),
    infectionRiskSigns: stringArray(raw.infectionRiskSigns),
    isolationRequired: bool(raw.isolationRequired),
    preArrivalCare: str(raw.preArrivalCare),
    immediateInterventions: str(raw.immediateInterventions),
    disposition: oneOf(raw.disposition, ['emergency', 'general_clinic', 'specialty_clinic', 'home_care'] as const, 'general_clinic'),
    destinationClinic: str(raw.destinationClinic),
    assignedProviderId: str(raw.assignedProviderId),
    handoffNote: str(raw.handoffNote),
    overrideVitalUrgency: bool(raw.overrideVitalUrgency),
    vitalUrgencyOverrideReason: str(raw.vitalUrgencyOverrideReason),
    currentMedications: str(raw.currentMedications),
    chronicConditions: stringArray(raw.chronicConditions),
    unmeasuredVitalReasons: stringRecord(raw.unmeasuredVitalReasons),
    manualPriorityRaise: oneOf(raw.manualPriorityRaise, ['RED', 'YELLOW', ''] as const, ''),
    manualUpgradeReason: str(raw.manualUpgradeReason),
    editingTriageId: strOrNull(raw.editingTriageId),
    resumePendingTriageId: strOrNull(raw.resumePendingTriageId),
    encounterId: strOrNull(raw.encounterId),
  };
}
