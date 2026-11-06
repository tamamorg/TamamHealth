/**
 * @jest-environment node
 *
 * /api/dhis2-sync-log is the server write-path that makes the shared DHIS2 sync
 * log replicate (one global doc in the pull-only platform_config DB). It must
 * be limited to the DHIS2 reporting roles and route each action to the right
 * service writer (security/data audit 2026-11-05, §2.1 #11).
 */
jest.mock('@/lib/audit/with-audit', () => ({
  AUDIT_ACTION_HEADER: 'x-audit-action',
  withAuditLog: (h: (...a: unknown[]) => Promise<Response>) => h,
}));

let role = 'hrio';
jest.mock('@/lib/api-json-guard', () => ({
  authorizeJson: jest.fn(async (request: Request, roles: string[]) => {
    if (!roles.includes(role)) return { response: Response.json({ error: 'forbidden' }, { status: 403 }) };
    return { auth: { sub: 'u', username: 'u', name: 'U', role }, body: await request.json() };
  }),
}));
jest.mock('@/modules/identity', () => ({
  logApiError: jest.fn(),
  serverError: () => Response.json({ error: 'server' }, { status: 500 }),
}));

const appendDhis2LogEntry = jest.fn(async (..._a: unknown[]) => ({ _id: 'dhis2_sync_log' }));
const recordDhis2SyncFailure = jest.fn(async (..._a: unknown[]) => ({ _id: 'dhis2_sync_log' }));
const recordDhis2SyncResult = jest.fn(async (..._a: unknown[]) => ({ _id: 'dhis2_sync_log' }));
jest.mock('@/lib/services/dhis2-sync-log-service', () => ({
  appendDhis2LogEntry: (...a: unknown[]) => appendDhis2LogEntry(...a),
  recordDhis2SyncFailure: (...a: unknown[]) => recordDhis2SyncFailure(...a),
  recordDhis2SyncResult: (...a: unknown[]) => recordDhis2SyncResult(...a),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/dhis2-sync-log/route';

const post = (body: unknown) => new NextRequest('http://localhost/api/dhis2-sync-log', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

beforeEach(() => { jest.clearAllMocks(); role = 'hrio'; });

describe('/api/dhis2-sync-log', () => {
  it('append routes to appendDhis2LogEntry', async () => {
    const res = await POST(post({ action: 'append', message: 'Sync starting', status: 'info' }));
    expect(res.status).toBe(200);
    expect(appendDhis2LogEntry).toHaveBeenCalledWith('Sync starting', 'info');
  });

  it('result routes to recordDhis2SyncResult', async () => {
    const res = await POST(post({ action: 'result', dataset: { period: '2026-11' }, push: { ok: true, status: 'pushed' } }));
    expect(res.status).toBe(200);
    expect(recordDhis2SyncResult).toHaveBeenCalled();
  });

  it('failure routes to recordDhis2SyncFailure', async () => {
    const res = await POST(post({ action: 'failure', message: 'boom' }));
    expect(res.status).toBe(200);
    expect(recordDhis2SyncFailure).toHaveBeenCalledWith('boom');
  });

  it('a role outside the reporting set is refused and writes nothing', async () => {
    role = 'nurse';
    const res = await POST(post({ action: 'append', message: 'x' }));
    expect(res.status).toBe(403);
    expect(appendDhis2LogEntry).not.toHaveBeenCalled();
  });

  it('a missing message on append is a 400', async () => {
    const res = await POST(post({ action: 'append' }));
    expect(res.status).toBe(400);
  });
});
