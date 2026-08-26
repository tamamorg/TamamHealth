/**
 * Scheduling — appointment status model (src/lib/appointment-status.ts).
 *
 * Two invariants matter for correctness:
 *  - a COMPLETED appointment must NOT release its slot (the visit happened),
 *    while cancelled/no-show/rescheduled do,
 *  - legacy stored statuses fold onto their canonical offered value so old and
 *    new writers agree.
 */
import {
  canonicalAppointmentStatus,
  appointmentStatusGroup,
  APPOINTMENT_SLOT_RELEASED_STATUSES,
  APPOINTMENT_CLOSED_STATUSES,
  APPOINTMENT_STATUS_EXITS,
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_STATUS_COLORS,
  APPOINTMENT_STATUS_TONES,
  APPOINTMENT_STATUS_GROUP_LABELS,
  appointmentMatchesStatusFilter,
  appointmentStatusFilterKey,
} from '@/lib/appointment-status';
import type { AppointmentStatus } from '@/lib/db-types';

describe('appointment slot release', () => {
  test('cancelled / no_show / rescheduled release the slot', () => {
    for (const s of ['cancelled', 'no_show', 'rescheduled'] as const) {
      expect(APPOINTMENT_SLOT_RELEASED_STATUSES).toContain(s);
    }
  });
  test('completed does NOT release the slot (the visit occurred)', () => {
    expect(APPOINTMENT_SLOT_RELEASED_STATUSES).not.toContain('completed');
    // ...even though completed is a closed status.
    expect(APPOINTMENT_CLOSED_STATUSES).toContain('completed');
  });
});

describe('canonical status folding', () => {
  test('legacy statuses map onto their offered canonical value', () => {
    expect(canonicalAppointmentStatus('reminder_sent')).toBe('scheduled');
    expect(canonicalAppointmentStatus('confirmed')).toBe('scheduled');
    expect(canonicalAppointmentStatus('arrived')).toBe('checked_in');
    expect(canonicalAppointmentStatus('triaged')).toBe('in_progress');
  });
  test('offered statuses are unchanged by folding', () => {
    for (const s of ['scheduled', 'checked_in', 'in_progress', 'completed'] as const) {
      expect(canonicalAppointmentStatus(s)).toBe(s);
    }
  });
});

describe('three-lane grouping', () => {
  test('arrived stays in the scheduled lane (desk has not opened the visit)', () => {
    expect(appointmentStatusGroup('arrived')).toBe('scheduled');
  });
  test('in_progress is in-office and completed is finished', () => {
    expect(appointmentStatusGroup('in_progress')).toBe('in_office');
    expect(appointmentStatusGroup('completed')).toBe('finished');
  });
});

describe('exit statuses', () => {
  test('the exit set is exactly no_show / rescheduled / cancelled', () => {
    expect([...APPOINTMENT_STATUS_EXITS].sort()).toEqual(['cancelled', 'no_show', 'rescheduled']);
  });
});

/* ── Vocabulary coherence ──
   The three lanes (Upcoming / Checked In / Completed) are the platform's
   primary vocabulary, so a pill, its lane, its colour and the status filter
   must all agree about the same stored status. Each of these locks a
   contradiction that was live before the 2026-08 audit. */
describe('status vocabulary is self-consistent', () => {
  const ALL = Object.keys(APPOINTMENT_STATUS_LABELS) as AppointmentStatus[];

  test('no pill claims a lane it does not file in', () => {
    // `arrived` used to read "Checked In" while sitting under "Upcoming",
    // telling reception the visit was open when it was still theirs to open.
    for (const s of ALL) {
      const laneLabel = APPOINTMENT_STATUS_GROUP_LABELS[appointmentStatusGroup(s)];
      if (APPOINTMENT_STATUS_LABELS[s] === 'Checked In') {
        expect(laneLabel).toBe('In Facility');
      }
    }
    expect(APPOINTMENT_STATUS_LABELS.arrived).toBe('Arrived');
    expect(appointmentStatusGroup('arrived')).toBe('scheduled');
  });

  test('statuses reading the same word render the same colour and tone', () => {
    const byLabel = new Map<string, AppointmentStatus[]>();
    for (const s of ALL) {
      const label = APPOINTMENT_STATUS_LABELS[s];
      byLabel.set(label, [...(byLabel.get(label) ?? []), s]);
    }
    for (const [, group] of byLabel) {
      if (group.length < 2) continue;
      const colours = new Set(group.map(s => APPOINTMENT_STATUS_COLORS[s].color));
      const tones = new Set(group.map(s => APPOINTMENT_STATUS_TONES[s]));
      expect(colours.size).toBe(1);
      expect(tones.size).toBe(1);
    }
  });

  test('a status filter returns exactly what its label promises', () => {
    // Picking "Scheduled" catches the folded rungs that read "Scheduled"…
    for (const s of ['scheduled', 'reminder_sent', 'confirmed'] as AppointmentStatus[]) {
      expect(appointmentMatchesStatusFilter(s, 'scheduled')).toBe(true);
    }
    // …but "Checked In" must not sweep up a row whose pill reads "Arrived".
    expect(appointmentMatchesStatusFilter('arrived', 'checked_in')).toBe(false);
    expect(appointmentMatchesStatusFilter('arrived', 'arrived')).toBe(true);
    expect(appointmentMatchesStatusFilter('triaged', 'in_progress')).toBe(true);
  });

  test('every status counts into the bucket its filter selects', () => {
    for (const s of ALL) {
      expect(appointmentMatchesStatusFilter(s, appointmentStatusFilterKey(s))).toBe(true);
    }
  });
});
