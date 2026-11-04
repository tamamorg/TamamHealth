/**
 * describeError decides what a clinician reads when something fails: domain
 * sentences pass through, coded and internal errors never do.
 */
import {
  CODE_MESSAGES, CONFLICT_MESSAGE, OFFLINE_MESSAGE, SESSION_MESSAGE,
  describeApiError, describeError, isUserFacingText,
} from '@/lib/user-facing-error';
import { BillingError } from '@/lib/services/billing-service';

const FALLBACK = 'Blood unit not added. Try again.';

describe('describeError', () => {
  it('translates a bare error code instead of showing it', () => {
    expect(describeError(new Error('INSURANCE_LINK_MISMATCH'), FALLBACK)).toBe(CODE_MESSAGES.INSURANCE_LINK_MISMATCH);
    expect(describeError(new BillingError('BILL_HAS_PAYMENTS', 'x'), FALLBACK)).toBe(CODE_MESSAGES.BILL_HAS_PAYMENTS);
  });

  it('passes a sentence written for the user through unchanged', () => {
    const msg = 'The bed changed on another workstation. Refresh and try again.';
    expect(describeError(new Error(msg), FALLBACK)).toBe(msg);
  });

  it('falls back for internal and developer messages', () => {
    for (const msg of [
      'Encounter not found: enc-123_abc',
      'Upstash 5xx: 503',
      'patientId is required',
      "Cannot read properties of undefined (reading 'name')",
      'Unexpected token < in JSON at position 0',
      'missing',
      'Invalid request body',
      'Malformed ciphertext envelope.',
      'CSP nonce contains invalid characters',
    ]) expect(describeError(new Error(msg), FALLBACK)).toBe(FALLBACK);
    expect(describeError('boom', FALLBACK)).toBe(FALLBACK);
    expect(describeError(null, FALLBACK)).toBe(FALLBACK);
  });

  it('names the real cause for offline, conflict and session failures', () => {
    expect(describeError(new TypeError('Failed to fetch'), FALLBACK)).toBe(OFFLINE_MESSAGE);
    expect(describeError({ status: 409, name: 'conflict', message: 'Document update conflict' }, FALLBACK)).toBe(CONFLICT_MESSAGE);
    expect(describeError({ status: 401, message: 'unauthorized' }, FALLBACK)).toBe(SESSION_MESSAGE);
  });
});

describe('describeApiError', () => {
  it('shows a sentence body, hides a developer body', () => {
    expect(describeApiError({ error: 'Enter your username and password.' }, FALLBACK)).toBe('Enter your username and password.');
    expect(describeApiError({ error: 'providerId, date and startTime are required' }, FALLBACK)).toBe(FALLBACK);
    expect(describeApiError({ error: 'PAYMENT_LINK_EXPIRED' }, FALLBACK)).toBe(CODE_MESSAGES.PAYMENT_LINK_EXPIRED);
    expect(describeApiError({}, FALLBACK)).toBe(FALLBACK);
  });
});

describe('isUserFacingText', () => {
  it('accepts plain sentences, including ones with numbers', () => {
    expect(isUserFacingText('Ward 3 bed 402 is no longer available. Choose another bed.')).toBe(true);
  });
});

describe('describeError in Juba Arabic', () => {
  afterEach(async () => {
    const { loadTranslations, setActiveTranslations } = await import('@/lib/i18n');
    setActiveTranslations(await loadTranslations('en'));
  });

  it('shows a service sentence and a coded message in the current language', async () => {
    const { loadTranslations, setActiveTranslations } = await import('@/lib/i18n');
    const apd = await loadTranslations('apd');
    setActiveTranslations(apd);
    expect(describeError(new Error('Appointment not updated. Try again.'), FALLBACK)).toBe('الموعد ما اتحدّث. جرّب تاني.');
    expect(describeError(new TypeError('Failed to fetch'), FALLBACK)).not.toBe(OFFLINE_MESSAGE);
    expect(describeApiError({ error: 'The username or password is incorrect.' }, FALLBACK)).toBe('اسم المستخدم أو كلمة السر غلط.');
  });

  it('fills values into a sentence that has them, translating status words', async () => {
    const { loadTranslations, setActiveTranslations } = await import('@/lib/i18n');
    setActiveTranslations(await loadTranslations('apd'));
    expect(describeError(new Error('Amoxicillin is out of stock at this facility.'), FALLBACK)).toBe('Amoxicillin خلص من المخزون في المرفق ده.');
    expect(describeError(new Error('This claim is denied. Only a denied claim can be appealed.'), FALLBACK)).toBe('المطالبة دي مرفوض. بس المطالبة المرفوضة بيتستأنف عليها.');
    expect(describeError(new Error('Mary Akol already has an active admission in Ward A, bed 4.'), FALLBACK)).toBe('Mary Akol عندو تنويم نشط في Ward A، سرير 4.');
  });

  it('leaves a sentence with no translation, and the fallback, as they are', async () => {
    const { loadTranslations, setActiveTranslations } = await import('@/lib/i18n');
    setActiveTranslations(await loadTranslations('apd'));
    const msg = 'The bed on ward 3 changed on another workstation. Refresh and try again.';
    expect(describeError(new Error(msg), FALLBACK)).toBe(msg);
    expect(describeError(new Error('patientId is required'), 'الموعد ما اتحدّث.')).toBe('الموعد ما اتحدّث.');
  });
});
