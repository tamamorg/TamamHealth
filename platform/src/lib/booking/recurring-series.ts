/**
 * Recurring appointments as real bookings.
 *
 * "Recurring" used to be a flag on one appointment: nothing ever created the
 * following visits, so a patient booked "monthly" had a single visit and a
 * label promising more. A series is now the first booking plus one booking per
 * following occurrence, each made through the normal `create` path, so every
 * one runs the same conflict rule — the provider's and the nurse's calendars,
 * the room, the patient's own day. An occurrence that clashes is skipped and
 * reported, never double-booked.
 */
import type { AppointmentDoc } from '@/lib/db-types';

export type RecurrencePattern = 'weekly' | 'biweekly' | 'monthly' | 'quarterly';

/** Visits in a series, the first included. */
export const SERIES_MIN = 2;
export const SERIES_MAX = 12;
export const SERIES_DEFAULT = 4;

/**
 * The dates of a series starting on `start` (YYYY-MM-DD), the first included.
 * Months step by calendar month and clamp to the month's last day, so a series
 * started on 31 January lands on 28/29 February, not 3 March.
 */
export function recurrenceDates(start: string, pattern: RecurrencePattern, count: number): string[] {
  const [y, m, d] = start.split('-').map(Number);
  const total = Math.max(1, Math.min(SERIES_MAX, Math.floor(count)));
  const out: string[] = [];
  for (let i = 0; i < total; i += 1) {
    let date: Date;
    if (pattern === 'weekly' || pattern === 'biweekly') {
      date = new Date(Date.UTC(y, m - 1, d + i * (pattern === 'weekly' ? 7 : 14)));
    } else {
      const step = pattern === 'monthly' ? 1 : 3;
      const monthIndex = m - 1 + i * step;
      const lastDay = new Date(Date.UTC(y, monthIndex + 1, 0)).getUTCDate();
      date = new Date(Date.UTC(y, monthIndex, Math.min(d, lastDay)));
    }
    out.push(date.toISOString().slice(0, 10));
  }
  return out;
}

export type NewAppointment = Omit<AppointmentDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>;

export interface SeriesResult {
  /** The first visit — the one the booker chose and saw checked. */
  first: AppointmentDoc;
  /** Every visit created, the first included. */
  booked: AppointmentDoc[];
  /** Later occurrences that were not booked, with the reason. */
  skipped: Array<{ date: string; reason: string }>;
}

/**
 * Book `base` and, when it recurs, the rest of its series. The first booking
 * must succeed (its error propagates, exactly as a single booking's would);
 * later occurrences that fail are collected in `skipped`.
 */
export async function createBookingSeries(
  base: NewAppointment,
  create: (data: NewAppointment) => Promise<AppointmentDoc>,
  series?: { pattern: RecurrencePattern; count: number },
): Promise<SeriesResult> {
  const recurring = !!series && series.count >= SERIES_MIN;
  const first = await create({
    ...base,
    isRecurring: recurring,
    recurrencePattern: recurring ? series!.pattern : undefined,
  });
  const result: SeriesResult = { first, booked: [first], skipped: [] };
  if (!recurring) return result;

  for (const date of recurrenceDates(base.appointmentDate, series!.pattern, series!.count).slice(1)) {
    try {
      result.booked.push(await create({
        ...base,
        appointmentDate: date,
        isRecurring: true,
        recurrencePattern: series!.pattern,
      }));
    } catch (error) {
      result.skipped.push({ date, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
