/**
 * A hospital anywhere can run the platform and register a patient from
 * anywhere. South Sudan is the default and keeps its exact behaviour.
 */
import { activeCountry, defaultCurrency, offeredCurrencies, usesAddressLists } from '@/lib/country/country-pack';
import { identifiersFrom, isValidDocumentNumber } from '@/lib/country/patient-identity';
import { countryName, worldCountries, worldLanguages } from '@/lib/country/world-lists';
import { formatPhoneDisplay, isValidEmail, isValidPhone, normalizePhone } from '@/lib/field-formats';
import { isAllowedDestination } from '@/lib/sms/destination-policy';
import { sendSms } from '@/lib/sms';
import { normalizePhone as smsNumber } from '@/lib/sms/text';
import { clinicalInstant, jubaDate, jubaDateRangeUtc } from '@/lib/time-juba';
import { normalizeGender, validatePatientData } from '@/lib/validation';
import { formatMoney } from '@/lib/format-utils';

const KEYS = ['NEXT_PUBLIC_ORG_COUNTRY_CODE', 'NEXT_PUBLIC_ORG_DIAL_CODE', 'NEXT_PUBLIC_ORG_TIMEZONE', 'NEXT_PUBLIC_DEFAULT_CURRENCY'];
const saved = KEYS.map(key => process.env[key]);
const useCountry = (code: string, dial: string, zone: string, currency: string) => {
  process.env.NEXT_PUBLIC_ORG_COUNTRY_CODE = code;
  process.env.NEXT_PUBLIC_ORG_DIAL_CODE = dial;
  process.env.NEXT_PUBLIC_ORG_TIMEZONE = zone;
  process.env.NEXT_PUBLIC_DEFAULT_CURRENCY = currency;
};
beforeEach(() => KEYS.forEach(key => { delete process.env[key]; }));
afterAll(() => KEYS.forEach((key, i) => {
  if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i];
}));

const visitor = {
  firstName: 'Amina', gender: 'Female', dateOfBirth: '1990-01-01', primaryLanguage: 'Swahili',
  residenceCountry: 'KE', nokName: 'Juma', nokRelationship: 'Spouse', nokPhone: '+254712345678', phone: '+447911123456',
};

describe('South Sudan stays the default', () => {
  it('keeps its country settings', () => {
    expect(activeCountry()).toMatchObject({ code: 'SS', dialCode: '211', timeZone: 'Africa/Juba', currency: 'SSP', asksTribe: true });
    expect(formatMoney(1234)).toBe('SSP 1,234');
  });

  it('keeps local numbers and their display', () => {
    expect(normalizePhone('0912 345 678')).toBe('+211912345678');
    expect(formatPhoneDisplay('0912345678')).toBe('+211 912 345 678');
    expect(normalizePhone('0812345678')).toBeNull();
    expect(normalizePhone('+211 812 345 678')).toBeNull();
  });

  it('still requires a listed state and county for a local patient', () => {
    expect(validatePatientData({ ...visitor, residenceCountry: 'SS', phone: '', nokPhone: '0912345678' })).toMatchObject({ state: expect.any(String) });
    expect(validatePatientData({ ...visitor, residenceCountry: undefined, state: 'Jonglei', phone: '', nokPhone: '0912345678' })).toMatchObject({ county: expect.any(String) });
  });

  it('keeps the clinical day at UTC+2', () => {
    expect(jubaDate('2026-03-31T22:30:00Z')).toBe('2026-04-01');
    expect(clinicalInstant('2026-04-01', '08:00')).toBe('2026-04-01T06:00:00.000Z');
  });
});

describe('a patient from another country', () => {
  it('registers with foreign phones, no surname, and no local address', () => {
    expect(validatePatientData(visitor)).toEqual({});
  });

  it('keeps any country\'s number in E.164', () => {
    expect(normalizePhone('+254 712 345 678')).toBe('+254712345678');
    expect(normalizePhone('00447911123456')).toBe('+447911123456');
    expect(formatPhoneDisplay('+254712345678')).toBe('+254712345678');
    expect(normalizePhone('+12')).toBeNull();
  });

  it('accepts Other and Unknown', () => {
    expect(normalizeGender('other')).toBe('Other');
    expect(normalizeGender('Unknown')).toBe('Unknown');
    expect(normalizeGender('x')).toBeNull();
  });

  it('holds a passport with its punctuation', () => {
    expect(isValidDocumentNumber('P<KEN 1234-5')).toBe(true);
    expect(isValidDocumentNumber('ab')).toBe(false);
    expect(identifiersFrom('passport', ' P123 ', 'KE')).toEqual([{ type: 'passport', value: 'P123', country: 'KE' }]);
    expect(identifiersFrom('', 'P123', '')).toBeUndefined();
    expect(validatePatientData({ ...visitor, identifiers: [{ type: 'passport', value: 'x' }] }).identifiers).toBeDefined();
  });

  it('offers every country and language', () => {
    expect(worldCountries().length).toBeGreaterThan(240);
    expect(countryName('KE')).toBe('Kenya');
    expect(worldLanguages()).toEqual(expect.arrayContaining(['Swahili', 'French', 'Amharic']));
  });
});

describe('any phone number and email can be recorded', () => {
  it('takes a foreign number in its home format', () => {
    expect(isValidPhone('0712 345 678')).toBe(true);
    expect(validatePatientData({ ...visitor, phone: '(020) 7946 0958', nokPhone: '0712345678' })).toEqual({});
  });

  it('still refuses what is not a phone number', () => {
    expect(isValidPhone('call me')).toBe(false);
    expect(isValidPhone('123')).toBe(false);
    expect(isValidPhone('1234567890123456')).toBe(false);
  });

  it('never guesses South Sudan for a home-format foreign number', () => {
    expect(normalizePhone('0712345678')).toBeNull();
    expect(smsNumber('0712345678')).toBe('');
    expect(isAllowedDestination('0712345678')).toBe(false);
    expect(smsNumber('0912345145')).toBe('+211912345145');
    expect(smsNumber('+254712345678')).toBe('+254712345678');
  });

  it('refuses to send to such a number', async () => {
    await expect(sendSms({ to: '0712345678', body: 'x' } as Parameters<typeof sendSms>[0])).resolves.toMatchObject({ ok: false, error: 'invalid_number' });
  });

  it('takes emails from anywhere', () => {
    expect(isValidEmail('amina@mail.co.ke')).toBe(true);
    expect(isValidEmail('josé@correo.es')).toBe(true);
    expect(isValidEmail('用户@例子.中国')).toBe(true);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(validatePatientData({ ...visitor, email: 'nope', nokEmail: 'nope' })).toMatchObject({ email: expect.any(String), nokEmail: expect.any(String) });
  });
});

describe('another country\'s deployment', () => {
  it('follows that country\'s code, currency and lists', () => {
    useCountry('KE', '254', 'Africa/Nairobi', 'KES');
    expect(normalizePhone('0712 345 678')).toBe('+254712345678');
    expect(defaultCurrency()).toBe('KES');
    expect(offeredCurrencies()[0]).toBe('KES');
    expect(usesAddressLists('KE')).toBe(false);
    expect(activeCountry().asksTribe).toBe(false);
    expect(formatMoney(5)).toBe('KES 5');
  });

  it('buckets the clinical day in that zone', () => {
    useCountry('KE', '254', 'Africa/Nairobi', 'KES');
    expect(jubaDate('2026-03-31T21:30:00Z')).toBe('2026-04-01');
    expect(clinicalInstant('2026-04-01', '08:00')).toBe('2026-04-01T05:00:00.000Z');
  });

  it('follows daylight saving', () => {
    useCountry('GB', '44', 'Europe/London', 'GBP');
    expect(clinicalInstant('2026-01-15', '09:00')).toBe('2026-01-15T09:00:00.000Z');
    expect(clinicalInstant('2026-07-15', '09:00')).toBe('2026-07-15T08:00:00.000Z');
    expect(jubaDateRangeUtc('2026-07-01', '2026-07-02').from).toBe('2026-06-30T23:00:00.000Z');
  });

  it('handles a zone behind UTC', () => {
    useCountry('US', '1', 'America/New_York', 'USD');
    expect(jubaDate('2026-01-15T03:00:00Z')).toBe('2026-01-14');
  });

  it('asks for a country code when none is configured', () => {
    useCountry('FR', '', 'Europe/Paris', 'EUR');
    expect(normalizePhone('0612345678')).toBeNull();
    expect(normalizePhone('+33612345678')).toBe('+33612345678');
  });
});
