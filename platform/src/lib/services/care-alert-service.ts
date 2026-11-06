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
import type { DataScope } from './data-scope';
import { mutatePatientListField } from './patient-list-field';
import { logAuditSafe } from './audit-service';
import { chartCareAlerts } from '../care-alert-rules';

/** All care alerts for a patient (active + resolved). */
export async function getCareAlerts(patientId: string, scope: DataScope): Promise<CareAlertEntry[]> {
  const patient = await getPatientById(patientId, scope);
  return patient?.careAlerts ?? [];
}

/** Active care alerts only — what the chart banner shows. */
export async function getActiveCareAlerts(patientId: string, scope: DataScope): Promise<CareAlertEntry[]> {
  return chartCareAlerts(await getCareAlerts(patientId, scope));
}

export interface AddCareAlertInput {
  category: CareAlertCategory;
  message: string;
  priority?: 'high' | 'normal';
  recordedBy?: string;
  recordedByName?: string;
}

/** Add a care alert. Returns the full updated list, or null if no patient. */
export async function addCareAlert(patientId: string, scope: DataScope, input: AddCareAlertInput): Promise<CareAlertEntry[] | null> {
  if (!input.message || input.message.trim().length === 0) {
    throw new Error('Enter the care alert message.');
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
    scope,
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
  scope: DataScope,
  alertId: string,
  resolutionReason: string,
): Promise<CareAlertEntry[] | null> {
  if (!resolutionReason || resolutionReason.trim().length === 0) {
    throw new Error('Enter the reason for resolving this alert.');
  }
  return mutatePatientListField<CareAlertEntry>(
    patientId,
    scope,
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

export interface UpdateCareAlertInput {
  category?: CareAlertCategory;
  message?: string;
  priority?: 'high' | 'normal';
}

/**
 * Edit an ACTIVE care alert's text, severity or category. A resolved alert is a
 * closed record: reopen it first. Returns the updated list, or null when the
 * patient or alert is missing.
 */
export async function updateCareAlert(
  patientId: string,
  scope: DataScope,
  alertId: string,
  input: UpdateCareAlertInput,
  actor?: { id?: string; name?: string },
): Promise<CareAlertEntry[] | null> {
  if (input.message !== undefined && input.message.trim().length === 0) {
    throw new Error('Enter the care alert message.');
  }
  return mutatePatientListField<CareAlertEntry>(
    patientId,
    scope,
    (patient) => {
      const existing = patient.careAlerts ?? [];
      const found = existing.find((a) => a.id === alertId);
      if (!found) return null;
      if (found.status !== 'active') throw new Error('Care alert not edited. Reopen it first.');
      const now = new Date().toISOString();
      const next = existing.map((a) => a.id === alertId ? {
        ...a,
        ...(input.category ? { category: input.category } : {}),
        ...(input.message !== undefined ? { message: input.message.trim() } : {}),
        ...(input.priority ? { priority: input.priority } : {}),
        updatedAt: now,
        updatedByName: actor?.name,
      } : a);
      return { patch: { careAlerts: next } as Partial<PatientDoc>, entries: next };
    },
    { action: 'UPDATE_CARE_ALERT', by: actor?.id, byName: actor?.name, detail: `Care alert ${alertId} edited for patient ${patientId}` },
  );
}

/**
 * Put a resolved care alert back on the chart (resolved in error, or the risk
 * returned). The earlier resolution reason is cleared from the entry and kept
 * in the audit trail.
 */
export async function reopenCareAlert(
  patientId: string,
  scope: DataScope,
  alertId: string,
  actor?: { id?: string; name?: string },
): Promise<CareAlertEntry[] | null> {
  let previousReason = '';
  const entries = await mutatePatientListField<CareAlertEntry>(
    patientId,
    scope,
    (patient) => {
      const existing = patient.careAlerts ?? [];
      const found = existing.find((a) => a.id === alertId);
      if (!found) return null;
      if (found.status !== 'resolved') throw new Error('Care alert not reopened. It is already active.');
      previousReason = found.resolutionReason ?? '';
      const now = new Date().toISOString();
      const next = existing.map((a) => {
        if (a.id !== alertId) return a;
        const { resolutionReason: _drop, ...rest } = a;
        void _drop;
        return { ...rest, status: 'active' as const, updatedAt: now, updatedByName: actor?.name };
      });
      return { patch: { careAlerts: next } as Partial<PatientDoc>, entries: next };
    },
    { action: 'REOPEN_CARE_ALERT', by: actor?.id, byName: actor?.name, detail: `Care alert ${alertId} reopened for patient ${patientId}` },
  );
  // The reason is dropped from the entry, so the audit trail keeps it.
  if (entries && previousReason) {
    await logAuditSafe('REOPEN_CARE_ALERT', actor?.id, actor?.name, `Care alert ${alertId} had been resolved: ${previousReason}`);
  }
  return entries;
}
