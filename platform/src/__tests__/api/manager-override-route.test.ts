/**
 * @jest-environment node
 *
 * The approver's password is guessed from a cashier's session: the route is
 * limited per cashier+device, per TARGET username and per IP, and the approval
 * it returns is signed (bound to the patient and amount named in the request).
 */
const rateLimit = jest.fn();
const refundRateLimit = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a), refundRateLimit: (...a: unknown[]) => refundRateLimit(...a) }));
jest.mock('@/lib/request-utils', () => ({ getClientIp: () => '10.0.0.7' }));
const authenticateUser = jest.fn();
jest.mock('@/modules/identity', () => ({
  getAuthPayload: jest.fn().mockResolvedValue({ sub: 'u-cashier', username: 'cashier.a', name: 'Cashier A', role: 'cashier', orgId: 'org-a', hospitalId: 'h-1' }),
  logApiError: jest.fn(), serverError: () => new Response('{}', { status: 500 }), unauthorized: () => new Response('{}', { status: 401 }),
  UsersDbUnavailableError: class extends Error {},
  authenticateUser: (...a: unknown[]) => authenticateUser(...a),
}));
jest.mock('@/lib/services/audit-service', () => ({ logAuditSafe: jest.fn().mockResolvedValue(undefined) }));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/auth/manager-override/route';
import { approvalVerifies } from '@/lib/billing/approval-token';

const call = (body: Record<string, unknown>) => POST(new NextRequest('http://localhost/api/auth/manager-override', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}));

beforeEach(() => {
  rateLimit.mockReset().mockResolvedValue({ allowed: true, remaining: 4, resetAt: Date.now() + 1000 });
  refundRateLimit.mockClear();
  authenticateUser.mockReset();
});

describe('manager override route limits', () => {
  test('keys the limiter per cashier+device, per target username and per IP', async () => {
    authenticateUser.mockResolvedValue(null);
    await call({ username: 'Mgr.B', password: 'x', purpose: 'p' });
    const keys = rateLimit.mock.calls.map(c => (c[0] as { key: string }).key);
    expect(keys).toEqual(expect.arrayContaining([
      'manager-override:u-cashier:10.0.0.7', 'manager-override:target:mgr.b', 'manager-override:ip:10.0.0.7',
    ]));
  });

  test.each(['u-cashier', 'target', 'ip'])('refuses with 429 when the %s limiter is spent, without checking the password', async (which) => {
    rateLimit.mockImplementation(async ({ key }: { key: string }) =>
      ({ allowed: !key.includes(which === 'u-cashier' ? 'manager-override:u-cashier' : `manager-override:${which}:`), remaining: 0, resetAt: Date.now() + 1000 }));
    const res = await call({ username: 'mgr.b', password: 'x', purpose: 'p' });
    expect(res.status).toBe(429);
    expect(authenticateUser).not.toHaveBeenCalled();
  });

  test('a success gives every attempt back and returns a signed approval bound to the request', async () => {
    authenticateUser.mockResolvedValue({ _id: 'u-mgr', username: 'mgr.b', name: 'Mary', role: 'hospital_manager', orgId: 'org-a', hospitalId: 'h-1' });
    const res = await call({ username: 'mgr.b', password: 'Secret-1', purpose: 'waiver', subjectId: 'p-1', amount: 50 });
    expect(res.status).toBe(200);
    const { approval } = await res.json();
    expect(refundRateLimit).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(approval)).not.toContain('Secret-1');
    const claim = { token: approval.approvalToken, approvedBy: 'u-mgr', approvedByRole: 'hospital_manager', requesterId: 'u-cashier', subjectId: 'p-1', amount: 50, writtenAt: approval.approvedAt };
    expect(approvalVerifies(claim)).toBe(true);
    expect(approvalVerifies({ ...claim, subjectId: 'p-2' })).toBe(false);
    expect(approvalVerifies({ ...claim, amount: 500 })).toBe(false);
  });
});
