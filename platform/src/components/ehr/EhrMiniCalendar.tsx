'use client';

import { Calendar, ChevronLeft, ChevronRight } from '@/components/icons/lucide';

export function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseIsoDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

export function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(date: Date, offset: number) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

export function addDays(date: Date, offset: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + offset);
  return copy;
}

export function formatDateTitle(value: string) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: '2-digit' }).format(parseIsoDate(value));
}

export function formatMonthTitle(value: Date) {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(value);
}

export default function EhrMiniCalendar({
  month,
  selectedDate,
  today,
  eventDates,
  onMonthChange,
  onDateSelect,
}: {
  month: Date;
  selectedDate: string;
  today: string;
  eventDates: string[];
  onMonthChange: (month: Date) => void;
  onDateSelect: (date: string) => void;
}) {
  const eventDateCounts = eventDates.reduce<Map<string, number>>((counts, date) => {
    counts.set(date, (counts.get(date) || 0) + 1);
    return counts;
  }, new Map());
  const monthStart = startOfMonth(month);
  const gridStart = addDays(monthStart, -monthStart.getDay());
  const cells = Array.from({ length: 42 }).map((_, index) => {
    const date = addDays(gridStart, index);
    const iso = toIsoDate(date);
    return {
      iso,
      day: date.getDate(),
      inMonth: date.getMonth() === month.getMonth(),
      isToday: iso === today,
      isSelected: iso === selectedDate,
      count: eventDateCounts.get(iso) || 0,
    };
  });

  return (
    <div className="ehr-mini-calendar">
      {/* The design anchors every rail calendar with a full-width "Go to
          today" — one press home from any month the rail has wandered to. */}
      <button
        type="button"
        className="ehr-mini-calendar-goto"
        onClick={() => {
          onDateSelect(today);
          onMonthChange(startOfMonth(parseIsoDate(today)));
        }}
      >
        <Calendar className="w-4 h-4" /> Go to today
      </button>
      <div className="ehr-mini-calendar-title">
        <button type="button" onClick={() => onMonthChange(addMonths(month, -1))} aria-label="Previous month">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span>{formatMonthTitle(month)}</span>
        <button type="button" onClick={() => onMonthChange(addMonths(month, 1))} aria-label="Next month">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      <div className="ehr-mini-calendar-grid">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <b key={`${day}-${index}`}>{day}</b>)}
        {cells.map(cell => (
          <button
            key={cell.iso}
            type="button"
            className={[
              cell.isToday ? 'today' : '',
              cell.isSelected ? 'selected' : '',
              !cell.inMonth ? 'muted' : '',
              cell.count > 0 ? 'has-events' : '',
            ].filter(Boolean).join(' ')}
            onClick={() => {
              onDateSelect(cell.iso);
              if (!cell.inMonth) onMonthChange(startOfMonth(parseIsoDate(cell.iso)));
            }}
            aria-pressed={cell.isSelected}
            aria-label={`${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(parseIsoDate(cell.iso))}${cell.count ? `, ${cell.count} item${cell.count === 1 ? '' : 's'}` : ''}`}
          >
            <span>{cell.day}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
