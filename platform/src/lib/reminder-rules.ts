import type { PatientReminderDoc } from './db-types';

/**
 * Whether a reminder's Mark sent / Cancel can be undone (back to the queue).
 * Pure, so lists can decide without loading the reminder service.
 *
 * A reminder the SMS gateway actually sent (it carries dispatch attempts) is
 * never re-queued: that would text the patient a second time.
 */
export function canReopenReminder(r: Pick<PatientReminderDoc, 'status' | 'attempts'>): boolean {
  if (r.status === 'cancelled') return true;
  return r.status === 'sent' && !(r.attempts && r.attempts > 0);
}
