/**
 * @jest-environment node
 */
const auth: { value: null | { role: string; orgId?: string; sub?: string } } = { value: null };
const calls: unknown[][] = [];

jest.mock('@/modules/identity', () => ({
  getAuthPayload: async () => auth.value,
  hasRole: (a: { role: string }, roles: string[]) => roles.includes(a.role),
  unauthorized: () => new Response('{}', { status: 401 }),
  forbidden: () => new Response('{}', { status: 403 }),
  serverError: () => new Response('{}', { status: 500 }),
  logApiError: () => undefined,
}));
jest.mock('@/lib/audit/with-audit', () => ({ withAuditLog: (h: unknown) => h }));
jest.mock('@/lib/services/conflict-service', () => ({
  resolveConflict: async (...a: unknown[]) => { calls.push(a); return { ok: false, error: 'unsupported', message: 'nope' }; },
  dismissConflict: async (...a: unknown[]) => { calls.push(a); return { ok: false, error: 'not_found', message: 'nf' }; },
}));

import { POST } from '@/app/api/admin/conflicts/[id]/route';

const ctx = { params: Promise.resolve({ id: 'c1' }) };
const req = (body: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as never;

beforeEach(() => { calls.length = 0; });

describe('/api/admin/conflicts/:id', () => {
  it('hrio may not resolve clinical conflicts', async () => {
    auth.value = { role: 'hrio', orgId: 'org-a' };
    expect((await POST(req({ action: 'resolve', chosenRev: '2-a' }), ctx)).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('passes the caller\'s tenant scope and surfaces unsupported as 422', async () => {
    auth.value = { role: 'org_admin', orgId: 'org-a' };
    const res = await POST(req({ action: 'resolve', chosenRev: '2-a' }), ctx);
    expect(res.status).toBe(422);
    expect(calls[0][2]).toEqual({ orgId: 'org-a', superAdmin: false });
  });

  it('super_admin carries the all-orgs scope; a missing row is 404', async () => {
    auth.value = { role: 'super_admin' };
    const res = await POST(req({ action: 'dismiss' }), ctx);
    expect(res.status).toBe(404);
    expect(calls[0][2]).toEqual({ orgId: undefined, superAdmin: true });
  });
});
