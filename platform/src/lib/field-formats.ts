/**
 * Canonical field formats — the single source of truth for how structured
 * fields (phone, email, national ID, hospital number) are normalized,
 * validated, and displayed across the platform.
 *
 * Goal: every capture point stores the SAME canonical form, every validator
 * rejects malformed input with a clear error, and every display renders the
 * SAME human-friendly form. Previously phone numbers were stored inconsistently
 * (some with the +211 country code, some without, some with dashes).
 *
 * Phone canonical (stored) form: E.164 `+211XXXXXXXXX` (South Sudan +211 plus a
 * 9-digit national number beginning with 9). Display form: `+211 9XX XXX XXX`.
 */

import { getRoleFlag } from './settings/role-settings-store';

/** Default country calling code (South Sudan). */
export const DEFAULT_COUNTRY_CODE = '211';

/**
 * Normalize a raw phone string to canonical E.164 (`+211XXXXXXXXX`).
 * Accepts local (`0912 345 678`, `912345678`), international (`+211 912-345-678`,
 * `211912345678`) with arbitrary spaces/dashes/parens. Returns `null` if the
 * input cannot be normalized to a valid South Sudan number.
 */
export function normalizePhone(raw: unknown, countryCode: string = DEFAULT_COUNTRY_CODE): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  let digits = s.replace(/\D/g, '');
  if (!digits) return null;
  // Strip the country code or a national trunk "0" prefix to get the NSN.
  if (digits.startsWith(countryCode)) {
    digits = digits.slice(countryCode.length);
  } else if (digits.startsWith('0')) {
    digits = digits.replace(/^0+/, '');
  }
  // South Sudan mobile numbers: 9 digits beginning with 9.
  if (!/^9\d{8}$/.test(digits)) return null;
  return `+${countryCode}${digits}`;
}

/** True when the value is empty (optional) OR a valid normalizable phone. */
export function isValidPhone(raw: unknown, countryCode: string = DEFAULT_COUNTRY_CODE): boolean {
  if (raw == null || String(raw).trim() === '') return true;
  return normalizePhone(raw, countryCode) !== null;
}

/** Human display form: `+211 912 345 678`. Falls back to the raw value if it
 *  isn't a canonical SS number (so legacy/unknown values still render). */
export function formatPhoneDisplay(raw: unknown, countryCode: string = DEFAULT_COUNTRY_CODE): string {
  const e164 = normalizePhone(raw, countryCode);
  if (!e164) return raw == null ? '' : String(raw);
  const nsn = e164.slice(1 + countryCode.length); // 9 digits
  return `+${countryCode} ${nsn.slice(0, 3)} ${nsn.slice(3, 6)} ${nsn.slice(6)}`;
}

/**
 * Phone for a SHARED screen — a queue, a worklist, the header search results.
 *
 * Honours the user's "Hide patient identifiers on shared screens"
 * (`security.mask`): a masked number keeps its last two digits so staff can
 * still confirm the right patient with someone standing in front of them,
 * without the whole number being readable across a waiting room.
 *
 * The patient's own chart, registration, and printed documents deliberately
 * keep `formatPhoneDisplay` — masking there would hide the number from the
 * clinician who needs to dial it.
 */
export function formatPhoneShared(raw: unknown, countryCode: string = DEFAULT_COUNTRY_CODE): string {
  const shown = formatPhoneDisplay(raw, countryCode);
  if (!shown) return '';
  if (!getRoleFlag('security.mask', false)) return shown;
  const digits = shown.replace(/\D/g, '');
  if (digits.length < 3) return '•••';
  return `••• ••• ${digits.slice(-2)}`;
}

/** Street address for a shared screen — masked entirely, or shown in full. */
export function formatAddressShared(raw: unknown): string {
  const value = raw == null ? '' : String(raw).trim();
  if (!value) return '';
  return getRoleFlag('security.mask', false) ? 'Address hidden' : value;
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

/** Canonical email: trimmed + lower-cased. */
export function normalizeEmail(raw: unknown): string {
  return raw == null ? '' : String(raw).trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** True when empty (optional) OR a structurally valid email. */
export function isValidEmail(raw: unknown): boolean {
  const s = normalizeEmail(raw);
  if (!s) return true;
  return EMAIL_RE.test(s);
}

// ---------------------------------------------------------------------------
// National ID (South Sudan) — alphanumeric, 3–30 chars, stored upper-cased.
// ---------------------------------------------------------------------------

export function normalizeNationalId(raw: unknown): string {
  return raw == null ? '' : String(raw).trim().toUpperCase().replace(/\s+/g, '');
}

export function isValidNationalId(raw: unknown): boolean {
  const s = normalizeNationalId(raw);
  if (!s) return true;
  return /^[A-Z0-9-]{3,30}$/.test(s);
}

