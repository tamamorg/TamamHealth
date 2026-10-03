/**
 * Which numbers the facility's SMS gateway may text.
 *
 * The patient-text route takes the number from the patient's record, never
 * from the request — but a record's number is itself editable by many of the
 * roles that may send, so "it is on a chart" does not make a number safe to
 * pay to reach. Any account able to register a patient could otherwise point
 * the gateway at a premium-rate or overseas number and send from the
 * facility's sender name.
 *
 * So texts go only to countries the deployment serves. The default is South
 * Sudan and the countries it borders, where patients genuinely hold numbers;
 * set `PATIENT_SMS_COUNTRY_CODES` (comma-separated calling codes, no `+`) to
 * narrow or widen it.
 *
 * Server-only: read from the route, not from the browser.
 */
import { normalizePhone } from './text';

/** South Sudan, then Sudan, Ethiopia, Kenya, Uganda, DR Congo, Central African Republic. */
export const DEFAULT_PATIENT_SMS_COUNTRY_CODES = ['211', '249', '251', '254', '256', '243', '236'] as const;

export function allowedCountryCodes(configured: string | undefined = process.env.PATIENT_SMS_COUNTRY_CODES): string[] {
  const parsed = (configured || '').split(',').map(code => code.replace(/\D/g, '')).filter(Boolean);
  return parsed.length > 0 ? parsed : [...DEFAULT_PATIENT_SMS_COUNTRY_CODES];
}

/** Whether the gateway may text this number, as stored on a patient record. */
export function isAllowedDestination(rawPhone: string, codes: string[] = allowedCountryCodes()): boolean {
  const digits = normalizePhone(rawPhone).replace(/\D/g, '');
  // An E.164 number is 8–15 digits; anything else is not a phone number.
  if (digits.length < 8 || digits.length > 15) return false;
  return codes.some(code => digits.startsWith(code));
}
