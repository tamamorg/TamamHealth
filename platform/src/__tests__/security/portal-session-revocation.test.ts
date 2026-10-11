/**
 * @jest-environment node
 *
 * Portal sessions must end when the patient is suspended or their credential
 * changes; the login path must not be a timing oracle; client-IP trust and the
 * OTP attempt counter must not be bypassable.
 */
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test';

let patientDoc: Record<string, unknown> | null = { _id: 'pat-1', firstName: 'A', surname: 'B' };
jest.mock('@/lib/db', () => ({
  patientsDB: () => ({
    get: async () => {
      if (!patientDoc) throw Object.assign(new Error('missing'), { status: 404, name: 'not_found' });
      return patientDoc;
    },
    createIndex: async () => undefined,
    find: async () => ({ docs: patientDoc ? [patientDoc] : [] }),
  }),
}));
jest.mock('@/lib/rate-limit', () => ({
  rateLimit: jest.fn(async () => ({ allowed: true, resetAt: Date.now() + 1000, remaining: 5 })),
  resetRateLimit: jest.fn(async () => undefined),
  refundRateLimit: jest.fn(async () => undefined),
}));

import { NextRequest } from 'next/server';
import { createPatientToken } from '@/lib/patient-portal-auth';

async function authedReq(path: string, method = 'GET') {
  const token = await createPatientToken({ sub: 'pat-1', name: 'A B', hospitalNumber: 'H1', role: 'patient' });
  return new NextRequest(`http://localhost${path}`, { method, headers: { authorization: `Bearer ${token}` } });
}

beforeEach(() => { patientDoc = { _id: 'pat-1', firstName: 'A', surname: 'B' }; });

describe('portal session liveness', () => {
  it('a live patient passes a data route', async () => {
    jest.doMock('@/lib/services/medical-record-service', () => ({ getRecordsByPatient: jest.fn(async () => []) }));
    const { GET } = await import('@/app/api/patient-portal/records/route');
    expect((await GET(await authedReq('/api/patient-portal/records'))).status).toBe(200);
  });

  it('a suspended patient\'s token is rejected on a data route and on refresh', async () => {
    patientDoc = { _id: 'pat-1', portalDisabledAt: new Date().toISOString() };
    const { GET } = await import('@/app/api/patient-portal/records/route');
    expect((await GET(await authedReq('/api/patient-portal/records'))).status).toBe(401);
    const { POST } = await import('@/app/api/patient-portal/refresh/route');
    expect((await POST(await authedReq('/api/patient-portal/refresh', 'POST'))).status).toBe(401);
  });

  it('a token issued before the credential epoch is rejected; a later one is fine', async () => {
    const token = await createPatientToken({ sub: 'pat-1', name: 'A B', hospitalNumber: 'H1', role: 'patient' });
    patientDoc = { _id: 'pat-1', portalCredentialEpoch: new Date(Date.now() + 60_000).toISOString() };
    const { verifyPatientToken } = await import('@/lib/patient-portal-auth');
    const req = new NextRequest('http://localhost/x', { headers: { authorization: `Bearer ${token}` } });
    expect((await verifyPatientToken(req) as Response).status).toBe(401);
    patientDoc = { _id: 'pat-1', portalCredentialEpoch: new Date(Date.now() - 60_000).toISOString() };
    expect((await verifyPatientToken(req) as { sub?: string }).sub).toBe('pat-1');
  });

  it('a deleted patient is rejected', async () => {
    patientDoc = null;
    const { verifyPatientToken } = await import('@/lib/patient-portal-auth');
    const req = await authedReq('/x');
    expect((await verifyPatientToken(req) as Response).status).toBe(401);
  });
});

describe('getClientIp trust', () => {
  const mk = (h: Record<string, string>) => new NextRequest('http://localhost/x', { headers: h });
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; jest.resetModules(); });

  it('believes the proxy-written entry by default, and nothing when no proxy is declared', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    delete process.env.TRUST_PROXY_HEADERS;
    jest.resetModules();
    const { getClientIp } = await import('@/lib/request-utils');
    // A client-sent x-real-ip never beats the entry the proxy wrote.
    expect(getClientIp(mk({ 'x-real-ip': '6.6.6.6', 'x-forwarded-for': '7.7.7.7' }))).toBe('7.7.7.7');
    process.env.TRUST_PROXY_HEADERS = 'false';
    expect(getClientIp(mk({ 'x-real-ip': '6.6.6.6', 'x-forwarded-for': '7.7.7.7' }))).toBe('unknown');
  });
});

describe('portal OTP attempts are an atomic counter', () => {
  it('concurrent wrong guesses cannot exceed the attempt cap', async () => {
    jest.resetModules();
    // Real rate-limit (in-memory) for this test.
    jest.doMock('@/lib/rate-limit', () => jest.requireActual('@/lib/rate-limit'));
    jest.doMock('@/lib/sms', () => ({ sendSms: jest.fn(async () => ({ ok: true })) }));
    const { issueOtp, verifyOtp, OTP_MAX_ATTEMPTS } = await import('@/lib/patient-portal-otp');
    await issueOtp('pat-1', '+211912345678');
    const results = await Promise.all(Array.from({ length: 20 }, () => verifyOtp('pat-1', '000000x')));
    const mismatches = results.filter(r => !r.ok && r.reason === 'mismatch').length;
    expect(mismatches).toBeLessThan(OTP_MAX_ATTEMPTS);
    expect(results.some(r => !r.ok && r.reason === 'too-many-attempts')).toBe(true);
  });
});

describe('portal login timing', () => {
  it('runs a password comparison even when the username does not exist', async () => {
    jest.resetModules();
    const verifyPassword = jest.fn(async () => false);
    jest.doMock('@/modules/identity/core/auth', () => ({ verifyPassword }));
    jest.doMock('@/lib/patient-portal-otp', () => ({ otpEnabled: () => false, issueOtp: jest.fn() }));
    patientDoc = null;
    const { POST } = await import('@/app/api/patient-portal/login/route');
    const res = await POST(new NextRequest('http://localhost/api/patient-portal/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'nobody', password: 'whatever-password' }),
    }));
    expect(res.status).toBe(401);
    expect(verifyPassword).toHaveBeenCalledTimes(1);
  });
});
