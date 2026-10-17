/**
 * @jest-environment node
 *
 * The fee catalog is server-write-only (pull replication), so the pricing page
 * edits it through this route. It must be role-checked, org-stamped from the
 * session, and refuse another organization's rows.
 */
const auth: { value: null | { role: string; orgId?: string } } = { value: null };
const store = new Map<string, Record<string, unknown>>();
let rev = 0;

jest.mock('@/modules/identity', () => ({
  getAuthPayload: async () => auth.value && { sub: 'u1', username: 'admin', ...auth.value },
  hasRole: (a: { role: string }, roles: string[]) => roles.includes(a.role),
  unauthorized: () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
  forbidden: () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
  serverError: () => new Response('{}', { status: 500 }),
  logApiError: () => undefined,
}));
jest.mock('@/lib/audit/with-audit', () => ({ withAuditLog: (h: unknown) => h }));
const auditCalls: string[][] = [];
jest.mock('@/lib/services/audit-service', () => ({
  logAuditSafe: async (...a: string[]) => { auditCalls.push(a); },
}));
jest.mock('@/lib/db', () => ({
  feeScheduleDB: () => ({
    put: async (d: Record<string, unknown>) => { rev += 1; store.set(d._id as string, { ...d, _rev: `${rev}-x` }); return { rev: `${rev}-x` }; },
    get: async (id: string) => { const d = store.get(id); if (!d) throw Object.assign(new Error('missing'), { status: 404 }); return { ...d }; },
    remove: async (id: string) => { store.delete(id); },
  }),
  organizationsDB: () => ({
    get: async (id: string) => { if (id === 'org-a' || id === 'org-b') return { _id: id }; throw new Error('missing'); },
  }),
  hospitalsDB: () => ({
    get: async (id: string) => {
      if (id === 'hosp-a') return { name: 'A Hospital', orgId: 'org-a' };
      if (id === 'hosp-b') return { name: 'B Hospital', orgId: 'org-b' };
      throw new Error('missing');
    },
  }),
}));

import { POST } from '@/app/api/fee-schedule/route';

function call(body: unknown) {
  return POST(new Request('http://x/api/fee-schedule', { method: 'POST', body: JSON.stringify(body) }) as never);
}
const fee = { facilityId: 'hosp-a', category: 'consultation', serviceCode: 'C1', serviceName: 'Consult', unitPrice: 5 };

beforeEach(() => { store.clear(); auditCalls.length = 0; auth.value = { role: 'org_admin', orgId: 'org-a' }; });

describe('/api/fee-schedule', () => {
  it('rejects anonymous callers and non-admin roles', async () => {
    auth.value = null;
    expect((await call({ action: 'create', fee })).status).toBe(401);
    auth.value = { role: 'doctor', orgId: 'org-a' };
    expect((await call({ action: 'create', fee })).status).toBe(403);
  });

  it('stamps orgId from the session and ignores one in the body', async () => {
    const res = await call({ action: 'create', fee: { ...fee, orgId: 'org-evil' } });
    expect(res.status).toBe(201);
    const { fee: created } = await res.json();
    expect(created.orgId).toBe('org-a');
    expect(created.facilityName).toBe('A Hospital');
  });

  it("refuses a facility from another organization", async () => {
    const res = await call({ action: 'create', fee: { ...fee, facilityId: 'hosp-b' } });
    expect(res.status).toBe(400);
  });

  it('validates the price', async () => {
    expect((await call({ action: 'create', fee: { ...fee, unitPrice: -1 } })).status).toBe(400);
    expect((await call({ action: 'create', fee: { ...fee, category: 'nonsense' } })).status).toBe(400);
  });

  it('updates and deletes its own rows, and treats another org\'s rows as missing', async () => {
    const { fee: created } = await (await call({ action: 'create', fee })).json();
    const upd = await call({ action: 'update', id: created._id, fee: { unitPrice: 9, orgId: 'org-evil' } });
    expect(upd.status).toBe(200);
    expect((await upd.json()).fee).toMatchObject({ unitPrice: 9, orgId: 'org-a' });

    auth.value = { role: 'org_admin', orgId: 'org-b' };
    expect((await call({ action: 'update', id: created._id, fee: { unitPrice: 1 } })).status).toBe(404);
    expect((await call({ action: 'delete', id: created._id })).status).toBe(404);

    auth.value = { role: 'org_admin', orgId: 'org-a' };
    expect((await call({ action: 'delete', id: created._id })).status).toBe(200);
    expect(store.size).toBe(0);
  });
  it('refuses a caller with no organization (undefined must not match org-less rows)', async () => {
    store.set('fee_orphan', { _id: 'fee_orphan', type: 'fee_schedule', serviceName: 'x', unitPrice: 1, currency: 'SSP' });
    auth.value = { role: 'org_admin' };
    expect((await call({ action: 'create', fee })).status).toBe(403);
    expect((await call({ action: 'update', id: 'fee_orphan', fee: { unitPrice: 2 } })).status).toBe(403);
    expect((await call({ action: 'delete', id: 'fee_orphan' })).status).toBe(403);
    expect(store.has('fee_orphan')).toBe(true);
  });

  it('rounds prices to 2 decimals', async () => {
    const { fee: created } = await (await call({ action: 'create', fee: { ...fee, unitPrice: 1.005 + 1.234 } })).json();
    expect(created.unitPrice).toBe(2.24);
  });

  it('super_admin creates under the named facility\'s org, or an explicit existing org', async () => {
    auth.value = { role: 'super_admin' };
    const viaFacility = await call({ action: 'create', fee: { ...fee, facilityId: 'hosp-b' } });
    expect(viaFacility.status).toBe(201);
    expect((await viaFacility.json()).fee.orgId).toBe('org-b');

    const viaOrg = await call({ action: 'create', fee: { ...fee, facilityId: '', orgId: 'org-a' } });
    expect(viaOrg.status).toBe(201);
    expect((await viaOrg.json()).fee.orgId).toBe('org-a');

    expect((await call({ action: 'create', fee: { ...fee, facilityId: '' } })).status).toBe(400);
    expect((await call({ action: 'create', fee: { ...fee, facilityId: '', orgId: 'org-nope' } })).status).toBe(400);
    expect((await call({ action: 'create', fee: { ...fee, facilityId: 'hosp-b', orgId: 'org-a' } })).status).toBe(400);
  });

  it('an explicit null facility on update makes the fee organisation-wide', async () => {
    const { fee: created } = await (await call({ action: 'create', fee })).json();
    expect(created.facilityId).toBe('hosp-a');
    const upd = await call({ action: 'update', id: created._id, fee: { facilityId: null } });
    expect((await upd.json()).fee).toMatchObject({ facilityId: '', facilityName: '' });
  });

  it('audits create, update and delete with old and new prices', async () => {
    const { fee: created } = await (await call({ action: 'create', fee })).json();
    await call({ action: 'update', id: created._id, fee: { unitPrice: 9 } });
    await call({ action: 'delete', id: created._id });
    expect(auditCalls.map(c => c[0])).toEqual(['FEE_SCHEDULE_CREATED', 'FEE_SCHEDULE_UPDATED', 'FEE_SCHEDULE_DELETED']);
    expect(auditCalls[1][3]).toContain('5 -> 9');
    expect(auditCalls[2][3]).toContain('Consult');
    expect(auditCalls[2][3]).toContain('9');
  });
});
