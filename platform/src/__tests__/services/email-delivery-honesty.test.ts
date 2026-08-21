/**
 * @jest-environment node
 *
 * "Sent" must mean sent.
 *
 * The `log` provider reports `ok: true` by design, so that delivery status,
 * toasts and audit keep working on a deployment with no mail credentials. That
 * is right for a receipt nobody is waiting on and wrong for an account
 * invitation: an administrator told the invitation was emailed will not read
 * the temporary password out loud, and the new user is left with no way in.
 *
 * `wasDelivered` is the distinction. These pin it, because the failure it
 * prevents is silent — everything looks successful and a person cannot log in.
 */

import { sendEmail, wasDelivered, resetEmailProviderForTest } from '@/lib/email';

const OLD_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...OLD_ENV };
  resetEmailProviderForTest();
});

test('an unconfigured deployment reports ok but is NOT delivered', async () => {
  delete process.env.EMAIL_PROVIDER;
  resetEmailProviderForTest();

  const result = await sendEmail({ to: 'a@example.org', subject: 'hi', body: 'text' });

  // Both halves matter: `ok` stays true so nothing downstream breaks…
  expect(result.ok).toBe(true);
  expect(result.providerId).toBe('log');
  // …and the caller that depends on real delivery is told the truth.
  expect(wasDelivered(result)).toBe(false);
});

test('EMAIL_PROVIDER=log is treated the same as unset', async () => {
  process.env.EMAIL_PROVIDER = 'log';
  resetEmailProviderForTest();

  expect(wasDelivered(await sendEmail({ to: 'a@example.org', subject: 's', body: 'b' }))).toBe(false);
});

test('a real provider that fails is not delivered either', () => {
  expect(wasDelivered({ ok: false, providerId: 'resend', error: 'Resend 401' })).toBe(false);
});

test('a real provider that succeeds is delivered', () => {
  expect(wasDelivered({ ok: true, providerId: 'resend', providerMessageId: 'msg-1' })).toBe(true);
  expect(wasDelivered({ ok: true, providerId: 'sendgrid' })).toBe(true);
});
