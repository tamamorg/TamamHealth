/** @jest-environment node
 *
 * /api/couch — messages and conversations are a retained record.
 *
 * The app no longer deletes a message, but the app is not the boundary: a
 * signed-in user holds the `_id` and `_rev` of every message their device
 * replicated and can push a tombstone for any of them. The gateway is the one
 * place every such write passes, so this is where the record is defended:
 *   - deleting the only live revision never reaches CouchDB;
 *   - conflict pruning (a loser deleted while the winner lives) still does,
 *     or sync would leave conflicts on the server forever;
 *   - a refused tombstone is dropped from its batch rather than failing it, so
 *     the legitimate writes beside it are not stalled;
 *   - every refusal is audited by id, with no message content.
 */
const actor = { sub: 'user-dr-wani', username: 'dr.wani', name: 'Dr. Wani', role: 'doctor', orgId: 'org-a', hospitalId: 'hosp-1' };
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
import { POST, DELETE } from '@/app/api/couch/[...path]/route';

const DB = tenantDatabaseName('tamamhealth_messages', 'org-a');
const COUCH = 'http://couch.test:5984';

/** Leaves CouchDB reports per document id, and every write it was asked to make. */
let leaves: Record<string, Array<{ _rev: string; _deleted?: boolean }>> = {};
let writes: Array<{ method: string; url: string; body: unknown }> = [];

beforeEach(() => {
  process.env.NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED = 'true';
  process.env.COUCHDB_URL = COUCH;
  leaves = {};
  writes = [];
  logAuditSafe.mockClear();
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || 'GET').toUpperCase();
    if (method === 'GET' && url.includes('open_revs=all')) {
      const id = decodeURIComponent(url.split('/').pop()!.split('?')[0]);
      const found = leaves[id];
      if (!found) return Response.json({ error: 'not_found' }, { status: 404 });
      return Response.json(found.map(ok => ({ ok })));
    }
    // The participant-scope membership lookup; these tests use no conversations.
    if (url.endsWith('/_find')) return Response.json({ docs: [] });
    // The integrity check's read of the server's current copies; none exist here.
    if (url.includes('/_all_docs')) return Response.json({ rows: [] });
    const raw = init?.body ? new TextDecoder().decode(init.body as ArrayBuffer) : '';
    writes.push({ method, url, body: raw ? JSON.parse(raw) : null });
    return Response.json([], { status: 201 });
  }) as unknown as typeof fetch;
});

function push(docs: unknown[]) {
  const request = new NextRequest(`http://localhost/api/couch/${DB}/_bulk_docs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ new_edits: false, docs }),
  });
  return POST(request, { params: Promise.resolve({ path: [DB, '_bulk_docs'] }) });
}

const tombstone = (id: string, parent: string) => ({
  _id: id, _deleted: true, _rev: '3-dead', _revisions: { start: 3, ids: ['dead', parent.split('-')[1]] },
});
const message = (id: string) => ({ _id: id, type: 'message', orgId: 'org-a', body: 'hello' });
const blockedAudits = () => logAuditSafe.mock.calls.filter(call => call[0] === 'sync.gateway.retained_delete_blocked');

describe('sync gateway: messages are a retained record', () => {
  test('a tombstone for the only live revision is dropped; the rest of the batch is carried', async () => {
    leaves['msg-1'] = [{ _rev: '2-aaa' }];

    const response = await push([message('msg-9'), tombstone('msg-1', '2-aaa')]);

    expect(response.status).toBe(201);
    // Reported per document, the way CouchDB's validator would: replication
    // records it as denied and moves on instead of believing it landed.
    expect(await response.json()).toEqual([expect.objectContaining({ id: 'msg-1', error: 'forbidden' })]);
    expect(writes).toHaveLength(1);
    expect((writes[0].body as { docs: Array<{ _id: string }> }).docs.map(doc => doc._id)).toEqual(['msg-9']);
    expect((writes[0].body as { new_edits: boolean }).new_edits).toBe(false);
    expect(blockedAudits()).toHaveLength(1);
    const details = String(blockedAudits()[0][3]);
    expect(details).toContain('msg-1');
    expect(details).not.toContain('hello');
  });

  test('pruning a conflict loser passes untouched while the winner lives', async () => {
    leaves['msg-1'] = [{ _rev: '2-aaa' }, { _rev: '2-bbb' }];

    await push([tombstone('msg-1', '2-aaa')]);

    expect((writes[0].body as { docs: unknown[] }).docs).toHaveLength(1);
    expect(blockedAudits()).toHaveLength(0);
  });

  test('a tombstone for a message the server never received is carried', async () => {
    await push([tombstone('msg-never', '2-aaa')]);

    expect((writes[0].body as { docs: unknown[] }).docs).toHaveLength(1);
    expect(blockedAudits()).toHaveLength(0);
  });

  test('a direct DELETE of a live message is refused outright', async () => {
    leaves['msg-1'] = [{ _rev: '2-aaa' }];
    const request = new NextRequest(`http://localhost/api/couch/${DB}/msg-1?rev=2-aaa`, { method: 'DELETE' });

    const response = await DELETE(request, { params: Promise.resolve({ path: [DB, 'msg-1'] }) });

    expect(response.status).toBe(403);
    expect(writes).toHaveLength(0);
    expect(blockedAudits()).toHaveLength(1);
  });

  test('ordinary message writes are forwarded with no per-document lookup', async () => {
    await push([message('msg-1'), message('msg-2')]);

    expect(writes).toHaveLength(1);
    const lookups = (global.fetch as jest.Mock).mock.calls.filter(call => String(call[0]).includes('open_revs'));
    expect(lookups).toHaveLength(0);
  });
});
