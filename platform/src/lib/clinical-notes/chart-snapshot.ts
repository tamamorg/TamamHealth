/**
 * Snapshots of chart data for a note's derived sections.
 *
 * A note is a record of what the clinician saw at the time of the encounter, so
 * vitals, medications and allergies are captured as text at the moment they are
 * pulled in rather than rendered live. If the chart later changes, last month's
 * note must still say what it said — a note whose contents drift is not a
 * record, and re-reading it later would misrepresent what the decision was
 * based on.
 *
 * The formatters are pure and exported separately from the fetchers so they can
 * be unit-tested without a database.
 */

import type { AllergyEntry } from '../types/patient-clinical';
import type { PrescriptionDoc, ProblemDoc, MedicalRecordDoc, TriageDoc } from '../db-types';
import type { NoteSectionId } from './note-catalog';
import type { DataScope } from '../services/data-scope';
import { mergeVitalsTimeline } from '../clinical/vitals';

/** "38.1 °C · 150/90 · HR 92" — the line a clinician scans, not a table. */
export function formatVitals(record: Partial<Pick<MedicalRecordDoc, 'vitalSigns' | 'triageVitals'>> | null): string {
  if (!record) return '';
  const v = record.vitalSigns;
  const t = record.triageVitals;
  const parts: string[] = [];

  const temperature = v?.temperature ?? (t?.temperature ? Number(t.temperature) : undefined);
  const systolic = v?.systolic ?? (t?.systolic ? Number(t.systolic) : undefined);
  const diastolic = v?.diastolic ?? (t?.diastolic ? Number(t.diastolic) : undefined);
  const pulse = v?.pulse ?? (t?.pulse ? Number(t.pulse) : undefined);
  const resp = v?.respiratoryRate ?? (t?.respiratoryRate ? Number(t.respiratoryRate) : undefined);
  const spo2 = v?.oxygenSaturation ?? (t?.oxygenSaturation ? Number(t.oxygenSaturation) : undefined);
  const weight = v?.weight ?? (t?.weight ? Number(t.weight) : undefined);
  const height = v?.height ?? (t?.height ? Number(t.height) : undefined);
  const bmi = v?.bmi ?? (t?.bmi ? Number(t.bmi) : undefined);

  if (isNum(temperature)) parts.push(`Temp: ${temperature} °C`);
  if (isNum(systolic) && isNum(diastolic)) parts.push(`BP: ${systolic}/${diastolic} mmHg`);
  if (isNum(pulse)) parts.push(`HR: ${pulse} bpm`);
  if (isNum(resp)) parts.push(`RR: ${resp}/min`);
  if (isNum(spo2)) parts.push(`SpO₂: ${spo2}%`);
  if (isNum(weight)) parts.push(`Wt: ${weight} kg`);
  if (isNum(height)) parts.push(`Ht: ${height} cm`);
  if (isNum(bmi)) parts.push(`BMI: ${bmi}`);

  return parts.join('\n');
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v !== 0;
}

/** Active medications, one bullet per line, dose and frequency included —
 *  the same list shape as allergies and problems, so a note reads uniformly. */
export function formatMedications(prescriptions: PrescriptionDoc[]): string {
  const active = prescriptions.filter(p => p.status !== 'discontinued');
  if (active.length === 0) return '';
  return active
    .map((p) => {
      const bits = [p.medication, p.dose, p.route, p.frequency].filter(Boolean);
      const line = bits.join(' · ');
      return `• ${p.duration ? `${line} — ${p.duration}` : line}`;
    })
    .join('\n');
}

/**
 * Active allergies, one bullet per entry. Returns '' for an empty list — the
 * caller (`snapshotForSection`) is the one that decides whether an empty list
 * means "confirmed no known allergies" or "couldn't be determined"; this
 * formatter only renders what it was given.
 */
export function formatAllergies(allergies: AllergyEntry[]): string {
  const active = allergies.filter(a => a.status === 'active');
  if (active.length === 0) return '';
  return active
    .map((a) => {
      const bits = [a.substance];
      if (a.reaction) bits.push(a.reaction);
      if (a.criticality && a.criticality !== 'unknown') bits.push(`${a.criticality} criticality`);
      return `• ${bits.join(' — ')}`;
    })
    .join('\n');
}

export function formatProblems(problems: ProblemDoc[]): string {
  const active = problems.filter(p => p.status === 'active');
  if (active.length === 0) return '';
  return active
    .map(p => `• ${p.name}${p.icd11Code ? ` [${p.icd11Code}]` : ''}`)
    .join('\n');
}

export interface ChartSnapshotInput {
  vitalsRecord?: Partial<Pick<MedicalRecordDoc, 'vitalSigns' | 'triageVitals'>> | null;
  prescriptions?: PrescriptionDoc[];
  allergies?: AllergyEntry[];
  problems?: ProblemDoc[];
  /**
   * True when the allergy read itself threw (network/DB failure) rather than
   * genuinely returning zero rows. `safely()` maps both cases to `[]`, which
   * would otherwise make `snapshotForSection` write "No allergy history has
   * been documented for this patient." into the note on a failed read — a
   * fabricated negative clinical assertion indistinguishable from a real
   * reconciled empty list. Only `loadChartSnapshot` sets this; a caller
   * building `ChartSnapshotInput` by hand gets the pre-existing behaviour.
   */
  allergiesLoadFailed?: boolean;
}

/**
 * Text for one derived section. Returns an empty string when there is nothing
 * to show, so the caller can render its own "not documented" wording rather
 * than this module inventing a sentence for every section.
 */
export function snapshotForSection(
  sectionId: NoteSectionId,
  input: ChartSnapshotInput,
): string {
  switch (sectionId) {
    case 'vitals':
      return formatVitals(input.vitalsRecord ?? null);
    case 'medications':
      return formatMedications(input.prescriptions ?? []);
    case 'allergies': {
      const text = formatAllergies(input.allergies ?? []);
      if (text) return text;
      // A failed read is not evidence of "no known allergies" — asserting
      // that into a note would be a fabricated negative. Say nothing rather
      // than say something false; the caller's own "not documented" wording
      // (or a retry) takes it from here.
      if (input.allergiesLoadFailed) return '';
      return 'No allergy history has been documented for this patient.';
    }
    default:
      return '';
  }
}

/**
 * Fetch everything the derived sections need, in one pass.
 *
 * Each source is independently guarded: a chart with no problem list must still
 * produce vitals, and one failing read should not blank the whole note.
 *
 * `scope` is threaded into the tenant-boundary-sensitive reads (prescriptions,
 * vitals) the same way the chart itself scopes them — a note's derived
 * sections must not surface another facility's or org's data that the chart
 * would hide, especially once that text is frozen into a signed note.
 */
export async function loadChartSnapshot(patientId: string, scope?: DataScope): Promise<ChartSnapshotInput> {
  const [prescriptions, allergies, problems, vitalsRecord] = await Promise.all([
    safelyTagged(async () => {
      const { getPrescriptionsByPatient } = await import('../services/prescription-service');
      return getPrescriptionsByPatient(patientId, scope);
    }, [] as PrescriptionDoc[]),
    safelyTagged(async () => {
      const { getActiveAllergies } = await import('../services/allergy-service');
      return getActiveAllergies(patientId);
    }, [] as AllergyEntry[]),
    safelyTagged(async () => {
      const { getProblemsByPatient } = await import('../services/problem-service');
      return getProblemsByPatient(patientId);
    }, [] as ProblemDoc[]),
    newestVitals(patientId, scope),
  ]);

  return {
    prescriptions: prescriptions.value,
    allergies: allergies.value,
    problems: problems.value,
    vitalsRecord,
    allergiesLoadFailed: allergies.failed,
  };
}

/**
 * The patient's most recent vitals, from whichever source actually has them.
 *
 * TriageWorkflow writes vitals onto the TriageDoc itself, never onto a
 * medical_record's `triageVitals` — nothing in the app writes that field. A
 * note opened right after triage and before any consult record exists must
 * still pick up what triage just took, so this compares the newest
 * vitals-bearing medical record against the newest vitals-bearing triage stop
 * and returns whichever is more recent, rather than only ever looking at
 * medical records and showing stale (or no) vitals.
 */
async function newestVitals(
  patientId: string,
  scope?: DataScope,
): Promise<Partial<Pick<MedicalRecordDoc, 'vitalSigns' | 'triageVitals'>> | null> {
  const [records, triages] = await Promise.all([
    safely(async () => {
      const { getRecordsByPatient } = await import('../services/medical-record-service');
      return getRecordsByPatient(patientId, scope);
    }, [] as MedicalRecordDoc[]),
    safely(async () => {
      const { getTriageByPatient } = await import('../services/triage-service');
      return getTriageByPatient(patientId, scope);
    }, [] as TriageDoc[]),
  ]);

  // The shared merge picks the newest entry across both sources (record wins
  // a same-instant tie) — resolve it back to the original doc so the return
  // shape (and formatVitals(), which reads it) is unchanged.
  const winner = mergeVitalsTimeline(records, triages)[0];
  if (!winner) return null;

  if (winner.source === 'Triage') {
    const t = triages.find(row => row._id === winner.id);
    if (!t) return null;
    return {
      triageVitals: {
        temperature: t.temperature, systolic: t.systolic, diastolic: t.diastolic,
        pulse: t.pulse, respiratoryRate: t.respiratoryRate, oxygenSaturation: t.oxygenSaturation,
        weight: t.weight, height: t.height, bmi: t.bmi,
        muac: t.muac, bloodGlucose: t.bloodGlucose, capturedAt: t.triagedAt,
      },
    };
  }
  return records.find(row => row._id === winner.id) ?? null;
}

async function safely<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/**
 * Same shape as {@link safely}, but tags whether the fallback was returned
 * because the read genuinely failed — needed wherever an empty result and a
 * failed read must be told apart (see `allergiesLoadFailed` above).
 */
async function safelyTagged<T>(fn: () => Promise<T>, fallback: T): Promise<{ value: T; failed: boolean }> {
  try {
    return { value: await fn(), failed: false };
  } catch {
    return { value: fallback, failed: true };
  }
}
