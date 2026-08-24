/**
 * Date helpers scoped to Africa/Juba (UTC+02:00, no DST).
 *
 * All clinical events are recorded by users physically in South Sudan; if
 * we compare them with `new Date().toISOString()` on a UTC server, a death
 * at 22:00 Juba on Mar 31 shifts into April UTC and lands in the wrong
 * monthly bucket. Use these helpers wherever you'd otherwise slice
 * `toISOString()` for month/day comparisons.
 *
 * South Sudan moved from EAT (UTC+3) to CAT (UTC+2) on 1 Feb 2021. This
 * constant MUST agree with `jubaNow()`, which reads the offset from the
 * platform's Africa/Juba zone data — when the two disagreed (+3 here vs +2
 * from Intl), every date-based comparison against jubaNow() broke for the
 * hour of UTC 21:00–22:00, when only one of them had rolled to the next day.
 */
const JUBA_OFFSET_MS = 2 * 60 * 60 * 1000;

function toJuba(d: Date | string | number): Date {
  const date = typeof d === 'string' || typeof d === 'number' ? new Date(d) : d;
  return new Date(date.getTime() + JUBA_OFFSET_MS);
}

export function jubaYearMonth(d: Date | string | number = new Date()): string {
  const j = toJuba(d);
  return `${j.getUTCFullYear()}-${String(j.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function jubaDate(d: Date | string | number = new Date()): string {
  const j = toJuba(d);
  return `${j.getUTCFullYear()}-${String(j.getUTCMonth() + 1).padStart(2, '0')}-${String(j.getUTCDate()).padStart(2, '0')}`;
}

export function jubaIsInMonth(date: string | undefined, yyyyMm: string): boolean {
  if (!date) return false;
  return jubaYearMonth(date) === yyyyMm;
}

export function jubaWeekStart(d: Date | string | number = new Date()): string {
  const j = toJuba(d);
  const day = j.getUTCDay();
  const daysFromMonday = (day + 6) % 7;
  j.setUTCDate(j.getUTCDate() - daysFromMonday);
  return `${j.getUTCFullYear()}-${String(j.getUTCMonth() + 1).padStart(2, '0')}-${String(j.getUTCDate()).padStart(2, '0')}`;
}

/** Convert half-open Juba calendar dates to UTC instants for indexed queries. */
export function jubaDateRangeUtc(fromDate: string, toDateExclusive: string): { from: string; to: string } {
  const toUtc = (value: string): string => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) throw new Error(`Invalid ISO date: ${value}`);
    const [, year, month, day] = match;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)) - JUBA_OFFSET_MS).toISOString();
  };
  return { from: toUtc(fromDate), to: toUtc(toDateExclusive) };
}

/**
 * "Now" as a Date whose LOCAL fields (getHours/getDate/…) equal the current
 * Africa/Juba wall-clock — regardless of the viewer's browser timezone.
 *
 * Appointment dates/times are stored as naive Juba wall-clock strings and are
 * positioned on the calendar via their local fields, so any component that
 * needs "now" relative to those events (the current-time indicator, the
 * default focused date, walk-in timestamps) must use this rather than a raw
 * `new Date()` — otherwise the clock drifts by the browser's UTC offset.
 */
export function jubaNow(): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Juba', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  const hour = get('hour') % 24; // some engines emit "24" for midnight
  return new Date(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
}

/** Current Africa/Juba time as a "HH:MM" wall-clock string. */
export function jubaTime(): string {
  const n = jubaNow();
  return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
}

/**
 * True if `iso` falls within the half-open instant range [range.from, range.to).
 * Both boundaries are already-resolved ISO instants — e.g. produced by
 * dhis2-export-service's period→range conversion (which does its own Juba
 * offset math to anchor the boundaries to local wall-clock days/weeks/months).
 * This helper does no timezone math of its own; it's a plain timestamp
 * compare, kept here alongside the other date helpers so callers doing
 * period-bounded reporting share one implementation.
 */
export function isInRange(iso: string | undefined, range: { from: string; to: string }): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  const fromMs = new Date(range.from).getTime();
  const toMs = new Date(range.to).getTime();
  return t >= fromMs && t < toMs;
}
