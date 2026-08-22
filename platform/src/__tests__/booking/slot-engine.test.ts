/**
 * @jest-environment node
 *
 * The slot engine — what the public booking page is allowed to offer.
 *
 * ## Why this file was written twice
 *
 * `docs/ONLINE-BOOKING-AND-INTAKE-PLAN-2026-08.md` lists this engine under
 * "Delivered" as "Slot engine (pure, 57 tests)". Those tests were deleted in
 * `e581d4b6` ("remove obsolete test files") and never replaced, so 558 lines
 * of pure logic sitting behind `/api/booking/slots` — the endpoint a patient
 * hits from an SMS link — had no coverage at all, while the plan went on
 * asserting it had 57 tests.
 *
 * The cases below are taken from that document's own list, because it is the
 * closest thing to a specification the deleted suite left behind: recurrence
 * expansion, wall-clock arithmetic, buffer overlap, capacity > 1, the
 * lead-time boundary, reason-duration override, cancelled/no-show releasing a
 * slot, and hold expiry.
 *
 * Everything here is pure: string times in, string times out, `now` injected.
 * No clock, no database, no timezone library — which is exactly why losing the
 * tests was cheap and getting them back is too.
 */
import {
  computeSlots, expandWindows, windowIsEligible, reasonIsBookable, busyBlocksOn,
  toMinutes, toHHMM, dayOfWeek, addDays, datesBetween, slotIsStillOpen,
  type SlotQuery,
} from '@/lib/booking/slot-engine';
import type { AvailabilityDoc, AppointmentDoc } from '@/lib/db-types';
// The booking-specific documents live in their own module, not the main
// db-types barrel — which is where the engine itself imports them from.
import type { BookingPolicyDoc, SlotHoldDoc, VisitReasonDoc } from '@/lib/db-types-booking';

// ── Fixtures ────────────────────────────────────────────────────────────────
// Deliberately explicit rather than generated: a booking bug is almost always
// "these particular inputs produced the wrong list", so the inputs should be
// readable at the point of failure.

const policy = (over: Partial<BookingPolicyDoc> = {}): BookingPolicyDoc => ({
  _id: 'policy-1', type: 'booking_policy', orgId: 'org-a', facilityId: 'fac-1',
  onlineBookingEnabled: true, confirmationMode: 'auto',
  minLeadTimeMinutes: 0, maxAdvanceDays: 30,
  bufferBeforeMinutes: 0, bufferAfterMinutes: 0,
  defaultCapacity: 1, cancellationWindowHours: 24, requireInsurance: false,
  singleSlotPerFacility: false,
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
  ...over,
} as BookingPolicyDoc);

const reason = (over: Partial<VisitReasonDoc> = {}): VisitReasonDoc => ({
  _id: 'reason-1', type: 'visit_reason', orgId: 'org-a',
  name: 'General consultation', slug: 'general', durationMinutes: 30,
  availableToNewPatients: true, availableToReturningPatients: true,
  modality: 'in_person', providerIds: [], isActive: true,
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
  ...over,
} as VisitReasonDoc);

const window_ = (over: Partial<AvailabilityDoc> = {}): AvailabilityDoc => ({
  _id: 'win-1', type: 'availability', orgId: 'org-a',
  providerId: 'dr-wani', providerName: 'Dr. Wani',
  facilityId: 'fac-1', facilityName: 'Juba Teaching Hospital',
  date: '2026-09-07', startTime: '09:00', endTime: '10:00',
  status: 'open', bookableOnline: true,
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
  ...over,
} as AvailabilityDoc);

const appointment = (over: Partial<AppointmentDoc> = {}): AppointmentDoc => ({
  _id: 'appt-1', type: 'appointment', orgId: 'org-a',
  patientId: 'pat-1', patientName: 'Mary Lado',
  providerId: 'dr-wani', providerName: 'Dr. Wani',
  facilityId: 'fac-1', facilityName: 'Juba Teaching Hospital',
  facilityLevel: 'teaching_hospital',
  appointmentDate: '2026-09-07', appointmentTime: '09:00', duration: 30,
  status: 'scheduled', appointmentType: 'general', priority: 'routine',
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
  ...over,
} as AppointmentDoc);

const hold = (over: Partial<SlotHoldDoc> = {}): SlotHoldDoc => ({
  _id: 'hold-1', type: 'slot_hold', orgId: 'org-a', facilityId: 'fac-1',
  providerId: 'dr-wani', date: '2026-09-07', startTime: '09:00',
  durationMinutes: 30, expiresAt: '2026-09-01T10:00:00.000Z', holdToken: 'tok',
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
  ...over,
} as SlotHoldDoc);

const query = (over: Partial<SlotQuery> = {}): SlotQuery => ({
  from: '2026-09-07', to: '2026-09-07',
  now: { date: '2026-09-01', time: '08:00' },
  visitReason: reason(), patientClass: 'returning', channel: 'public',
  ...over,
});

/** Just the times, which is what nearly every assertion is really about. */
const times = (slots: { startTime: string }[]) => slots.map(s => s.startTime);

const NOW_ISO = '2026-09-01T08:00:00.000Z';

// ── Time helpers ────────────────────────────────────────────────────────────

describe('wall-clock arithmetic', () => {
  it('round-trips a time', () => {
    expect(toHHMM(toMinutes('09:30'))).toBe('09:30');
    expect(toMinutes('00:00')).toBe(0);
    expect(toHHMM(1439)).toBe('23:59');
  });

  it('reports an unparseable time rather than guessing', () => {
    // The engine skips NaN starts. Silently treating "9am" as midnight would
    // put a slot at the top of the day.
    expect(Number.isNaN(toMinutes('9am'))).toBe(true);
    expect(Number.isNaN(toMinutes(''))).toBe(true);
  });

  it('walks dates without a Date object, across a month boundary', () => {
    // There is no DST in Africa/Juba, but the engine still avoids Date on
    // purpose — string dates cannot drift by an hour.
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31');
    expect(datesBetween('2026-08-30', '2026-09-02'))
      .toEqual(['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
  });

  it('knows the weekday', () => {
    expect(dayOfWeek('2026-09-07')).toBe(1); // a Monday
  });
});

// ── Recurrence ──────────────────────────────────────────────────────────────

describe('recurrence expansion', () => {
  it('covers exactly its own date when there is no recurrence', () => {
    const out = expandWindows([window_()], '2026-09-01', '2026-09-30');
    expect(out.map(w => w.date)).toEqual(['2026-09-07']);
  });

  it('repeats on the named weekdays until the series ends', () => {
    const weekly = window_({
      date: '2026-09-07',
      recurrence: { daysOfWeek: [1, 3], until: '2026-09-18' },
    } as Partial<AvailabilityDoc>);
    expect(expandWindows([weekly], '2026-09-01', '2026-09-30').map(w => w.date))
      .toEqual(['2026-09-07', '2026-09-09', '2026-09-14', '2026-09-16']);
  });

  it('honours a single-date exception without breaking the series', () => {
    // The clinic is shut one Wednesday. Every other date still stands.
    const weekly = window_({
      date: '2026-09-07',
      recurrence: { daysOfWeek: [1, 3], until: '2026-09-18', exceptions: ['2026-09-09'] },
    } as Partial<AvailabilityDoc>);
    expect(expandWindows([weekly], '2026-09-01', '2026-09-30').map(w => w.date))
      .toEqual(['2026-09-07', '2026-09-14', '2026-09-16']);
  });

  it('never starts before the series does, or runs past its end', () => {
    const weekly = window_({
      date: '2026-09-14',
      recurrence: { daysOfWeek: [1], until: '2026-09-21' },
    } as Partial<AvailabilityDoc>);
    expect(expandWindows([weekly], '2026-09-01', '2026-09-30').map(w => w.date))
      .toEqual(['2026-09-14', '2026-09-21']);
  });

  it('drops a cancelled window entirely, recurring or not', () => {
    const cancelled = window_({
      status: 'cancelled',
      recurrence: { daysOfWeek: [1], until: '2026-09-30' },
    } as Partial<AvailabilityDoc>);
    expect(expandWindows([cancelled], '2026-09-01', '2026-09-30')).toEqual([]);
  });
});

// ── Eligibility ─────────────────────────────────────────────────────────────

describe('which windows a channel may see', () => {
  it('shows the public only windows that opted in', () => {
    const closed = window_({ bookableOnline: false });
    expect(windowIsEligible(closed, query({ channel: 'public' }))).toBe(false);
    // The desk may book into any open window — a person is making the call.
    expect(windowIsEligible(closed, query({ channel: 'staff' }))).toBe(true);
  });

  it('respects a window reserved for one patient class', () => {
    const newOnly = window_({ patientClass: 'new' } as Partial<AvailabilityDoc>);
    expect(windowIsEligible(newOnly, query({ patientClass: 'new' }))).toBe(true);
    expect(windowIsEligible(newOnly, query({ patientClass: 'returning' }))).toBe(false);
    // Unset takes anybody.
    expect(windowIsEligible(window_(), query({ patientClass: 'new' }))).toBe(true);
  });

  it('respects a window limited to certain reasons', () => {
    const limited = window_({ visitReasonIds: ['reason-2'] } as Partial<AvailabilityDoc>);
    expect(windowIsEligible(limited, query())).toBe(false);
    expect(windowIsEligible(limited, query({ visitReason: reason({ _id: 'reason-2' }) }))).toBe(true);
  });

  it('respects a reason limited to certain providers', () => {
    const q = query({ visitReason: reason({ providerIds: ['dr-achol'] }) });
    expect(windowIsEligible(window_({ providerId: 'dr-wani' }), q)).toBe(false);
    expect(windowIsEligible(window_({ providerId: 'dr-achol' }), q)).toBe(true);
  });

  it('narrows by facility and provider when the query asks', () => {
    expect(windowIsEligible(window_(), query({ facilityIds: ['fac-2'] }))).toBe(false);
    expect(windowIsEligible(window_(), query({ providerIds: ['dr-achol'] }))).toBe(false);
  });
});

describe('which reasons may be booked', () => {
  it('never offers an inactive reason, on any channel', () => {
    expect(reasonIsBookable(query({ visitReason: reason({ isActive: false }) }))).toBe(false);
    expect(reasonIsBookable(query({ visitReason: reason({ isActive: false }), channel: 'staff' }))).toBe(false);
  });

  it('checks the patient class the reason is open to, online only', () => {
    const returningOnly = reason({ availableToNewPatients: false });
    expect(reasonIsBookable(query({ visitReason: returningOnly, patientClass: 'new' }))).toBe(false);
    expect(reasonIsBookable(query({ visitReason: returningOnly, patientClass: 'returning' }))).toBe(true);
    // The desk can book a reason that is not offered online at all.
    expect(reasonIsBookable(query({ visitReason: returningOnly, patientClass: 'new', channel: 'staff' }))).toBe(true);
  });
});

// ── The engine ──────────────────────────────────────────────────────────────

describe('computing slots', () => {
  it('steps by the REASON\'s duration, never overrunning the window', () => {
    // A 20-minute reason in an 08:00–09:00 window yields three slots and no
    // 08:50 that would run past the end.
    const slots = computeSlots(
      [window_({ startTime: '08:00', endTime: '09:00' })], [], [], policy(),
      query({ visitReason: reason({ durationMinutes: 20 }) }), NOW_ISO,
    );
    expect(times(slots)).toEqual(['08:00', '08:20', '08:40']);
    expect(slots[0].endTime).toBe('08:20');
  });

  it('returns nothing for a window shorter than one visit', () => {
    const slots = computeSlots(
      [window_({ startTime: '09:00', endTime: '09:20' })], [], [], policy(),
      query({ visitReason: reason({ durationMinutes: 30 }) }), NOW_ISO,
    );
    expect(slots).toEqual([]);
  });

  it('offers nothing when the facility has online booking switched off', () => {
    const off = policy({ onlineBookingEnabled: false });
    expect(computeSlots([window_()], [], [], off, query(), NOW_ISO)).toEqual([]);
    // …but the desk is unaffected: the switch is about the public door.
    expect(computeSlots([window_()], [], [], off, query({ channel: 'staff' }), NOW_ISO).length)
      .toBeGreaterThan(0);
  });

  it('refuses a reason with a nonsensical duration rather than looping', () => {
    for (const durationMinutes of [0, -30, Number.NaN]) {
      expect(computeSlots([window_()], [], [], policy(),
        query({ visitReason: reason({ durationMinutes }) }), NOW_ISO)).toEqual([]);
    }
  });
});

describe('the lead-time boundary', () => {
  const q = (time: string) => query({
    from: '2026-09-01', to: '2026-09-01', now: { date: '2026-09-01', time },
  });
  const todayWindow = window_({ date: '2026-09-01', startTime: '09:00', endTime: '10:00' });

  it('ALLOWS a slot exactly at the cutoff', () => {
    // 08:00 + 60 minutes lead = 09:00, and 09:00 is offered.
    //
    // The booking plan's parenthetical says "exactly at the cutoff is
    // excluded", which contradicts this. The field's own contract is the
    // better authority — `minLeadTimeMinutes` is documented as "no booking may
    // start sooner than this many minutes from now", and 09:00 is not sooner
    // than 60 minutes away. The doc has been corrected rather than the engine:
    // changing a live booking rule to match a parenthetical would be the tail
    // wagging the dog, and this reading is the defensible one.
    const slots = computeSlots([todayWindow], [], [], policy({ minLeadTimeMinutes: 60 }),
      q('08:00'), NOW_ISO);
    expect(times(slots)).toEqual(['09:00', '09:30']);
  });

  it('excludes a slot one minute inside the cutoff', () => {
    const slots = computeSlots([todayWindow], [], [], policy({ minLeadTimeMinutes: 61 }),
      q('08:00'), NOW_ISO);
    expect(times(slots)).toEqual(['09:30']);
  });

  it('does not apply the lead time to staff', () => {
    const slots = computeSlots([todayWindow], [], [], policy({ minLeadTimeMinutes: 600 }),
      { ...q('08:00'), channel: 'staff' }, NOW_ISO);
    expect(times(slots)).toEqual(['09:00', '09:30']);
  });

  it('never offers a time already past', () => {
    const slots = computeSlots([todayWindow], [], [], policy(), q('09:15'), NOW_ISO);
    expect(times(slots)).toEqual(['09:30']);
  });
});

describe('the booking horizon', () => {
  it('stops at maxAdvanceDays however far the caller asked', () => {
    const weekly = window_({
      date: '2026-09-01',
      recurrence: { daysOfWeek: [1, 2, 3, 4, 5], until: '2026-12-31' },
    } as Partial<AvailabilityDoc>);
    const slots = computeSlots([weekly], [], [], policy({ maxAdvanceDays: 3 }),
      query({ from: '2026-09-01', to: '2026-12-31' }), NOW_ISO);
    const last = slots[slots.length - 1];
    expect(last.date <= '2026-09-04').toBe(true);
  });

  it('does not apply the horizon to staff', () => {
    const weekly = window_({
      date: '2026-09-01',
      recurrence: { daysOfWeek: [1, 2, 3, 4, 5], until: '2026-12-31' },
    } as Partial<AvailabilityDoc>);
    const slots = computeSlots([weekly], [], [], policy({ maxAdvanceDays: 3 }),
      query({ from: '2026-09-01', to: '2026-10-01', channel: 'staff' }), NOW_ISO);
    expect(slots.some(s => s.date > '2026-09-04')).toBe(true);
  });
});

describe('occupancy', () => {
  it('removes a slot an appointment already holds', () => {
    const slots = computeSlots([window_()], [appointment({ appointmentTime: '09:00' })], [],
      policy(), query(), NOW_ISO);
    expect(times(slots)).toEqual(['09:30']);
  });

  it('releases the slot when the booking is cancelled, no-show or rescheduled', () => {
    // The three statuses that give the time back. A cancelled appointment
    // holding a slot forever is how a clinic's calendar silently fills up.
    for (const status of ['cancelled', 'no_show', 'rescheduled'] as const) {
      const slots = computeSlots([window_()], [appointment({ status })], [],
        policy(), query(), NOW_ISO);
      expect(times(slots)).toEqual(['09:00', '09:30']);
    }
  });

  it('does not let one provider\'s booking block another\'s slot', () => {
    // Two doctors genuinely see two patients at 09:00.
    const slots = computeSlots(
      [window_({ _id: 'w1', providerId: 'dr-wani', providerName: 'Dr. Wani' }),
       window_({ _id: 'w2', providerId: 'dr-achol', providerName: 'Dr. Achol' })],
      [appointment({ providerId: 'dr-wani', appointmentTime: '09:00' })],
      [], policy(), query(), NOW_ISO,
    );
    expect(slots.filter(s => s.startTime === '09:00').map(s => s.providerId)).toEqual(['dr-achol']);
  });

  it('applies facility-wide exclusivity only when the policy asks for it', () => {
    const windows = [
      window_({ _id: 'w1', providerId: 'dr-wani', providerName: 'Dr. Wani' }),
      window_({ _id: 'w2', providerId: 'dr-achol', providerName: 'Dr. Achol' }),
    ];
    const booked = [appointment({ providerId: 'dr-wani', appointmentTime: '09:00' })];
    const strict = computeSlots(windows, booked, [], policy({ singleSlotPerFacility: true }),
      query(), NOW_ISO);
    expect(strict.filter(s => s.startTime === '09:00')).toEqual([]);
  });

  it('offers a slot more than once when the window has capacity', () => {
    const doubled = window_({ capacity: 2 } as Partial<AvailabilityDoc>);
    const slots = computeSlots([doubled], [appointment({ appointmentTime: '09:00' })], [],
      policy(), query(), NOW_ISO);
    const at9 = slots.find(s => s.startTime === '09:00');
    expect(at9?.capacityLeft).toBe(1);
  });

  it('collapses two windows that open the same time for one provider', () => {
    // Editing a recurring series can leave an overlapping duplicate; the grid
    // must not show 09:00 twice for the same doctor.
    const slots = computeSlots(
      [window_({ _id: 'w1' }), window_({ _id: 'w2' })], [], [], policy(), query(), NOW_ISO,
    );
    expect(times(slots)).toEqual(['09:00', '09:30']);
  });
});

describe('buffers', () => {
  it('pushes the next slot past the turnaround after a visit', () => {
    // A 15-minute turnaround belongs to the CONSULTATION, so it expands that
    // booking's block rather than the candidate slot — the next slot is
    // blocked regardless of how long the next visit happens to be.
    const slots = computeSlots(
      [window_({ startTime: '09:00', endTime: '11:00' })],
      [appointment({ appointmentTime: '09:00', duration: 30 })],
      [], policy({ bufferAfterMinutes: 15 }), query(), NOW_ISO,
    );
    expect(times(slots)).not.toContain('09:30');
    expect(times(slots)).toContain('10:00');
  });

  it('protects the run-up to a booking too', () => {
    const slots = computeSlots(
      [window_({ startTime: '08:00', endTime: '10:00' })],
      [appointment({ appointmentTime: '09:00', duration: 30 })],
      [], policy({ bufferBeforeMinutes: 15 }), query(), NOW_ISO,
    );
    expect(times(slots)).not.toContain('08:30');
    expect(times(slots)).toContain('08:00');
  });
});

describe('holds', () => {
  it('blocks a slot while a hold is live', () => {
    const slots = computeSlots([window_()], [], [hold({ startTime: '09:00' })],
      policy(), query(), '2026-09-01T09:00:00.000Z');
    expect(times(slots)).toEqual(['09:30']);
  });

  it('releases it once the hold expires', () => {
    // A patient who abandons the form must not hold the slot for ever.
    const slots = computeSlots([window_()], [], [hold({ startTime: '09:00', expiresAt: '2026-09-01T09:00:00.000Z' })],
      policy(), query(), '2026-09-01T09:00:01.000Z');
    expect(times(slots)).toEqual(['09:00', '09:30']);
  });

  it('releases it once the hold has been consumed', () => {
    // The booking it was holding for now exists and blocks the slot itself;
    // counting both would take two slots for one patient.
    const consumed = hold({ startTime: '09:00', consumedAt: '2026-09-01T08:30:00.000Z' } as Partial<SlotHoldDoc>);
    const slots = computeSlots([window_()], [], [consumed], policy(), query(), NOW_ISO);
    expect(times(slots)).toEqual(['09:00', '09:30']);
  });
});

describe('busyBlocksOn', () => {
  it('ignores everything on another date', () => {
    expect(busyBlocksOn('2026-09-08', [appointment()], [hold()], policy(), NOW_ISO)).toEqual([]);
  });

  it('falls back to 30 minutes for a booking with no duration', () => {
    const [block] = busyBlocksOn('2026-09-07',
      [appointment({ appointmentTime: '09:00', duration: 0 })], [], policy(), NOW_ISO);
    expect(block.end - block.start).toBe(30);
  });
});

describe('an empty day', () => {
  it('produces no slots rather than a placeholder', () => {
    // The `—` the plan describes is the UI's rendering of an empty list; the
    // engine's job is to return nothing and say nothing about presentation.
    expect(computeSlots([], [], [], policy(), query(), NOW_ISO)).toEqual([]);
    expect(computeSlots([window_({ date: '2026-09-20' })], [], [], policy(),
      query({ from: '2026-09-07', to: '2026-09-07' }), NOW_ISO)).toEqual([]);
  });
});

describe('slotIsStillOpen', () => {
  it('is the re-check between choosing a slot and submitting it', () => {
    // Two patients on the same slot is the race this exists to lose safely.
    const chosen = { providerId: 'dr-wani', date: '2026-09-07', startTime: '09:00' };
    const windows = [window_()];
    expect(slotIsStillOpen(chosen, windows, [], [], policy(), query(), NOW_ISO)).toBe(true);
    expect(slotIsStillOpen(
      chosen, windows, [appointment({ appointmentTime: '09:00' })], [], policy(), query(), NOW_ISO,
    )).toBe(false);
  });
});
