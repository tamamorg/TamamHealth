/** @jest-environment node */
/**
 * Rate limiting on the patient portal.
 *
 * `/login`, `/verify-otp` and `/refresh` were limited — somebody reasoned
 * carefully about credential brute-force — and the eleven routes behind them
 * were not. A token, once obtained, could read a patient's records, labs,
 * prescriptions, immunisations and bills as fast as the network allowed, and
 * write appointment requests and clinician messages without bound.
 *
 * The floor lives inside `verifyPatientToken`, which every portal route
 * already calls, so a new route inherits it rather than having to remember.
 * It is keyed on the PATIENT: an attacker holding a stolen token can change
 * IP freely, and what is worth bounding is access to one person's record.
 */
const mockRateLimit = jest.fn();
jest.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => mockRateLimit(...a) }));

import { NextResponse } from 'next/server';
import { verifyPatientToken, guardPortalWrite, createPatientToken } from '@/lib/patient-portal-auth';

const allow = { allowed: true, resetAt: Date.now() + 60_000 };
const deny = { allowed: false, resetAt: Date.now() + 30_000 };

function request(token: string) {
  return { headers: { get: (h: string) => (h === 'authorization' ? `Bearer ${token}` : null) } } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRateLimit.mockResolvedValue(allow);
});

describe('the per-patient floor', () => {
  it('lets an ordinary request through', async () => {
    const token = await createPatientToken({ sub: 'pat-1', name: 'Achol', hospitalNumber: 'JTH-1', role: 'patient' as const });
    const result = await verifyPatientToken(request(token));
    expect(result).not.toBeInstanceOf(NextResponse);
    expect((result as { sub: string }).sub).toBe('pat-1');
  });

  it('is keyed on the patient, not the caller’s address', async () => {
    // Rotating IPs is free for whoever holds a stolen token.
    const token = await createPatientToken({ sub: 'pat-1', name: 'Achol', hospitalNumber: 'JTH-1', role: 'patient' as const });
    await verifyPatientToken(request(token));
    expect(mockRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'portal:floor:pat-1' }),
    );
  });

  it('answers 429 with Retry-After once the floor is hit', async () => {
    mockRateLimit.mockResolvedValue(deny);
    const token = await createPatientToken({ sub: 'pat-1', name: 'Achol', hospitalNumber: 'JTH-1', role: 'patient' as const });
    const result = await verifyPatientToken(request(token));
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(429);
    expect((result as NextResponse).headers.get('Retry-After')).toBeTruthy();
  });

  it('does not spend a token bucket on a request that fails to authenticate', async () => {
    // An invalid token is rejected before the limiter runs, so a stream of
    // garbage cannot exhaust a real patient's allowance.
    const result = await verifyPatientToken(request('not-a-jwt'));
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it('rejects a missing header without consulting the limiter', async () => {
    const bare = { headers: { get: () => null } } as never;
    const result = await verifyPatientToken(bare);
    expect((result as NextResponse).status).toBe(401);
    expect(mockRateLimit).not.toHaveBeenCalled();
  });
});

describe('the write cap', () => {
  it('uses its own bucket, so writes cannot be masked by reads', async () => {
    await guardPortalWrite('pat-1', 'portal-message', 10, 300_000);
    expect(mockRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'portal:portal-message:pat-1', limit: 10, windowMs: 300_000 }),
    );
  });

  it('returns 429 when a patient floods an inbox', async () => {
    mockRateLimit.mockResolvedValue(deny);
    const result = await guardPortalWrite('pat-1', 'portal-message');
    expect(result).toBeInstanceOf(NextResponse);
    expect(result!.status).toBe(429);
  });

  it('passes when under the cap', async () => {
    await expect(guardPortalWrite('pat-1', 'portal-message')).resolves.toBeNull();
  });

  it('does nothing without a patient to key on', async () => {
    await expect(guardPortalWrite('', 'portal-message')).resolves.toBeNull();
    expect(mockRateLimit).not.toHaveBeenCalled();
  });
});
