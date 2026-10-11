/**
 * Conflict queue: idempotent enqueue, tenant scoping, and resolution that
 * actually changes the target document.
 */
import PouchDB from 'pouchdb-browser';
import memoryAdapter from 'pouchdb-adapter-memory';

PouchDB.plugin(memoryAdapter);

const live: Record<string, PouchDB.Database> = {};
function openDB(name: string): PouchDB.Database {
  if (!live[name]) live[name] = new PouchDB(`${name}-${Math.random().toString(36).slice(2)}`, { adapter: 'memory' });
  return live[name];
}

jest.mock('@/lib/db', () => ({
  getDB: (name: string) => openDB(name),
  conflictQueueDB: () => openDB('tamamhealth_conflict_queue'),
}));
jest.mock('@/lib/services/db-query', () => ({
  findByType: async (db: PouchDB.Database, type: string) => {
    const all = await db.allDocs({ include_docs: true });
    return all.rows.map(r => r.doc).filter(d => d && (d as { type?: string }).type === type);
  },
}));

import {
  HIGH_RISK_RESOURCES,
  dismissConflict,
  enqueueConflict,
  listConflicts,
  resolveConflict,
} from '@/lib/services/conflict-service';
import { DATABASE_DOCUMENT_TYPES } from '@/lib/sync/sync-config';

beforeEach(async () => {
  for (const k of Object.keys(live)) {
    await live[k].destroy().catch(() => undefined);
    delete live[k];
  }
});

/** Create doc, then replicate a divergent branch in with new_edits:false. */
async function makeConflict(dbName: string, type: string, orgId = 'org-a') {
  const db = openDB(dbName);
  const first = await db.put({ _id: 'doc-1', type, orgId, value: 'base' });
  const mine = await db.put({ _id: 'doc-1', _rev: first.rev, type, orgId, value: 'mine' });
  const theirRev = '2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  await db.bulkDocs(
    [{ _id: 'doc-1', _rev: theirRev, _revisions: { start: 2, ids: ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', first.rev.split('-')[1]] }, type, orgId, value: 'theirs' }],
    { new_edits: false },
  );
  const head = await db.get('doc-1', { conflicts: true }) as unknown as { _rev: string; _conflicts?: string[]; value: string };
  return { db, head, mineRev: mine.rev, theirRev };
}

describe('enqueueConflict', () => {
  it('is idempotent on (type, id, winningRev): same input, one row', async () => {
    const input = { resourceType: 'patient', resourceId: 'p1', winningRev: '3-x', losingRevs: ['3-y'], orgId: 'org-a' };
    const a = await enqueueConflict(input);
    const b = await enqueueConflict(input);
    expect(a._id).toBe(b._id);
    expect(await listConflicts({ orgId: 'org-a', status: 'pending' })).toHaveLength(1);
  });

  it('a different winning revision is a different row', async () => {
    const base = { resourceType: 'patient', resourceId: 'p1', losingRevs: [], orgId: 'org-a' };
    await enqueueConflict({ ...base, winningRev: '3-x' });
    await enqueueConflict({ ...base, winningRev: '4-x' });
    expect(await listConflicts({ orgId: 'org-a' })).toHaveLength(2);
  });
});

describe('HIGH_RISK_RESOURCES', () => {
  const real = new Set(Object.values(DATABASE_DOCUMENT_TYPES).flat());
  it('contains only real document types', () => {
    expect([...HIGH_RISK_RESOURCES].filter(t => !real.has(t))).toEqual([]);
  });
  it.each(['billing', 'payment', 'medical_record', 'clinical_note', 'charge', 'appointment', 'problem'])('%s is high risk', t => {
    expect(HIGH_RISK_RESOURCES.has(t)).toBe(true);
  });
});

describe('listConflicts tenant scoping', () => {
  it('never treats a missing org as all orgs', async () => {
    await enqueueConflict({ resourceType: 'patient', resourceId: 'p1', winningRev: '2-a', losingRevs: [], orgId: 'org-a' });
    await enqueueConflict({ resourceType: 'patient', resourceId: 'p2', winningRev: '2-a', losingRevs: [], orgId: 'org-b' });
    expect(await listConflicts({})).toEqual([]);
    expect(await listConflicts({ orgId: 'org-a' })).toHaveLength(1);
    expect(await listConflicts({ superAdmin: true })).toHaveLength(2);
  });
});

describe('resolveConflict', () => {
  const resolver = { username: 'admin', chosenRev: '' };

  it('refuses another organization and leaves the row pending', async () => {
    const row = await enqueueConflict({ resourceType: 'patient', resourceId: 'doc-1', winningRev: '2-a', losingRevs: [], orgId: 'org-a' });
    const r = await resolveConflict(row._id, { ...resolver, chosenRev: '2-a' }, { orgId: 'org-b' });
    expect(r).toMatchObject({ ok: false, error: 'not_found' });
    const d = await dismissConflict(row._id, {}, { orgId: 'org-b' });
    expect(d).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('choosing the losing branch makes its content the winner and closes the rest', async () => {
    const { db, head, mineRev, theirRev } = await makeConflict('tamamhealth_patients', 'patient');
    const loser = head._rev === mineRev ? theirRev : mineRev;
    const wantedValue = loser === mineRev ? 'mine' : 'theirs';
    const row = await enqueueConflict({ resourceType: 'patient', resourceId: 'doc-1', winningRev: head._rev, losingRevs: head._conflicts ?? [], orgId: 'org-a' });
    const r = await resolveConflict(row._id, { ...resolver, chosenRev: loser }, { orgId: 'org-a' });
    expect(r.ok).toBe(true);
    const after = await db.get('doc-1', { conflicts: true }) as unknown as { value: string; _conflicts?: string[] };
    expect(after.value).toBe(wantedValue);
    expect(after._conflicts ?? []).toEqual([]);
    expect((await listConflicts({ orgId: 'org-a', status: 'resolved' }))).toHaveLength(1);
  });

  it('choosing the current winner just closes the losing branches', async () => {
    const { db, head } = await makeConflict('tamamhealth_patients', 'patient');
    const row = await enqueueConflict({ resourceType: 'patient', resourceId: 'doc-1', winningRev: head._rev, losingRevs: head._conflicts ?? [], orgId: 'org-a' });
    const r = await resolveConflict(row._id, { ...resolver, chosenRev: head._rev }, { orgId: 'org-a' });
    expect(r.ok).toBe(true);
    const after = await db.get('doc-1', { conflicts: true }) as unknown as { value: string; _conflicts?: string[] };
    expect(after.value).toBe(head.value);
    expect(after._conflicts ?? []).toEqual([]);
  });

  it('a revision that is not live is refused and the row stays pending', async () => {
    await makeConflict('tamamhealth_patients', 'patient');
    const row = await enqueueConflict({ resourceType: 'patient', resourceId: 'doc-1', winningRev: '2-zz', losingRevs: [], orgId: 'org-a' });
    const r = await resolveConflict(row._id, { ...resolver, chosenRev: '9-nope' }, { orgId: 'org-a' });
    expect(r).toMatchObject({ ok: false, error: 'invalid_rev' });
    expect(await listConflicts({ orgId: 'org-a', status: 'pending' })).toHaveLength(1);
  });

  it('retained records get the chosen content as a new revision and no deletions', async () => {
    const { db, head, mineRev, theirRev } = await makeConflict('tamamhealth_messages', 'message');
    const loser = head._rev === mineRev ? theirRev : mineRev;
    const wantedValue = loser === mineRev ? 'mine' : 'theirs';
    const row = await enqueueConflict({ resourceType: 'message', resourceId: 'doc-1', winningRev: head._rev, losingRevs: head._conflicts ?? [], orgId: 'org-a' });
    const r = await resolveConflict(row._id, { ...resolver, chosenRev: loser }, { orgId: 'org-a' });
    expect(r.ok).toBe(true);
    const after = await db.get('doc-1', { conflicts: true }) as unknown as { value: string; _conflicts?: string[] };
    expect(after.value).toBe(wantedValue);
    // The competing branch is still live: nothing was destroyed.
    expect((after._conflicts ?? []).length).toBeGreaterThan(0);
  });

  it('append-only types return an explicit error and stay pending', async () => {
    await makeConflict('tamamhealth_controlled_substance_log', 'controlled_substance_log');
    const row = await enqueueConflict({ resourceType: 'controlled_substance_log', resourceId: 'doc-1', winningRev: '2-a', losingRevs: [], orgId: 'org-a' });
    const r = await resolveConflict(row._id, { ...resolver, chosenRev: '2-a' }, { orgId: 'org-a' });
    expect(r).toMatchObject({ ok: false, error: 'unsupported' });
    expect(await listConflicts({ orgId: 'org-a', status: 'pending' })).toHaveLength(1);
  });

  it('an already-closed row cannot be resolved twice', async () => {
    const row = await enqueueConflict({ resourceType: 'patient', resourceId: 'nope', winningRev: '2-a', losingRevs: [], orgId: 'org-a' });
    await dismissConflict(row._id, {}, { orgId: 'org-a' });
    const r = await resolveConflict(row._id, { ...resolver, chosenRev: '2-a' }, { orgId: 'org-a' });
    expect(r).toMatchObject({ ok: false, error: 'already_closed' });
  });
});

describe('resolveConflict hardening', () => {
  const resolver = { username: 'admin', chosenRev: '' };

  it('is re-entrant: a retry after the chosen branch was already closed finishes the job', async () => {
    const { db, head, mineRev, theirRev } = await makeConflict('tamamhealth_patients', 'patient');
    const loser = head._rev === mineRev ? theirRev : mineRev;
    const row = await enqueueConflict({ resourceType: 'patient', resourceId: 'doc-1', winningRev: head._rev, losingRevs: head._conflicts ?? [], orgId: 'org-a' });
    // Fail the queue-row close on the first attempt: document writes all landed.
    const qdb = openDB('tamamhealth_conflict_queue');
    const realPut = qdb.put.bind(qdb);
    let calls = 0;
    jest.spyOn(qdb, 'put').mockImplementation((async (d: { status?: string }, ...rest: unknown[]) => {
      if (d.status === 'resolved' && calls++ === 0) throw new Error('disk');
      return (realPut as (...a: unknown[]) => unknown)(d, ...rest);
    }) as never);
    const first = await resolveConflict(row._id, { ...resolver, chosenRev: loser }, { orgId: 'org-a' });
    expect(first).toMatchObject({ ok: false, error: 'failed' });
    const second = await resolveConflict(row._id, { ...resolver, chosenRev: loser }, { orgId: 'org-a' });
    expect(second.ok).toBe(true);
    expect(await listConflicts({ orgId: 'org-a', status: 'resolved' })).toHaveLength(1);
    const after = await db.get('doc-1', { conflicts: true }) as unknown as { _conflicts?: string[] };
    expect(after._conflicts ?? []).toEqual([]);
  });

  it('a retained record resolved once is not re-enqueued by the next detection pass', async () => {
    const { db, head, mineRev, theirRev } = await makeConflict('tamamhealth_messages', 'message');
    const loser = head._rev === mineRev ? theirRev : mineRev;
    const row = await enqueueConflict({ resourceType: 'message', resourceId: 'doc-1', winningRev: head._rev, losingRevs: head._conflicts ?? [], orgId: 'org-a' });
    expect((await resolveConflict(row._id, { ...resolver, chosenRev: loser }, { orgId: 'org-a' })).ok).toBe(true);
    const after = await db.get('doc-1', { conflicts: true }) as unknown as { _rev: string; _conflicts?: string[] };
    expect(after._conflicts?.length).toBeGreaterThan(0); // branches remain, as designed
    await enqueueConflict({ resourceType: 'message', resourceId: 'doc-1', winningRev: after._rev, losingRevs: after._conflicts ?? [], orgId: 'org-a' });
    expect(await listConflicts({ orgId: 'org-a', status: 'pending' })).toHaveLength(0);
  });

  it('patient resolution keeps the head\'s portal* fields whatever branch is chosen', async () => {
    const db = openDB('tamamhealth_patients');
    const first = await db.put({ _id: 'doc-1', type: 'patient', orgId: 'org-a', value: 'base', portalSuspended: false, portalCredentialEpoch: 1, portalPasswordHash: 'OLD' });
    const mine = await db.put({ _id: 'doc-1', _rev: first.rev, type: 'patient', orgId: 'org-a', value: 'mine', portalSuspended: true, portalCredentialEpoch: 2, portalPasswordHash: 'NEW' });
    const theirRev = '2-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    await db.bulkDocs([{ _id: 'doc-1', _rev: theirRev, _revisions: { start: 2, ids: ['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', first.rev.split('-')[1]] }, type: 'patient', orgId: 'org-a', value: 'theirs', portalSuspended: false, portalCredentialEpoch: 1, portalPasswordHash: 'OLD' }], { new_edits: false });
    const head = await db.get('doc-1', { conflicts: true }) as unknown as { _rev: string; _conflicts?: string[]; portalPasswordHash: string };
    const loser = head._rev === mine.rev ? theirRev : mine.rev;
    const row = await enqueueConflict({ resourceType: 'patient', resourceId: 'doc-1', winningRev: head._rev, losingRevs: head._conflicts ?? [], orgId: 'org-a' });
    expect((await resolveConflict(row._id, { ...resolver, chosenRev: loser }, { orgId: 'org-a' })).ok).toBe(true);
    const after = await db.get('doc-1') as unknown as Record<string, unknown>;
    expect(after.value).toBe(loser === mine.rev ? 'mine' : 'theirs');
    expect(after.portalPasswordHash).toBe(head.portalPasswordHash);
    expect(after.portalCredentialEpoch).toBe(head.portalPasswordHash === 'NEW' ? 2 : 1);
  });

  it('refuses an unsigned branch over a signed medical record and leaves the row pending', async () => {
    const db = openDB('tamamhealth_medical_records');
    const first = await db.put({ _id: 'doc-1', type: 'medical_record', orgId: 'org-a', documentStatus: 'draft', value: 'base' });
    const signed = await db.put({ _id: 'doc-1', _rev: first.rev, type: 'medical_record', orgId: 'org-a', documentStatus: 'signed', value: 'signed' });
    const draftRev = '2-00000000000000000000000000000000';
    await db.bulkDocs([{ _id: 'doc-1', _rev: draftRev, _revisions: { start: 2, ids: ['00000000000000000000000000000000', first.rev.split('-')[1]] }, type: 'medical_record', orgId: 'org-a', documentStatus: 'draft', value: 'draft' }], { new_edits: false });
    const head = await db.get('doc-1', { conflicts: true }) as unknown as { _rev: string; _conflicts?: string[]; documentStatus: string };
    // The all-zero hash sorts lowest, so the signed revision is the head.
    expect(head._rev).toBe(signed.rev);
    const row = await enqueueConflict({ resourceType: 'medical_record', resourceId: 'doc-1', winningRev: head._rev, losingRevs: head._conflicts ?? [], orgId: 'org-a' });
    const r = await resolveConflict(row._id, { ...resolver, chosenRev: draftRev }, { orgId: 'org-a' });
    expect(r).toMatchObject({ ok: false, error: 'unsupported' });
    expect(await listConflicts({ orgId: 'org-a', status: 'pending' })).toHaveLength(1);
    expect((await db.get('doc-1') as unknown as { documentStatus: string }).documentStatus).toBe('signed');
  });
});
