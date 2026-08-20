'use client';

import React from 'react';
import { ChevronLeft, ChevronRight } from '@/components/icons/lucide';
import type { AppointmentStatus, AppointmentPriority, AppointmentDoc } from '@/lib/db-types';
import { Calendar as BigCalendar, dateFnsLocalizer, type View, type ToolbarProps, type DateLocalizer } from 'react-big-calendar';
import TimeGrid from 'react-big-calendar/lib/TimeGrid';
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
 * How far a blocked booking runs *under* the one to its right, as a share of a
 * column. It is what makes two overlapping bookings read as two shapes at
 * different depths rather than two columns of a table.
 */
const COLUMN_OVERLAP = 0.7;

type SlotMetrics = {
  getRange: (start: Date, end: Date) => { top: number; height: number };
};

type Accessors = { start: (e: CalEvent) => Date; end: (e: CalEvent) => Date };

type Placed = { event: CalEvent; start: number; end: number; column: number };

/**
 * The day laid out the way Google Calendar lays it out.
 *
 * A booking alone at its time takes the whole column. Where bookings collide
 * they are packed into columns — first-fit, so a 7pm visit reuses the column a
 * 4pm visit has finished with — and then each block widens to the right
 * through every column that has nothing overlapping it. What is left is a set
 * of DIFFERENT shapes: the 4pm half-width, the 4:30 offset and running to the
 * edge, the 7pm back at the left and wide again. That difference is the point.
 * Equal columns (what this used to draw) made every collision look identical,
 * and a plain cascade made them look like one block with a shadow.
 *
 * A block that could not widen still runs `COLUMN_OVERLAP` of a column under
 * its right-hand neighbour, which is what gives the stack its depth. Nothing is
 * hidden by it: the neighbour starts where the block's own column ends, so the
 * text of every booking has its full column to be read in.
 *
 * Signature is react-big-calendar's `dayLayoutAlgorithm` contract — it hands us
 * the events plus the `slotMetrics` that convert a time range into the column's
 * top/height percentages, and expects styled events back.
 */
export function stackedDayLayout({
  events, slotMetrics, accessors,
}: {
  events: CalEvent[];
  slotMetrics: SlotMetrics;
  accessors: Accessors;
}) {
  const sorted = [...events].sort((a, b) => (
    +accessors.start(a) - +accessors.start(b) || +accessors.end(a) - +accessors.end(b)
  ));

  // Walk the day once, breaking a cluster whenever a booking starts at or after
  // everything before it has finished. Clusters are independent: a busy morning
  // never narrows a lone afternoon visit.
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

  return clusters.flatMap(cluster => layoutCluster(cluster, slotMetrics, accessors));
}

function layoutCluster(cluster: CalEvent[], slotMetrics: SlotMetrics, accessors: Accessors) {
  // First-fit column packing: reuse the earliest column whose last booking has
  // already finished, otherwise open a new one.
  const columnEnds: number[] = [];
  const placed: Placed[] = cluster.map(event => {
    const start = +accessors.start(event);
    const end = +accessors.end(event);
    let column = columnEnds.findIndex(columnEnd => columnEnd <= start);
    if (column === -1) {
      columnEnds.push(end);
      column = columnEnds.length - 1;
    } else {
      columnEnds[column] = end;
    }
    return { event, start, end, column };
  });

  const columns = columnEnds.length;
  const unit = 100 / columns;

  return placed
    .slice()
    // Painted left to right, so a later column lands ON TOP of the block it
    // overlaps — the depth cue only reads in that order.
    .sort((a, b) => a.column - b.column || a.start - b.start)
    .map(item => {
      let span = 1;
      while (
        item.column + span < columns
        && !placed.some(other => (
          other.column === item.column + span && other.start < item.end && other.end > item.start
        ))
      ) span += 1;

      const xOffset = item.column * unit;
      const blocked = item.column + span < columns;
      const width = blocked
        ? Math.min((span + COLUMN_OVERLAP) * unit, 100 - xOffset)
        : 100 - xOffset;
      const { top, height } = slotMetrics.getRange(accessors.start(item.event), accessors.end(item.event));
      return { event: item.event, style: { top, height, width, xOffset } };
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

/**
 * And below this a third line would be clipped, so the room / department is
 * only printed on a block with the height to hold it — an hour and a quarter
 * at the current 96px hour.
 */
const THREE_LINE_MINUTES = 75;

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
function CalToolbar({ onNavigate }: ToolbarProps<CalEvent, object>) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
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
      <button type="button" onClick={() => onNavigate('PREV')} aria-label="Previous" style={rbcNavBtn}>
        <ChevronLeft size={16} />
      </button>
      <button type="button" onClick={() => onNavigate('NEXT')} aria-label="Next" style={rbcNavBtn}>
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

/* ─── The day view is two days ────────────────────────────────────────────
   A clinic reads forward: what is left of today, and what is waiting
   tomorrow. react-big-calendar's own `day` view draws exactly one column, so
   this is a custom view over its `TimeGrid` — the same grid the week view is
   built from, given a two-day range. The statics are the view contract:
   `range` is what it draws, `navigate` is what the arrows step by (two days,
   so paging never lands mid-pair), and `title` is what the toolbar would say
   if we were still letting it say anything. */
const TWO_DAY_SPAN = 2;

type TwoDayContext = { localizer: DateLocalizer };

const TwoDayView = Object.assign(
  function TwoDayGrid(props: { date: Date; localizer: DateLocalizer } & Record<string, unknown>) {
    const { date, localizer } = props;
    const range = TwoDayView.range(date, { localizer });
    return <TimeGrid {...props} range={range} eventOffset={15} />;
  },
  {
    range: (date: Date, { localizer }: TwoDayContext) => {
      const start = localizer.startOf(date, 'day');
      return Array.from({ length: TWO_DAY_SPAN }, (_, i) => localizer.add(start, i, 'day'));
    },
    navigate: (date: Date, action: string, { localizer }: TwoDayContext) => {
      if (action === 'PREV') return localizer.add(date, -TWO_DAY_SPAN, 'day');
      if (action === 'NEXT') return localizer.add(date, TWO_DAY_SPAN, 'day');
      return date;
    },
    title: (date: Date, { localizer }: TwoDayContext) => {
      const range = TwoDayView.range(date, { localizer });
      const last = range[range.length - 1];
      return `${localizer.format(range[0], 'MMM d')} – ${localizer.format(last, 'MMM d, yyyy')}`;
    },
  },
);

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
  // Where the visit happens — the room if one is assigned, else the
  // department. It is the third thing a clerk looks for after who and when,
  // and on a long block it was empty space.
  const where = event.resource.room || event.resource.department;
  return (
    <span className="gcal-slot">
      <span className="gcal-slot-title">{event.title}</span>
      <span className="gcal-slot-time">{calendarRange(event.start, event.end)}</span>
      {minutes >= THREE_LINE_MINUTES && where && (
        <span className="gcal-slot-where">{where}</span>
      )}
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
  /** Acuity colours for the block's leading edge — see `eventPropGetter`. */
  priorityConfig: Record<AppointmentPriority, { color: string; label: string }>;
  onNavigate: (d: Date) => void;
  onView: (v: 'month' | 'week' | 'day') => void;
  onSelectEvent: (apt: AppointmentDoc) => void;
  onSelectSlot: (slot: { start: Date }) => void;
};

export default function AppointmentsCalendar({
  events, calView, calDate, today, statusConfig, priorityConfig,
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
      // Two columns now, so the day view needs the same weekday-over-date
      // header the week view has — otherwise there is nothing above the
      // divider saying which column is today and which is tomorrow.
      day: { event: SlotEvent, header: SlotHeader },
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
      // `day` is the two-day grid above; month and week stay built-in.
      views={{ month: true, week: true, day: TwoDayView as never }}
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
        // Two facts, two channels: the fill is the rung the booking is on, the
        // stripe down its leading edge is how urgent it is. They used to be one
        // colour doing both jobs badly — an emergency and a routine visit at the
        // same status were indistinguishable until the block was opened.
        return {
          className: 'gcal-block',
          style: {
            backgroundColor: statusColor,
            borderColor: statusColor,
            ['--gcal-accent' as string]: priorityConfig[a.priority]?.color || statusColor,
            color: '#fff',
            border: 'none',
            fontSize: 12,
            fontFamily: "var(--font-platform)",
            fontWeight: 600,
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
