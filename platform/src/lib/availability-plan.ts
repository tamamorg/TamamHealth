/**
 * A clinician's working day as a plan: the hours they keep, less the breaks
 * they take (lunch, ward round, theatre, …). Pure, so the form, the service
 * and the tests share one set of rules.
 *
 * The plan is stored as one availability window per bookable stretch, because
 * every reader of availability (the slot engine, "who is in now", the desk's
 * clinic-hours list) already works on windows. A break is then simply a gap
 * the slot engine never fills; the windows carry the breaks too, so the desk
 * can say what the gap is.
 */
import type { AvailabilityBreak, AvailabilityBreakKind, AvailabilityDoc } from './db-types';

export const BREAK_KINDS: readonly AvailabilityBreakKind[] = [
  'lunch', 'tea', 'ward_round', 'theatre', 'meeting', 'prayer', 'other',
];

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function fromMinutes(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Why a plan cannot be published, as an i18n key, or null when it can. */
export type DayPlanProblem =
  | 'clinicHours.errorTimes'
  | 'clinicHours.errorEndBeforeStart'
  | 'clinicHours.errorBreakTimes'
  | 'clinicHours.errorBreakOutside'
  | 'clinicHours.errorBreakOverlap'
  | 'clinicHours.errorNoBookableTime'
  | 'clinicHours.errorNoDays'
  | 'clinicHours.errorUntil';

export interface DayPlanInput {
  start: string;
  end: string;
  breaks: readonly AvailabilityBreak[];
  slotMinutes: number;
}

export function validateDayPlan(plan: DayPlanInput): { problem: DayPlanProblem; breakIndex?: number } | null {
  if (!HHMM.test(plan.start) || !HHMM.test(plan.end)) return { problem: 'clinicHours.errorTimes' };
  const start = toMinutes(plan.start);
  const end = toMinutes(plan.end);
  if (end <= start) return { problem: 'clinicHours.errorEndBeforeStart' };
  const sorted = plan.breaks
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.start.localeCompare(b.item.start));
  for (const { item, index } of sorted) {
    if (!HHMM.test(item.start) || !HHMM.test(item.end) || toMinutes(item.end) <= toMinutes(item.start)) {
      return { problem: 'clinicHours.errorBreakTimes', breakIndex: index };
    }
    if (toMinutes(item.start) < start || toMinutes(item.end) > end) {
      return { problem: 'clinicHours.errorBreakOutside', breakIndex: index };
    }
  }
  for (let i = 1; i < sorted.length; i += 1) {
    if (toMinutes(sorted[i].item.start) < toMinutes(sorted[i - 1].item.end)) {
      return { problem: 'clinicHours.errorBreakOverlap', breakIndex: sorted[i].index };
    }
  }
  if (countSlots(planSegments(plan.start, plan.end, plan.breaks), plan.slotMinutes) === 0) {
    return { problem: 'clinicHours.errorNoBookableTime' };
  }
  return null;
}

/** The bookable stretches of a day: the hours with the breaks cut out. Assumes a valid plan. */
export function planSegments(start: string, end: string, breaks: readonly AvailabilityBreak[]): { start: string; end: string }[] {
  const segments: { start: string; end: string }[] = [];
  let cursor = toMinutes(start);
  const close = toMinutes(end);
  for (const item of [...breaks].sort((a, b) => a.start.localeCompare(b.start))) {
    const from = Math.max(cursor, toMinutes(item.start));
    if (from > cursor) segments.push({ start: fromMinutes(cursor), end: fromMinutes(from) });
    cursor = Math.max(cursor, toMinutes(item.end));
  }
  if (close > cursor) segments.push({ start: fromMinutes(cursor), end: fromMinutes(close) });
  return segments;
}

/** Whole slots the stretches hold; a stretch shorter than a slot holds none. */
export function countSlots(segments: readonly { start: string; end: string }[], slotMinutes: number): number {
  if (!slotMinutes || slotMinutes <= 0) return 0;
  return segments.reduce((total, seg) => total + Math.floor((toMinutes(seg.end) - toMinutes(seg.start)) / slotMinutes), 0);
}

type WindowDates = Pick<AvailabilityDoc, 'date' | 'status' | 'recurrence'>;

/** Whether one window covers a given date, recurrence included. */
export function appliesOnDate(window: WindowDates, date: string): boolean {
  if (window.status === 'cancelled') return false;
  if (!window.recurrence) return window.date === date;

  const { daysOfWeek, until, exceptions } = window.recurrence;
  if (!daysOfWeek?.length) return false;
  if (date < window.date || date > until) return false;
  if (exceptions?.includes(date)) return false;

  // Parsed as UTC so the weekday cannot shift with the reader's timezone.
  return daysOfWeek.includes(weekdayOf(date));
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function lastDate(window: WindowDates): string {
  return window.recurrence ? window.recurrence.until : window.date;
}

type TimedWindow = WindowDates & Pick<AvailabilityDoc, 'startTime' | 'endTime'>;

/**
 * The first date two windows both cover with hours that overlap, or null.
 * Recurrence-aware: a one-off Tuesday clinic clashes with a weekly Tuesday
 * clinic, which a same-`date` comparison never saw.
 */
export function firstClash(a: TimedWindow, b: TimedWindow): string | null {
  if (!(toMinutes(a.startTime) < toMinutes(b.endTime) && toMinutes(b.startTime) < toMinutes(a.endTime))) return null;
  let date = a.date > b.date ? a.date : b.date;
  const stop = lastDate(a) < lastDate(b) ? lastDate(a) : lastDate(b);
  // A year of days at most: recurrence is capped well inside that.
  for (let i = 0; i < 400 && date <= stop; i += 1, date = addDay(date)) {
    if (appliesOnDate(a, date) && appliesOnDate(b, date)) return date;
  }
  return null;
}

/** One clinician's published day, as the desk reads it. */
export interface ClinicianDay {
  providerId: string;
  providerName: string;
  department?: string;
  start: string;
  end: string;
  /** Named breaks, and any other gap between windows (kind 'other'). */
  breaks: AvailabilityBreak[];
  windows: AvailabilityDoc[];
}

/**
 * Who works when on a date: the windows that apply, folded into one day per
 * clinician. A plan's stored breaks name its gaps; a gap between windows
 * written one at a time (or by the seed) still shows, as a plain break.
 */
export function clinicianDays(windows: readonly AvailabilityDoc[], date: string): ClinicianDay[] {
  const byProvider = new Map<string, AvailabilityDoc[]>();
  for (const window of windows) {
    if (!appliesOnDate(window, date)) continue;
    byProvider.set(window.providerId, [...(byProvider.get(window.providerId) ?? []), window]);
  }
  const days: ClinicianDay[] = [];
  for (const [providerId, list] of byProvider) {
    const sorted = [...list].sort((a, b) => a.startTime.localeCompare(b.startTime));
    const start = sorted.map(w => w.dayStart ?? w.startTime).sort()[0];
    const end = sorted.map(w => w.dayEnd ?? w.endTime).sort().at(-1) as string;
    const named = new Map<string, AvailabilityBreak>();
    for (const w of sorted) for (const b of w.breaks ?? []) named.set(`${b.start}-${b.end}`, b);
    const breaks = [...named.values()];
    for (let i = 1; i < sorted.length; i += 1) {
      const gapStart = sorted[i - 1].endTime;
      const gapEnd = sorted[i].startTime;
      if (gapEnd <= gapStart) continue;
      const covered = breaks.some(b => b.start < gapEnd && gapStart < b.end);
      if (!covered) breaks.push({ kind: 'other', start: gapStart, end: gapEnd });
    }
    breaks.sort((a, b) => a.start.localeCompare(b.start));
    days.push({
      providerId,
      providerName: sorted[0].providerName,
      department: sorted.find(w => w.department)?.department,
      start,
      end,
      breaks,
      windows: sorted,
    });
  }
  return days.sort((a, b) => a.start.localeCompare(b.start) || a.providerName.localeCompare(b.providerName));
}

export type ClinicNow =
  | { state: 'before' }
  | { state: 'in' }
  | { state: 'break'; kind: AvailabilityBreak['kind']; until: string }
  | { state: 'after' };

/** Where a clinician's day stands at a time (HH:MM), for today's list. */
export function clinicNow(day: ClinicianDay, time: string): ClinicNow {
  if (time < day.start) return { state: 'before' };
  if (time >= day.end) return { state: 'after' };
  const pause = day.breaks.find(b => b.start <= time && time < b.end);
  if (pause) return { state: 'break', kind: pause.kind, until: pause.end };
  const inWindow = day.windows.some(w => w.startTime <= time && time < w.endTime);
  return inWindow ? { state: 'in' } : { state: 'break', kind: 'other', until: day.windows.find(w => w.startTime > time)?.startTime ?? day.end };
}
