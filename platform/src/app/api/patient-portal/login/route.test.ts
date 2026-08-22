/** @jest-environment node */
import { NextRequest } from 'next/server';

const mockRateLimit = jest.fn();
const mockResetRateLimit = jest.fn();
const mockFind = jest.fn();

jest.mock('@/lib/rate-limit', () => ({
  rateLimit: (...args: unknown[]) => mockRateLimit(...args),
  resetRateLimit: (...args: unknown[]) => mockResetRateLimit(...args),
}));
jest.mock('@/lib/request-utils', () => ({ getClientIp: () => '203.0.113.9' }));
jest.mock('@/lib/patient-portal-auth', () => ({ createPatientToken: async () => 'patient-token' }));
jest.mock('@/lib/patient-portal-demo', () => ({
  demoFallbackEnabled: () => false,
  logDemoFallback: jest.fn(),
  findDemoPatientByUsername: jest.fn(),
}));
jest.mock('@/modules/identity/core/auth', () => ({ verifyPassword: async () => true }));
jest.mock('@/lib/patient-portal-otp', () => ({ otpEnabled: () => false, issueOtp: jest.fn() }));
jest.mock('@/lib/db', () => ({
  patientsDB: () => ({ createIndex: async () => undefined, find: mockFind }),
}));

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/patient-portal/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRateLimit.mockResolvedValue({ allowed: true, resetAt: Date.now() + 1000, remaining: 9 });
  mockResetRateLimit.mockResolvedValue(undefined);
  mockFind.mockResolvedValue({
    docs: [{
      _id: 'patient-1',
      firstName: 'Asha',
      surname: 'Deng',
      hospitalNumber: 'TH-1',
      portalUsername: 'asha',
      portalPasswordHash: 'hash',
    }],
  });
});

test('uses shared IP/account buckets and clears them after a valid password', async () => {
  const { POST } = await import('./route');
  const response = await POST(request({ username: 'ASHA', password: 'correct-password' }));

  expect(response.status).toBe(200);
  expect(mockRateLimit).toHaveBeenNthCalledWith(1, expect.objectContaining({ key: 'portal-login:ip:203.0.113.9' }));
  expect(mockRateLimit).toHaveBeenNthCalledWith(2, expect.objectContaining({ key: 'portal-login:account:asha' }));
  expect(mockResetRateLimit).toHaveBeenCalledWith('portal-login:ip:203.0.113.9');
  expect(mockResetRateLimit).toHaveBeenCalledWith('portal-login:account:asha');
  expect(mockFind).toHaveBeenCalledWith(expect.objectContaining({
    selector: { type: 'patient', portalUsername: 'asha' },
  }));
});

test('rejects a blocked IP before consulting the patient database', async () => {
  mockRateLimit.mockResolvedValueOnce({ allowed: false, resetAt: Date.now() + 1000, remaining: 0 });
  const { POST } = await import('./route');
  const response = await POST(request({ username: 'asha', password: 'correct-password' }));

  expect(response.status).toBe(429);
  expect(mockFind).not.toHaveBeenCalled();
  expect(mockResetRateLimit).not.toHaveBeenCalled();
});
