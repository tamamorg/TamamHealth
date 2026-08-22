/**
 * What a departing staff member still has open.
 *
 * Deactivation used to be one boolean. The account closed, the person stopped
 * being able to sign in, and everything that had been routed to them — the
 * patients booked into their clinic next Tuesday, the consultations they had
 * started and not closed — simply stayed pointed at an account nobody could
 * open. Nothing surfaced it, so nobody reassigned it, and the first person to
 * find out was a patient who arrived for an appointment with a doctor who had
 * left.
 *
 * This does not reassign anything: who covers a departing clinician's list is
 * a clinical decision that belongs to the facility, not to a deactivation
 * dialog. It answers the question the dialog has to ask first — "is there
 * anything to hand over?" — so the administrator makes that decision knowingly
 * rather than discovering it later.
 *
 * Read-only, and deliberately cheap: it counts, and names a handful of
 * examples. A leaver with two hundred future appointments does not need two
 * hundred rows in a modal, and fetching them would turn a confirmation dialog
 * into a slow one.
 */

import { appointmentsDB, encountersDB } from '../db';
import type { AppointmentDoc, EncounterDoc } from '../db-types';
import { isTerminal } from '../clinical-flow/encounter-journey';
import { findByType } from './db-query';

/** How many examples to name before falling back to a bare count. */
const SAMPLE_LIMIT = 5;

/**
 * Appointment states that need no handover — the visit already happened, was
 * called off, or was moved to a different booking that carries its own row.
 */
const SETTLED_APPOINTMENT_STATUSES = new Set<AppointmentDoc['status']>([
  'completed', 'cancelled', 'no_show', 'rescheduled',
]);

export interface OpenWorkSummary {
  /** Appointments on or after today where the leaver is the assigned provider. */
  futureAppointments: number;
  /** Encounters they own that have not reached a terminal status. */
  openEncounters: number;
  /** Patient names, for the confirmation dialog. Capped — see SAMPLE_LIMIT. */
  examples: string[];
  /** True when there is anything at all to hand over. */
  hasOpenWork: boolean;
}

export const EMPTY_OPEN_WORK: OpenWorkSummary = {
  futureAppointments: 0,
  openEncounters: 0,
  examples: [],
  hasOpenWork: false,
};

/**
 * Summarise what `userId` still owns.
 *
 * Never throws. This runs on the path to deactivating an account — usually
 * because someone has already left — and an unreadable appointments database
 * must not be the thing that stops a leaver's access being revoked. An empty
 * summary is the safe answer: it means the dialog asks no extra question,
 * not that access is granted.
 */
export async function summarizeOpenWork(
  userId: string,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<OpenWorkSummary> {
  try {
    const [appointments, encounters] = await Promise.all([
      findByType<AppointmentDoc>(appointmentsDB(), 'appointment').catch(() => [] as AppointmentDoc[]),
      findByType<EncounterDoc>(encountersDB(), 'clinical_encounter').catch(() => [] as EncounterDoc[]),
    ]);

    const upcoming = appointments.filter(a =>
      a.providerId === userId
      && (a.appointmentDate || '') >= today
      && !SETTLED_APPOINTMENT_STATUSES.has(a.status));

    const open = encounters.filter(e => e.clinicianId === userId && !isTerminal(e.status));

    const examples = [
      ...upcoming.map(a => a.patientName),
      ...open.map(e => e.patientName),
    ].filter(Boolean).slice(0, SAMPLE_LIMIT);

    return {
      futureAppointments: upcoming.length,
      openEncounters: open.length,
      examples,
      hasOpenWork: upcoming.length > 0 || open.length > 0,
    };
  } catch {
    return EMPTY_OPEN_WORK;
  }
}

/** One sentence for a confirmation dialog, or null when there is nothing to say. */
export function describeOpenWork(summary: OpenWorkSummary): string | null {
  if (!summary.hasOpenWork) return null;
  const parts: string[] = [];
  if (summary.futureAppointments > 0) {
    parts.push(`${summary.futureAppointments} upcoming appointment${summary.futureAppointments === 1 ? '' : 's'}`);
  }
  if (summary.openEncounters > 0) {
    parts.push(`${summary.openEncounters} open consultation${summary.openEncounters === 1 ? '' : 's'}`);
  }
  const names = summary.examples.length ? ` (${summary.examples.join(', ')}${summary.examples.length >= 5 ? ', …' : ''})` : '';
  return `This account still has ${parts.join(' and ')}${names}. `
    + 'Reassign them before closing the account, or the patients stay booked with someone who can no longer sign in.';
}
