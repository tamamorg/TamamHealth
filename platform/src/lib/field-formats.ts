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
 * Phone canonical (stored) form: E.164, `+211XXXXXXXXX` for South Sudan (+211
 * plus a 9-digit national number beginning with 9), displayed `+211 9XX XXX XXX`.
 * A number that cannot be normalized is kept as entered.
 */

import { activeCountry } from '@/lib/country/country-pack';
import { getRoleFlag } from './settings/role-settings-store';

/** Default country calling code (South Sudan). */
/**
 * Normalize a raw phone string to canonical E.164. Accepts this country's local
 * form (`0912 345 678`), its international form (`+211 912-345-678`,
 * `211912345678`), and any other country's number written with its code
 * (`+254 712 345 678`, `00254…`), with arbitrary spaces/dashes/parens. Returns
 * `null` for a number that fits none of those.
 */
export function normalizePhone(raw: unknown, countryCode: string = activeCountry().dialCode): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  let digits = s.replace(/\D/g, '');
  if (!digits) return null;
  const international = /^(\+|00)/.test(s);
  if (international) digits = digits.replace(/^00/, '');
  // Strip the country code or a national trunk "0" prefix to get the NSN.
  if (countryCode && digits.startsWith(countryCode)) {
    digits = digits.slice(countryCode.length);
  } else if (international) {
    // Another country's number: its length rules are that country's, so hold
    // it to E.164 only.
    return /^[1-9]\d{6,14}$/.test(digits) ? `+${digits}` : null;
  } else if (digits.startsWith('0')) {
    digits = digits.replace(/^0+/, '');
  }
  if (!countryCode || !activeCountry().nationalNumber.test(digits)) return null;
  return `+${countryCode}${digits}`;
}

/**
 * True when empty (optional) or anything that could be someone's phone number.
 * Deliberately loose: a visitor may only know their number in their home
 * format, and a record with it is better than a refused one. Only what
 * normalizes is safe to send to; see `normalizePhone` in lib/sms/text.ts.
 */
export function isValidPhone(raw: unknown, countryCode: string = activeCountry().dialCode): boolean {
  if (raw == null || String(raw).trim() === '') return true;
  if (normalizePhone(raw, countryCode) !== null) return true;
  const value = String(raw).trim();
  const digits = value.replace(/\D/g, '');
  return /^[+\d\s().\-/]+$/.test(value) && digits.length >= 6 && digits.length <= 15;
}

/** Human display form: `+211 912 345 678`, a foreign number as entered in E.164.
 *  Falls back to the raw value when it won't normalize, so legacy values still
 *  render. */
export function formatPhoneDisplay(raw: unknown, countryCode: string = activeCountry().dialCode): string {
  const e164 = normalizePhone(raw, countryCode);
  if (!e164) return raw == null ? '' : String(raw);
  if (!countryCode || !e164.startsWith(`+${countryCode}`)) return e164;
  const nsn = e164.slice(1 + countryCode.length);
  if (nsn.length !== 9) return e164;
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
export function formatPhoneShared(raw: unknown, countryCode: string = activeCountry().dialCode): string {
  const shown = formatPhoneDisplay(raw, countryCode);
  if (!shown) return '';
  if (!getRoleFlag('security.mask', false)) return shown;
  const digits = shown.replace(/\D/g, '');
  if (digits.length < 3) return '•••';
  return `••• ••• ${digits.slice(-2)}`;
}

/**
 * Address for a shared screen — masked entirely, or shown in full.
 *
 * `hiddenLabel` names what was withheld, so a county/state line on a list row
 * reads "Location hidden" rather than claiming a street address was there.
 */
export function formatAddressShared(raw: unknown, hiddenLabel: string = 'Address hidden'): string {
  const value = raw == null ? '' : String(raw).trim();
  if (!value) return '';
  return getRoleFlag('security.mask', false) ? hiddenLabel : value;
}

/** County/state line for a shared screen — the list-row form of the above. */
export function formatLocationShared(parts: unknown[]): string {
  const value = parts.map(part => (part == null ? '' : String(part).trim())).filter(Boolean).join(', ');
  return formatAddressShared(value, 'Location hidden');
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
// National ID — alphanumeric, 3–30 chars, stored upper-cased.
// ---------------------------------------------------------------------------

export function normalizeNationalId(raw: unknown): string {
  return raw == null ? '' : String(raw).trim().toUpperCase().replace(/\s+/g, '');
}

export function isValidNationalId(raw: unknown): boolean {
  const s = normalizeNationalId(raw);
  if (!s) return true;
  return /^[A-Z0-9-]{3,30}$/.test(s);
}

