/**
 * Booking policy — the per-facility rules every booking surface obeys.
 *
 * A facility with no policy document is the normal case for everything that
 * existed before online booking, so `DEFAULT_BOOKING_POLICY` is not a fallback
 * for missing data so much as the description of how a facility behaves until
 * someone configures it: online booking OFF, requests reviewed by a human,
 * and different clinicians free to see different patients at the same time.
 */

import { bookingPoliciesDB } from '../db';
import type { BookingPolicyDoc } from '../db-types-booking';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { findByType } from './db-query';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { v4 as uuidv4 } from 'uuid';

/**
 * The rules a facility runs on before anyone configures it.
 *
 * `singleSlotPerFacility: false` is the load-bearing choice here. The schedule
 * used to refuse any two overlapping bookings across a whole facility, on the
 * reasoning that the day view draws one stack — but a practice with two
 * doctors genuinely does see two patients at 09:00, and refusing that made the
 * calendar's drawing preference into a clinical constraint. Provider and room
 * exclusivity are what actually protect a clinician's day, and those are
 * always enforced.
 */
export const DEFAULT_BOOKING_POLICY: Omit<BookingPolicyDoc, '_id' | 'createdAt' | 'updatedAt' | 'orgId' | 'facilityId'> = {
  type: 'booking_policy',
  onlineBookingEnabled: false,
  confirmationMode: 'request',
  minLeadTimeMinutes: 240,
  maxAdvanceDays: 90,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  defaultCapacity: 1,
  cancellationWindowHours: 24,
  requireInsurance: false,
  singleSlotPerFacility: false,
  consentTextPrivacy:
    'I have read and agree to the Privacy Policy and Terms & Conditions, am at least 18, and have the authority to make this appointment.',
  consentTextSms:
    'I agree to receive text messages from this practice about my appointment. Message frequency and data rates may apply.',
  publicSlug: '',
  embedAllowedOrigins: [],
};

/** A usable policy for a facility that has no document of its own. */
export function defaultPolicyFor(facilityId: string, orgId: string): BookingPolicyDoc {
  const now = new Date().toISOString();
  return {
    _id: `booking-policy-default-${facilityId}`,
    ...DEFAULT_BOOKING_POLICY,
    orgId,
    facilityId,
    createdAt: now,
    updatedAt: now,
  };
}

// Per-process cache. The policy changes rarely and is read on every booking;
// re-fetching it per conflict check would put a database round-trip in the
// middle of every save. Invalidated on write below.
const cache = new Map<string, { doc: BookingPolicyDoc | null; at: number }>();
const CACHE_TTL_MS = 60_000;

function cacheKey(facilityId: string, orgId?: string): string {
  return `${orgId || ''}|${facilityId}`;
}

/** Drop cached policies. Call after any write that changes one. */
export function clearBookingPolicyCache(): void {
  cache.clear();
}

export async function getAllBookingPolicies(scope?: DataScope): Promise<BookingPolicyDoc[]> {
  const db = bookingPoliciesDB();
  const all = await findByType<BookingPolicyDoc>(db, 'booking_policy');
  return scope ? filterByScope(all, scope) : all;
}

/**
 * The stored policy for a facility, or `null` when it has none.
 *
 * Returns null rather than the default so callers can tell "not configured"
 * from "configured this way" — the settings screen needs that distinction even
 * though the booking paths do not.
 */
export async function getBookingPolicy(
  facilityId: string,
  orgId?: string,
): Promise<BookingPolicyDoc | null> {
  if (!facilityId) return null;

  const key = cacheKey(facilityId, orgId);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.doc;

  let doc: BookingPolicyDoc | null = null;
  try {
    const db = bookingPoliciesDB();
    const all = await findByType<BookingPolicyDoc>(db, 'booking_policy');
    doc = all.find(p =>
      p.facilityId === facilityId && (!orgId || !p.orgId || p.orgId === orgId)) ?? null;
  } catch {
    // No database (tests, offline boot) — behave as an unconfigured facility
    // rather than failing the booking that asked.
    doc = null;
  }

  cache.set(key, { doc, at: Date.now() });
  return doc;
}

/** The policy to apply, falling back to the unconfigured-facility defaults. */
export async function getEffectiveBookingPolicy(
  facilityId: string,
  orgId?: string,
): Promise<BookingPolicyDoc> {
  const stored = await getBookingPolicy(facilityId, orgId);
  return stored ?? defaultPolicyFor(facilityId, orgId || '');
}

/** Resolve a practice's public slug to its facility. Public routes start here. */
export async function getBookingPolicyBySlug(slug: string): Promise<BookingPolicyDoc | null> {
  if (!slug) return null;
  try {
    const db = bookingPoliciesDB();
    const all = await findByType<BookingPolicyDoc>(db, 'booking_policy');
    return all.find(p => p.publicSlug === slug && p.onlineBookingEnabled) ?? null;
  } catch {
    return null;
  }
}

export interface BookingPolicyInput extends Partial<Omit<BookingPolicyDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>> {
  facilityId: string;
  orgId: string;
}

export async function saveBookingPolicy(
  input: BookingPolicyInput,
  actorId?: string,
  actorName?: string,
): Promise<BookingPolicyDoc> {
  if (!input.facilityId) throw new Error('A booking policy needs a facility');
  if (!input.orgId) throw new Error('A booking policy needs an organization');

  const db = bookingPoliciesDB();
  const now = new Date().toISOString();
  const existing = await getBookingPolicy(input.facilityId, input.orgId);

  // A published slug must be unique across the platform or two practices
  // resolve to the same public URL.
  if (input.publicSlug) {
    const clash = (await findByType<BookingPolicyDoc>(db, 'booking_policy'))
      .find(p => p.publicSlug === input.publicSlug && p.facilityId !== input.facilityId);
    if (clash) throw new Error(`The link "${input.publicSlug}" is already taken by another practice`);
  }

  const doc: BookingPolicyDoc = {
    ...(existing ?? defaultPolicyFor(input.facilityId, input.orgId)),
    ...input,
    _id: existing?._id ?? `booking-policy-${uuidv4().slice(0, 8)}`,
    _rev: existing?._rev,
    type: 'booking_policy',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const resp = await db.put(doc);
  doc._rev = resp.rev;
  clearBookingPolicyCache();

  await logAuditSafe(
    existing ? 'UPDATE_BOOKING_POLICY' : 'CREATE_BOOKING_POLICY',
    actorId, actorName,
    `Booking policy for ${doc.facilityId}: online booking ${doc.onlineBookingEnabled ? 'on' : 'off'}` +
    `, ${doc.confirmationMode === 'auto' ? 'auto-confirm' : 'review each request'}`,
  );
  emitSyncEvent({
    resourceType: 'booking_policy',
    resourceId: doc._id,
    operation: existing ? 'update' : 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });
  return doc;
}
