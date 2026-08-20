/**
 * Care alert service (P1.2) — chart-permanent patient-safety alerts.
 *
 * Care alerts live ON the patient document so they ride the patient's sync +
 * scoping and surface on every visit (the Centricity "care alert" that stays
 * attached to the chart). Resolving an alert keeps it for the audit trail
 * rather than hard-deleting it. Writes go through `mutatePatient`
 * (optimistic-concurrency retry).
 */
import { v4 as uuidv4 } from 'uuid';
import type { CareAlertEntry, CareAlertCategory } from '../../data/mock';
import type { PatientDoc } from '../db-types';
import { getPatientById } from './patient-service';
import { mutatePatientListField } from './patient-list-field';

/** All care alerts for a patient (active + resolved). */
export async function getCareAlerts(patientId: string): Promise<CareAlertEntry[]> {
  const patient = await getPatientById(patientId);
  return patient?.careAlerts ?? [];
}

/** Active care alerts only — what the chart banner shows. */
export async function getActiveCareAlerts(patientId: string): Promise<CareAlertEntry[]> {
  return (await getCareAlerts(patientId)).filter((a) => a.status === 'active');
}

export interface AddCareAlertInput {
  category: CareAlertCategory;
  message: string;
  priority?: 'high' | 'normal';
  recordedBy?: string;
  recordedByName?: string;
}

/** Add a care alert. Returns the full updated list, or null if no patient. */
export async function addCareAlert(patientId: string, input: AddCareAlertInput): Promise<CareAlertEntry[] | null> {
  if (!input.message || input.message.trim().length === 0) {
    throw new Error('Care alert message is required');
  }
  const entry: CareAlertEntry = {
    id: uuidv4(),
    category: input.category,
    message: input.message.trim(),
    priority: input.priority ?? 'normal',
    status: 'active',
    recordedBy: input.recordedBy,
    recordedByName: input.recordedByName,
    recordedAt: new Date().toISOString(),
  };
  return mutatePatientListField<CareAlertEntry>(
    patientId,
    (patient) => {
      const next = [...(patient.careAlerts ?? []), entry];
      return { patch: { careAlerts: next } as Partial<PatientDoc>, entries: next };
    },
    { action: 'ADD_CARE_ALERT', by: input.recordedBy, byName: input.recordedByName, detail: `Care alert "${input.category}" (${entry.priority}) for patient ${patientId}` },
  );
}

/**
 * Resolve (clear) a care alert. A reason is required; the entry is retained as
 * resolved for the audit trail rather than hard-deleted.
 */
export async function resolveCareAlert(
  patientId: string,
  alertId: string,
  resolutionReason: string,
): Promise<CareAlertEntry[] | null> {
  if (!resolutionReason || resolutionReason.trim().length === 0) {
    throw new Error('A resolution reason is required');
  }
  return mutatePatientListField<CareAlertEntry>(
    patientId,
    (patient) => {
      const existing = patient.careAlerts ?? [];
      if (!existing.some((a) => a.id === alertId)) return null;
      const next = existing.map((a) =>
        a.id === alertId ? { ...a, status: 'resolved' as const, resolutionReason: resolutionReason.trim() } : a,
      );
      return { patch: { careAlerts: next } as Partial<PatientDoc>, entries: next };
    },
    { action: 'RESOLVE_CARE_ALERT', detail: `Care alert ${alertId} resolved (${resolutionReason.trim()}) for patient ${patientId}` },
  );
}
