/**
 * Shared vital-signs ranges, validation and abnormal-flagging.
 *
 * Consolidates the thresholds that were previously duplicated between
 * `components/nurse/shared.tsx` (getVitalFlags) and the inline range table in
 * TriageWorkflow's submit guard. One source of truth for "what counts as
 * abnormal / out-of-range".
 *
 * Also carries `mergeVitalsTimeline` — the merge/normalize logic for a
 * patient's vitals history across the two places they get captured
 * (MedicalRecordDoc.vitalSigns and TriageDoc's own vitals fields). Pure and
 * DB-free so both `chart-snapshot.ts` (picks the single newest entry for a
 * note) and the patient chart (needs the whole history for the vitals band/
 * table/trends) share one implementation instead of drifting.
 */

import type { MedicalRecordDoc, TriageDoc } from '../db-types';

/** Free-text (string) vitals as captured by the nurse/triage forms. */
export interface VitalsInput {
  systolic?: string;
  diastolic?: string;
  temperature?: string;
  pulse?: string;
  spo2?: string;
  weight?: string;
  height?: string;
  respiratoryRate?: string;
  /** Pain score, 0–10 numeric rating scale. */
  painScore?: string;
  /** Capillary blood glucose, mmol/L. */
  bloodGlucose?: string;
  /** Glasgow Coma Scale, 3–15. */
  gcs?: string;
  /** Mid-upper arm circumference, cm (nutrition screening). */
  muac?: string;
  notes?: string;
}

/**
 * Physiologically plausible [min, max] bounds, used to reject garbage input
 * ("abc", "999") before persisting. Keys match VitalsInput numeric fields.
 */
export const VITAL_RANGES: Record<'temperature' | 'pulse' | 'respiratoryRate' | 'systolic' | 'diastolic' | 'spo2' | 'weight' | 'height' | 'painScore' | 'bloodGlucose' | 'gcs' | 'muac', [number, number]> = {
  temperature: [25, 45],
  pulse: [20, 250],
  respiratoryRate: [4, 80],
  systolic: [40, 300],
  diastolic: [20, 200],
  spo2: [30, 100],
  weight: [0.5, 400],
  height: [30, 250],
  painScore: [0, 10],
  bloodGlucose: [1, 40],
  gcs: [3, 15],
  muac: [5, 50],
};

export type TriageVitalField =
  | 'temperature'
  | 'pulse'
  | 'respiratoryRate'
  | 'oxygenSaturation'
  | 'systolic'
  | 'diastolic'
  | 'weight'
  | 'height'
  | 'painScore'
  | 'bloodGlucose'
  | 'gcs'
  | 'muac';

export type TriageVitalsInput = Partial<Record<TriageVitalField, string | number>>;

const TRIAGE_RANGE_FIELD: Record<TriageVitalField, keyof typeof VITAL_RANGES> = {
  temperature: 'temperature',
  pulse: 'pulse',
  respiratoryRate: 'respiratoryRate',
  oxygenSaturation: 'spo2',
  systolic: 'systolic',
  diastolic: 'diastolic',
  weight: 'weight',
  height: 'height',
  painScore: 'painScore',
  bloodGlucose: 'bloodGlucose',
  gcs: 'gcs',
  muac: 'muac',
};

const TRIAGE_VITAL_LABEL: Record<TriageVitalField, string> = {
  temperature: 'Temperature',
  pulse: 'Pulse',
  respiratoryRate: 'Respiratory rate',
  oxygenSaturation: 'Oxygen saturation',
  systolic: 'Systolic blood pressure',
  diastolic: 'Diastolic blood pressure',
  weight: 'Weight',
  height: 'Height',
  painScore: 'Pain score',
  bloodGlucose: 'Blood glucose',
  gcs: 'GCS',
  muac: 'MUAC',
};

const TRIAGE_VITAL_UNIT: Record<TriageVitalField, string> = {
  temperature: '°C',
  pulse: 'bpm',
  respiratoryRate: 'breaths/min',
  oxygenSaturation: '%',
  systolic: 'mmHg',
  diastolic: 'mmHg',
  weight: 'kg',
  height: 'cm',
  painScore: '',
  bloodGlucose: 'mmol/L',
  gcs: '',
  muac: 'cm',
};

const INTEGER_TRIAGE_VITALS = new Set<TriageVitalField>([
  'pulse', 'respiratoryRate', 'oxygenSaturation', 'systolic', 'diastolic',
  'painScore', 'gcs',
]);

/**
 * Parse a complete decimal string. Unlike parseFloat, this rejects partial
 * values such as `80abc`, exponent notation, Infinity, and punctuation-only
 * input instead of silently accepting the numeric prefix.
 */
export function parseStrictVitalNumber(raw?: string | number): number | null {
  const value = raw === undefined || raw === null ? '' : String(raw).trim();
  if (!value || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** BMI is derived, never typed independently, so the stored value cannot
 * disagree with the height/weight captured at the same triage stop. */
export function calculateBmi(weightRaw?: string | number, heightRaw?: string | number): string | null {
  const weight = parseStrictVitalNumber(weightRaw);
  const heightCm = parseStrictVitalNumber(heightRaw);
  if (weight === null || heightCm === null) return null;
  const [minWeight, maxWeight] = VITAL_RANGES.weight;
  const [minHeight, maxHeight] = VITAL_RANGES.height;
  if (weight < minWeight || weight > maxWeight || heightCm < minHeight || heightCm > maxHeight) return null;
  return (weight / ((heightCm / 100) ** 2)).toFixed(1);
}

/** Field-level blocking errors for the nurse triage form. Empty fields remain optional. */
export function validateTriageVitals(vitals: TriageVitalsInput): Partial<Record<TriageVitalField, string>> {
  const errors: Partial<Record<TriageVitalField, string>> = {};

  for (const field of Object.keys(TRIAGE_RANGE_FIELD) as TriageVitalField[]) {
    const supplied = vitals[field];
    const raw = supplied === undefined || supplied === null ? '' : String(supplied).trim();
    if (!raw) continue;
    const value = parseStrictVitalNumber(raw);
    const [min, max] = VITAL_RANGES[TRIAGE_RANGE_FIELD[field]];
    const unit = TRIAGE_VITAL_UNIT[field];

    if (value === null) {
      errors[field] = `${TRIAGE_VITAL_LABEL[field]} must be a number.`;
    } else if (INTEGER_TRIAGE_VITALS.has(field) && !Number.isInteger(value)) {
      errors[field] = `${TRIAGE_VITAL_LABEL[field]} must be a whole number.`;
    } else if (value < min || value > max) {
      errors[field] = `${TRIAGE_VITAL_LABEL[field]} must be between ${min} and ${max}${unit ? ` ${unit}` : ''}.`;
    }
  }

  const systolic = parseStrictVitalNumber(vitals.systolic);
  const diastolic = parseStrictVitalNumber(vitals.diastolic);
  if (!errors.systolic && !errors.diastolic && systolic !== null && diastolic !== null && systolic <= diastolic) {
    errors.systolic = 'Systolic blood pressure must be higher than diastolic blood pressure.';
    errors.diastolic = 'Diastolic blood pressure must be lower than systolic blood pressure.';
  }

  return errors;
}

export interface TriageVitalWarning {
  field: TriageVitalField;
  code: string;
  urgency: 'RED' | 'YELLOW';
  message: string;
}

function warning(
  field: TriageVitalField,
  code: string,
  urgency: TriageVitalWarning['urgency'],
  message: string,
): TriageVitalWarning {
  return { field, code, urgency, message };
}

/**
 * Identify dangerous but physiologically possible readings.
 *
 * Thresholds follow the WHO/ICRC/MSF Interagency Integrated Triage Tool
 * (IITT): age-specific high-risk vital signs require up-triage/immediate
 * review, while explicit RED criteria (for example adult HR <50 or >150 and
 * known hypoglycaemia) require immediate high-acuity care. MUAC follows WHO's
 * <11.5 cm severe acute malnutrition threshold for children 6–59 months.
 * NEWS2 supplies the adult low-systolic boundary and AHA/ACC guidance supplies
 * the severe-hypertension boundary because IITT does not define a general,
 * non-pregnancy numeric BP boundary.
 *
 * `isPregnant` exists because IITT's one numeric BP rule is a pregnancy rule,
 * and it is a RED one: "PREGNANT WITH ANY OF … SBP ≥160 or DBP ≥110" sends the
 * patient to the resuscitation area immediately. Without it a woman at 165/112
 * — severe pre-eclampsia, and a leading cause of maternal death — cleared both
 * general boundaries (>180 and >120) and this function returned nothing at
 * all. Pregnancy status comes from the same active-ANC signal the chart header
 * draws its pregnancy pill from.
 */
export function getTriageVitalWarnings(
  vitals: TriageVitalsInput,
  patientAgeYears?: number,
  options: { isPregnant?: boolean } = {},
): TriageVitalWarning[] {
  const blockingErrors = validateTriageVitals(vitals);
  const value = (field: TriageVitalField) => blockingErrors[field]
    ? null
    : parseStrictVitalNumber(vitals[field]);
  const temperature = value('temperature');
  const pulse = value('pulse');
  const rr = value('respiratoryRate');
  const spo2 = value('oxygenSaturation');
  const systolic = value('systolic');
  const diastolic = value('diastolic');
  const pain = value('painScore');
  const glucose = value('bloodGlucose');
  const gcs = value('gcs');
  const muac = value('muac');
  const warnings: TriageVitalWarning[] = [];
  const isChild = patientAgeYears !== undefined && patientAgeYears < 12;
  const isAdult = patientAgeYears === undefined || patientAgeYears >= 18;

  if (temperature !== null && (temperature < 36 || temperature > 39)) {
    const neonatalEmergency = patientAgeYears !== undefined && patientAgeYears < (2 / 12);
    warnings.push(warning(
      'temperature',
      neonatalEmergency ? 'IITT_NEONATE_TEMPERATURE_RED' : 'IITT_HIGH_RISK_TEMPERATURE',
      neonatalEmergency ? 'RED' : 'YELLOW',
      neonatalEmergency
        ? `Temperature ${temperature}°C meets RED criteria for an infant under 2 months; move to high-acuity care immediately.`
        : `Temperature ${temperature}°C is high risk; up-triage for immediate clinician review.`,
    ));
  }

  if (spo2 !== null && spo2 < 92) {
    warnings.push(warning(
      'oxygenSaturation',
      'IITT_HIGH_RISK_SPO2',
      'YELLOW',
      `Oxygen saturation ${spo2}% is high risk; up-triage for immediate clinician review.`,
    ));
  }

  if (pulse !== null) {
    if (!isChild && (pulse < 50 || pulse > 150)) {
      warnings.push(warning('pulse', 'IITT_ADULT_PULSE_RED', 'RED', `Pulse ${pulse} bpm meets RED criteria; move to high-acuity care immediately.`));
    } else if (!isChild && (pulse < 60 || pulse > 130)) {
      warnings.push(warning('pulse', 'IITT_ADULT_HIGH_RISK_PULSE', 'YELLOW', `Pulse ${pulse} bpm is high risk; up-triage for immediate clinician review.`));
    } else if (isChild) {
      const [low, high] = patientAgeYears! < 1 ? [90, 180] : patientAgeYears! < 5 ? [80, 160] : [70, 140];
      if (pulse < low || pulse > high) {
        warnings.push(warning('pulse', 'IITT_CHILD_HIGH_RISK_PULSE', 'YELLOW', `Pulse ${pulse} bpm is high risk for this child's age; up-triage for immediate clinician review.`));
      }
    }
  }

  if (rr !== null) {
    if (!isChild && (rr < 10 || rr > 30)) {
      warnings.push(warning('respiratoryRate', 'IITT_ADULT_HIGH_RISK_RR', 'YELLOW', `Respiratory rate ${rr}/min is high risk; up-triage for immediate clinician review.`));
    } else if (isChild) {
      const [low, high] = patientAgeYears! < 1 ? [25, 50] : patientAgeYears! < 5 ? [20, 40] : [10, 30];
      if (rr < low || rr > high) {
        warnings.push(warning('respiratoryRate', 'IITT_CHILD_HIGH_RISK_RR', 'YELLOW', `Respiratory rate ${rr}/min is high risk for this child's age; up-triage for immediate clinician review.`));
      }
    }
  }

  // Pregnancy first: its boundary is both lower and more urgent than the
  // general one, so checking the general rule first would let 165/112 through.
  const pregnancyHypertension = options.isPregnant
    && ((systolic !== null && systolic >= 160) || (diastolic !== null && diastolic >= 110));
  if (pregnancyHypertension) {
    const reading = [systolic, diastolic].every(v => v !== null)
      ? `${systolic}/${diastolic} mmHg`
      : `${systolic !== null ? `systolic ${systolic}` : `diastolic ${diastolic}`} mmHg`;
    warnings.push(warning(
      systolic !== null && systolic >= 160 ? 'systolic' : 'diastolic',
      'IITT_PREGNANCY_HYPERTENSION_RED',
      'RED',
      `Blood pressure ${reading} in pregnancy meets RED criteria (SBP ≥160 or DBP ≥110); move to high-acuity care immediately and assess for pre-eclampsia.`,
    ));
  }
  if (!pregnancyHypertension && isAdult && systolic !== null && (systolic <= 90 || systolic > 180)) {
    warnings.push(warning('systolic', 'ADULT_HIGH_RISK_SYSTOLIC_BP', 'YELLOW', `Systolic blood pressure ${systolic} mmHg requires immediate clinician review and repeat measurement.`));
  }
  if (!pregnancyHypertension && isAdult && diastolic !== null && (diastolic <= 40 || diastolic > 120)) {
    warnings.push(warning('diastolic', 'ADULT_HIGH_RISK_DIASTOLIC_BP', 'YELLOW', `Diastolic blood pressure ${diastolic} mmHg requires immediate clinician review and repeat measurement.`));
  }

  if (pain !== null && pain >= 7) {
    warnings.push(warning('painScore', 'IITT_SEVERE_PAIN', 'YELLOW', `Pain score ${pain}/10 is severe; up-triage for prompt assessment and analgesia.`));
  }
  if (glucose !== null && glucose < 3) {
    warnings.push(warning('bloodGlucose', 'IITT_HYPOGLYCAEMIA_RED', 'RED', `Blood glucose ${glucose} mmol/L meets RED hypoglycaemia criteria; treat and move to high-acuity care immediately.`));
  } else if (glucose !== null && glucose >= 25) {
    warnings.push(warning('bloodGlucose', 'HIGH_RISK_HYPERGLYCAEMIA', 'YELLOW', `Blood glucose ${glucose} mmol/L is critically high; arrange immediate clinician review.`));
  }
  if (gcs !== null && gcs <= 8) {
    warnings.push(warning('gcs', 'SEVERE_IMPAIRED_CONSCIOUSNESS_RED', 'RED', `GCS ${gcs}/15 indicates severe impaired consciousness; move to high-acuity care immediately.`));
  } else if (gcs !== null && gcs < 15) {
    warnings.push(warning('gcs', 'ALTERED_CONSCIOUSNESS_HIGH_RISK', 'YELLOW', `GCS ${gcs}/15 indicates altered consciousness; up-triage for immediate clinician review.`));
  }
  if (muac !== null && patientAgeYears !== undefined && patientAgeYears >= 0.5 && patientAgeYears < 5 && muac < 11.5) {
    warnings.push(warning('muac', 'WHO_SEVERE_ACUTE_MALNUTRITION', 'YELLOW', `MUAC ${muac} cm indicates severe acute malnutrition for age 6–59 months; refer for full assessment.`));
  }

  return warnings;
}

const PRIORITY_RANK = { GREEN: 0, YELLOW: 1, RED: 2 } as const;

/** Highest urgency from the ABCC assessment and all valid vital warnings. */
export function recommendTriagePriority(
  assessedPriority: 'RED' | 'YELLOW' | 'GREEN' | '',
  warnings: TriageVitalWarning[],
): 'RED' | 'YELLOW' | 'GREEN' | '' {
  if (!assessedPriority) return '';
  return warnings.reduce<'RED' | 'YELLOW' | 'GREEN'>((current, item) =>
    PRIORITY_RANK[item.urgency] > PRIORITY_RANK[current] ? item.urgency : current,
  assessedPriority);
}

export function isLowerTriagePriority(
  priority: 'RED' | 'YELLOW' | 'GREEN' | '',
  recommendation: 'RED' | 'YELLOW' | 'GREEN' | '',
): boolean {
  if (!priority || !recommendation) return false;
  return PRIORITY_RANK[priority] < PRIORITY_RANK[recommendation];
}

/**
 * Flag which vitals are abnormal (outside normal clinical range). Returns a
 * map of fieldName → true for each abnormal value. Mirrors the long-standing
 * thresholds used on the ward board.
 */
export function getVitalFlags(data: VitalsInput): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  const temp = parseFloat(data.temperature ?? '');
  const sys = parseInt(data.systolic ?? '');
  const dia = parseInt(data.diastolic ?? '');
  const spo2 = parseInt(data.spo2 ?? '');
  const pulse = parseInt(data.pulse ?? '');
  const rr = parseInt(data.respiratoryRate ?? '');
  const pain = parseInt(data.painScore ?? '');
  const glucose = parseFloat(data.bloodGlucose ?? '');
  const gcs = parseInt(data.gcs ?? '');
  const muac = parseFloat(data.muac ?? '');

  if (!isNaN(temp) && temp > 38.5) flags.temperature = true;
  if (!isNaN(sys) && (sys > 140 || sys < 90)) flags.systolic = true;
  if (!isNaN(dia) && (dia > 90 || dia < 60)) flags.diastolic = true;
  if (!isNaN(spo2) && spo2 < 95) flags.spo2 = true;
  if (!isNaN(pulse) && (pulse > 100 || pulse < 50)) flags.pulse = true;
  if (!isNaN(rr) && (rr > 24 || rr < 12)) flags.respiratoryRate = true;
  if (!isNaN(pain) && pain >= 7) flags.painScore = true;
  if (!isNaN(glucose) && (glucose < 3.9 || glucose > 11.1)) flags.bloodGlucose = true;
  if (!isNaN(gcs) && gcs < 15) flags.gcs = true;
  if (!isNaN(muac) && muac < 12.5) flags.muac = true; // < 12.5cm = acute malnutrition

  return flags;
}

/**
 * Validate a single entered vital is numeric and within plausible bounds.
 * Returns true when empty (optional) or valid; false for garbage/out-of-range.
 */
export function isVitalInRange(field: keyof typeof VITAL_RANGES, raw?: string): boolean {
  if (!raw?.trim()) return true;
  const n = parseStrictVitalNumber(raw);
  const [min, max] = VITAL_RANGES[field];
  return n !== null && n >= min && n <= max;
}

/**
 * One row in a patient's merged vitals timeline — either a MedicalRecordDoc
 * observation (a consultation's vitals, or a standalone nursing check) or a
 * TriageDoc's captured vitals, normalized to the same numeric shape and
 * tagged with where it came from so the UI can label it.
 */
export interface VitalsTimelineEntry {
  /** The source document's `_id` — stable React key and deep-link target. */
  id: string;
  /** ISO-ish timestamp used to sort and to display "when". */
  at: string;
  source: 'Triage' | 'Consult' | 'Nursing';
  temperature?: number;
  systolic?: number;
  diastolic?: number;
  pulse?: number;
  respiratoryRate?: number;
  oxygenSaturation?: number;
  weight?: number;
  height?: number;
  bmi?: number;
  muac?: number;
  bloodGlucose?: number;
  facility?: string;
  /** True when this observation is an appended correction of an earlier row. */
  corrected?: boolean;
  correctionReason?: string;
}

/** Parses to a finite number, or `undefined` for empty/garbage input — never
 *  `0`, which the rest of the app treats as a real (if implausible) reading
 *  rather than "not taken". */
function numOrUndef(raw?: string | number): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = typeof raw === 'number' ? raw : parseFloat(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** True once at least one measurement is present — filters out a record or
 *  triage stop that carries the vitals *shape* but no actual observation. */
function hasAnyVital(e: Pick<VitalsTimelineEntry,
  'temperature' | 'systolic' | 'diastolic' | 'pulse' | 'respiratoryRate' | 'oxygenSaturation' | 'weight' | 'height' | 'bmi' | 'muac' | 'bloodGlucose'
>): boolean {
  return [e.temperature, e.systolic, e.diastolic, e.pulse, e.respiratoryRate, e.oxygenSaturation, e.weight, e.height, e.bmi, e.muac, e.bloodGlucose]
    .some(v => v !== undefined);
}

/**
 * Merge a patient's medical-record vitals and triage vitals into one
 * normalized, newest-first timeline.
 *
 * `MedicalRecordDoc.vitalSigns` is already numeric; `TriageDoc`'s vitals
 * fields are free-text strings captured at triage and are parsed here.
 * Ties (same timestamp) keep record-sourced entries ahead of triage-sourced
 * ones, matching the long-standing tie-break in `chart-snapshot.ts`'s note
 * vitals lookup: a real record wins over a triage stop from the same moment.
 */
export function mergeVitalsTimeline(records: MedicalRecordDoc[], triages: TriageDoc[] = []): VitalsTimelineEntry[] {
  const supersededRecordIds = new Set(
    records.map(r => r.correctsRecordId).filter((id): id is string => Boolean(id)),
  );
  const fromRecords: VitalsTimelineEntry[] = records
    .filter(r => r.vitalSigns && !supersededRecordIds.has(r._id))
    .map((r): VitalsTimelineEntry => {
      const v = r.vitalSigns;
      return {
        id: r._id,
        at: r.consultedAt || r.visitDate || r.createdAt || '',
        source: r.recordKind === 'nursing_vitals' ? 'Nursing' : 'Consult',
        temperature: numOrUndef(v.temperature),
        systolic: numOrUndef(v.systolic),
        diastolic: numOrUndef(v.diastolic),
        pulse: numOrUndef(v.pulse),
        respiratoryRate: numOrUndef(v.respiratoryRate),
        oxygenSaturation: numOrUndef(v.oxygenSaturation),
        weight: numOrUndef(v.weight),
        height: numOrUndef(v.height),
        bmi: numOrUndef(v.bmi),
        muac: numOrUndef(v.muac),
        bloodGlucose: numOrUndef(v.bloodGlucose),
        facility: r.hospitalName,
        corrected: Boolean(r.correctsRecordId),
        correctionReason: r.correctionReason,
      };
    })
    .filter(hasAnyVital);

  const fromTriage: VitalsTimelineEntry[] = triages
    .map((t): VitalsTimelineEntry => ({
      id: t._id,
      at: t.triagedAt || t.createdAt || '',
      source: 'Triage',
      temperature: numOrUndef(t.temperature),
      systolic: numOrUndef(t.systolic),
      diastolic: numOrUndef(t.diastolic),
      pulse: numOrUndef(t.pulse),
      respiratoryRate: numOrUndef(t.respiratoryRate),
      oxygenSaturation: numOrUndef(t.oxygenSaturation),
      weight: numOrUndef(t.weight),
      height: numOrUndef(t.height),
      bmi: numOrUndef(t.bmi),
      muac: numOrUndef(t.muac),
      bloodGlucose: numOrUndef(t.bloodGlucose),
      facility: t.facilityName,
    }))
    // Same completeness test the record side uses — filtering on a hand-listed
    // subset dropped triage stops whose ONLY observation was MUAC (nutrition
    // screening) or blood glucose.
    .filter(hasAnyVital);

  // Array#sort is stable (guaranteed since ES2019), so entries with an equal
  // `at` keep their relative order — records were concatenated first, so a
  // same-instant tie resolves to the record, not the triage stop.
  return [...fromRecords, ...fromTriage].sort((a, b) => (b.at || '').localeCompare(a.at || ''));
}
