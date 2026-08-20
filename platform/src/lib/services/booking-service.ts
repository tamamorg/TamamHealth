/**
 * Booking service — the thin data layer around the slot engine.
 *
 * Everything decision-making lives in `lib/booking/slot-engine.ts`, which is
 * pure. This module's only job is to fetch the documents that engine needs and
 * to own the slot-hold lifecycle. Both the staff booking form and the public
 * booking routes come through here, so a slot offered in one place is computed
 * by exactly the same rules as a slot offered in the other.
 */

import { appointmentsDB, availabilityDB, slotHoldsDB } from '../db';
import type { AppointmentDoc, AvailabilityDoc } from '../db-types';
import type { BookingPolicyDoc, SlotHoldDoc, VisitReasonDoc, PatientClass } from '../db-types-booking';
import { findByType } from './db-query';
import { getEffectiveBookingPolicy } from './booking-policy-service';
import {
  computeSlots, slotIsStillOpen, filterSlotsByStaffAvailability, addDays,
  type Slot, type SlotChannel, type SlotQuery,
} from '../booking/slot-engine';
import { jubaDate, jubaTime } from '../time-juba';
import { v4 as uuidv4 } from 'uuid';

/** How long a patient gets to finish the form before their slot is released. */
export const HOLD_MINUTES = 10;

/**
 * Facility-local "now".
 *
 * Single point of truth for the engine's clock so no caller has to decide
 * between `jubaDate()` and a browser-local date — mixing those is how a booking
 * ends up an hour out. When facilities outside this zone are supported, this is
 * the one function that needs a timezone argument.
 */
export function facilityNow(): { date: string; time: string } {
  return { date: jubaDate(), time: jubaTime() };
}

export interface AvailabilityRequest {
  facilityId: string;
  orgId?: string;
  visitReason: VisitReasonDoc;
  patientClass: PatientClass;
  channel: SlotChannel;
  /** Defaults to today. */
  from?: string;
  /** Defaults to `from` + 30 days, then clamped by the policy for public use. */
  to?: string;
  providerIds?: string[];
  /**
   * A second person the visit needs — the rooming nurse, an interpreter, a
   * scribe. Slots are narrowed to times they are free too, so the desk cannot
   * book a doctor into an hour when the only nurse is in another room.
   */
  secondaryStaffId?: string;
}

export interface AvailabilityResult {
  slots: Slot[];
  policy: BookingPolicyDoc;
  /** The range actually searched, after the policy clamped it. */
  from: string;
  to: string;
}

async function loadWindows(facilityId: string, orgId?: string): Promise<AvailabilityDoc[]> {
  const all = await findByType<AvailabilityDoc>(availabilityDB(), 'availability');
  return all.filter(w =>
    w.facilityId === facilityId &&
    (!orgId || !w.orgId || w.orgId === orgId));
}

async function loadAppointments(facilityId: string, orgId: string | undefined, from: string, to: string): Promise<AppointmentDoc[]> {
  const all = await findByType<AppointmentDoc>(appointmentsDB(), 'appointment');
  return all.filter(a =>
    a.facilityId === facilityId &&
    (!orgId || !a.orgId || a.orgId === orgId) &&
    a.appointmentDate >= from && a.appointmentDate <= to);
}

async function loadHolds(facilityId: string, from: string, to: string): Promise<SlotHoldDoc[]> {
  try {
    const all = await findByType<SlotHoldDoc>(slotHoldsDB(), 'slot_hold');
    return all.filter(h => h.facilityId === facilityId && h.date >= from && h.date <= to);
  } catch {
    // No holds database yet (first run, or a client that never books) — an
    // empty list is correct, not a failure: holds only ever remove slots.
    return [];
  }
}

/** Every bookable slot for a request. */
export async function getAvailableSlots(request: AvailabilityRequest): Promise<AvailabilityResult> {
  const now = facilityNow();
  const from = request.from || now.date;
  const to = request.to || addDays(from, 30);
  const policy = await getEffectiveBookingPolicy(request.facilityId, request.orgId);

  const [windows, appointments, holds] = await Promise.all([
    loadWindows(request.facilityId, request.orgId),
    loadAppointments(request.facilityId, request.orgId, from, to),
    loadHolds(request.facilityId, from, to),
  ]);

  const query: SlotQuery = {
    from,
    to,
    now,
    visitReason: request.visitReason,
    patientClass: request.patientClass,
    channel: request.channel,
    facilityIds: [request.facilityId],
    providerIds: request.providerIds,
  };

  const nowIso = new Date().toISOString();
  let slots = computeSlots(windows, appointments, holds, policy, query, nowIso);

  if (request.secondaryStaffId) {
    // Note this runs on the FULL appointment list, not the provider's: the
    // nurse's other commitments are mostly other clinicians' visits.
    slots = filterSlotsByStaffAvailability(
      slots, request.secondaryStaffId, windows, appointments, policy, nowIso);
  }

  return { slots, policy, from, to };
}

/** The first `limit` days that have at least one slot — for "next available". */
export async function getNextAvailableSlots(
  request: AvailabilityRequest,
  limit = 3,
): Promise<Slot[]> {
  const { slots } = await getAvailableSlots(request);
  return slots.slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════════════
// Slot holds
// ═══════════════════════════════════════════════════════════════════════════

export interface HoldRequest {
  orgId: string;
  facilityId: string;
  providerId: string;
  date: string;
  startTime: string;
  durationMinutes: number;
}

export interface HoldResult {
  holdToken: string;
  expiresAt: string;
}

/**
 * Claim a slot for `HOLD_MINUTES` while the patient fills in the form.
 *
 * Deliberately does NOT re-verify availability first: the submit path does that
 * properly, and a hold that races another hold costs one patient a re-pick,
 * where a hold that races a *booking* is caught at submit either way.
 */
export async function holdSlot(request: HoldRequest): Promise<HoldResult> {
  const db = slotHoldsDB();
  const now = new Date();
  const holdToken = uuidv4();
  const doc: SlotHoldDoc = {
    _id: `hold-${uuidv4().slice(0, 8)}`,
    type: 'slot_hold',
    orgId: request.orgId,
    facilityId: request.facilityId,
    providerId: request.providerId,
    date: request.date,
    startTime: request.startTime,
    durationMinutes: request.durationMinutes,
    expiresAt: new Date(now.getTime() + HOLD_MINUTES * 60_000).toISOString(),
    holdToken,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await db.put(doc);
  return { holdToken, expiresAt: doc.expiresAt };
}

/** Look up a live hold by its token. Expired or consumed holds return null. */
export async function getLiveHold(holdToken: string): Promise<SlotHoldDoc | null> {
  if (!holdToken) return null;
  try {
    const all = await findByType<SlotHoldDoc>(slotHoldsDB(), 'slot_hold');
    const nowIso = new Date().toISOString();
    return all.find(h => h.holdToken === holdToken && !h.consumedAt && h.expiresAt > nowIso) ?? null;
  } catch {
    return null;
  }
}

/** Mark a hold used, so it stops blocking the slot it was protecting. */
export async function consumeHold(holdToken: string): Promise<void> {
  const hold = await getLiveHold(holdToken);
  if (!hold) return;
  try {
    await slotHoldsDB().put({ ...hold, consumedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  } catch {
    // Lost a race with the sweeper or another writer. The hold expires on its
    // own within minutes either way; failing the booking over it would be worse.
  }
}

/** Delete holds that have expired. Safe to call often; ignores failures. */
export async function sweepExpiredHolds(): Promise<number> {
  try {
    const db = slotHoldsDB();
    const nowIso = new Date().toISOString();
    const stale = (await findByType<SlotHoldDoc>(db, 'slot_hold'))
      .filter(h => h.expiresAt <= nowIso || h.consumedAt);
    let removed = 0;
    for (const hold of stale) {
      try {
        await db.remove({ _id: hold._id, _rev: hold._rev as string });
        removed++;
      } catch { /* already gone */ }
    }
    return removed;
  } catch {
    return 0;
  }
}

/**
 * Re-check one slot at submit time.
 *
 * The hold is a courtesy; this is the truth. Runs the same engine over freshly
 * loaded documents, so a slot booked by the front desk in the last ten minutes
 * is caught before a second patient is written into it.
 */
export async function verifySlotStillOpen(
  request: AvailabilityRequest & { providerId: string; date: string; startTime: string; ignoreHoldToken?: string },
): Promise<boolean> {
  const now = facilityNow();
  const policy = await getEffectiveBookingPolicy(request.facilityId, request.orgId);
  const [windows, appointments, allHolds] = await Promise.all([
    loadWindows(request.facilityId, request.orgId),
    loadAppointments(request.facilityId, request.orgId, request.date, request.date),
    loadHolds(request.facilityId, request.date, request.date),
  ]);

  // The booker's own hold must not block the booking it exists to protect.
  const holds = request.ignoreHoldToken
    ? allHolds.filter(h => h.holdToken !== request.ignoreHoldToken)
    : allHolds;

  return slotIsStillOpen(
    { providerId: request.providerId, date: request.date, startTime: request.startTime },
    windows, appointments, holds, policy,
    {
      from: request.date,
      to: request.date,
      now,
      visitReason: request.visitReason,
      patientClass: request.patientClass,
      channel: request.channel,
      facilityIds: [request.facilityId],
    },
    new Date().toISOString(),
  );
}
