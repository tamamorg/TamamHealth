/**
 * Shared formatting utilities used across the app for consistent date/time
 * display. Always prefer these helpers over inline `toLocaleDateString()`
 * calls so date formatting stays uniform across modules.
 *
 * One rule runs through all of them: a bare `YYYY-MM-DD` is a CALENDAR DAY,
 * not an instant. `new Date('2026-08-24')` is the date-only form, which the
 * spec parses as UTC midnight and every getter then reports in local time — so
 * west of UTC the day rendered as the one before. A patient's chart showed an
 * appointment booked for Monday sitting on Sunday, while the calendar that
 * booked it showed Monday. `asLocalDay` is what keeps a day a day; a value
 * carrying a time component is a real instant and is parsed as one.
 */

import { parseIsoDate } from './date-utils';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Parse a date string without letting a calendar day travel through UTC. */
function asLocalDay(value: string): Date {
  return DATE_ONLY.test(value) ? parseIsoDate(value) : new Date(value);
}

/**
 * Format an ISO 8601 timestamp as "Mon DD, YYYY at HH:mm" (e.g. "Apr 10, 2026 at 14:32").
 *
 * - Returns "—" for falsy / empty inputs.
 * - Returns the raw string if it can't be parsed.
 * - If the input has only a date component (no time), returns the date alone.
 */
export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = asLocalDay(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hasTime = /T\d{2}:\d{2}/.test(iso);
  const dateStr = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  if (!hasTime) return dateStr;
  const timeStr = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${dateStr} at ${timeStr}`;
}

/**
 * Compact variant: "Mon DD · HH:mm" (e.g. "Apr 10 · 14:32"). Used for dense
 * tables where vertical space matters. No year shown — assume "this year".
 */
export function formatCompactDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = asLocalDay(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const hasTime = /T\d{2}:\d{2}/.test(iso);
  if (!hasTime) return dateStr;
  const timeStr = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${dateStr} · ${timeStr}`;
}

/**
 * Clock time, ALWAYS 12-hour with AM/PM ("8:00 AM", "3:30 PM"), regardless of
 * locale or source shape. Accepts a bare "HH:MM"(:SS) 24-hour slot string
 * (appointment times) or an ISO/Date timestamp. Returns '' for empty input.
 * Use everywhere a time-of-day is shown so appointments (raw "15:30") and
 * timestamps (formatted) never render in different formats side by side.
 */
export function formatClockTime(value?: string | Date | null): string {
  if (!value) return '';
  // The design writes clock times as zero-padded 24-hour ("08:30", "14:15")
  // everywhere — queue rows, chips, feeds — so the one shared formatter does.
  if (typeof value === 'string') {
    // Bare "HH:MM" / "HH:MM:SS" slot with no date component.
    const m = value.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return typeof value === 'string' ? value : '';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Date-only formatter: "Mon DD, YYYY" (e.g. "Apr 10, 2026").
 */
export function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = asLocalDay(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Compact list-row date: "13 Aug" (day + short month), or "13 Aug 2026" with
 * `{ year: true }`.
 *
 * Built from a fixed month table rather than `toLocaleDateString` on purpose:
 * the per-file copies this replaces each picked a different locale ('en-GB',
 * 'en-US', the runtime default), so one list read "13 Aug" and the next
 * "Aug 13" for the same day.
 *
 * - '' for empty input; the raw string when it can't be parsed.
 * - A leading `YYYY-MM-DD` is read literally, so a date-only value can't slip
 *   a day across the UTC offset. Anything else resolves to its local
 *   calendar day, the same convention as `toIsoDate`.
 */
export function formatShortDate(value?: string | Date | null, opts?: { year?: boolean }): string {
  if (!value) return '';
  let year: number;
  let month: number;
  let day: number;
  if (typeof value === 'string') {
    const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (parts) {
      year = Number(parts[1]);
      month = Number(parts[2]);
      day = Number(parts[3]);
    } else {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return value;
      year = d.getFullYear();
      month = d.getMonth() + 1;
      day = d.getDate();
    }
  } else {
    if (Number.isNaN(value.getTime())) return '';
    year = value.getFullYear();
    month = value.getMonth() + 1;
    day = value.getDate();
  }
  const mon = SHORT_MONTHS[month - 1];
  if (!mon || !day) return typeof value === 'string' ? value : '';
  return opts?.year ? `${day} ${mon} ${year}` : `${day} ${mon}`;
}

/**
 * ISO-8601 week of a date — `{ year, week, label }`, label as "2026-W07".
 *
 * The ISO year is the year of that week's Thursday, so 29 Dec 2025 falls in
 * 2026-W01. Epi-week reporting (IDSR, outbreak trends) buckets on this, and a
 * second implementation that rounds the year boundary differently makes two
 * screens label the same case with two different weeks — so every caller
 * shares this one.
 *
 * Returns null for empty or unparseable input.
 */
export function isoWeek(
  value?: string | Date | null,
): { year: number; week: number; label: string } | null {
  if (!value) return null;
  // A string is UTC-anchored — a bare "2026-01-01" parses to UTC midnight, so
  // its UTC parts are the day it names — while a Date carries a local
  // calendar day (`toIsoDate`'s convention). Reading the wrong set shifts
  // Mondays into the previous week anywhere the offset isn't zero.
  let target: Date;
  if (typeof value === 'string') {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  } else {
    if (Number.isNaN(value.getTime())) return null;
    target = new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  }
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  const year = target.getUTCFullYear();
  return { year, week, label: `${year}-W${String(week).padStart(2, '0')}` };
}

/**
 * Long, human header date: "Wednesday, 17 June 2026". Used in dashboard
 * headers. Accepts a Date or ISO string; defaults to now.
 */
export function formatLongDate(input?: Date | string | null): string {
  const d = input ? new Date(input) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Canonical money formatter. Standardizes the previously-inconsistent
 * "{n} SSP" / "SSP {n}" inline renderings into one symbol-prefixed form:
 * "SSP 1,234". Null/undefined/NaN render as the zero amount.
 *
 * @param amount  numeric value (minor handling: undefined/null → 0)
 * @param opts.currency  currency code/symbol (default "SSP")
 * @param opts.decimals  fixed decimal places (default 0, matching prior `.toLocaleString()`)
 */
export function formatMoney(
  amount?: number | null,
  opts?: { currency?: string; decimals?: number },
): string {
  const currency = opts?.currency ?? 'SSP';
  const decimals = opts?.decimals ?? 0;
  const n = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
  const num = n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${currency} ${num}`;
}

/**
 * How far a moment is from now, phrased for a schedule row: "in 2h 15m",
 * "in 45m", "20m ago", "Now", "Tomorrow", "in 3d". Coarse by design — the
 * exact clock time is always shown next to it, so this only has to answer
 * "how soon?" at a glance.
 *
 * - Returns '' for falsy/unparseable input, so callers can render nothing.
 * - Anything inside ±1 minute reads "Now".
 * - Past times get "… ago"; future times get "in …".
 * - Beyond 24h it switches to whole days (and names the next day "Tomorrow"/
 *   "Yesterday") rather than printing an unhelpful "in 53h".
 *
 * `now` is injectable so callers can drive many rows off one ticking clock
 * (and so tests stay deterministic).
 */
export function formatTimeUntil(value?: string | Date | null, now: Date = new Date()): string {
  if (!value) return '';
  const target = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(target.getTime())) return '';

  const diffMs = target.getTime() - now.getTime();
  const past = diffMs < 0;
  const totalMinutes = Math.floor(Math.abs(diffMs) / 60000);
  if (totalMinutes < 1) return 'Now';

  const days = Math.floor(totalMinutes / 1440);
  if (days >= 1) {
    // Calendar-day difference reads better than 24h buckets: an 8 AM slot
    // tomorrow should say "Tomorrow", not "in 18h".
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const dayDiff = Math.round((startOfDay(target) - startOfDay(now)) / 86400000);
    if (dayDiff === 1) return 'Tomorrow';
    if (dayDiff === -1) return 'Yesterday';
    const n = Math.abs(dayDiff) || days;
    return past ? `${n}d ago` : `in ${n}d`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const label = hours > 0
    ? (minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`)
    : `${minutes}m`;
  return past ? `${label} ago` : `in ${label}`;
}

/**
 * Compact appointment display used in shared worklists. Same-day meetings
 * count down to seconds; meetings on another day use a calendar date. A
 * meeting from a previous calendar day stays a date instead of becoming an
 * ambiguous "2d ago" label.
 */
export function formatAppointmentTimeUntil(value?: string | Date | null, now: Date = new Date()): string {
  if (!value) return '';
  const target = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(target.getTime())) return '';

  const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const sameDay = dayKey(target) === dayKey(now);
  const dateLabel = target.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  if (!sameDay) return dateLabel;

  const diffMs = target.getTime() - now.getTime();
  const past = diffMs < 0;
  const totalSeconds = Math.floor(Math.abs(diffMs) / 1000);
  if (totalSeconds < 60) {
    const label = `${totalSeconds}s`;
    return past ? `${label} ago` : `in ${label}`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const label = hours > 0
    ? (minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`)
    : `${minutes}m`;
  return past ? `${label} ago` : `in ${label}`;
}

/** Part of day for greetings. Pure function of the hour (local time). */
export function timeOfDay(date: Date = new Date()): 'morning' | 'afternoon' | 'evening' {
  const h = date.getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}


/**
 * Human-readable status label from a raw enum value: "checked_in" → "Checked in".
 * Use for every status chip so raw enum casing/underscores never reach the UI.
 */
export function humanizeStatus(status?: string | null): string {
  if (!status) return '—';
  const s = String(status).replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Label-case a raw identifier: "lab_tech" → "Lab Tech", "x-ray" → "X-Ray".
 * Capitalizes only — casing already inside a word survives, so "ICU nurse"
 * reads "ICU Nurse" instead of "Icu Nurse". For enum-shaped status values
 * prefer `humanizeStatus`, which sentence-cases the whole label.
 */
export function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One canonical prescription sig line: "500mg · Oral · BD · 30 days".
 *
 * Historical prescription docs (and some seeds) stored the whole sig in `dose`
 * ("500mg BD x 30 days") *while also* carrying separate `frequency`/`duration`
 * fields, so naive `dose · frequency · duration` concatenation printed the
 * frequency and duration twice. This helper appends each part only when the
 * dose string doesn't already contain it (word-boundary match, so a "20mg"
 * dose still gets an "OD" frequency appended), making it safe for both old
 * and new documents. Every surface that shows a sig should use this.
 */
export function formatRxSig(rx: {
  dose?: string | null;
  route?: string | null;
  frequency?: string | null;
  duration?: string | null;
}): string {
  const dose = (rx.dose || '').trim();
  const doseLower = dose.toLowerCase();
  const parts: string[] = dose ? [dose] : [];
  for (const raw of [rx.route, rx.frequency, rx.duration]) {
    const v = (raw || '').trim();
    if (!v) continue;
    const embedded = dose
      && new RegExp(`(^|[^a-z0-9])${escapeRegExp(v.toLowerCase())}($|[^a-z0-9])`).test(doseLower);
    if (embedded) continue;
    if (parts.some(p => p.toLowerCase() === v.toLowerCase())) continue;
    parts.push(v);
  }
  return parts.join(' · ');
}
