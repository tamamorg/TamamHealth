/**
 * @jest-environment node
 *
 * /api/risk-resolution is the server write-path that makes Risk Center
 * resolutions replicate (they live in the pull-only platform_config DB).
 * It must be super_admin-only and stamp the actor from the verified auth claim,
 * never from the client (security/data audit 2026-11-05, §2.1 #11, cf. #18).
 */
jest.mock('@/lib/audit/with-audit', () => ({
  AUDIT_ACTION_HEADER: 'x-audit-action',
  withAuditLog: (h: (...a: unknown[]) => Promise<Response>) => h,
}));

type Actor = { sub: string; username: string; name: string; role: string };
let actor: Actor = { sub: 'sa-1', username: 'super', name: 'Super Admin', role: 'super_admin' };

jest.mock('@/lib/api-json-guard', () => ({
  authorizeJson: jest.fn(async (request: Request, roles: string[]) => {
    if (!roles.includes(actor.role)) {
      return { response: Response.json({ error: 'forbidden' }, { status: 403 }) };
    }
    return { auth: actor, body: await request.json() };
  }),
}));
jest.mock('@/modules/identity', () => ({
  forbidden: () => Response.json({ error: 'forbidden' }, { status: 403 }),
  logApiError: jest.fn(),
  serverError: () => Response.json({ error: 'server' }, { status: 500 }),
}));

const resolveRisk = jest.fn(async (..._a: unknown[]) => ({ _id: 'r', riskId: 'x' }));
const resolveRisks = jest.fn(async (..._a: unknown[]) => ({ resolved: [{ _id: 'r' }], failed: 0 }));
const reopenRisk = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('@/lib/services/risk-resolution-service', () => ({
  resolveRisk: (...a: unknown[]) => resolveRisk(a[0], a[1]),
  resolveRisks: (...a: unknown[]) => resolveRisks(a[0], a[1]),
  reopenRisk: (...a: unknown[]) => reopenRisk(a[0], a[1]),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/risk-resolution/route';

const post = (body: unknown) => new NextRequest('http://localhost/api/risk-resolution', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

beforeEach(() => {
  jest.clearAllMocks();
  actor = { sub: 'sa-1', username: 'super', name: 'Super Admin', role: 'super_admin' };
});

describe('/api/risk-resolution', () => {
  it('resolve stamps the actor from auth, not the body', async () => {
    const res = await POST(post({ action: 'resolve', input: { riskId: 'audit-1', signature: 's', severity: 'high', source: 'Audit', signal: 'x' } }));
    expect(res.status).toBe(200);
    expect(resolveRisk).toHaveBeenCalledWith(
      expect.objectContaining({ riskId: 'audit-1' }),
      { _id: 'sa-1', username: 'super', name: 'Super Admin' },
    );
  });

  it('resolve-batch routes to resolveRisks', async () => {
    const res = await POST(post({ action: 'resolve-batch', inputs: [{ riskId: 'a' }] }));
    expect(res.status).toBe(200);
    expect(resolveRisks).toHaveBeenCalled();
  });

  it('reopen routes to reopenRisk with the riskId', async () => {
    const res = await POST(post({ action: 'reopen', riskId: 'audit-1' }));
    expect(res.status).toBe(200);
    expect(reopenRisk).toHaveBeenCalledWith('audit-1', expect.objectContaining({ _id: 'sa-1' }));
  });

  it('a non-super_admin is refused and no write runs', async () => {
    actor = { sub: 'u', username: 'oa', name: 'Org Admin', role: 'org_admin' };
    const res = await POST(post({ action: 'resolve', input: { riskId: 'x' } }));
    expect(res.status).toBe(403);
    expect(resolveRisk).not.toHaveBeenCalled();
  });

  it('an unknown action is a 400', async () => {
    const res = await POST(post({ action: 'nope' }));
    expect(res.status).toBe(400);
  });
});
