/**
 * Slot engine — turns provider availability into bookable appointment slots.
 *
 * This is the piece the whole booking feature rests on. Everything else is a
 * screen or a route around it, so it is deliberately kept PURE: no database,
 * no `Date.now()`, no timezone guessing. Callers load the documents, pass in
 * `now`, and get back a sorted list of slots.
 *
 * Why pure matters here beyond testability: a slot offered to a patient that
 * the booking guard then rejects is the single worst failure this feature can
 * have — the patient fills in a form and is told no. Keeping the rules in one
 * side-effect-free function is what lets us test every edge (lunch gaps,
 * buffers, lead time, capacity, cancellations releasing a slot) exhaustively
 * rather than hoping.
 *
 * Time handling: every date is `YYYY-MM-DD` and every time is `HH:MM` in the
 * FACILITY's local wall clock, matching how `AvailabilityDoc` and
 * `AppointmentDoc` already store them. No `Date` arithmetic crosses a day
 * boundary in here; days are walked as strings. The one place a real timestamp
 * is needed — "is this slot already in the past?" — takes `now` as an explicit
 * `{ date, time }` pair the caller resolves in the facility's zone.
 */

import type { AppointmentDoc, AvailabilityDoc } from '../db-types';
import type {
  BookingPolicyDoc, PatientClass, SlotHoldDoc, VisitReasonDoc,
} from '../db-types-booking';
import { APPOINTMENT_SLOT_RELEASED_STATUSES } from '../appointment-status';
import { toIsoDate } from '@/lib/date-utils';

// ═══════════════════════════════════════════════════════════════════════════
// Public shapes
// ═══════════════════════════════════════════════════════════════════════════

/** A single bookable opening. */
export interface Slot {
  providerId: string;
  providerName: string;
  facilityId: string;
  facilityName: string;
  date: string;          // YYYY-MM-DD
  startTime: string;     // HH:MM
  endTime: string;       // HH:MM
  durationMinutes: number;
  /** How many more bookings this slot can still take. Always ≥ 1. */
  capacityLeft: number;
  roomId?: string;
}

/**
 * Which door the request came through.
 *
 * `public` is the strict channel: a window must have opted in
 * (`bookableOnline === true`) and every policy rule applies. `staff` is the
 * permissive one — the desk can book into any open window, because a person is
 * making the judgement.
 */
export type SlotChannel = 'public' | 'staff';

export interface SlotQuery {
  /** Inclusive date range, facility-local. */
  from: string;
  to: string;
  /** Facility-local "now", used for the past/lead-time cut. */
  now: { date: string; time: string };
  visitReason: VisitReasonDoc;
  patientClass: PatientClass;
  channel: SlotChannel;
  /** Narrow to specific facilities. Empty/unset = all in the input. */
  facilityIds?: string[];
  /** Narrow to specific providers. Empty/unset = all in the input. */
  providerIds?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Small time helpers (string in, string out — no Date objects)
// ═══════════════════════════════════════════════════════════════════════════

/** "09:30" → 570. Returns NaN for anything unparseable. */
export function toMinutes(hhmm: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  if (!match) return NaN;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return NaN;
  return h * 60 + m;
}

/** 570 → "09:30". */
export function toHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Half-open overlap: [aStart, aEnd) vs [bStart, bEnd), all in minutes. */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** "2026-08-07" → 0=Sun … 6=Sat, without constructing a local-timezone Date. */
export function dayOfWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Walk forward n days from a YYYY-MM-DD string. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + n));
  return toIsoDate(shifted);
}

/** Every date from `from` to `to` inclusive. Capped so a bad range can't hang. */
export function datesBetween(from: string, to: string, cap = 400): string[] {
  const out: string[] = [];
  let cursor = from;
  while (cursor <= to && out.length < cap) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

/** YYYY-MM-DD → UTC epoch ms at midnight. Used only for day arithmetic. */
function dateToUtcMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole days between two YYYY-MM-DD strings. Negative if `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((dateToUtcMs(to) - dateToUtcMs(from)) / 86_400_000);
}

/** Minutes from facility-local `now` to a given date+time. Negative = past. */
function minutesUntil(now: { date: string; time: string }, date: string, time: string): number {
  return daysBetween(now.date, date) * 1440 + (toMinutes(time) - toMinutes(now.time));
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 1 — recurrence expansion
// ═══════════════════════════════════════════════════════════════════════════

/** One window on one concrete date. */
export interface ExpandedWindow {
  window: AvailabilityDoc;
  date: string;
}

/**
 * Expand each availability window into the concrete dates it covers inside
 * [from, to].
 *
 * A window with no `recurrence` covers exactly its own `date` — which is every
 * row that exists today, so nothing changes for them.
 */
export function expandWindows(
  windows: AvailabilityDoc[],
  from: string,
  to: string,
): ExpandedWindow[] {
  const out: ExpandedWindow[] = [];
  const range = datesBetween(from, to);

  for (const window of windows) {
    if (window.status === 'cancelled') continue;

    if (!window.recurrence) {
      if (window.date >= from && window.date <= to) out.push({ window, date: window.date });
      continue;
    }

    const { daysOfWeek, until, exceptions } = window.recurrence;
    if (!daysOfWeek?.length) continue;
    const skip = new Set(exceptions ?? []);
    const allowed = new Set(daysOfWeek);

    for (const date of range) {
      if (date < window.date || date > until) continue;   // outside the series
      if (!allowed.has(dayOfWeek(date))) continue;
      if (skip.has(date)) continue;
      out.push({ window, date });
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 2 — window eligibility
// ═══════════════════════════════════════════════════════════════════════════

/** Whether a window may be offered for this query at all. */
export function windowIsEligible(window: AvailabilityDoc, query: SlotQuery): boolean {
  if (window.status === 'cancelled') return false;

  // Public traffic only ever sees windows explicitly opened to it.
  if (query.channel === 'public' && window.bookableOnline !== true) return false;

  if (query.facilityIds?.length && !query.facilityIds.includes(window.facilityId)) return false;
  if (query.providerIds?.length && !query.providerIds.includes(window.providerId)) return false;

  // A window reserved for new patients is not shown to a returning one, and
  // vice versa. Unset means the window takes anybody.
  if (window.patientClass && window.patientClass !== query.patientClass) return false;

  // A window restricted to certain reasons only offers those.
  if (window.visitReasonIds?.length && !window.visitReasonIds.includes(query.visitReason._id)) {
    return false;
  }

  // The reason itself may be limited to a provider subset.
  const reasonProviders = query.visitReason.providerIds;
  if (reasonProviders?.length && !reasonProviders.includes(window.providerId)) return false;

  return true;
}

/** Whether the reason may be booked at all through this channel. */
export function reasonIsBookable(query: SlotQuery): boolean {
  const reason = query.visitReason;
  if (!reason.isActive) return false;
  if (query.channel === 'staff') return true;
  return query.patientClass === 'new'
    ? reason.availableToNewPatients
    : reason.availableToReturningPatients;
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 3 — occupancy
// ═══════════════════════════════════════════════════════════════════════════

/** A booking whose status released its slot never blocks a new one. */
function holdsSlot(appointment: AppointmentDoc): boolean {
  return !APPOINTMENT_SLOT_RELEASED_STATUSES.includes(appointment.status);
}

interface Busy {
  providerId: string;
  facilityId: string;
  roomId?: string;
  start: number;   // minutes from midnight, buffers already applied
  end: number;
}

/**
 * Everything occupying time on a given date, with buffers baked in.
 *
 * Buffers are applied to the EXISTING booking rather than to the candidate
 * slot: a 15-minute turnaround after a consultation belongs to that
 * consultation, and expanding the busy block is what stops the next slot
 * landing inside it — regardless of how long the next visit is.
 */
export function busyBlocksOn(
  date: string,
  appointments: AppointmentDoc[],
  holds: SlotHoldDoc[],
  policy: BookingPolicyDoc,
  nowIso: string,
): Busy[] {
  const blocks: Busy[] = [];

  for (const appointment of appointments) {
    if (appointment.appointmentDate !== date) continue;
    if (!holdsSlot(appointment)) continue;
    const start = toMinutes(appointment.appointmentTime);
    if (Number.isNaN(start)) continue;
    const duration = appointment.duration > 0 ? appointment.duration : 30;
    blocks.push({
      providerId: appointment.providerId,
      facilityId: appointment.facilityId,
      roomId: appointment.room,
      start: start - policy.bufferBeforeMinutes,
      end: start + duration + policy.bufferAfterMinutes,
    });
  }

  for (const hold of holds) {
    if (hold.date !== date) continue;
    if (hold.consumedAt) continue;
    if (hold.expiresAt <= nowIso) continue;     // expired holds block nobody
    const start = toMinutes(hold.startTime);
    if (Number.isNaN(start)) continue;
    blocks.push({
      providerId: hold.providerId,
      facilityId: hold.facilityId,
      start: start - policy.bufferBeforeMinutes,
      end: start + hold.durationMinutes + policy.bufferAfterMinutes,
    });
  }

  return blocks;
}

/**
 * How many bookings already occupy a candidate slot.
 *
 * Counted against the PROVIDER (a clinician cannot be in two visits at once)
 * and, when the window names one, the ROOM. Facility-wide exclusivity is
 * deliberately not applied here: a practice with two doctors genuinely sees
 * two patients at 09:00, which is what `singleSlotPerFacility` exists to
 * express for the facilities that want the older, stricter behaviour.
 */
function occupancyFor(
  blocks: Busy[],
  window: AvailabilityDoc,
  policy: BookingPolicyDoc,
  slotStart: number,
  slotEnd: number,
): number {
  let count = 0;
  for (const block of blocks) {
    if (!overlaps(slotStart, slotEnd, block.start, block.end)) continue;
    const sameProvider = block.providerId === window.providerId;
    const sameRoom = !!window.roomId && block.roomId === window.roomId;
    const sameFacility = policy.singleSlotPerFacility && block.facilityId === window.facilityId;
    if (sameProvider || sameRoom || sameFacility) count++;
  }
  return count;
}

// ═══════════════════════════════════════════════════════════════════════════
// The engine
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute every bookable slot for a query.
 *
 * @param windows      Availability windows for the facilities in scope. May
 *                     include recurring series and dates outside the range —
 *                     both are filtered here.
 * @param appointments Existing bookings for the same facilities and range.
 * @param holds        Live slot holds.
 * @param policy       The facility's booking policy.
 * @param query        What the patient is asking for.
 * @param nowIso       Real ISO timestamp, used only to expire holds.
 */
export function computeSlots(
  windows: AvailabilityDoc[],
  appointments: AppointmentDoc[],
  holds: SlotHoldDoc[],
  policy: BookingPolicyDoc,
  query: SlotQuery,
  nowIso: string,
): Slot[] {
  if (query.channel === 'public' && !policy.onlineBookingEnabled) return [];
  if (!reasonIsBookable(query)) return [];

  const duration = query.visitReason.durationMinutes;
  if (!Number.isFinite(duration) || duration <= 0) return [];

  // Never look further ahead than the policy allows, whatever the caller asked.
  const horizonEnd = addDays(query.now.date, policy.maxAdvanceDays);
  const to = query.channel === 'public' && query.to > horizonEnd ? horizonEnd : query.to;
  if (to < query.from) return [];

  const eligible = windows.filter(w => windowIsEligible(w, query));
  const expanded = expandWindows(eligible, query.from, to);
  if (expanded.length === 0) return [];

  // Busy blocks are per-date; build each date once rather than per window.
  const blocksByDate = new Map<string, Busy[]>();
  const blocksFor = (date: string): Busy[] => {
    let cached = blocksByDate.get(date);
    if (!cached) {
      cached = busyBlocksOn(date, appointments, holds, policy, nowIso);
      blocksByDate.set(date, cached);
    }
    return cached;
  };

  const leadCut = query.channel === 'public' ? policy.minLeadTimeMinutes : 0;
  const slots: Slot[] = [];

  for (const { window, date } of expanded) {
    const windowStart = toMinutes(window.startTime);
    const windowEnd = toMinutes(window.endTime);
    if (Number.isNaN(windowStart) || Number.isNaN(windowEnd) || windowEnd <= windowStart) continue;

    const capacity = Math.max(1, window.capacity ?? policy.defaultCapacity ?? 1);
    const blocks = blocksFor(date);

    // Step by the visit's own duration, so a 20-minute reason in an 08:00–09:00
    // window yields 08:00 / 08:20 / 08:40 and never an 08:50 that runs over.
    for (let start = windowStart; start + duration <= windowEnd; start += duration) {
      const end = start + duration;
      const startTime = toHHMM(start);

      if (minutesUntil(query.now, date, startTime) < leadCut) continue;

      const occupied = occupancyFor(blocks, window, policy, start, end);
      const capacityLeft = capacity - occupied;
      if (capacityLeft <= 0) continue;

      slots.push({
        providerId: window.providerId,
        providerName: window.providerName,
        facilityId: window.facilityId,
        facilityName: window.facilityName,
        date,
        startTime,
        endTime: toHHMM(end),
        durationMinutes: duration,
        capacityLeft,
        roomId: window.roomId,
      });
    }
  }

  slots.sort((a, b) => (
    a.date.localeCompare(b.date) ||
    a.startTime.localeCompare(b.startTime) ||
    a.providerName.localeCompare(b.providerName)
  ));

  // Two windows for the same provider can legitimately overlap after a
  // recurring series is edited; collapse identical openings so the grid never
  // shows 09:00 twice for one doctor.
  const seen = new Set<string>();
  return slots.filter(slot => {
    const key = `${slot.providerId}|${slot.date}|${slot.startTime}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Narrow slots to times a SECOND staff member is also free.
 *
 * A visit is rarely one person. A consultation needs the clinician, but it may
 * also need the nurse who rooms the patient, an interpreter, or a scribe —
 * and booking a doctor into a slot where the only nurse is already in another
 * room produces an appointment nobody can actually run.
 *
 * Two rules, and the difference between them matters:
 *
 *  - BOOKED is always binding. If that person already holds an appointment at
 *    the time (as clinician or as second staff), the slot goes.
 *  - ROSTERED is only binding if they have a roster. Staff with availability
 *    windows are offered only inside them. Staff with none are not thereby
 *    "always busy" — nobody has recorded their hours, which is an absence of
 *    information, not an absence of the person. Treating it as busy would make
 *    choosing a nurse empty the grid, and teach everyone to leave the field
 *    blank.
 */
export function filterSlotsByStaffAvailability(
  slots: Slot[],
  staffId: string,
  windows: AvailabilityDoc[],
  appointments: AppointmentDoc[],
  policy: BookingPolicyDoc,
  nowIso: string,
  excludeAppointmentId?: string,
): Slot[] {
  if (!staffId) return slots;

  const staffWindows = windows.filter(w => w.providerId === staffId && w.status !== 'cancelled');
  const rostered = staffWindows.length > 0;

  // Every booking this person is committed to, in either role.
  const commitments = appointments.filter(a =>
    a._id !== excludeAppointmentId &&
    !APPOINTMENT_SLOT_RELEASED_STATUSES.includes(a.status) &&
    (a.providerId === staffId || a.staffId === staffId));

  const busyByDate = new Map<string, { start: number; end: number }[]>();
  for (const appointment of commitments) {
    const start = toMinutes(appointment.appointmentTime);
    if (Number.isNaN(start)) continue;
    const duration = appointment.duration > 0 ? appointment.duration : 30;
    const list = busyByDate.get(appointment.appointmentDate) ?? [];
    list.push({
      start: start - policy.bufferBeforeMinutes,
      end: start + duration + policy.bufferAfterMinutes,
    });
    busyByDate.set(appointment.appointmentDate, list);
  }

  // Roster coverage, expanded per date, so recurrence is honoured here too.
  const coverByDate = new Map<string, { start: number; end: number }[]>();
  if (rostered) {
    const dates = [...new Set(slots.map(s => s.date))];
    for (const { window, date } of expandWindows(staffWindows, dates[0] ?? '', dates[dates.length - 1] ?? '')) {
      const start = toMinutes(window.startTime);
      const end = toMinutes(window.endTime);
      if (Number.isNaN(start) || Number.isNaN(end)) continue;
      const list = coverByDate.get(date) ?? [];
      list.push({ start, end });
      coverByDate.set(date, list);
    }
  }

  void nowIso;   // reserved: holds are provider-scoped, so they do not apply here

  return slots.filter(slot => {
    const start = toMinutes(slot.startTime);
    const end = start + slot.durationMinutes;

    const busy = busyByDate.get(slot.date) ?? [];
    if (busy.some(b => overlaps(start, end, b.start, b.end))) return false;

    if (!rostered) return true;
    const cover = coverByDate.get(slot.date) ?? [];
    return cover.some(c => start >= c.start && end <= c.end);
  });
}

/** Group slots by date — the shape the day-by-day pickers want. */
export function groupSlotsByDate(slots: Slot[]): Map<string, Slot[]> {
  const byDate = new Map<string, Slot[]>();
  for (const slot of slots) {
    const list = byDate.get(slot.date);
    if (list) list.push(slot);
    else byDate.set(slot.date, [slot]);
  }
  return byDate;
}

/** Group slots by provider, then date — the shape the week grid wants. */
export function groupSlotsByProviderAndDate(slots: Slot[]): Map<string, Map<string, Slot[]>> {
  const byProvider = new Map<string, Map<string, Slot[]>>();
  for (const slot of slots) {
    let byDate = byProvider.get(slot.providerId);
    if (!byDate) {
      byDate = new Map();
      byProvider.set(slot.providerId, byDate);
    }
    const list = byDate.get(slot.date);
    if (list) list.push(slot);
    else byDate.set(slot.date, [slot]);
  }
  return byProvider;
}

/**
 * Whether one specific slot is still open.
 *
 * Used by the submit path to re-check what a hold claimed. Deliberately built
 * on `computeSlots` rather than duplicating the rules — a second
 * implementation is a second set of bugs.
 */
export function slotIsStillOpen(
  candidate: { providerId: string; date: string; startTime: string },
  windows: AvailabilityDoc[],
  appointments: AppointmentDoc[],
  holds: SlotHoldDoc[],
  policy: BookingPolicyDoc,
  query: SlotQuery,
  nowIso: string,
): boolean {
  const slots = computeSlots(
    windows, appointments, holds, policy,
    { ...query, from: candidate.date, to: candidate.date, providerIds: [candidate.providerId] },
    nowIso,
  );
  return slots.some(s => s.startTime === candidate.startTime);
}
