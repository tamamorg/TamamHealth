/** @jest-environment node */

import crypto from 'node:crypto';

jest.mock('@/modules/identity', () => ({ logApiError: jest.fn() }));
jest.mock('@/lib/audit/with-audit', () => ({ withAuditLog: (handler: unknown) => handler }));
jest.mock('@/lib/services/payment-service', () => ({ reconcileProviderPayment: jest.fn() }));

import {
  verifyFlutterWaveSignature,
  verifyFlutterWaveTransaction,
  verifyLegacyFlutterWaveHash,
} from '@/lib/payments/flutterwave-verify';

const originalEnv = process.env;

afterEach(() => {
  process.env = originalEnv;
  jest.restoreAllMocks();
});

describe('Flutterwave callback verification', () => {
  it('accepts the current base64 HMAC and rejects a different encoding', () => {
    const body = JSON.stringify({ event: 'charge.completed', data: { id: 42 } });
    const secret = 'callback-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
    const base64 = crypto.createHmac('sha256', secret).update(body).digest('base64');
    const hex = crypto.createHmac('sha256', secret).update(body).digest('hex');

    expect(verifyFlutterWaveSignature(body, base64, secret)).toBe(true);
    expect(verifyFlutterWaveSignature(body, hex, secret)).toBe(false);
  });

  it('supports the documented legacy verif-hash comparison', () => {
    const secret = 'legacy-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
    expect(verifyLegacyFlutterWaveHash(secret, secret)).toBe(true);
    expect(verifyLegacyFlutterWaveHash(`${secret}-wrong`, secret)).toBe(false);
  });

  it('re-verifies the settled transaction values with the provider', async () => {
    process.env = {
      ...originalEnv,
      FLUTTERWAVE_SECRET_KEY: 'FLWSECK_TEST-0123456789',
      FLUTTERWAVE_API_BASE_URL: 'https://flutterwave.example/v3/',
    };
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'success',
        data: { id: 42, tx_ref: 'bill-42', amount: 125.5, currency: 'SSP', status: 'successful' },
      }),
    });
    global.fetch = fetchMock as typeof fetch;

    await expect(verifyFlutterWaveTransaction({
      id: 42,
      tx_ref: 'bill-42',
      amount: 125.5,
      currency: 'ssp',
      status: 'successful',
      payment_type: 'card',
      customer: { email: 'payer@example.invalid' },
    })).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://flutterwave.example/v3/transactions/42/verify',
      expect.objectContaining({ headers: { Authorization: 'Bearer FLWSECK_TEST-0123456789' } }),
    );
  });

  it('rejects a provider response whose amount does not match', async () => {
    process.env = { ...originalEnv, FLUTTERWAVE_SECRET_KEY: 'FLWSECK_TEST-0123456789' };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'success',
        data: { id: 42, tx_ref: 'bill-42', amount: 1, currency: 'SSP', status: 'successful' },
      }),
    }) as typeof fetch;

    await expect(verifyFlutterWaveTransaction({
      id: 42,
      tx_ref: 'bill-42',
      amount: 125.5,
      currency: 'SSP',
      status: 'successful',
      payment_type: 'card',
      customer: { email: 'payer@example.invalid' },
    })).resolves.toBe(false);
  });
});
