/**
 * Preventive-care screening reminders (health maintenance). Like care alerts,
 * screenings live ON the patient document so they ride the patient's sync +
 * scoping and surface on every visit — the HealthBridge "screenings due" bell.
 *
 * A screening carries a due date and an optional recall interval; completing a
 * recurring screening stamps the date done and rolls the due date forward by
 * the interval, so the reminder re-arms automatically. Writes go through the
 * shared patient-list helper (optimistic-concurrency retry + audit).
 */
import { v4 as uuidv4 } from 'uuid';
import type { ScreeningEntry } from '../../data/mock';
import type { PatientDoc } from '../db-types';
import { getPatientById } from './patient-service';
import { mutatePatientListField } from './patient-list-field';
import { toIsoDate, todayIso } from '@/lib/date-utils';

/** yyyy-mm-dd for today. */
function todayISO(): string {
  return todayIso();
}

/** Add `months` to a yyyy-mm-dd date, returning yyyy-mm-dd. */
function addMonths(fromISO: string, months: number): string {
  const d = new Date(fromISO);
  if (Number.isNaN(d.getTime())) return fromISO;
  d.setMonth(d.getMonth() + months);
  return toIsoDate(d);
}

/** Whether a "due" screening is past its due date as of `asOf` (default today). */
export function isScreeningOverdue(s: ScreeningEntry, asOf: string = todayISO()): boolean {
  return s.status === 'due' && !!s.dueDate && s.dueDate < asOf;
}

/** All screenings for a patient. */
export async function getScreenings(patientId: string): Promise<ScreeningEntry[]> {
  const patient = await getPatientById(patientId);
  return patient?.screenings ?? [];
}

/** Outstanding (due) screenings — what the reminder bell counts. */
export async function getDueScreenings(patientId: string): Promise<ScreeningEntry[]> {
  return (await getScreenings(patientId)).filter((s) => s.status === 'due');
}

export interface AddScreeningInput {
  type: string;
  dueDate?: string;
  lastDoneDate?: string;
  intervalMonths?: number;
  notes?: string;
  recordedBy?: string;
  recordedByName?: string;
}

/** Add a screening reminder. Returns the full updated list, or null if no patient. */
export async function addScreening(patientId: string, input: AddScreeningInput): Promise<ScreeningEntry[] | null> {
  if (!input.type || input.type.trim().length === 0) {
    throw new Error('Screening type is required');
  }
  const entry: ScreeningEntry = {
    id: uuidv4(),
    type: input.type.trim(),
    status: 'due',
    dueDate: input.dueDate || todayISO(),
    lastDoneDate: input.lastDoneDate,
    intervalMonths: input.intervalMonths,
    notes: input.notes?.trim() || undefined,
    recordedBy: input.recordedBy,
    recordedByName: input.recordedByName,
    recordedAt: new Date().toISOString(),
  };
  return mutatePatientListField<ScreeningEntry>(
    patientId,
    (patient) => {
      const next = [...(patient.screenings ?? []), entry];
      return { patch: { screenings: next } as Partial<PatientDoc>, entries: next };
    },
    { action: 'ADD_SCREENING', by: input.recordedBy, byName: input.recordedByName, detail: `Screening "${entry.type}" due ${entry.dueDate} for patient ${patientId}` },
  );
}

/**
 * Mark a screening done. If it has a recall interval the due date rolls forward
 * (status stays "due" so it re-arms); otherwise it becomes "completed".
 */
export async function completeScreening(patientId: string, screeningId: string, doneDate?: string): Promise<ScreeningEntry[] | null> {
  const done = doneDate || todayISO();
  return mutatePatientListField<ScreeningEntry>(
    patientId,
    (patient) => {
      const existing = patient.screenings ?? [];
      const target = existing.find((s) => s.id === screeningId);
      if (!target) return null;
      const next = existing.map((s) => {
        if (s.id !== screeningId) return s;
        if (s.intervalMonths && s.intervalMonths > 0) {
          return { ...s, status: 'due' as const, lastDoneDate: done, dueDate: addMonths(done, s.intervalMonths) };
        }
        return { ...s, status: 'completed' as const, lastDoneDate: done };
      });
      return { patch: { screenings: next } as Partial<PatientDoc>, entries: next };
    },
    { action: 'COMPLETE_SCREENING', detail: `Screening ${screeningId} completed (${done}) for patient ${patientId}` },
  );
}

/** Record that the patient declined a screening (kept for the record). */
export async function declineScreening(patientId: string, screeningId: string, reason?: string): Promise<ScreeningEntry[] | null> {
  return mutatePatientListField<ScreeningEntry>(
    patientId,
    (patient) => {
      const existing = patient.screenings ?? [];
      if (!existing.some((s) => s.id === screeningId)) return null;
      const next = existing.map((s) => (s.id === screeningId ? { ...s, status: 'declined' as const, notes: reason?.trim() || s.notes } : s));
      return { patch: { screenings: next } as Partial<PatientDoc>, entries: next };
    },
    { action: 'DECLINE_SCREENING', detail: `Screening ${screeningId} declined for patient ${patientId}` },
  );
}

/** Remove a screening entry entirely. */
export async function removeScreening(patientId: string, screeningId: string): Promise<ScreeningEntry[] | null> {
  return mutatePatientListField<ScreeningEntry>(
    patientId,
    (patient) => {
      const existing = patient.screenings ?? [];
      if (!existing.some((s) => s.id === screeningId)) return null;
      const next = existing.filter((s) => s.id !== screeningId);
      return { patch: { screenings: next } as Partial<PatientDoc>, entries: next };
    },
    { action: 'REMOVE_SCREENING', detail: `Screening ${screeningId} removed for patient ${patientId}` },
  );
}
