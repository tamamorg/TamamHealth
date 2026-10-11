/** @jest-environment node
 *
 * /api/couch -- portal credential hashes do not replicate down to staff devices.
 *
 * The push side already makes the server authoritative for `portal*` fields.
 * This is the read side: a lost staff tablet must not hold every enrolled
 * patient's bcrypt hash. Covered here: every response shape that carries a
 * patient body is stripped, a query that names the hashes is refused (it would
 * be an extraction oracle), and the push side still restores / accepts them.
 */
const actor = { sub: 'user-ana', username: 'dr.ana', name: 'Dr. Ana', role: 'doctor', orgId: 'org-a', hospitalId: 'hosp-1' };
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
jest.mock('@/lib/services/audit-service', () => ({ logAuditSafe: jest.fn(async () => undefined) }));

import { NextRequest } from 'next/server';
import { tenantDatabaseName } from '@/lib/sync/tenant-database';
import { GET, POST } from '@/app/api/couch/[...path]/route';
import { stripPortalSecrets } from '@/lib/sync/portal-read-redaction';

const PATIENTS = tenantDatabaseName('tamamhealth_patients', 'org-a');
const COUCH = 'http://couch.test:5984';
type Doc = Record<string, unknown> & { _id: string };

const serverPatient = (): Doc => ({
  _id: 'pat-1', _rev: '3-c', type: 'patient', orgId: 'org-a', firstName: 'A', surname: 'B',
  portalUsername: 'asha', portalPasswordHash: '$2b$12$serverhash', portalInviteTokenHash: 'serverinvite',
});
let upstream: Array<{ method: string; url: URL; body: Record<string, unknown> | null }> = [];

beforeEach(() => {
  process.env.NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED = 'true';
  process.env.COUCHDB_URL = COUCH;
  upstream = [];
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method || 'GET').toUpperCase();
    const endpoint = url.pathname.split('/').map(decodeURIComponent)[2] ?? '';
    const raw = init?.body ? (typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as ArrayBuffer)) : '';
    upstream.push({ method, url, body: raw ? JSON.parse(raw) : null });
    const doc = serverPatient();
    if (endpoint === '_bulk_get') return Response.json({ results: [{ id: 'pat-1', docs: [{ ok: doc }] }] });
    if (endpoint === '_changes') return Response.json({ results: [{ id: 'pat-1', changes: [{ rev: '3-c' }], doc }], last_seq: '1' });
    if (endpoint === '_all_docs') {
      return raw && url.searchParams.get('include_docs') === 'true' && method === 'POST' && upstream.length === 1
        ? Response.json({ rows: [{ id: 'pat-1', key: 'pat-1', value: { rev: '3-c' }, doc }] })
        : Response.json({ rows: [{ id: 'pat-1', key: 'pat-1', value: { rev: '3-c' }, doc }] });
    }
    if (endpoint === '_find') return Response.json({ docs: [doc] });
    if (endpoint === '_bulk_docs') return Response.json([], { status: 201 });
    if (endpoint === 'pat-1') {
      return url.searchParams.get('open_revs') ? Response.json([{ ok: doc }]) : Response.json(doc);
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  }) as unknown as typeof fetch;
});

function call(path: string[], init: { method?: string; body?: unknown; query?: string } = {}) {
  const method = init.method || (init.body ? 'POST' : 'GET');
  const request = new NextRequest(`http://localhost/api/couch/${PATIENTS}/${path.join('/')}${init.query || ''}`, {
    method,
    ...(init.body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) } : {}),
  });
  return (method === 'GET' ? GET : POST)(request, { params: Promise.resolve({ path: [PATIENTS, ...path] }) });
}
const noSecrets = (text: string) => {
  expect(text).not.toContain('portalPasswordHash');
  expect(text).not.toContain('portalInviteTokenHash');
  expect(text).not.toContain('serverhash');
  expect(text).not.toContain('serverinvite');
};

describe('every read shape that carries a patient body is stripped', () => {
  test('_bulk_get', async () => {
    const text = JSON.stringify(await (await call(['_bulk_get'], { body: { docs: [{ id: 'pat-1' }] } })).json());
    noSecrets(text);
    expect(text).toContain('asha'); // non-secret portal state is kept
    expect(text).toContain('"_rev":"3-c"'); // revision identity is untouched
  });
  test('_changes?include_docs', async () => {
    noSecrets(JSON.stringify(await (await call(['_changes'], { query: '?include_docs=true&since=0' })).json()));
  });
  test('_all_docs?include_docs', async () => {
    noSecrets(JSON.stringify(await (await call(['_all_docs'], { body: { keys: ['pat-1'] }, query: '?include_docs=true' })).json()));
  });
  test('_find', async () => {
    noSecrets(JSON.stringify(await (await call(['_find'], { body: { selector: { type: 'patient' } } })).json()));
  });
  test('GET by id and open_revs', async () => {
    noSecrets(JSON.stringify(await (await call(['pat-1'])).json()));
    noSecrets(JSON.stringify(await (await call(['pat-1'], { query: '?open_revs=all' })).json()));
  });
  test('the response is always requested as JSON, never multipart', async () => {
    await call(['pat-1'], { query: '?open_revs=all' });
    expect(upstream).toHaveLength(1);
  });
});

describe('queries that would read a hash out without receiving it', () => {
  test('a selector on a hash field is refused and never reaches CouchDB', async () => {
    const response = await call(['_find'], { body: { selector: { portalPasswordHash: { $regex: '^\\$2b\\$12\\$a' } } } });
    expect(response.status).toBe(403);
    expect(upstream).toHaveLength(0);
  });
  test('so are fields, sort and a selector-filtered feed that name them', async () => {
    expect((await call(['_find'], { body: { selector: { type: 'patient' }, fields: ['portalInviteTokenHash'] } })).status).toBe(403);
    expect((await call(['_changes'], { body: { selector: { portalInviteTokenHash: { $exists: true } } }, query: '?filter=_selector' })).status).toBe(403);
    expect(upstream).toHaveLength(0);
  });
  test('a streamed feed cannot be rewritten, so it is refused however it is asked for', async () => {
    expect((await call(['_changes'], { query: '?feed=continuous&include_docs=true' })).status).toBe(403);
    expect((await call(['_changes'], { query: '?Feed=Continuous' })).status).toBe(403);
    expect((await call(['_changes'], { query: '?feed=eventsource' })).status).toBe(403);
    expect(upstream).toHaveLength(0);
  });
  // CouchDB reads a repeated or differently-cased parameter its own way; the
  // gateway does not try to guess, and strips every change feed.
  test('a change feed is stripped whatever its query says about documents', async () => {
    for (const query of ['?include_docs=false&include_docs=true', '?Include_Docs=true', '']) {
      noSecrets(JSON.stringify(await (await call(['_changes'], { query })).json()));
    }
  });
  test('a sub-resource of a replication endpoint is not offered at all', async () => {
    const response = await call(['_all_docs', 'queries'], { body: { queries: [{ include_docs: true }] } });
    expect(response.status).toBe(403);
    expect(upstream).toHaveLength(0);
  });
});

describe('the push side is unchanged', () => {
  test('a device pushing a stripped copy gets the server hashes restored', async () => {
    const stripped = { ...serverPatient(), _rev: '4-d', phone: '+211911111111' } as Record<string, unknown>;
    delete stripped.portalPasswordHash;
    delete stripped.portalInviteTokenHash;
    // The mock _all_docs (used for the server's current copy) returns the full doc.
    await call(['_bulk_docs'], { body: { new_edits: false, docs: [stripped] } });
    const sent = upstream.find(c => c.url.pathname.endsWith('/_bulk_docs'))!;
    const [doc] = sent.body!.docs as Doc[];
    expect(doc.portalPasswordHash).toBe('$2b$12$serverhash');
    expect(doc.portalInviteTokenHash).toBe('serverinvite');
    expect(doc.phone).toBe('+211911111111');
  });

  test('registration still creates a patient carrying a freshly minted invitation hash', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const raw = init?.body ? (typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as ArrayBuffer)) : '';
      upstream.push({ method: (init?.method || 'GET').toUpperCase(), url, body: raw ? JSON.parse(raw) : null });
      if (url.pathname.endsWith('/_all_docs')) return Response.json({ rows: [{ key: 'pat-new', error: 'not_found' }] });
      return Response.json([], { status: 201 });
    }) as unknown as typeof fetch;
    const fresh = {
      _id: 'pat-new', _rev: '1-a', type: 'patient', orgId: 'org-a', firstName: 'N', surname: 'P',
      portalUsername: 'np', portalEnabledAt: '2026-01-01', portalInviteTokenHash: 'minted', portalInviteExpiresAt: '2026-02-01',
    };
    await call(['_bulk_docs'], { body: { new_edits: false, docs: [fresh] } });
    const sent = upstream.find(c => c.url.pathname.endsWith('/_bulk_docs'))!;
    expect((sent.body!.docs as Doc[])[0].portalInviteTokenHash).toBe('minted');
  });
});

describe('stripPortalSecrets', () => {
  test('a multi-query answer is stripped per query', () => {
    const payload = { results: [{ rows: [{ id: 'pat-1', doc: { _id: 'pat-1', portalUsername: 'asha', portalPasswordHash: 'x', portalInviteTokenHash: 'y' } }] }] };
    expect(stripPortalSecrets(payload).results[0].rows[0].doc).toEqual({ _id: 'pat-1', portalUsername: 'asha' });
  });
  test('leaves non-document payloads and other fields alone', () => {
    expect(stripPortalSecrets({ ok: true })).toEqual({ ok: true });
    expect(stripPortalSecrets([{ missing: '1-a' }])).toEqual([{ missing: '1-a' }]);
    expect(stripPortalSecrets({ _id: 'x', portalUsername: 'u', portalPasswordHash: 'h' })).toEqual({ _id: 'x', portalUsername: 'u' });
  });
});
