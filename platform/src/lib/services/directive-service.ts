/**
 * Patient directives / consent service (P2.1).
 *
 * Like allergies, directives live ON the patient document so they ride the
 * patient's existing sync + scoping. Entries are deactivated (with a reason)
 * rather than hard-deleted, so the consent/authorization history is preserved.
 * Writes go through `mutatePatient` (optimistic-concurrency retry).
 */
import { v4 as uuidv4 } from 'uuid';
import type { DirectiveEntry, DirectiveType } from '../../data/mock';
import type { DirectiveSignature } from '../types/patient-clinical';
import type { PatientDoc } from '../db-types';
import { getPatientById } from './patient-service';
import type { DataScope } from './data-scope';
import { mutatePatientListField } from './patient-list-field';
import { todayIso } from '@/lib/date-utils';

/** All directive entries for a patient (active + inactive). */
export async function getDirectives(patientId: string, scope: DataScope): Promise<DirectiveEntry[]> {
  const patient = await getPatientById(patientId, scope);
  return patient?.directives ?? [];
}

/** Active directives only. */
export async function getActiveDirectives(patientId: string, scope: DataScope): Promise<DirectiveEntry[]> {
  return (await getDirectives(patientId, scope)).filter((d) => d.status === 'active');
}

export interface AddDirectiveInput {
  type: DirectiveType;
  description: string;
  startDate?: string;
  recordedBy?: string;
  recordedByName?: string;
}

/** Record a new directive. Returns the full updated list, or null if no patient. */
export async function addDirective(patientId: string, scope: DataScope, input: AddDirectiveInput): Promise<DirectiveEntry[] | null> {
  if (!input.description || input.description.trim().length === 0) {
    throw new Error('Enter a description of the directive.');
  }
  const entry: DirectiveEntry = {
    id: uuidv4(),
    type: input.type,
    description: input.description.trim(),
    startDate: input.startDate || todayIso(),
    status: 'active',
    recordedBy: input.recordedBy,
    recordedByName: input.recordedByName,
    recordedAt: new Date().toISOString(),
  };
  return mutatePatientListField<DirectiveEntry>(
    patientId,
    scope,
    (patient) => {
      const next = [...(patient.directives ?? []), entry];
      return { patch: { directives: next } as Partial<PatientDoc>, entries: next };
    },
    { action: 'ADD_DIRECTIVE', by: input.recordedBy, byName: input.recordedByName, detail: `Directive "${input.type}" added for patient ${patientId}` },
  );
}

/** Edit fields of an existing directive in place. */
export async function updateDirective(
  patientId: string,
  scope: DataScope,
  directiveId: string,
  patch: Partial<Omit<DirectiveEntry, 'id'>>,
): Promise<DirectiveEntry[] | null> {
  return mutatePatientListField<DirectiveEntry>(
    patientId,
    scope,
    (patient) => {
      const existing = patient.directives ?? [];
      if (!existing.some((d) => d.id === directiveId)) return null;
      const next = existing.map((d) => (d.id === directiveId ? { ...d, ...patch, id: d.id } : d));
      return { patch: { directives: next } as Partial<PatientDoc>, entries: next };
    },
    { action: 'UPDATE_DIRECTIVE', detail: `Directive ${directiveId} updated for patient ${patientId}` },
  );
}

export interface SignDirectiveInput {
  /** Name as signed. */
  name: string;
  signedBy: DirectiveSignature['signedBy'];
  /** Relationship to the patient — required unless the patient signed. */
  relationship?: string;
  /** The staff member taking the signature, from the signed-in user. */
  witnessId?: string;
  witnessName?: string;
}

/**
 * Attest a consent or directive.
 *
 * A signature is written once and never edited afterwards: correcting an
 * attestation in place would let the record claim someone agreed to something
 * they did not. A wrong signature is revoked (`removeDirective`) and the
 * consent taken again, which is what leaves a legible trail.
 */
export async function signDirective(
  patientId: string,
  scope: DataScope,
  directiveId: string,
  input: SignDirectiveInput,
): Promise<DirectiveEntry[] | null> {
  const name = input.name?.trim();
  if (!name) throw new Error('Enter the name of the person signing.');
  if (input.signedBy !== 'patient' && !input.relationship?.trim()) {
    throw new Error('Enter the signer\'s relationship to the patient.');
  }
  const signature: DirectiveSignature = {
    name,
    signedBy: input.signedBy,
    relationship: input.signedBy === 'patient' ? undefined : input.relationship?.trim(),
    signedAt: new Date().toISOString(),
    witnessId: input.witnessId,
    witnessName: input.witnessName,
  };
  return mutatePatientListField<DirectiveEntry>(
    patientId,
    scope,
    (patient) => {
      const existing = patient.directives ?? [];
      const target = existing.find((d) => d.id === directiveId);
      if (!target) return null;
      // Signing twice would silently overwrite the first attestation and its
      // timestamp, so the second attempt is refused rather than applied.
      if (target.signature) throw new Error('This directive has already been signed.');
      const next = existing.map((d) => (d.id === directiveId ? { ...d, signature } : d));
      return { patch: { directives: next } as Partial<PatientDoc>, entries: next };
    },
    {
      action: 'SIGN_DIRECTIVE',
      by: input.witnessId,
      byName: input.witnessName,
      detail: `Directive ${directiveId} signed by ${signature.signedBy} (${name}) for patient ${patientId}`,
    },
  );
}

/**
 * Remove (deactivate / revoke) a directive. A reason is required; the entry is
 * retained for the audit trail rather than hard-deleted.
 */
export async function removeDirective(
  patientId: string,
  scope: DataScope,
  directiveId: string,
  removalReason: string,
  status: 'inactive' | 'expired' | 'revoked' = 'revoked',
): Promise<DirectiveEntry[] | null> {
  if (!removalReason || removalReason.trim().length === 0) {
    throw new Error('Enter the reason for removing this entry.');
  }
  return mutatePatientListField<DirectiveEntry>(
    patientId,
    scope,
    (patient) => {
      const existing = patient.directives ?? [];
      if (!existing.some((d) => d.id === directiveId)) return null;
      const next = existing.map((d) => (d.id === directiveId ? { ...d, status, removalReason: removalReason.trim() } : d));
      return { patch: { directives: next } as Partial<PatientDoc>, entries: next };
    },
    { action: 'REVOKE_DIRECTIVE', detail: `Directive ${directiveId} ${status} (${removalReason.trim()}) for patient ${patientId}` },
  );
}
