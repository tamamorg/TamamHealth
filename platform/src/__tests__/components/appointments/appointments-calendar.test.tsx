import { renderToStaticMarkup } from 'react-dom/server';
import AppointmentsCalendar, { stackedDayLayout, calendarRange, type CalEvent } from '@/app/(dashboard)/appointments/_AppointmentsCalendar';
import type { AppointmentDoc, AppointmentPriority, AppointmentStatus } from '@/lib/db-types';

const at = (hour: number, minute = 0) => new Date(2026, 7, 20, hour, minute, 0);

const event = (id: string, start: Date, end: Date): CalEvent => ({
  id,
  title: id,
  start,
  end,
  resource: { _id: id } as AppointmentDoc,
});

// The real `slotMetrics` maps a time range onto the column; the layout only
// passes those numbers through, so a stub is enough to test the widths.
const slotMetrics = {
  getRange: (start: Date, end: Date) => ({
    top: start.getHours(),
    height: (end.getTime() - start.getTime()) / 3600000,
  }),
};
const accessors = { start: (e: CalEvent) => e.start, end: (e: CalEvent) => e.end };

const layout = (events: CalEvent[]) => stackedDayLayout({ events, slotMetrics, accessors });

describe('day/week block layout', () => {
  it('gives a booking the full column when nothing overlaps it', () => {
    const [first, second] = layout([
      event('09:00', at(9), at(10)),
      event('10:00', at(10), at(11)),
    ]);

    expect(first.style).toMatchObject({ width: 100, xOffset: 0 });
    expect(second.style).toMatchObject({ width: 100, xOffset: 0 });
  });

  it('gives two overlapping bookings two different shapes', () => {
    const [first, second] = layout([
      event('a', at(9), at(10)),
      event('b', at(9, 30), at(10, 30)),
    ]);

    // Blocked on its right, so it runs under its neighbour rather than
    // stopping at a half-column — a different shape, not a narrower twin.
    expect(first.style).toMatchObject({ xOffset: 0 });
    expect(first.style.width).toBeGreaterThan(50);
    expect(second.style).toMatchObject({ xOffset: 50, width: 50 });
    expect(first.style.width).not.toBe(second.style.width);
    // The later column is painted after, so it lands on top of the overlap.
    expect(first.event.id).toBe('a');
    expect(second.event.id).toBe('b');
  });

  it('reuses a column once its last booking has finished', () => {
    // 4–6, 4:30–8 and 7–11: the 7pm reuses the 4pm's column, so the day is
    // two columns wide, not three.
    const laid = layout([
      event('4pm', at(16), at(18)),
      event('4:30pm', at(16, 30), at(20)),
      event('7pm', at(19), at(23)),
    ]);
    const byId = Object.fromEntries(laid.map(l => [l.event.id, l.style]));

    expect(byId['4pm'].xOffset).toBe(0);
    expect(byId['7pm'].xOffset).toBe(0);
    expect(byId['4:30pm']).toMatchObject({ xOffset: 50, width: 50 });
    expect(byId['4pm'].width).toBeGreaterThan(50);
  });

  it('widens a booking through the columns nothing overlaps it in', () => {
    // Three columns are open for the morning, but the 11am only shares its
    // time with the long 9–12 — so it spans the two columns to its right.
    const laid = layout([
      event('long', at(9), at(12)),
      event('short', at(9, 30), at(10)),
      event('brief', at(9, 40), at(9, 50)),
      event('later', at(11), at(11, 30)),
    ]);
    const byId = Object.fromEntries(laid.map(l => [l.event.id, l.style]));

    expect(byId['later'].xOffset).toBeCloseTo(100 / 3);
    expect(byId['later'].width).toBeCloseTo(200 / 3);
    // The 9–12 underneath it is blocked on both sides, so it stays narrow.
    expect(byId['long'].width).toBeLessThan(byId['later'].width);
  });

  it('starts a new cluster once the previous run has finished', () => {
    const laid = layout([
      event('a', at(9), at(10)),
      event('b', at(9, 30), at(10, 30)),
      event('c', at(14), at(15)),
    ]);

    expect(laid[2].style).toMatchObject({ width: 100, xOffset: 0 });
  });

  it('drops the repeated meridiem inside one half of the day', () => {
    expect(calendarRange(at(7), at(10))).toBe('7 – 10am');
    expect(calendarRange(at(11), at(13))).toBe('11am – 1pm');
  });
});

describe('the day view is two days', () => {
  const statusConfig = {
    scheduled: { color: '#0F6FA8', bg: '#E7F1F8', label: 'Scheduled' },
  } as unknown as Record<AppointmentStatus, { color: string; bg: string; label: string }>;
  const priorityConfig = {
    routine: { color: '#0B7A54', label: 'Routine' },
  } as unknown as Record<AppointmentPriority, { color: string; label: string }>;

  const booking = {
    _id: 'a1',
    patientName: 'Nyandeng Deng',
    reason: 'Follow-up',
    status: 'scheduled',
    priority: 'routine',
    appointmentDate: '2026-08-20',
    appointmentTime: '09:00',
    duration: 90,
    department: 'Outpatient',
  } as unknown as AppointmentDoc;

  const render = (calView: 'day' | 'week' | 'month') => renderToStaticMarkup(
    <AppointmentsCalendar
      events={[{
        id: 'a1',
        title: 'Nyandeng Deng · Follow-up',
        start: new Date(2026, 7, 20, 9, 0),
        end: new Date(2026, 7, 20, 10, 30),
        resource: booking,
      }]}
      calView={calView}
      calDate={new Date(2026, 7, 20, 12, 0)}
      today="2026-08-20"
      statusConfig={statusConfig}
      priorityConfig={priorityConfig}
      onNavigate={() => {}}
      onView={() => {}}
      onSelectEvent={() => {}}
      onSelectSlot={() => {}}
    />,
  );

  it('draws today and the next day as two columns', () => {
    document.body.innerHTML = render('day');

    expect(document.querySelectorAll('.rbc-day-slot')).toHaveLength(2);
    expect([...document.querySelectorAll('.gcal-colhead-date')].map(el => el.textContent)).toEqual(['20', '21']);
    // Only the first of the pair is today.
    expect(document.querySelectorAll('.gcal-colhead-date.is-today')).toHaveLength(1);
  });

  it('puts the patient, the time and where the visit is inside the block', () => {
    document.body.innerHTML = render('day');

    expect(document.querySelector('.gcal-slot-title')?.textContent).toBe('Nyandeng Deng · Follow-up');
    expect(document.querySelector('.gcal-slot-time')?.textContent).toBe('9 – 10:30am');
    expect(document.querySelector('.gcal-slot-where')?.textContent).toBe('Outpatient');
  });

  it('leaves month and week to react-big-calendar', () => {
    document.body.innerHTML = render('month');
    expect(document.querySelector('.rbc-month-view')).not.toBeNull();

    document.body.innerHTML = render('week');
    expect(document.querySelectorAll('.rbc-day-slot')).toHaveLength(7);
  });
});
