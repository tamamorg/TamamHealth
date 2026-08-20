'use client';

/**
 * Browser-side types and fetchers for the public booking API.
 *
 * These screens never touch PouchDB — they are rendered for a patient on their
 * own device, and the only thing that should reach that device is the free/busy
 * and published-profile data these endpoints return.
 */

export interface PublicPracticeInfo {
  slug: string;
  name: string;
  town?: string;
  state?: string;
  phone?: string;
}

export interface PublicPolicy {
  slug: string;
  confirmationMode: 'request' | 'auto';
  maxAdvanceDays: number;
  minLeadTimeMinutes: number;
  cancellationWindowHours: number;
  requireInsurance: boolean;
  policyText?: string;
  consentTextPrivacy: string;
  consentTextSms: string;
  publicPhone?: string;
  publicEmail?: string;
}

export interface PublicProvider {
  id: string;
  slug: string;
  displayName: string;
  credentials?: string;
  specialtyLabel: string;
  photoUrl?: string;
  bio?: string;
  languages: string[];
  acceptingNewPatients: boolean;
  facilityIds: string[];
}

export interface PublicReason {
  id: string;
  slug: string;
  name: string;
  durationMinutes: number;
  availableToNewPatients: boolean;
  availableToReturningPatients: boolean;
  requiresInsurance: boolean;
  sortOrder: number;
}

export interface PublicSlot {
  providerId: string;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
}

export interface PracticePayload {
  practice: PublicPracticeInfo;
  policy: PublicPolicy;
  providers: PublicProvider[];
  reasons: PublicReason[];
}

export interface ProviderPayload {
  practice: PublicPracticeInfo;
  policy: PublicPolicy;
  provider: PublicProvider;
  locations: { id: string; name: string; town?: string; state?: string }[];
  reasons: PublicReason[];
}

export interface SlotsPayload {
  slots: PublicSlot[];
  from: string;
  to: string;
  durationMinutes?: number;
  notOfferedToPatientClass?: boolean;
  notOfferedInModality?: boolean;
  beyondHorizon?: boolean;
}

export interface BookingConfirmation {
  reference: string;
  status: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  providerName: string;
  facilityName: string;
  visitReasonName: string;
}

/**
 * One place where a failed response becomes a thrown `Error` carrying the
 * server's own message. The booking forms show that message verbatim — "That
 * time has just been taken" is more use to a patient than "Request failed".
 */
async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null) as ({ error?: string; code?: string } & T) | null;
  if (!res.ok) {
    const err = new Error(body?.error || `Request failed (${res.status})`) as Error & { code?: string };
    err.code = body?.code;
    throw err;
  }
  return body as T;
}

export async function fetchPractice(slug: string, signal?: AbortSignal): Promise<PracticePayload> {
  return json<PracticePayload>(await fetch(`/api/booking/practice/${encodeURIComponent(slug)}`, { signal }));
}

export async function fetchProvider(
  practice: string, provider: string, signal?: AbortSignal,
): Promise<ProviderPayload> {
  const url = `/api/booking/provider/${encodeURIComponent(provider)}?practice=${encodeURIComponent(practice)}`;
  return json<ProviderPayload>(await fetch(url, { signal }));
}

export interface SlotQueryParams {
  practice: string;
  reason: string;
  patientClass: 'new' | 'returning';
  from: string;
  to: string;
  provider?: string;
}

export async function fetchSlots(params: SlotQueryParams, signal?: AbortSignal): Promise<SlotsPayload> {
  const q = new URLSearchParams({
    practice: params.practice,
    reason: params.reason,
    patientClass: params.patientClass,
    from: params.from,
    to: params.to,
  });
  if (params.provider) q.set('provider', params.provider);
  return json<SlotsPayload>(await fetch(`/api/booking/slots?${q.toString()}`, { signal }));
}

export async function holdSlot(input: {
  practice: string; reason: string; providerId: string; date: string; startTime: string;
}): Promise<{ holdToken: string; expiresAt: string }> {
  return json(await fetch('/api/booking/hold', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }));
}

export interface SubmitBookingInput {
  practice: string;
  reason: string;
  holdToken: string;
  patientClass: 'new' | 'returning';
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  dateOfBirth?: string;
  insurance?: { provider?: string; memberId?: string; groupId?: string };
  notes?: string;
  consentPrivacy: boolean;
  consentSms: boolean;
  website?: string;
}

export async function submitBooking(input: SubmitBookingInput): Promise<BookingConfirmation> {
  return json<BookingConfirmation>(await fetch('/api/booking/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }));
}

export async function fetchByReference(ref: string): Promise<BookingConfirmation & { firstName?: string }> {
  return json(await fetch(`/api/booking/reference/${encodeURIComponent(ref)}`));
}

// ── Formatting ─────────────────────────────────────────────────────────────

/** "14:30" → "2:30 PM". */
export function to12Hour(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

/**
 * Parsed as a local date at midday.
 *
 * `new Date('2026-05-21')` is parsed as UTC and renders as the 20th anywhere
 * west of Greenwich — which would show a patient the wrong day for their own
 * appointment. Midday local is far enough from either boundary to be safe.
 */
export function localDate(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

/** "TUE" / "May 21", the two lines of the day navigator. */
export function dayParts(iso: string): { weekday: string; label: string } {
  const d = localDate(iso);
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase(),
    label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  };
}

/** "Tuesday, May 21, 10:30 AM" — the summary header line. */
export function longWhen(iso: string, hhmm: string): string {
  const d = localDate(iso);
  const day = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  return `${day}, ${to12Hour(hhmm)}`;
}

export function addDays(iso: string, n: number): string {
  const d = localDate(iso);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "Dr. Achol Mayen Deng" → "AM". Titles are dropped, not initialised. */
export { initials as monogram } from '@/lib/patient-utils';
