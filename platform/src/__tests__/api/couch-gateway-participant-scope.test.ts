/** @jest-environment node
 *
 * /api/couch — staff chat is visible to its participants only.
 *
 * Every device in an organisation used to replicate every conversation and
 * every message in it; the app merely hid the ones you were not in. The
 * gateway is the only path between a browser and CouchDB, so this is where
 * "not yours" has to mean "never sent":
 *   - change feeds and queries are narrowed by a selector CouchDB evaluates;
 *   - a document asked for by id is checked before it is returned;
 *   - you cannot write yourself into a conversation, or post into one you are
 *     not in — judged on the server's copy, not the one you sent;
 *   - a message that arrives before its conversation is held, not lost;
 *   - patient messages (no conversation) are untouched.
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
  couchAdminAuthorization: () => 'Basic server',
}));
const logAuditSafe = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock('@/lib/services/audit-service', () => ({ logAuditSafe: (...args: unknown[]) => logAuditSafe(...args) }));

import { NextRequest } from 'next/server';
import { tenantDatabaseName } from '@/lib/sync/tenant-database';
import { GET, POST } from '@/app/api/couch/[...path]/route';

const MESSAGES = tenantDatabaseName('tamamhealth_messages', 'org-a');
const CONVERSATIONS = tenantDatabaseName('tamamhealth_conversations', 'org-a');
const PATIENTS = tenantDatabaseName('tamamhealth_patients', 'org-a');
const COUCH = 'http://couch.test:5984';

type Doc = Record<string, unknown> & { _id: string };
/** The server's documents, per database. */
let store: Record<string, Doc[]> = {};
let upstreamCalls: Array<{ method: string; url: URL; body: Record<string, unknown> | null }> = [];
let counter = 0;
let mine = '';
let theirs = '';
/** A fresh account per test, so the gateway's short membership cache starts cold. */
let me = 'user-ana';

const conversation = (id: string, participantIds: string[]): Doc =>
  ({ _id: id, _rev: '1-a', type: 'conversation', kind: 'group', orgId: 'org-a', participantIds });
const chat = (id: string, conversationId: string, fromDoctorId = 'user-ben'): Doc =>
  ({ _id: id, _rev: '1-a', type: 'message', orgId: 'org-a', conversationId, fromDoctorId, body: `secret ${id}` });
const patientMessage = (id: string): Doc =>
  ({ _id: id, _rev: '1-a', type: 'message', orgId: 'org-a', patientId: 'pat-1', fromDoctorId: 'user-ben', body: 'see you Tuesday' });

beforeEach(() => {
  process.env.NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED = 'true';
  process.env.COUCHDB_URL = COUCH;
  counter += 1;
  me = `user-ana-${counter}`;
  actor.sub = me;
  mine = `conv-mine-${counter}`;
  theirs = `conv-theirs-${counter}`;
  store = {
    [CONVERSATIONS]: [conversation(mine, [me, 'user-ben']), conversation(theirs, ['user-ben', 'user-cat'])],
    [MESSAGES]: [chat('msg-mine', mine), chat('msg-theirs', theirs), patientMessage('msg-patient')],
  };
  upstreamCalls = [];
  logAuditSafe.mockClear();
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method || 'GET').toUpperCase();
    const [, db, endpoint = ''] = url.pathname.split('/').map(decodeURIComponent);
    const raw = init?.body ? (typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as ArrayBuffer)) : '';
    const body = raw ? JSON.parse(raw) as Record<string, unknown> : null;
    upstreamCalls.push({ method, url, body });
    const docs = store[db] || [];
    if (endpoint === '_find') {
      // Only the membership lookup's shape is modelled.
      const userId = ((body!.selector as Doc).participantIds as { $elemMatch: { $eq: string } }).$elemMatch.$eq;
      return Response.json({ docs: docs.filter(d => (d.participantIds as string[] | undefined)?.includes(userId)).map(d => ({ _id: d._id })) });
    }
    if (endpoint === '_all_docs') {
      const keys = (body?.keys as string[] | undefined) ?? docs.map(d => d._id);
      return Response.json({ rows: keys.map(key => {
        const doc = docs.find(d => d._id === key);
        if (!doc) return { key, error: 'not_found' };
        // A tombstone is listed, without its body — as CouchDB lists one.
        return doc._deleted ? { id: key, key, value: { rev: doc._rev, deleted: true }, doc: null } : { id: key, key, value: { rev: doc._rev }, doc };
      }) });
    }
    if (endpoint === '_bulk_get') {
      const wanted = body!.docs as Array<{ id: string }>;
      return Response.json({ results: wanted.map(({ id }) => ({ id, docs: [{ ok: docs.find(d => d._id === id) }] })) });
    }
    if (endpoint === '_changes') return Response.json({ results: [], last_seq: '0' });
    if (endpoint === '_bulk_docs') return Response.json([], { status: 201 });
    const doc = docs.find(d => d._id === endpoint);
    return doc ? Response.json(doc) : Response.json({ error: 'not_found' }, { status: 404 });
  }) as unknown as typeof fetch;
});

function call(db: string, path: string[], init: { method?: string; body?: unknown; query?: string } = {}) {
  const method = init.method || (init.body ? 'POST' : 'GET');
  const request = new NextRequest(`http://localhost/api/couch/${db}/${path.join('/')}${init.query || ''}`, {
    method,
    ...(init.body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) } : {}),
  });
  return (method === 'GET' ? GET : POST)(request, { params: Promise.resolve({ path: [db, ...path] }) });
}
const forwarded = (endpoint: string) => upstreamCalls.filter(c => c.url.pathname.endsWith(`/${endpoint}`));
const audits = (action: string) => logAuditSafe.mock.calls.filter(c => c[0] === action);

describe('reads', () => {
  test('the messages change feed is narrowed to my conversations and non-chat messages', async () => {
    await call(MESSAGES, ['_changes'], { body: { selector: { orgId: 'org-a' } }, query: '?filter=_selector&since=12' });

    const [sent] = forwarded('_changes').filter(c => c.url.pathname.includes(MESSAGES));
    expect(sent.method).toBe('POST');
    expect(sent.url.searchParams.get('filter')).toBe('_selector');
    expect(sent.url.searchParams.get('since')).toBe('12');
    const [client, scope] = (sent.body!.selector as { $and: unknown[] }).$and;
    expect(client).toEqual({ orgId: 'org-a' });
    expect(JSON.stringify(scope)).toContain(mine);
    expect(JSON.stringify(scope)).not.toContain(theirs);
  });

  test('a feed asked for with no selector, as a GET, is still narrowed', async () => {
    await call(CONVERSATIONS, ['_changes'], { query: '?since=0' });

    const [sent] = forwarded('_changes');
    expect(sent.method).toBe('POST');
    expect(sent.body!.selector).toEqual({ participantIds: { $elemMatch: { $eq: me } } });
  });

  test('a custom changes filter cannot be used to step around the selector', async () => {
    const response = await call(MESSAGES, ['_changes'], { query: '?filter=app/everything' });
    expect(response.status).toBe(403);
    expect(forwarded('_changes')).toHaveLength(0);
  });

  test('fetching by id returns my thread and patient messages, never someone else’s', async () => {
    const response = await call(MESSAGES, ['_bulk_get'], {
      body: { docs: [{ id: 'msg-mine' }, { id: 'msg-theirs' }, { id: 'msg-patient' }] },
    });
    const text = JSON.stringify(await response.json());

    expect(text).toContain('secret msg-mine');
    expect(text).toContain('see you Tuesday');
    expect(text).not.toContain('secret msg-theirs');
    expect(audits('sync.gateway.participant_read_blocked')).toHaveLength(1);
  });

  test('_all_docs marks a conversation I am not in as forbidden, distinct from not found', async () => {
    const response = await call(CONVERSATIONS, ['_all_docs'], {
      body: { keys: [mine, theirs, 'conv-unknown'] }, query: '?include_docs=true',
    });
    const { rows } = await response.json() as { rows: Array<{ key: string; error?: string; doc?: unknown }> };

    expect(rows[0].doc).toBeDefined();
    expect(rows[1]).toMatchObject({ key: theirs, error: 'forbidden' });
    expect(rows[1].doc).toBeUndefined();
    expect(rows[2]).toMatchObject({ key: 'conv-unknown', error: 'not_found' });
  });

  test('a direct GET of someone else’s message is refused', async () => {
    expect((await call(MESSAGES, ['msg-theirs'])).status).toBe(403);
    const ok = await call(MESSAGES, ['msg-mine']);
    expect(ok.status).toBe(200);
    expect((await ok.json() as Doc).body).toBe('secret msg-mine');
  });
});

describe('writes', () => {
  const pushed = (db: string) => forwarded('_bulk_docs').filter(c => c.url.pathname.includes(db))
    .flatMap(c => (c.body!.docs as Doc[]).map(d => d._id));

  test('I cannot write myself into a conversation I am not in', async () => {
    const hijack = { ...conversation(theirs, ['user-ben', 'user-cat', me]), _rev: '2-b' };

    const response = await call(CONVERSATIONS, ['_bulk_docs'], { body: { new_edits: false, docs: [hijack] } });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual([expect.objectContaining({ id: theirs, error: 'forbidden' })]);
    expect(pushed(CONVERSATIONS)).toEqual([]);
    expect(audits('sync.gateway.participant_write_blocked')).toHaveLength(1);
  });

  test('a participant can update a conversation, and anyone can create one they are in', async () => {
    const update = { ...conversation(mine, [me, 'user-ben', 'user-dan']), _rev: '2-b' };
    const fresh = conversation('conv-new', [me, 'user-eve']);
    const notMine = conversation('conv-foreign', ['user-ben', 'user-cat']);

    await call(CONVERSATIONS, ['_bulk_docs'], { body: { new_edits: false, docs: [update, fresh, notMine] } });

    expect(pushed(CONVERSATIONS)).toEqual([mine, 'conv-new']);
  });

  test('a message into someone else’s conversation is dropped; mine and patient messages are carried', async () => {
    await call(MESSAGES, ['_bulk_docs'], { body: { new_edits: false, docs: [
      chat('msg-a', mine, me), chat('msg-b', theirs, me), patientMessage('msg-c'),
    ] } });

    expect(pushed(MESSAGES)).toEqual(['msg-a', 'msg-c']);
    expect(String(audits('sync.gateway.participant_write_blocked')[0][3])).not.toContain('secret');
  });

  test('my message for a conversation the server has not received yet is held for retry, not lost', async () => {
    const response = await call(MESSAGES, ['_bulk_docs'], { body: { new_edits: false, docs: [
      chat('msg-early', 'conv-not-synced-yet', me),
    ] } });

    expect(response.status).toBe(503);
    expect(pushed(MESSAGES)).toEqual([]);
  });

  test('a conversation I just created is honoured even before the membership cache catches up', async () => {
    await call(MESSAGES, ['_changes'], { query: '?since=0' }); // warms the cache without conv-new
    store[CONVERSATIONS].push(conversation(`conv-new-${counter}`, [me, 'user-eve']));

    await call(MESSAGES, ['_bulk_docs'], { body: { new_edits: false, docs: [chat('msg-n', `conv-new-${counter}`, me)] } });

    expect(pushed(MESSAGES)).toEqual(['msg-n']);
  });

  test('rewriting a colleague’s message is refused and audited; my own read receipt is carried', async () => {
    const original = store[MESSAGES].find(d => d._id === 'msg-mine')!;
    const forged = { ...original, _rev: '2-x', body: 'Give 5 g' };
    const receipt = { ...chat('msg-other', mine), _rev: '2-y', readBy: [me] };
    store[MESSAGES].push(chat('msg-other', mine));

    const response = await call(MESSAGES, ['_bulk_docs'], { body: { new_edits: false, docs: [forged, receipt] } });

    expect(pushed(MESSAGES)).toEqual(['msg-other']);
    expect(await response.json()).toEqual([expect.objectContaining({ id: 'msg-mine', error: 'forbidden' })]);
    const [audit] = audits('sync.gateway.message_integrity_blocked');
    expect(String(audit[3])).toContain('msg-mine');
    expect(String(audit[3])).not.toContain('Give 5 g');
  });

  test('I cannot post into my own conversation under a colleague’s name', async () => {
    await call(MESSAGES, ['_bulk_docs'], { body: { new_edits: false, docs: [chat('msg-fake', mine, 'user-ben')] } });

    expect(pushed(MESSAGES)).toEqual([]);
    expect(audits('sync.gateway.message_integrity_blocked')).toHaveLength(1);
  });
});

describe('patient writes: portal credentials are the server’s', () => {
  const onServer = { _id: 'pat-1', _rev: '3-a', type: 'patient', orgId: 'org-a', phone: '0911', portalUsername: 'mary.0042', portalPasswordHash: 'server-hash' };

  test('a planted activation code never reaches CouchDB, and the rest of the edit does', async () => {
    store[PATIENTS] = [onServer];
    const attack = { ...onServer, _rev: '4-b', phone: '0922', portalInviteTokenHash: 'attacker-hash', portalPasswordHash: 'attacker-hash' };

    const response = await call(PATIENTS, ['_bulk_docs'], { body: { new_edits: false, docs: [attack] } });

    expect(response.status).toBe(201);
    const [sent] = forwarded('_bulk_docs').filter(c => c.url.pathname.includes(PATIENTS));
    const [written] = sent.body!.docs as Doc[];
    expect(written).toMatchObject({ _id: 'pat-1', _rev: '4-b', phone: '0922', portalPasswordHash: 'server-hash' });
    expect(written.portalInviteTokenHash).toBeUndefined();
    expect(sent.body!.new_edits).toBe(false);
  });

  const REGISTER = 'tamamhealth_patients';
  const invite = { portalUsername: 'mary.deng.0042', portalInviteTokenHash: 'b'.repeat(64), portalInviteExpiresAt: new Date(Date.now() + 86_400_000).toISOString() };
  const sentDoc = () => (forwarded('_bulk_docs').filter(c => c.url.pathname.includes(PATIENTS))[0].body!.docs as Doc[])[0];

  test('a patient registered with an invitation keeps it, whoever registered them', async () => {
    store[PATIENTS] = [];
    const fresh = { _id: 'pat-2', _rev: '1-a', type: 'patient', orgId: 'org-a', ...invite };

    await call(PATIENTS, ['_bulk_docs'], { body: { new_edits: false, docs: [fresh] } });

    expect(sentDoc()).toMatchObject(invite);
    expect(audits('sync.gateway.portal_credentials_stripped')).toHaveLength(0);
  });

  test('a new patient arriving with a ready-made password loses it, and it is audited', async () => {
    store[PATIENTS] = [];
    const fresh = { _id: 'pat-3', _rev: '1-a', type: 'patient', orgId: 'org-a', portalUsername: 'mary.deng.0042', portalPasswordHash: 'chosen-by-device' };

    await call(PATIENTS, ['_bulk_docs'], { body: { new_edits: false, docs: [fresh] } });

    expect(sentDoc().portalPasswordHash).toBeUndefined();
    expect(audits('sync.gateway.portal_credentials_stripped')).toHaveLength(1);
  });

  // The takeover this closes: delete a patient, then register "them" again
  // with an activation code of your own.
  test('a patient deleted and written back does not come back with a new invitation', async () => {
    store[PATIENTS] = [{ _id: 'pat-1', _rev: '4-dead', _deleted: true }];
    const rebirth = { _id: 'pat-1', _rev: '5-b', type: 'patient', orgId: 'org-a', phone: '0999', ...invite };

    await call(PATIENTS, ['_bulk_docs'], { body: { new_edits: false, docs: [rebirth] } });

    expect(Object.keys(sentDoc()).filter(key => key.startsWith('portal'))).toEqual([]);
    expect(sentDoc().phone).toBe('0999');
    expect(audits('sync.gateway.portal_credentials_stripped')).toHaveLength(1);
  });

  test('a patient the server’s register holds, under any organization, is not new here', async () => {
    store[PATIENTS] = [];
    store[REGISTER] = [{ _id: 'pat-elsewhere', _rev: '2-a', type: 'patient', orgId: 'org-b', portalUsername: 'someone.else', portalPasswordHash: 'server-hash' }];
    const claim = { _id: 'pat-elsewhere', _rev: '9-z', type: 'patient', orgId: 'org-a', ...invite };

    await call(PATIENTS, ['_bulk_docs'], { body: { new_edits: false, docs: [claim] } });

    expect(Object.keys(sentDoc()).filter(key => key.startsWith('portal'))).toEqual([]);
    const lookup = upstreamCalls.find(c => c.url.pathname === `/${REGISTER}/_all_docs`);
    expect(lookup?.body).toEqual({ keys: ['pat-elsewhere'] });
    expect(audits('sync.gateway.portal_credentials_stripped')).toHaveLength(1);
  });

  test('a patient written without an id carries no portal fields', async () => {
    store[PATIENTS] = [];
    const nameless = { type: 'patient', orgId: 'org-a', firstName: 'Mary', ...invite, portalPasswordHash: 'chosen-by-device' };

    await call(PATIENTS, ['_bulk_docs'], { body: { docs: [nameless] } });

    expect(Object.keys(sentDoc()).filter(key => key.startsWith('portal'))).toEqual([]);
    expect(sentDoc().firstName).toBe('Mary');
  });

  test('a write whose body names a different document than its path is refused', async () => {
    store[PATIENTS] = [onServer];
    const response = await call(PATIENTS, ['pat-1'], { method: 'PUT', body: { _id: 'pat-9', type: 'patient', orgId: 'org-a', ...invite } });

    expect(response.status).toBe(400);
    expect(upstreamCalls.filter(c => c.method === 'PUT')).toEqual([]);
  });
});
