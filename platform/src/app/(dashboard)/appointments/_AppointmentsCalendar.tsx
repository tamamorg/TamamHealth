'use client';

import React from 'react';
import { ChevronLeft, ChevronRight } from '@/components/icons/lucide';
import type { AppointmentStatus, AppointmentDoc } from '@/lib/db-types';
import { Calendar as BigCalendar, dateFnsLocalizer, type View, type ToolbarProps } from 'react-big-calendar';
import { format as dfFormat, parse as dfParse, startOfWeek as dfStartOfWeek, getDay as dfGetDay } from 'date-fns';
import { enUS } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { jubaNow } from '@/lib/time-juba';

// Google-Calendar-style localizer (date-fns, MIT) shared by the calendar view.
const calendarLocalizer = dateFnsLocalizer({
  format: dfFormat,
  parse: dfParse,
  startOfWeek: () => dfStartOfWeek(new Date(), { weekStartsOn: 0 }),
  getDay: dfGetDay,
  locales: { 'en-US': enUS },
});

// Event shape fed to react-big-calendar; keeps the full appointment on `resource`.
export type CalEvent = { id: string; title: string; start: Date; end: Date; resource: AppointmentDoc };

/**
 * Full width when a booking is alone at its time; equal columns when it is not.
 *
 * The day used to be drawn as a single stack, one appointment per row, because
 * the schedule refused two bookings in the same slot anywhere in the facility.
 * That rule is gone: two clinicians genuinely do see two patients at 09:00, so
 * the column has to divide.
 *
 * Neither built-in algorithm is right here. `overlap` cascades events on top of
 * each other, and `no-overlap` narrows an event whenever anything *anywhere in
 * the day* chains into it, which is what produced the ragged half/third/full
 * mix where some names were readable and others were a sliver.
 *
 * This splits by CONCURRENCY CLUSTER instead: events are grouped into runs that
 * actually overlap in time, and each cluster divides its width evenly. A 09:00
 * on its own still takes the full column; two at 09:00 take half each and stay
 * equal — the eye can compare them without working out which width means what.
 *
 * Signature is react-big-calendar's `dayLayoutAlgorithm` contract — it hands us
 * the events plus the `slotMetrics` that convert a time range into the column's
 * top/height percentages, and expects styled events back.
 */
type SlotMetrics = {
  getRange: (start: Date, end: Date) => { top: number; height: number };
};

export function stackedDayLayout({
  events, slotMetrics, accessors,
}: {
  events: CalEvent[];
  slotMetrics: SlotMetrics;
  accessors: { start: (e: CalEvent) => Date; end: (e: CalEvent) => Date };
}) {
  const sorted = [...events].sort((a, b) => (
    +accessors.start(a) - +accessors.start(b) || +accessors.end(a) - +accessors.end(b)
  ));

  // Walk the day once, breaking a cluster whenever a booking starts at or after
  // everything before it has finished.
  const clusters: CalEvent[][] = [];
  let current: CalEvent[] = [];
  let clusterEnd = -Infinity;

  for (const event of sorted) {
    const start = +accessors.start(event);
    const end = +accessors.end(event);
    if (current.length && start >= clusterEnd) {
      clusters.push(current);
      current = [];
      clusterEnd = -Infinity;
    }
    current.push(event);
    clusterEnd = Math.max(clusterEnd, end);
  }
  if (current.length) clusters.push(current);

  return clusters.flatMap(cluster => {
    const width = 100 / cluster.length;
    return cluster.map((event, index) => {
      const { top, height } = slotMetrics.getRange(accessors.start(event), accessors.end(event));
      return {
        event,
        style: { top, height, width, xOffset: width * index },
      };
    });
  });
}

/**
 * "4pm", "11am", "1:30pm" — Google Calendar's month-view clock.
 *
 * Lowercase meridiem, no leading zero, and `:00` dropped entirely, because in a
 * month grid the time is a prefix the eye skims past on its way to the name.
 * Written out rather than taken from `toLocaleTimeString`, which renders
 * "4:00 PM" — three characters wider per row, in the column that is scarcest.
 */
export function calendarClock(date: Date, withMeridiem = true): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const meridiem = withMeridiem ? (hours < 12 ? 'am' : 'pm') : '';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return minutes === 0
    ? `${hour12}${meridiem}`
    : `${hour12}:${String(minutes).padStart(2, '0')}${meridiem}`;
}

/**
 * "7 – 10am", "11am – 12pm", "1:30 – 5pm" — the second line of a week/day block.
 *
 * The start drops its meridiem when both ends share one, because "7am – 10am"
 * spends four characters restating something the reader has already been told.
 * Google's own blocks read this way, and in a column narrow enough to hold two
 * concurrent clinics those four characters are the difference between seeing
 * the patient's surname and not.
 */
export function calendarRange(start: Date, end: Date): string {
  const sameHalf = (start.getHours() < 12) === (end.getHours() < 12);
  return `${calendarClock(start, !sameHalf)} – ${calendarClock(end)}`;
}

/**
 * Below this a block cannot hold two lines, so the time joins the title on one
 * ("Teny/Krista, 12pm" in Google). Measured, not guessed: at 56px per hour a
 * 30-minute block is 28px, and one 16px line plus padding already fills it.
 */
const TWO_LINE_MINUTES = 45;

// Calendar toolbar: icon prev/next + the period label on the left, and the
// day/week/month view switcher docked on the right (mirrors the same filter
// that lives beside the search bar — both drive the calendar granularity).
const rbcNavBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--glass-border)',
  borderRadius: 8,
  width: 32,
  height: 32,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  color: 'var(--text-secondary)',
  transition: 'background 0.15s',
};
const CAL_VIEWS: ('day' | 'week' | 'month')[] = ['day', 'week', 'month'];

function CalToolbar({ label, onNavigate, onView, view }: ToolbarProps<CalEvent, object>) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
      {/* Today */}
      <button
        type="button"
        onClick={() => onNavigate('TODAY')}
        style={{
          height: 32, padding: '0 14px', borderRadius: 8,
          border: '1px solid var(--glass-border)',
          background: 'var(--bg-card-solid)',
          color: 'var(--text-secondary)',
          fontSize: 13, fontWeight: 600, cursor: 'pointer',
          fontFamily: "var(--font-platform)",
          whiteSpace: 'nowrap',
        }}
      >
        Today
      </button>
      {/* Prev / Next */}
      <button type="button" onClick={() => onNavigate('PREV')} aria-label="Previous" style={rbcNavBtn}>
        <ChevronLeft size={16} />
      </button>
      <button type="button" onClick={() => onNavigate('NEXT')} aria-label="Next" style={rbcNavBtn}>
        <ChevronRight size={16} />
      </button>
      {/* Period label */}
      <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>{label}</h3>
      {/* View switcher */}
      <div style={{ marginInlineStart: 'auto', display: 'flex', height: 32, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--glass-border)', background: 'var(--bg-card-solid)' }}>
        {CAL_VIEWS.map((v, i) => (
          <button
            key={v}
            type="button"
            onClick={() => onView(v as View)}
            style={{
              display: 'flex', alignItems: 'center', padding: '0 14px',
              borderInlineStart: i === 0 ? 'none' : '1px solid var(--glass-border)',
              cursor: 'pointer', fontSize: 12, fontWeight: 600,
              textTransform: 'capitalize',
              fontFamily: "var(--font-platform)",
              background: view === v ? 'var(--accent-primary)' : 'transparent',
              color: view === v ? '#fff' : 'var(--text-secondary)',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * A week/day block: who it is, then when.
 *
 * The grid used to render the title alone and blank the time entirely, on the
 * reasoning that the left-hand gutter already says when — true only for a block
 * that starts exactly on a gutter line. A 09:15 appointment sitting a quarter of
 * the way down the 9 AM row left the reader measuring pixels, so the time is
 * back inside the block where Google keeps it.
 *
 * Short visits fold both onto one line rather than clipping a second one: a
 * 30-minute block is 28px tall and simply has no room for it.
 */
function SlotEvent({ event }: { event: CalEvent }) {
  const minutes = Math.round((event.end.getTime() - event.start.getTime()) / 60000);
  if (minutes < TWO_LINE_MINUTES) {
    return (
      <span className="gcal-slot is-compact">
        <span className="gcal-slot-title">{event.title}</span>
        <span className="gcal-slot-time">, {calendarClock(event.start)}</span>
      </span>
    );
  }
  return (
    <span className="gcal-slot">
      <span className="gcal-slot-title">{event.title}</span>
      <span className="gcal-slot-time">{calendarRange(event.start, event.end)}</span>
    </span>
  );
}

/**
 * Column header: the weekday over a date badge, with today's date in a filled
 * circle — Google's two-line header.
 *
 * The single-line "05 Wed" it replaces was styled with a 50%-radius background,
 * which on a label that wide drew a stretched ellipse rather than a badge. Two
 * lines also let the weekday shrink to a quiet uppercase label, so the date
 * itself is what the eye lands on.
 */
function SlotHeader({ date }: { date: Date }) {
  const now = jubaNow();
  const isToday = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  return (
    <span className="gcal-colhead">
      <span className="gcal-colhead-day">{dfFormat(date, 'EEE').toUpperCase()}</span>
      <span className={`gcal-colhead-date${isToday ? ' is-today' : ''}`}>{date.getDate()}</span>
    </span>
  );
}

type AppointmentsCalendarProps = {
  events: CalEvent[];
  calView: 'month' | 'week' | 'day';
  calDate: Date;
  today: string;
  statusConfig: Record<AppointmentStatus, { color: string; bg: string; label: string }>;
  onNavigate: (d: Date) => void;
  onView: (v: 'month' | 'week' | 'day') => void;
  onSelectEvent: (apt: AppointmentDoc) => void;
  onSelectSlot: (slot: { start: Date }) => void;
};

export default function AppointmentsCalendar({
  events, calView, calDate, today, statusConfig,
  onNavigate, onView, onSelectEvent, onSelectSlot,
}: AppointmentsCalendarProps) {
  const isMonth = calView === 'month';

  /**
   * A month row the Google way: a status dot, the time, then the patient.
   *
   * The month grid was rendering each appointment as a solid colour bar, which
   * put roughly six words of white-on-saturated text in a cell 100px tall — so
   * a busy Wednesday became a wall of colour with the times nowhere in it. As a
   * dot plus a leading time the same row costs one line, the day reads as a
   * schedule, and the status colour still carries at a glance.
   *
   * Memoised on `statusConfig`: react-big-calendar remounts every event when
   * the components object changes identity, which would restart the row
   * animation on each parent render.
   */
  const MonthEvent = React.useMemo(() => {
    function MonthEventRow({ event }: { event: CalEvent }) {
      const color = statusConfig[event.resource.status]?.color || 'var(--accent-primary)';
      return (
        <span className="gcal-event">
          <span className="gcal-event-dot" style={{ background: color }} aria-hidden />
          <span className="gcal-event-time">{calendarClock(event.start)}</span>
          <span className="gcal-event-title">{event.title}</span>
        </span>
      );
    }
    return MonthEventRow;
  }, [statusConfig]);

  const calendarComponents = React.useMemo(
    () => ({
      toolbar: CalToolbar,
      month: { event: MonthEvent },
      week: { event: SlotEvent, header: SlotHeader },
      day: { event: SlotEvent },
    }),
    [MonthEvent],
  );

  return (
    <BigCalendar<CalEvent, object>
      localizer={calendarLocalizer}
      events={events}
      startAccessor="start"
      endAccessor="end"
      date={calDate}
      getNow={jubaNow}
      onNavigate={(d: Date) => onNavigate(d)}
      view={calView as View}
      onView={(v: View) => onView(v as 'month' | 'week' | 'day')}
      views={['month', 'week', 'day']}
      popup
      style={{ height: '100%' }}
      scrollToTime={new Date(1970, 0, 1, 7, 0, 0)}
      // Full width alone, equal columns when concurrent — see
      // `stackedDayLayout`. Neither built-in algorithm does this: `overlap`
      // cascades and `no-overlap` narrows events that never actually collide.
      dayLayoutAlgorithm={stackedDayLayout as never}
      // The label is now a single ellipsised line, so the tooltip carries what
      // the block had to cut. (It was blanked while events wrapped and showed
      // their text in full — then it only repeated what was already on screen.)
      // The in-event time label stays hidden in day/week: the gutter on the
      // left already gives the time.
      tooltipAccessor={(e: CalEvent) => e.title}
      formats={{ eventTimeRangeFormat: () => '' }}
      components={calendarComponents}
      onSelectEvent={(e: { resource: AppointmentDoc }) => onSelectEvent(e.resource)}
      selectable
      onSelectSlot={(slot: { start: Date }) => onSelectSlot(slot)}
      eventPropGetter={(e: { resource: AppointmentDoc }) => {
        const a = e.resource;
        const statusColor = statusConfig[a.status]?.color || 'var(--accent-primary)';
        // Month rows carry their colour on the dot, so the row itself stays on
        // the page background — the block treatment belongs to day/week, where
        // an event's height is meaningful because it maps to its duration.
        if (isMonth) {
          return {
            className: 'gcal-event-row',
            style: { backgroundColor: 'transparent', color: 'var(--text-primary)', border: 'none' },
          };
        }
        return {
          style: {
            backgroundColor: statusColor,
            borderColor: statusColor,
            color: '#fff',
            borderRadius: 6,
            border: 'none',
            fontSize: 12,
            fontFamily: "var(--font-platform)",
            fontWeight: 600,
            boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
          },
        };
      }}
      dayPropGetter={(d: Date) => {
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return iso === today ? { style: { backgroundColor: 'var(--accent-light)' } } : {};
      }}
    />
  );
}
