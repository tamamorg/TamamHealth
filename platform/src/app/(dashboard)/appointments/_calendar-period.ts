/**
 * The window a calendar view is showing, and what to call it.
 *
 * The day bar states a period and a count side by side, so both have to come
 * from the same window — a header reading "Aug 20 – 21" over "89 appointments"
 * is not a rounding error, it is two different questions answered in one line.
 *
 * Kept out of the page (and out of the calendar component, which carries
 * react-big-calendar with it) so the numbers on screen can be tested without
 * mounting either.
 */

export type CalendarView = 'month' | 'week' | 'day';

/**
 * Half-open `[start, end)` — the end is exclusive, so counting is a plain
 * range filter with no "is this the last millisecond of the day" edge.
 *
 * Week starts Sunday, matching the calendar's own localizer; the day view is
 * two days, matching the two-day grid it renders.
 */
export function calendarPeriodRange(view: CalendarView, date: Date): { start: Date; end: Date } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  if (view === 'week') start.setDate(start.getDate() - start.getDay());
  if (view === 'month') start.setDate(1);

  const end = new Date(start);
  if (view === 'month') end.setMonth(end.getMonth() + 1);
  else end.setDate(start.getDate() + (view === 'week' ? 7 : 2));

  return { start, end };
}

/** "August 2026", "Aug 16 – 22, 2026", "Aug 20 – 21, 2026". */
export function calendarPeriodLabel(view: CalendarView, date: Date): string {
  const { start, end } = calendarPeriodRange(view, date);
  if (view === 'month') return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // The range is half-open; the label names the last day inside it.
  const last = new Date(end);
  last.setDate(last.getDate() - 1);

  const from = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  // Written out for the same-month case rather than formatted: asking
  // toLocaleDateString for a day and a year with no month renders
  // "2026 (day: 21)", which is how "Aug 20 – 2026 (day: 21)" reached the header.
  const to = last.getMonth() === start.getMonth()
    ? `${last.getDate()}, ${last.getFullYear()}`
    : last.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${from} – ${to}`;
}

/** How many of `events` fall in the window the view is showing. */
export function countInPeriod(events: { start: Date }[], view: CalendarView, date: Date): number {
  const { start, end } = calendarPeriodRange(view, date);
  return events.filter(event => event.start >= start && event.start < end).length;
}
