/**
 * The patient's way into the portal, as it is handed over at the desk.
 *
 * Client-safe: Web Crypto only, no database, no Node built-in. It has to be,
 * because the account is now created BY the registration write — on the
 * registering device, offline or not — rather than by a second trip to the
 * server after the patient has already been sent to the waiting room. The
 * server's enrolment service (`services/patient-portal-enrolment.ts`) uses the
 * same functions, so a code issued at registration and one re-issued from the
 * chart are the same kind of thing and redeem at the same endpoint.
 *
 * ## Why not the staff invitation token
 *
 * Staff invitations are 32 random bytes in base64url, which is right for a
 * link in an email and wrong for a slip of paper: 43 mixed-case characters,
 * typed with a thumb, by someone who may never have filled in a web form.
 * A patient is handed this on paper far more often than by link.
 *
 * So the patient code is 16 characters from a 32-letter alphabet with the
 * look-alikes removed (no 0/O, 1/I), printed in four groups. That is 80 bits:
 * still far beyond guessing through a rate-limited endpoint, and still beyond
 * brute-forcing the stored SHA-256 from a database dump inside the code's
 * lifetime — the property the invitation design exists to keep.
 */

import { INVITE_TTL_HOURS } from './invite-window';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PORTAL_CODE_LENGTH = 16;
const CODE_GROUP = 4;
const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${PORTAL_CODE_LENGTH}}$`);

/**
 * How long a patient has to redeem the slip.
 *
 * Longer than a staff invitation (72 hours). A staff member is invited at
 * work and expected to act that day; a patient is handed a slip on the way to
 * triage and may not be near a phone with data until they are home and well.
 */
export const PORTAL_INVITE_TTL_HOURS = Math.max(INVITE_TTL_HOURS, 14 * 24);

/** A fresh activation code, unformatted. */
export function generatePortalActivationCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(PORTAL_CODE_LENGTH));
  // 32 divides 256, so masking is unbiased.
  return Array.from(bytes, byte => CODE_ALPHABET[byte & 31]).join('');
}

/** `ABCDEFGHJKLMNPQR` → `ABCD-EFGH-JKLM-NPQR`, as it is printed and read out. */
export function formatPortalActivationCode(code: string): string {
  const groups = normalisePortalActivationCode(code).match(new RegExp(`.{1,${CODE_GROUP}}`, 'g'));
  return groups ? groups.join('-') : '';
}

/** What a patient typed, reduced to what was issued: no dashes, spaces or case. */
export function normalisePortalActivationCode(raw: string): string {
  return (raw || '').replace(/[\s-]/g, '').toUpperCase();
}

/** True for a (normalised) code of the desk-issued shape. */
export function isPortalActivationCode(normalised: string): boolean {
  return CODE_PATTERN.test(normalised);
}

/**
 * SHA-256 of the normalised code, hex — what the patient document stores.
 *
 * Null where Web Crypto's digest is unavailable (a page served over plain
 * http on a LAN address). The caller must then leave the account unissued
 * rather than fall back to something weaker.
 */
export async function hashPortalActivationCode(code: string): Promise<string | null> {
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined;
  if (!subtle) return null;
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(normalisePortalActivationCode(code)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function portalInviteExpiry(now: Date = new Date()): string {
  return new Date(now.getTime() + PORTAL_INVITE_TTL_HOURS * 3_600_000).toISOString();
}

/** A minted invitation. `code` is shown once — only `tokenHash` is persisted. */
export interface PortalInvite {
  /** Formatted for the slip. */
  code: string;
  tokenHash: string;
  expiresAt: string;
}

/** Mint an invitation on this device, or null if it cannot be done safely. */
export async function mintPortalInvite(now: Date = new Date()): Promise<PortalInvite | null> {
  try {
    const code = generatePortalActivationCode();
    const tokenHash = await hashPortalActivationCode(code);
    if (!tokenHash) return null;
    return { code: formatPortalActivationCode(code), tokenHash, expiresAt: portalInviteExpiry(now) };
  } catch {
    return null;
  }
}

export function normalisePortalUsername(raw: string): string {
  return (raw || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
}

/** A username suggestion from the patient's own identifiers. */
export function suggestPortalUsername(patient: { firstName?: string; surname?: string; hospitalNumber?: string }): string {
  const name = [patient.firstName, patient.surname]
    .filter(Boolean)
    .join('.')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9.]/g, '');
  const suffix = (patient.hospitalNumber || '').replace(/[^0-9]/g, '').slice(-4);
  return normalisePortalUsername(suffix ? `${name}.${suffix}` : name) || 'patient';
}

/** `base`, or `base-2`, `base-3`… — the first one nobody holds. */
export function uniquePortalUsername(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Where the slip sends the patient. */
export const PORTAL_ACTIVATE_PATH = '/patient-portal/activate';
