/**
 * Structured allergy / adverse-reaction service (P0.3).
 *
 * Allergies live ON the patient document (`structuredAllergies`) rather than in
 * a separate database, so they ride the patient's existing sync + scoping and
 * are instantly available everywhere the patient is loaded (chart, consultation
 * prescribing screen, MAR, SBAR, referrals). The legacy `allergies: string[]`
 * field is kept as a denormalised mirror of the *active* substance names so the
 * many read sites that consume it keep working unchanged.
 *
 * Writes go through `mutatePatient` (optimistic-concurrency retry) so two
 * concurrent edits to the allergy list can't silently drop each other.
 */
import { v4 as uuidv4 } from 'uuid';
import type { AllergyEntry } from '../../data/mock';
import type { PatientDoc } from '../db-types';
import { getPatientById } from './patient-service';
import { isNoAllergySentinel } from '../clinical-roles';
import { mutatePatientListField } from './patient-list-field';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';

/** Active substance names, for the denormalised `Patient.allergies` mirror. */
function activeSubstanceNames(entries: AllergyEntry[]): string[] {
  return entries.filter((e) => e.status === 'active').map((e) => e.substance);
}

/** The structured entries for a patient, deriving from legacy text if needed. */
function entriesOf(patient: PatientDoc): AllergyEntry[] {
  if (patient.structuredAllergies !== undefined) return patient.structuredAllergies;
  return legacyToStructured(patient);
}

function legacyToStructured(patient: { allergies?: string[] }): AllergyEntry[] {
  const legacy = (patient.allergies || []).filter((a) => !isNoAllergySentinel(a));
  const now = new Date().toISOString();
  return legacy.map((substance) => ({
    id: uuidv4(),
    substance,
    classification: undefined,
    criticality: 'unknown' as const,
    status: 'active' as const,
    recordedAt: now,
  }));
}

/**
 * One-time migration of a patient's legacy free-text `allergies: string[]` into
 * structured entries. Idempotent: only runs when `structuredAllergies` is unset.
 */
export function migrateLegacyAllergies(patient: PatientDoc): AllergyEntry[] | null {
  if (patient.structuredAllergies !== undefined) return null;
  return legacyToStructured(patient);
}

/** All structured allergy entries for a patient (active + inactive). */
export async function getAllergies(patientId: string): Promise<AllergyEntry[]> {
  const patient = await getPatientById(patientId);
  if (!patient) return [];
  return entriesOf(patient);
}

/**
 * Active allergies only — the clinically relevant set for decision support.
 *
 * `scope`, when passed, is checked against the OWNING PATIENT record rather
 * than the individual entries: unlike `PrescriptionDoc`/`ProblemDoc`, an
 * `AllergyEntry` carries no `hospitalId`/`orgId` of its own (it lives embedded
 * in `PatientDoc.structuredAllergies`), so `filterByScope` cannot be applied to
 * the entries directly — every entry would fail the org check and the list
 * would come back empty. Scoping the patient instead matches this data's real
 * boundary: a patient out of scope returns no allergies rather than resolving
 * PHI for another org/facility's patient.
 */
export async function getActiveAllergies(patientId: string, scope?: DataScope): Promise<AllergyEntry[]> {
  const patient = await getPatientById(patientId);
  if (!patient) return [];
  if (scope && filterByScope([patient], scope).length === 0) return [];
  return entriesOf(patient).filter((e) => e.status === 'active');
}

function patchFor(entries: AllergyEntry[]): Partial<PatientDoc> {
  return { structuredAllergies: entries, allergies: activeSubstanceNames(entries) } as Partial<PatientDoc>;
}

export interface AddAllergyInput {
  substance: string;
  classification?: AllergyEntry['classification'];
  criticality?: AllergyEntry['criticality'];
  reaction?: string;
  onsetDate?: string;
  recordedBy?: string;
  recordedByName?: string;
}

/** Record a new allergy. Returns the full updated list, or null if no patient. */
export async function addAllergy(patientId: string, input: AddAllergyInput): Promise<AllergyEntry[] | null> {
  if (!input.substance || input.substance.trim().length === 0) {
    throw new Error('Allergy substance is required');
  }
  const substance = input.substance.trim();
  const now = new Date().toISOString();
  return mutatePatientListField<AllergyEntry>(
    patientId,
    (patient) => {
      const existing = entriesOf(patient);
      const dupe = existing.find((e) => e.substance.trim().toLowerCase() === substance.toLowerCase());
      let next: AllergyEntry[];
      if (dupe) {
        next = existing.map((e) =>
          e.id === dupe.id
            ? { ...e, ...input, substance, status: 'active', removalReason: undefined, recordedAt: now }
            : e,
        );
      } else {
        next = [
          ...existing,
          {
            id: uuidv4(),
            substance,
            classification: input.classification,
            criticality: input.criticality ?? 'unknown',
            reaction: input.reaction,
            onsetDate: input.onsetDate,
            status: 'active',
            recordedBy: input.recordedBy,
            recordedByName: input.recordedByName,
            recordedAt: now,
          },
        ];
      }
      return { patch: patchFor(next), entries: next };
    },
    { action: 'ADD_ALLERGY', by: input.recordedBy, byName: input.recordedByName, detail: `Allergy "${substance}" (${input.criticality ?? 'unknown'}) for patient ${patientId}` },
  );
}

/** Edit fields of an existing allergy in place. */
export async function updateAllergy(
  patientId: string,
  allergyId: string,
  patch: Partial<Omit<AllergyEntry, 'id'>>,
): Promise<AllergyEntry[] | null> {
  return mutatePatientListField<AllergyEntry>(
    patientId,
    (patient) => {
      const existing = entriesOf(patient);
      if (!existing.some((e) => e.id === allergyId)) return null;
      const next = existing.map((e) => (e.id === allergyId ? { ...e, ...patch, id: e.id } : e));
      return { patch: patchFor(next), entries: next };
    },
    { action: 'UPDATE_ALLERGY', detail: `Allergy ${allergyId} updated for patient ${patientId}` },
  );
}

/**
 * Remove (deactivate) an allergy. A removal reason is required so the clinical
 * audit trail is preserved — entries are never hard-deleted.
 */
export async function removeAllergy(
  patientId: string,
  allergyId: string,
  removalReason: string,
  status: 'inactive' | 'resolved' | 'entered_in_error' = 'inactive',
): Promise<AllergyEntry[] | null> {
  if (!removalReason || removalReason.trim().length === 0) {
    throw new Error('A removal reason is required');
  }
  return mutatePatientListField<AllergyEntry>(
    patientId,
    (patient) => {
      const existing = entriesOf(patient);
      if (!existing.some((e) => e.id === allergyId)) return null;
      const next = existing.map((e) => (e.id === allergyId ? { ...e, status, removalReason: removalReason.trim() } : e));
      return { patch: patchFor(next), entries: next };
    },
    { action: 'REMOVE_ALLERGY', detail: `Allergy ${allergyId} ${status} (${removalReason.trim()}) for patient ${patientId}` },
  );
}
