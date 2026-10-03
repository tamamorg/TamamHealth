/**
 * Which numbers the facility's SMS gateway may text.
 *
 * The number comes from the patient record, and many of the roles that may
 * send a text may also edit that record — so the record alone cannot make a
 * number safe to pay to reach.
 */
import { DEFAULT_PATIENT_SMS_COUNTRY_CODES, allowedCountryCodes, isAllowedDestination } from '@/lib/sms/destination-policy';
import { normalizePhone } from '@/lib/sms/text';

describe('allowedCountryCodes', () => {
  it('defaults to South Sudan and the countries it borders', () => {
    expect(allowedCountryCodes(undefined)).toEqual([...DEFAULT_PATIENT_SMS_COUNTRY_CODES]);
    expect(allowedCountryCodes('')).toEqual([...DEFAULT_PATIENT_SMS_COUNTRY_CODES]);
    expect(DEFAULT_PATIENT_SMS_COUNTRY_CODES[0]).toBe('211');
  });

  it('reads a configured list, tolerating spaces and plus signs', () => {
    expect(allowedCountryCodes(' +211, 256 ,,')).toEqual(['211', '256']);
  });
});

describe('isAllowedDestination', () => {
  it('accepts local and international forms of an allowed country', () => {
    for (const phone of ['0912345145', '+211 912 345 145', '211912345145', '+256701234567']) {
      expect(isAllowedDestination(phone)).toBe(true);
    }
  });

  it('refuses everywhere else, and anything that is not a phone number', () => {
    for (const phone of ['+447700900123', '+15550001111', '+8613800138000', '', '12345', '+2119']) {
      expect(isAllowedDestination(phone)).toBe(false);
    }
  });

  it('honours a narrower list', () => {
    expect(isAllowedDestination('+256701234567', ['211'])).toBe(false);
    expect(isAllowedDestination('0912345145', ['211'])).toBe(true);
  });
});

describe('normalizePhone', () => {
  it('reads a leading zero as the South Sudan trunk prefix', () => {
    expect(normalizePhone('0912345145')).toBe('+211912345145');
    expect(normalizePhone('211912345145')).toBe('+211912345145');
    expect(normalizePhone('+256701234567')).toBe('+256701234567');
  });
});
