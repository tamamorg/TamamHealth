/** @jest-environment node
 *
 * The sync gateway's messaging rules against a REAL CouchDB.
 *
 * Every other gateway test mocks CouchDB, which proves the rules but not that
 * CouchDB behaves the way they assume: that the generated validator compiles
 * in CouchDB's JavaScript engine, that a Mango selector with `$elemMatch` and
 * a `null` in `$in` filters a changes feed, what `?open_revs=all` returns for
 * a conflicted document, and what the validator is handed for a replicated
 * (`new_edits: false`) write. Those are exactly the assumptions a mock cannot
 * check, so this suite runs the real route handler against a real server.
 *
 * It is skipped unless a throwaway CouchDB is supplied:
 *
 *   docker run -d --rm -p 127.0.0.1:5985:5984 \
 *     -e COUCHDB_USER=admin -e COUCHDB_PASSWORD=<pw> couchdb:3
 *   COUCH_IT_URL=http://127.0.0.1:5985 COUCH_IT_USER=admin COUCH_IT_PASSWORD=<pw> \
 *     npx jest src/__tests__/integration/couch-gateway-live.test.ts
 *
 * It creates its own uniquely named databases and users. Never point it at a
 * server that holds real data.
 */
const IT_URL = process.env.COUCH_IT_URL || '';
const IT_ADMIN = `Basic ${Buffer.from(`${process.env.COUCH_IT_USER}:${process.env.COUCH_IT_PASSWORD}`).toString('base64')}`;
const live = IT_URL ? describe : describe.skip;

const actor = { sub: '', username: '', name: '', role: 'doctor', orgId: '', hospitalId: 'hosp-1' };
jest.mock('@/modules/identity/core/api-auth', () => ({
  getAuthPayload: jest.fn(async () => actor),
  unauthorized: jest.fn(() => Response.json({ error: 'unauthorized' }, { status: 401 })),
  forbidden: jest.fn((error = 'forbidden') => Response.json({ error }, { status: 403 })),
  logApiError: jest.fn((_tag: string, error: unknown) => { throw error; }),
}));
jest.mock('@/lib/sync/couch-auth', () => ({
  ensureCouchGatewayUser: jest.fn(async () => ({ username: actor.username, password: 'it-password' })),
  ensureOrganizationProvisioned: jest.fn(async () => undefined),
}));
const logAuditSafe = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock('@/lib/services/audit-service', () => ({ logAuditSafe: (...args: unknown[]) => logAuditSafe(...args) }));

import { NextRequest } from 'next/server';
import { tenantDatabaseName } from '@/lib/sync/tenant-database';
import { ORG_SCOPED_VALIDATE_FN } from '@/lib/sync/validate-doc-update';
import { GET, POST } from '@/app/api/couch/[...path]/route';

const ORG = `org-it-${Date.now().toString(36)}`;
const MESSAGES = tenantDatabaseName('tamamhealth_messages', ORG);
const CONVERSATIONS = tenantDatabaseName('tamamhealth_conversations', ORG);
const AUDIT = tenantDatabaseName('tamamhealth_audit_log', ORG);
const ANA = `user-ana-${ORG}`, BEN = `user-ben-${ORG}`, CAT = `user-cat-${ORG}`;
type Doc = Record<string, unknown>;

async function couch(path: string, init: { method?: string; body?: unknown; as?: string } = {}) {
  const authorization = init.as
    ? `Basic ${Buffer.from(`${init.as}:it-password`).toString('base64')}`
    : IT_ADMIN;
  const response = await fetch(`${IT_URL}/${path}`, {
    method: init.method || (init.body ? 'POST' : 'GET'),
    headers: { authorization, 'content-type': 'application/json', accept: 'application/json' },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  return { status: response.status, json: await response.json() as never };
}

function signInAs(userId: string) {
  actor.sub = userId; actor.username = userId; actor.name = userId; actor.orgId = ORG;
}

async function gateway(db: string, path: string[], init: { body?: unknown; query?: string } = {}) {
  const request = new NextRequest(`http://localhost/api/couch/${db}/${path.join('/')}${init.query || ''}`, {
    method: init.body ? 'POST' : 'GET',
    ...(init.body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) } : {}),
  });
  const response = await (init.body ? POST : GET)(request, { params: Promise.resolve({ path: [db, ...path] }) });
  return { status: response.status, json: await response.json() as never };
}

const conversation = (id: string, participantIds: string[]): Doc =>
  ({ _id: id, type: 'conversation', kind: 'group', orgId: ORG, participantIds });
const message = (id: string, conversationId: string | undefined, from: string, body: string): Doc => ({
  _id: id, type: 'message', orgId: ORG, ...(conversationId ? { conversationId } : { patientId: 'pat-1' }),
  fromDoctorId: from, fromDoctorName: from, sentAt: '2026-10-08T09:00:00.000Z', createdAt: '2026-10-08T09:00:00.000Z',
  direction: conversationId ? 'staff_to_staff' : 'staff_to_patient', channel: 'app', subject: '', body, readBy: [from],
});
const serverDoc = async (db: string, id: string) => (await couch(`${db}/${id}?conflicts=true`)).json as Doc;
/** A replication-style write: explicit revision, explicit ancestry. */
const replicated = (doc: Doc, rev: string, parents: string[]) => {
  const [start, hash] = rev.split('-');
  return { ...doc, _rev: rev, _revisions: { start: Number(start), ids: [hash, ...parents.map(p => p.split('-')[1])] } };
};

live('sync gateway against a real CouchDB', () => {
  beforeAll(async () => {
    process.env.NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED = 'true';
    process.env.COUCHDB_URL = IT_URL;
    delete process.env.DEMO_MODE;
    for (const userId of [ANA, BEN, CAT]) {
      await couch(`_users/org.couchdb.user:${userId}`, { method: 'PUT', body: {
        name: userId, password: 'it-password', type: 'user', roles: [`org:${ORG}`, 'role:doctor', `user:${userId}`],
      } });
    }
    for (const db of [MESSAGES, CONVERSATIONS, AUDIT]) {
      expect((await couch(db, { method: 'PUT' })).status).toBe(201);
      await couch(`${db}/_security`, { method: 'PUT', body: { admins: { names: [], roles: [] }, members: { names: [], roles: [`org:${ORG}`] } } });
      const design = await couch(`${db}/_design/tamamhealth-org-scope`, { method: 'PUT', body: { validate_doc_update: ORG_SCOPED_VALIDATE_FN } });
      expect(design.status).toBe(201);
    }
    await couch(`${CONVERSATIONS}/_bulk_docs`, { body: { docs: [
      conversation('conv-mine', [ANA, BEN]), conversation('conv-theirs', [BEN, CAT]),
    ] } });
    await couch(`${MESSAGES}/_bulk_docs`, { body: { docs: [
      message('msg-mine', 'conv-mine', ANA, 'Give 500 mg'),
      message('msg-theirs', 'conv-theirs', BEN, 'private to ben and cat'),
      message('msg-patient', undefined, BEN, 'see you Tuesday'),
    ] } });
  }, 60_000);

  afterAll(async () => {
    for (const db of [MESSAGES, CONVERSATIONS, AUDIT]) await couch(db, { method: 'DELETE' });
  });

  describe('the generated validator, as CouchDB itself runs it', () => {
    test('compiles and lets an ordinary read receipt through', async () => {
      const doc = await serverDoc(MESSAGES, 'msg-mine');
      const result = await couch(`${MESSAGES}/msg-mine`, { method: 'PUT', as: BEN, body: { ...doc, readBy: [ANA, BEN] } });
      expect(result.status).toBe(201);
    });

    test('refuses a colleague rewriting the text, and the author dropping the earlier wording', async () => {
      const doc = await serverDoc(MESSAGES, 'msg-mine');
      const forged = await couch(`${MESSAGES}/msg-mine`, { method: 'PUT', as: BEN, body: { ...doc, body: 'Give 5 g' } });
      expect(forged.status).toBe(403);
      const lossy = await couch(`${MESSAGES}/msg-mine`, { method: 'PUT', as: ANA, body: { ...doc, body: 'Give 1 g' } });
      expect(lossy.status).toBe(403);
      expect((await serverDoc(MESSAGES, 'msg-mine')).body).toBe('Give 500 mg');
    });

    test('accepts the author’s edit when the earlier wording is kept', async () => {
      const doc = await serverDoc(MESSAGES, 'msg-patient');
      const edit = await couch(`${MESSAGES}/msg-patient`, { method: 'PUT', as: BEN, body: {
        ...doc, body: 'see you Wednesday', editHistory: [{ body: 'see you Tuesday', at: doc.sentAt }],
      } });
      expect(edit.status).toBe(201);
    });
  });

  describe('reads through the gateway', () => {
    test('a real changes feed carries only my conversations and non-chat messages', async () => {
      signInAs(ANA);
      const feed = await gateway(MESSAGES, ['_changes'], { body: { selector: { orgId: ORG } }, query: '?filter=_selector&since=0' });
      const ids = ((feed.json as { results: Array<{ id: string }> }).results).map(row => row.id);
      expect(ids).toEqual(expect.arrayContaining(['msg-mine', 'msg-patient']));
      expect(ids).not.toContain('msg-theirs');

      const conversations = await gateway(CONVERSATIONS, ['_changes'], { query: '?since=0' });
      expect(((conversations.json as { results: Array<{ id: string }> }).results).map(row => row.id)).toEqual(['conv-mine']);
    });

    test('asking for someone else’s message by id returns no content', async () => {
      signInAs(ANA);
      const got = await gateway(MESSAGES, ['_bulk_get'], { body: { docs: [{ id: 'msg-mine' }, { id: 'msg-theirs' }] }, query: '?revs=true' });
      const text = JSON.stringify(got.json);
      expect(text).toContain('Give 500 mg');
      expect(text).not.toContain('private to ben and cat');
      expect((await gateway(MESSAGES, ['msg-theirs'])).status).toBe(403);
    });
  });

  describe('writes through the gateway', () => {
    test('a replicated rewrite of a colleague’s message is refused and the server copy is untouched', async () => {
      signInAs(BEN);
      const current = await serverDoc(MESSAGES, 'msg-mine');
      const forged = replicated({ ...current, body: 'Give 5 g' }, `${Number(String(current._rev).split('-')[0]) + 1}-forged`, [String(current._rev)]);
      const result = await gateway(MESSAGES, ['_bulk_docs'], { body: { new_edits: false, docs: [forged] } });
      expect(result.json).toEqual([expect.objectContaining({ id: 'msg-mine', error: 'forbidden' })]);
      expect((await serverDoc(MESSAGES, 'msg-mine')).body).toBe('Give 500 mg');
    });

    test('a forged branch with invented ancestry is refused at the gateway', async () => {
      signInAs(BEN);
      const current = await serverDoc(MESSAGES, 'msg-mine');
      const forged = replicated({ ...current, body: 'Give 5 g' }, '99-invented', ['98-neverexisted']);
      const result = await gateway(MESSAGES, ['_bulk_docs'], { body: { new_edits: false, docs: [forged] } });
      expect(result.json).toEqual([expect.objectContaining({ id: 'msg-mine', error: 'forbidden' })]);
      const after = await serverDoc(MESSAGES, 'msg-mine');
      expect(after.body).toBe('Give 500 mg');
      expect(after._conflicts).toBeUndefined();
    });

    test('deleting the only live revision is refused; pruning a conflict loser is carried', async () => {
      signInAs(ANA);
      const current = await serverDoc(MESSAGES, 'msg-mine');
      const rev = String(current._rev);
      const gen = Number(rev.split('-')[0]);
      const tombstone = replicated({ _id: 'msg-mine', _deleted: true }, `${gen + 1}-dead`, [rev]);
      const refused = await gateway(MESSAGES, ['_bulk_docs'], { body: { new_edits: false, docs: [tombstone] } });
      expect(refused.json).toEqual([expect.objectContaining({ id: 'msg-mine', error: 'forbidden' })]);
      expect((await serverDoc(MESSAGES, 'msg-mine'))._deleted).toBeUndefined();

      // A real conflict: a sibling revision with the same content plus a read receipt.
      const sibling = replicated({ ...current, readBy: [ANA, BEN, CAT] }, `${gen}-sibling`, []);
      await couch(`${MESSAGES}/_bulk_docs`, { body: { new_edits: false, docs: [sibling] } });
      const conflicted = await serverDoc(MESSAGES, 'msg-mine');
      const loser = (conflicted._conflicts as string[])[0];
      expect(loser).toBeDefined();
      const prune = replicated({ _id: 'msg-mine', _deleted: true }, `${gen + 1}-pruned`, [loser]);
      const carried = await gateway(MESSAGES, ['_bulk_docs'], { body: { new_edits: false, docs: [prune] } });
      expect(carried.json).toEqual([]);
      const resolved = await serverDoc(MESSAGES, 'msg-mine');
      expect(resolved._conflicts).toBeUndefined();
      expect(resolved.body).toBe('Give 500 mg');
    });

    test('I cannot write myself into a conversation, or post into it', async () => {
      signInAs(ANA);
      const theirs = await serverDoc(CONVERSATIONS, 'conv-theirs');
      const hijack = replicated({ ...theirs, participantIds: [BEN, CAT, ANA] }, '2-hijack', [String(theirs._rev)]);
      const joined = await gateway(CONVERSATIONS, ['_bulk_docs'], { body: { new_edits: false, docs: [hijack] } });
      expect(joined.json).toEqual([expect.objectContaining({ id: 'conv-theirs', error: 'forbidden' })]);
      expect((await serverDoc(CONVERSATIONS, 'conv-theirs')).participantIds).toEqual([BEN, CAT]);

      const intrusion = replicated(message('msg-intrude', 'conv-theirs', ANA, 'hello'), '1-intrude', []);
      const posted = await gateway(MESSAGES, ['_bulk_docs'], { body: { new_edits: false, docs: [intrusion] } });
      expect(posted.json).toEqual([expect.objectContaining({ id: 'msg-intrude', error: 'forbidden' })]);
      expect((await couch(`${MESSAGES}/msg-intrude`)).status).toBe(404);
    });

    test('my own message is carried, and one that outruns its conversation is held', async () => {
      signInAs(ANA);
      const mine = replicated(message('msg-new', 'conv-mine', ANA, 'on my way'), '1-new', []);
      const ok = await gateway(MESSAGES, ['_bulk_docs'], { body: { new_edits: false, docs: [mine] } });
      expect(ok.json).toEqual([]);
      expect((await serverDoc(MESSAGES, 'msg-new')).body).toBe('on my way');

      const early = replicated(message('msg-early', 'conv-not-there-yet', ANA, 'first!'), '1-early', []);
      expect((await gateway(MESSAGES, ['_bulk_docs'], { body: { new_edits: false, docs: [early] } })).status).toBe(503);
    });
  });

  describe('a real PouchDB device replicating through the gateway', () => {
    // The device's own replication client, pointed at the route handler: this
    // is the protocol conversation the browser actually has.
    /* eslint-disable @typescript-eslint/no-require-imports */
    // `pouchdb-browser` is the build the app ships: its replicator and http
    // adapter are the ones under test. Only storage is swapped for memory.
    (globalThis as { self?: unknown }).self ??= globalThis; // the browser build expects a worker/window global
    const browserBuild = require('pouchdb-browser');
    const memoryAdapter = require('pouchdb-adapter-memory');
    const PouchDB = (browserBuild.default || browserBuild).plugin(memoryAdapter.default || memoryAdapter);
    /* eslint-enable @typescript-eslint/no-require-imports */
    const remote = (db: string) => new PouchDB(`http://localhost/api/couch/${db}`, {
      skip_setup: true,
      fetch: async (url: string, init?: RequestInit) => {
        const target = new URL(String(url));
        const path = target.pathname.replace('/api/couch/', '').split('/').filter(Boolean).map(decodeURIComponent);
        const method = (init?.method || 'GET').toUpperCase();
        const request = new NextRequest(target, { method, headers: init?.headers, body: init?.body as BodyInit | undefined });
        return (method === 'GET' ? GET : POST)(request, { params: Promise.resolve({ path }) });
      },
    });

    test('a pull brings down my threads and patient messages, and nothing else', async () => {
      signInAs(ANA);
      const device = new PouchDB(`device-ana-${ORG}`, { adapter: 'memory' });
      const result = await device.replicate.from(remote(MESSAGES), { selector: { orgId: ORG } });
      expect(result.ok).toBe(true);
      const ids = (await device.allDocs()).rows.map((row: { id: string }) => row.id);
      expect(ids).toEqual(expect.arrayContaining(['msg-mine', 'msg-patient']));
      expect(ids).not.toContain('msg-theirs');
      await device.destroy();
    });

    test('a push carries my writes, reports the forged one as denied, and does not stall', async () => {
      signInAs(BEN);
      const device = new PouchDB(`device-ben-${ORG}`, { adapter: 'memory' });
      await device.replicate.from(remote(MESSAGES), { selector: { orgId: ORG } });
      const target = await device.get('msg-mine');
      await device.put({ ...target, body: 'Give 5 g' });
      await device.put(message('msg-ben-own', 'conv-mine', BEN, 'noted'));

      const denied: string[] = [];
      const push = device.replicate.to(remote(MESSAGES));
      push.on('denied', (info: { id?: string; doc?: { id?: string } }) => denied.push(info.id || info.doc?.id || '?'));
      const result = await push;

      expect(result.ok).toBe(true);
      expect(denied).toEqual(['msg-mine']);
      expect((await serverDoc(MESSAGES, 'msg-mine')).body).toBe('Give 500 mg');
      expect((await serverDoc(MESSAGES, 'msg-ben-own')).body).toBe('noted');
      await device.destroy();
    });
  });

  describe('the audit trail', () => {
    const entry = (details: string): Doc =>
      ({ _id: 'audit-1', type: 'audit_log', orgId: ORG, action: 'DELETE_MESSAGE', userId: BEN, details, timestamp: '2026-10-08T09:00:00.000Z' });

    test('an entry can be written once, and never rewritten — not even with invented ancestry', async () => {
      signInAs(BEN);
      const first = await gateway(AUDIT, ['_bulk_docs'], { body: { new_edits: false, docs: [replicated(entry('removed msg-1'), '1-real', [])] } });
      expect(first.json).toEqual([]);

      const forged = replicated(entry('nothing happened'), '99-forged', ['98-neverexisted']);
      const second = await gateway(AUDIT, ['_bulk_docs'], { body: { new_edits: false, docs: [forged] } });
      expect(second.json).toEqual([expect.objectContaining({ id: 'audit-1', error: 'forbidden' })]);

      const kept = await serverDoc(AUDIT, 'audit-1');
      expect(kept.details).toBe('removed msg-1');
      expect(kept._conflicts).toBeUndefined();
    });

    test('replication re-sending the same entry is not an error', async () => {
      signInAs(BEN);
      const again = await gateway(AUDIT, ['_bulk_docs'], { body: { new_edits: false, docs: [replicated(entry('removed msg-1'), '1-real', [])] } });
      expect(again.json).toEqual([]);
    });
  });

  // Not an assertion about our code: this records what CouchDB's validator is
  // handed for a replicated write that claims ancestry the server never had.
  // If it passes, the validator alone cannot stop a forged branch and the
  // gateway check above is the control that does.
  test('finding: a forged branch written straight to CouchDB, bypassing the gateway', async () => {
    const current = await serverDoc(MESSAGES, 'msg-theirs');
    const forged = replicated({ ...current, body: 'forged directly' }, '99-direct', ['98-neverexisted']);
    const result = await couch(`${MESSAGES}/_bulk_docs`, { as: CAT, body: { new_edits: false, docs: [forged] } });
    const after = await serverDoc(MESSAGES, 'msg-theirs');
    console.info('[finding] direct forged branch →', JSON.stringify(result.json), '| winner body:', after.body, '| conflicts:', after._conflicts);
    expect([200, 201, 403]).toContain(result.status);
  });
});
