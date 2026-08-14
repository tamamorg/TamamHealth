'use client';

import { useState } from 'react';
import { BarChart3, ChevronLeft, ChevronRight } from '@/components/icons/lucide';
import { addDays, parseIsoDate, toIsoDate } from '@/components/ehr/EhrMiniCalendar';

/** One unit of work plotted on the chart: a row, appointment or order. */
export type DayStatsItem = {
  /** ISO date (yyyy-mm-dd). Items without one are treated as today's work. */
  date?: string;
  /** Clock time ("08:20", "8:20 AM"). Untimed items are skipped — see below. */
  time?: string;
  /** Which of the two series this item belongs to. Defaults to the second. */
  series?: 0 | 1;
};

/* ─── Day statistics (left rail) ───
   The single day-activity widget shared by every EHR dashboard: a compact
   grouped-bar chart of one day's work in two-hour blocks, split into two
   series. The Clinical Officer dashboard names them Inpatient / Outpatient;
   other stations pass their own pair (Dispensed / Pending, …) so the widget
   reads the same everywhere while the data stays role-specific.

   The ‹ › controls step the focused day and stay visible even when the day is
   empty, so navigation is never dead-ended. Series colors come from the --viz-*
   custom properties on .ehr-day-stats so dark mode swaps validated steps rather
   than dimming the light ones.

   Items with no clock time are skipped rather than bucketed at a guessed hour —
   an invented 07:00 bar would misreport when the work actually happened. */
export default function EhrDayStatsChart({
  items,
  seriesNames,
  selectedDate,
  todayIso,
  title = 'Day statistics',
}: {
  items: DayStatsItem[];
  seriesNames: [string, string];
  selectedDate: string;
  todayIso: string;
  title?: string;
}) {
  // Chart-local focus day: follows the dashboard's selected date, but the
  // ‹ › controls can step it independently without changing the work list.
  // Re-synced during render rather than in an effect (React's "adjusting state
  // when a prop changes" pattern) so picking a date doesn't cost a second pass.
  const [focusDate, setFocusDate] = useState(selectedDate);
  const [syncedDate, setSyncedDate] = useState(selectedDate);
  if (selectedDate !== syncedDate) {
    setSyncedDate(selectedDate);
    setFocusDate(selectedDate);
  }
  const stepFocus = (days: number) => setFocusDate(current => toIsoDate(addDays(parseIsoDate(current), days)));

  const dayLabel = focusDate === todayIso
    ? 'Today'
    : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(parseIsoDate(focusDate));

  // Two-hour buckets covering the working day (07:00–19:00); earlier/later
  // items clamp into the first/last block.
  const buckets = [7, 9, 11, 13, 15, 17].map(start => ({ start, counts: [0, 0] }));
  const totals = [0, 0];
  let untimed = 0;
  for (const item of items) {
    if ((item.date || todayIso) !== focusDate) continue;
    const hour = parseHour(item.time);
    if (hour === null) { untimed += 1; continue; }
    const seriesIndex = item.series === 0 ? 0 : 1;
    const bucketIndex = Math.min(Math.max(Math.floor((hour - 7) / 2), 0), buckets.length - 1);
    buckets[bucketIndex].counts[seriesIndex] += 1;
    totals[seriesIndex] += 1;
  }
  const total = totals[0] + totals[1];
  const peak = Math.max(...buckets.map(bucket => Math.max(bucket.counts[0], bucket.counts[1])));
  // Even headroom so the midpoint gridline lands on a whole number.
  const yMax = Math.max(4, Math.ceil(peak / 2) * 2);

  // Geometry: 216×132 viewBox, plot from y=8 (top) to y=112 (baseline),
  // x from 20 (after tick labels) in 32px groups of two 7px bars + 2px gap.
  const plotTop = 8;
  const baseline = 112;
  const plotHeight = baseline - plotTop;
  const barY = (value: number) => baseline - (value / yMax) * plotHeight;
  const ticks = [0, yMax / 2, yMax];
  const seriesFill = ['var(--viz-inpatient)', 'var(--viz-outpatient)'];
  const summary = `${dayLabel} · ${totals[0]} ${seriesNames[0].toLowerCase()} · ${totals[1]} ${seriesNames[1].toLowerCase()}`;

  return (
    <div className="ehr-day-stats">
      <div className="ehr-side-card-head">
        <BarChart3 className="w-5 h-5" />
        <h2>{title}</h2>
        <div className="ehr-day-stats-nav">
          <button type="button" aria-label="Previous day" onClick={() => stepFocus(-1)}>
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button type="button" aria-label="Next day" onClick={() => stepFocus(1)}>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <p>{summary}</p>
      {total === 0 ? (
        <p className="ehr-day-stats-empty">
          {untimed > 0
            ? `${untimed} item${untimed === 1 ? '' : 's'} on this day without a recorded time.`
            : 'No activity on this day.'}
        </p>
      ) : (
        <>
          <svg viewBox="0 0 216 132" role="img" aria-label={`${dayLabel} activity by time of day: ${summary}`}>
            {ticks.map(tick => (
              <g key={tick}>
                <line x1={20} x2={212} y1={barY(tick)} y2={barY(tick)} stroke="var(--ehr-border)" strokeWidth={1} />
                <text x={16} y={barY(tick) + 2.5} textAnchor="end" fontSize={8} fill="var(--ehr-muted)">{tick}</text>
              </g>
            ))}
            {buckets.map((bucket, index) => {
              const x0 = 20 + index * 32 + 8;
              const hourLabel = `${String(bucket.start).padStart(2, '0')}:00`;
              return (
                <g key={bucket.start}>
                  {bucket.counts.map((count, seriesIndex) => count > 0 && (
                    <rect
                      key={seriesIndex}
                      className="ehr-day-stats-bar"
                      x={x0 + seriesIndex * 9}
                      y={barY(count)}
                      width={7}
                      height={baseline - barY(count)}
                      rx={2}
                      fill={seriesFill[seriesIndex]}
                    >
                      <title>{`${hourLabel} — ${count} ${seriesNames[seriesIndex].toLowerCase()}`}</title>
                    </rect>
                  ))}
                  <text x={x0 + 8} y={126} textAnchor="middle" fontSize={8} fill="var(--ehr-muted)">{hourLabel}</text>
                </g>
              );
            })}
          </svg>
          <div className="ehr-day-stats-legend">
            <span><i style={{ background: seriesFill[0] }} /> {seriesNames[0]}</span>
            <span><i style={{ background: seriesFill[1] }} /> {seriesNames[1]}</span>
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Weekly activity (doctor dashboard) ───
   One stacked bar per weekday for the week containing the selected date —
   series 1 (outpatient) on top of series 0 (inpatient). The selected day
   renders at full strength, the rest ghosted. Untimed items still count
   (a day bucket needs no clock time), so the bars agree with the worklist.
   Clicking a bar re-focuses the dashboard on that date. */
export function EhrWeekActivityChart({
  items,
  seriesNames,
  selectedDate,
  todayIso,
  onSelectDate,
  title = 'Day activity',
}: {
  items: DayStatsItem[];
  seriesNames: [string, string];
  selectedDate: string;
  todayIso: string;
  onSelectDate?: (iso: string) => void;
  title?: string;
}) {
  const selected = parseIsoDate(selectedDate);
  // Sunday-start week, matching the mini-calendar's S M T W T F S header.
  const selectedWeekStart = addDays(selected, -selected.getDay());
  const itemDates = items
    .map(item => item.date || todayIso)
    .filter((date): date is string => Boolean(date) && /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  const selectedWeekEndIso = toIsoDate(addDays(selectedWeekStart, 6));
  const selectedWeekHasData = itemDates.some(date => date >= toIsoDate(selectedWeekStart) && date <= selectedWeekEndIso);
  const latestItemDate = itemDates[itemDates.length - 1];
  const activeDate = selectedWeekHasData || !latestItemDate ? selected : parseIsoDate(latestItemDate);
  const activeWeekStart = addDays(activeDate, -activeDate.getDay());
  const activeSelectedIso = selectedWeekHasData ? selectedDate : toIsoDate(activeDate);
  const activeWeekIsCurrent = toIsoDate(activeWeekStart) === toIsoDate(addDays(parseIsoDate(todayIso), -parseIsoDate(todayIso).getDay()));
  const days = buildWeekDays(activeWeekStart);
  const dayByIso = new Map(days.map(day => [day.iso, day]));
  for (const item of items) {
    const day = dayByIso.get(item.date || todayIso);
    if (day) day.counts[item.series === 0 ? 0 : 1] += 1;
  }
  const maxTotal = Math.max(1, ...days.map(day => day.counts[0] + day.counts[1]));
  const total = days.reduce((sum, day) => sum + day.counts[0] + day.counts[1], 0);
  // Tallest stack tops out at ~84% of the plot; non-zero segments keep a
  // visible minimum so a single visit never rounds away to nothing.
  const pct = (count: number) => (count === 0 ? 0 : Math.max(11, Math.round((count / maxTotal) * 88)));
  const dayTitle = (day: (typeof days)[number]) => {
    const label = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(day.date);
    return `${label} — ${day.counts[0]} ${seriesNames[0].toLowerCase()} · ${day.counts[1]} ${seriesNames[1].toLowerCase()}`;
  };

  return (
    <div className="ehr-day-stats ehr-week-activity">
      <div className="ehr-side-card-head">
        <BarChart3 className="w-5 h-5" />
        <h2>{title}</h2>
        <span className="ehr-week-activity-caption">{activeWeekIsCurrent ? 'This week' : 'Latest week'}</span>
      </div>
      {total === 0 ? (
        <p className="ehr-day-stats-empty">No activity this week.</p>
      ) : (
        <div className="ehr-week-activity-bars">
          {days.map(day => {
            const dayTotal = day.counts[0] + day.counts[1];
            const className = [
              day.iso === activeSelectedIso ? 'is-selected' : '',
              day.iso === todayIso ? 'is-today' : '',
              dayTotal === 0 ? 'is-empty' : '',
            ].filter(Boolean).join(' ') || undefined;
            return (
              <button
                key={day.iso}
                type="button"
                className={className}
                aria-label={dayTitle(day)}
                aria-pressed={day.iso === activeSelectedIso}
                title={dayTitle(day)}
                onClick={() => onSelectDate?.(day.iso)}
              >
                {/* The design draws the two series side by side — a navy bar
                    and an orange bar per day, each scaled to the week's
                    tallest combined day — not stacked segments. */}
                <span className="ehr-week-activity-track">
                  <i className="ehr-week-seg-in" style={{ height: `${pct(day.counts[0])}%` }} />
                  <i className="ehr-week-seg-out" style={{ height: `${pct(day.counts[1])}%` }} />
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div className="ehr-week-activity-days" aria-hidden="true">
        {days.map(day => (
          <span key={day.iso} className={day.iso === activeSelectedIso ? 'is-selected' : undefined}>
            {day.letter}
          </span>
        ))}
      </div>
      <div className="ehr-day-stats-legend">
        {/* Dots match the bars: the design's navy/orange pair. */}
        <span><i style={{ background: '#144972' }} /> {seriesNames[0]}</span>
        <span><i style={{ background: '#C2410C' }} /> {seriesNames[1]}</span>
      </div>
    </div>
  );
}

function buildWeekDays(weekStart: Date) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index);
    return {
      iso: toIsoDate(date),
      letter: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][index],
      counts: [0, 0] as [number, number],
      date,
    };
  });
}

/** Hour-of-day from "08:20", "8:20 AM" or "20:05"; null when absent/unparseable. */
function parseHour(time?: string): number | null {
  if (!time) return null;
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(time.trim());
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  if (!Number.isFinite(hour)) return null;
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  return hour;
}
