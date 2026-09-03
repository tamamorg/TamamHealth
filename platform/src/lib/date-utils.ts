/**
 * Local calendar-day helpers.
 *
 * These are the client-side "what day is it here" primitives. They read the
 * DEVICE's local calendar — `getFullYear`/`getMonth`/`getDate` — which is the
 * only correct answer for a default date on a form a clinician is filling in
 * front of a patient.
 *
 * The trap this module exists to close: `new Date().toISOString().slice(0, 10)`
 * looks equivalent and is not. `toISOString()` converts to UTC first, so in
 * Juba (UTC+2, no DST) everything after 22:00 local reports TOMORROW. A birth
 * registered at 22:30 defaulted to the next calendar day; so did a death, an
 * immunization dose, an ANC visit and a facility assessment. Stock-expiry
 * comparisons flipped a day early for the same reason.
 *
 * Three date concepts live in this codebase — keep them apart:
 *
 *   - `toIsoDate(new Date())`  — LOCAL calendar day. Form defaults, "today"
 *                                highlighting, day-boundary comparisons in the
 *                                browser. This module.
 *   - `lib/time-juba.ts`       — Africa/Juba day/month buckets, for clinical
 *                                aggregation that must agree across devices
 *                                regardless of where the reader sits.
 *   - `toISOString().slice()`  — UTC. Correct ONLY in `src/app/api` server code.
 *
 * `toIsoDate` and `parseIsoDate` are re-exported by
 * `components/ehr/EhrMiniCalendar`, their original home, so existing importers
 * keep working. New code should import from here.
 */

/** Local calendar day as `YYYY-MM-DD`. Never UTC. */
export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** `YYYY-MM-DD` back to a Date at LOCAL midnight (not UTC midnight). */
export function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

/** Today's local calendar day as `YYYY-MM-DD`. */
export function todayIso(): string {
  return toIsoDate(new Date());
}

/** `YYYY-MM-DD` offset by whole days, staying on the local calendar. */
export function addDaysIso(value: string, days: number): string {
  const d = parseIsoDate(value);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

/**
 * Local start/end of a `YYYY-MM-DD` day, as epoch milliseconds.
 *
 * For range filters. `new Date('2026-08-20')` is a date-ONLY form, which the
 * spec parses as UTC midnight, while `new Date('2026-08-20T23:59:59')` is
 * parsed as LOCAL time — so a filter that mixed the two shapes silently lost
 * the first two hours of its own start day in Juba.
 */
export function startOfLocalDay(value: string): number {
  return parseIsoDate(value).getTime();
}

export function endOfLocalDay(value: string): number {
  const d = parseIsoDate(value);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/**
 * A date of birth as `dd-MMM-yyyy` — "17-Jun-1990", the Tamam convention the
 * patient chart and the printed bill both use. Distinct from the app's
 * general-purpose `formatDate` ("Jun 17, 1990").
 *
 * Stated once here because the two surfaces that show a DOB had a copy each,
 * and both copies read `new Date(iso)` for a date-ONLY string. The spec parses
 * that form as UTC midnight and `getDate()` reports it in LOCAL time, so west
 * of UTC every patient's birthday rendered a day early — on the chart header
 * every clinician reads, and on a bill that leaves the building. `parseIsoDate`
 * is the fix and the reason it exists: `YYYY-MM-DD` is a calendar day, not an
 * instant, so it must never travel through a timezone.
 *
 * A value carrying a time component is a real instant and is parsed as one.
 */
export function formatDobOmrs(iso?: string | null): string {
  if (!iso) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? parseIsoDate(iso) : new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const day = String(d.getDate()).padStart(2, '0');
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  return `${day}-${month}-${d.getFullYear()}`;
}
