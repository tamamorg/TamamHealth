/**
 * Server-side helpers shared by every `/api/booking/*` route.
 *
 * Two jobs, both about keeping the public surface honest:
 *
 *  1. Resolve a practice slug to the facility behind it — and refuse when
 *     online booking is off. Every public route starts here, so a practice
 *     that has not opted in has no reachable endpoints at all, rather than
 *     endpoints that happen to return nothing.
 *
 *  2. Shape what goes back over the wire. `publicProviderView` and friends are
 *     allow-lists, not omit-lists: a field added to `ProviderProfileDoc` or
 *     `VisitReasonDoc` later does not silently start being published.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import type { BookingPolicyDoc, ProviderProfileDoc, VisitReasonDoc } from '../db-types-booking';
import type { Slot } from './slot-engine';
import { getBookingPolicyBySlug } from '../services/booking-policy-service';
import { rateLimit } from '../rate-limit';
import { getClientIp } from '../request-utils';

export interface PublicPractice {
  policy: BookingPolicyDoc;
  facilityId: string;
  orgId: string;
}

/**
 * The practice behind a public slug, or a ready-made 404.
 *
 * Returns the same 404 for "no such practice" and "booking is switched off",
 * so the endpoint cannot be used to enumerate which of our facilities exist.
 */
export async function resolvePractice(
  slug: string,
): Promise<{ practice: PublicPractice } | { error: NextResponse }> {
  const policy = await getBookingPolicyBySlug(slug);
  if (!policy) {
    return { error: NextResponse.json({ error: 'Practice not found' }, { status: 404 }) };
  }
  return {
    practice: { policy, facilityId: policy.facilityId, orgId: policy.orgId },
  };
}

/** Narrow, public-safe view of a visit reason. */
export function publicReasonView(r: VisitReasonDoc) {
  return {
    id: r._id,
    slug: r.slug,
    name: r.name,
    durationMinutes: r.durationMinutes,
    availableToNewPatients: r.availableToNewPatients,
    availableToReturningPatients: r.availableToReturningPatients,
    requiresInsurance: r.requiresInsurance,
    sortOrder: r.sortOrder,
  };
}

/** Narrow, public-safe view of a provider. Never touches `UserDoc`. */
export function publicProviderView(p: ProviderProfileDoc) {
  return {
    id: p.userId,
    slug: p.publicSlug,
    displayName: p.displayName,
    credentials: p.credentials,
    specialtyLabel: p.specialtyLabel,
    photoUrl: p.photoUrl,
    bio: p.bio,
    languages: p.languages,
    acceptingNewPatients: p.acceptingNewPatients,
    facilityIds: p.facilityIds,
  };
}

/**
 * Free/busy only.
 *
 * `computeSlots` returns richer rows internally (which appointment blocked a
 * time, which window produced it); none of that may cross the boundary. A
 * patient is told when a clinician is free and nothing about who else is in
 * the diary.
 */
export function publicSlotView(s: Slot) {
  return {
    providerId: s.providerId,
    date: s.date,
    startTime: s.startTime,
    endTime: s.endTime,
    durationMinutes: s.durationMinutes,
  };
}

/** The consent + policy copy a practice wants shown before a patient submits. */
export function publicPolicyView(policy: BookingPolicyDoc) {
  return {
    slug: policy.publicSlug,
    confirmationMode: policy.confirmationMode,
    maxAdvanceDays: policy.maxAdvanceDays,
    minLeadTimeMinutes: policy.minLeadTimeMinutes,
    cancellationWindowHours: policy.cancellationWindowHours,
    requireInsurance: policy.requireInsurance,
    policyText: policy.policyText,
    consentTextPrivacy: policy.consentTextPrivacy,
    consentTextSms: policy.consentTextSms,
    publicPhone: policy.publicPhone,
    publicEmail: policy.publicEmail,
  };
}

/**
 * Rate limit a public booking request.
 *
 * There is no session to lean on here, so the limiter is the primary abuse
 * control. Reads get a generous bucket (a patient flicking through a week of
 * availability is normal); writes get a tight one.
 */
export async function guardPublicRate(
  request: NextRequest,
  bucket: string,
  limit: number,
  windowMs: number,
  extraKey?: string,
): Promise<NextResponse | null> {
  const ip = getClientIp(request);
  const verdict = await rateLimit({
    key: `booking:${bucket}:${extraKey || ip}`,
    limit,
    windowMs,
  });
  if (verdict.allowed) return null;
  return NextResponse.json(
    { error: 'Too many requests. Please try again shortly.' },
    { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((verdict.resetAt - Date.now()) / 1000))) } },
  );
}

/**
 * A reference a patient can read down the phone but nobody can guess.
 *
 * Ambiguous glyphs (0/O, 1/I) are left out of the alphabet — this string gets
 * read aloud to a receptionist, and "is that a zero or an oh" is a support
 * call we can design away.
 */
export function generateBookingReference(): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const body = Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
  return `TMH-${body.slice(0, 4)}-${body.slice(4, 8)}`;
}
