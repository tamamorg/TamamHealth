/** @jest-environment node
 *
 * /api/couch — a waiver, an adjustment or a human bill waiver reaches CouchDB
 * only with a manager approval the server signed. A refused document is taken
 * out of its batch (the rest is carried) and the refusal is audited by id.
 */
const actor = { sub: 'u-cashier', username: 'cashier.a', name: 'Cashier', role: 'cashier', orgId: 'org-a', hospitalId: 'hosp-1' };
jest.mock('@/modules/identity/core/api-auth', () => ({
  getAuthPayload: jest.fn(async () => actor),
  unauthorized: jest.fn(() => Response.json({ error: 'unauthorized' }, { status: 401 })),
  forbidden: jest.fn((error = 'forbidden') => Response.json({ error }, { status: 403 })),
  logApiError: jest.fn(),
}));
jest.mock('@/lib/sync/couch-auth', () => ({
  ensureCouchGatewayUser: jest.fn(async () => ({ username: 'gw', password: 'pw' })),
  ensureOrganizationProvisioned: jest.fn(async () => undefined),
}));
const logAuditSafe = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock('@/lib/services/audit-service', () => ({ logAuditSafe: (...args: unknown[]) => logAuditSafe(...args) }));

import { NextRequest } from 'next/server';
import { tenantDatabaseName } from '@/lib/sync/tenant-database';
import { POST } from '@/app/api/couch/[...path]/route';
import { signApproval } from '@/lib/billing/approval-token';

const COUCH = 'http://couch.test:5984';
const approval = { approvedBy: 'u-mgr', approvedByName: 'Mary', approvedByRole: 'hospital_manager', approvedAt: new Date().toISOString() };
const text = (b: unknown) => (typeof b === 'string' ? b : new TextDecoder().decode(b as ArrayBuffer));
let held: Record<string, Record<string, unknown>> = {};
let writes: Array<{ body: { docs: Array<{ _id: string }> } }> = [];

beforeEach(() => {
  process.env.NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED = 'true';
  process.env.COUCHDB_URL = COUCH;
  delete process.env.MONEY_APPROVAL_ENFORCEMENT;
  held = {}; writes = []; logAuditSafe.mockClear();
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/_all_docs')) {
      const keys = (JSON.parse(text(init!.body)) as { keys: string[] }).keys;
      return Response.json({ rows: keys.map(id => (held[id] ? { id, doc: held[id] } : { key: id, error: 'not_found' })) });
    }
    if (url.endsWith('/_find')) return Response.json({ docs: [] });
    const raw = init?.body ? text(init.body) : '';
    if (raw) writes.push({ body: JSON.parse(raw) });
    return Response.json([], { status: 201 });
  }) as unknown as typeof fetch;
});

const push = (database: string, docs: unknown[]) => POST(new NextRequest(`http://localhost/api/couch/${tenantDatabaseName(database, 'org-a')}/_bulk_docs`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ docs }),
}), { params: Promise.resolve({ path: [tenantDatabaseName(database, 'org-a'), '_bulk_docs'] }) });

const now = new Date().toISOString();
const adj = (id: string, token?: string) => ({
  _id: id, type: 'adjustment', orgId: 'org-a', patientId: 'p-1', amount: 30, createdBy: 'u-cashier', createdAt: now,
  approvedBy: 'u-mgr', approvedByRole: 'hospital_manager', ...(token ? { approvalToken: token } : {}),
});
const sent = () => writes.flatMap(w => w.body.docs.map(d => d._id));

describe('money approval at the gateway', () => {
  test('carries a signed adjustment and drops one a device made up, in the same batch', async () => {
    const good = signApproval(approval, { requesterId: 'u-cashier', subjectId: 'p-1', amount: 30 });
    await push('tamamhealth_adjustments', [adj('adj-good', good), adj('adj-forged'), adj('adj-note', 'x.y')]);
    expect(sent()).toEqual(['adj-good']);
    expect(logAuditSafe.mock.calls.some(c => c[0] === 'sync.gateway.money_approval_unverified')).toBe(true);
    expect(JSON.stringify(logAuditSafe.mock.calls)).not.toContain(good);
  });

  test('an exempt bill passes; a held bill flipped to waived without a token does not', async () => {
    const exempt = { _id: 'bill-ex', type: 'billing', orgId: 'org-a', status: 'waived', exemptReason: 'Exempt visit: Emergency', amountPaid: 0, payments: [] };
    const flipped = { _id: 'bill-held', type: 'billing', orgId: 'org-a', status: 'waived', exemptReason: 'Exempt visit: Emergency', amountPaid: 0, payments: [] };
    held['bill-held'] = { _id: 'bill-held', type: 'billing', status: 'pending' };
    await push('tamamhealth_billing', [exempt, flipped]);
    expect(sent()).toEqual(['bill-ex']);
  });

  test('MONEY_APPROVAL_ENFORCEMENT=off is the rollout switch', async () => {
    process.env.MONEY_APPROVAL_ENFORCEMENT = 'off';
    await push('tamamhealth_adjustments', [adj('adj-unsigned')]);
    expect(sent()).toEqual(['adj-unsigned']);
  });
});
