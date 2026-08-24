/** @jest-environment node */

import { NextRequest } from 'next/server';

jest.mock('@/modules/identity', () => ({ logApiError: jest.fn() }));
jest.mock('@/lib/audit/with-audit', () => ({ withAuditLog: (handler: unknown) => handler }));
jest.mock('@/lib/services/payment-service', () => ({ reconcileProviderPayment: jest.fn() }));

import { POST as airtelPOST } from '@/app/api/webhooks/airtel/route';
import { POST as mpesaPOST } from '@/app/api/webhooks/mpesa/route';

const originalEnv = process.env;

afterEach(() => {
  process.env = originalEnv;
  jest.restoreAllMocks();
});

describe('optional mobile-money callbacks', () => {
  it.each([
    ['Airtel', airtelPOST, 'AIRTEL_WEBHOOK_GATEWAY_VERIFIED'],
    ['M-Pesa', mpesaPOST, 'MPESA_WEBHOOK_GATEWAY_VERIFIED'],
  ] as const)('keeps the %s route disabled until gateway verification is confirmed', async (
    _provider,
    handler,
    flag,
  ) => {
    process.env = { ...originalEnv, NODE_ENV: 'production' };
    delete process.env[flag];
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await handler(new NextRequest('https://app.example.invalid/api/webhooks', {
      method: 'POST',
      body: '{}',
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: expect.stringContaining('not enabled'),
    });
  });
});
