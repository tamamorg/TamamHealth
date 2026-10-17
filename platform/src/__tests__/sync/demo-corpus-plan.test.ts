/**
 * Server-side demo corpus: planning rules, idempotency, and the property that
 * motivated it — a pharmacist's amend of a seeded prescription has a parent
 * revision the server knows.
 */
import PouchDB from 'pouchdb-browser';
import memoryAdapter from 'pouchdb-adapter-memory';
import {
  CLEANUP_EXCLUDED_DATABASES,
  corpusDatabases,
  planMissingDocs,
  planStaleDocs,
  type CorpusDoc,
} from '@/lib/demo-corpus-plan';
import { ORG_SCOPED_VALIDATE_FN } from '@/lib/sync/validate-doc-update';

PouchDB.plugin(memoryAdapter);

let counter = 0;
const fresh = () => new PouchDB(`demo-corpus-${Date.now()}-${counter++}`, { adapter: 'memory' });

const rx = (over: Record<string, unknown> = {}): CorpusDoc => ({
  _id: 'rx-wf-1', type: 'prescription', orgId: 'org-moh-ss', dataOrigin: 'demo_seed',
  patientId: 'pat-00001', medication: 'Paracetamol 500mg', status: 'pending',
  hospitalId: 'hosp-001', createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z',
  ...over,
});

describe('which databases receive the corpus', () => {
  it('never includes accounts or device-output logs', () => {
    const names = corpusDatabases();
    expect(names).toContain('tamamhealth_prescriptions');
    expect(names).not.toContain('tamamhealth_users');
    expect(names).not.toContain('tamamhealth_audit_log');
  });
});

describe('planMissingDocs', () => {
  it('creates only what the server lacks, without a local revision', () => {
    const corpus = [rx({ _id: 'a', _rev: '1-local' }), rx({ _id: 'b' }), rx({ _id: '_design/x' })];
    const plan = planMissingDocs(corpus, new Set(['b']));
    expect(plan.map(d => d._id)).toEqual(['a']);
    expect(plan[0]._rev).toBeUndefined();
  });

  it('is idempotent against a real database: the second pass writes nothing', async () => {
    const server = fresh();
    const corpus = [rx({ _id: 'a' }), rx({ _id: 'b' })];
    const known = async () => new Set((await server.changes({ since: 0 })).results.map(r => r.id));

    const first = planMissingDocs(corpus, await known());
    await server.bulkDocs(first);
    const revsAfterFirst = (await server.allDocs()).rows.map(r => r.value.rev);

    const second = planMissingDocs(corpus, await known());
    expect(second).toEqual([]);
    expect((await server.allDocs()).rows.map(r => r.value.rev)).toEqual(revsAfterFirst);
  });

  it('does not resurrect a document someone deleted on the server', async () => {
    const server = fresh();
    const put = await server.put(rx({ _id: 'gone' }) as PouchDB.Core.PutDocument<object>);
    await server.remove('gone', put.rev);
    const known = new Set((await server.changes({ since: 0 })).results.map(r => r.id));
    expect(planMissingDocs([rx({ _id: 'gone' })], known)).toEqual([]);
  });
});

describe('planStaleDocs', () => {
  it('removes only demo seed output the current seed no longer produces', () => {
    const server = [
      rx({ _id: 'kept' }),
      rx({ _id: 'drifted' }),
      rx({ _id: 'real-record', dataOrigin: undefined }),
      rx({ _id: '_design/org-scope' }),
    ];
    expect(planStaleDocs(server, new Set(['kept']))).toEqual(['drifted']);
  });

  it('leaves configuration databases to administrators', () => {
    expect(CLEANUP_EXCLUDED_DATABASES).toEqual(expect.arrayContaining(['tamamhealth_organizations', 'tamamhealth_hospitals']));
  });
});

describe('a pharmacist amends a seeded prescription', () => {
  const validate = new Function(`return (${ORG_SCOPED_VALIDATE_FN});`)() as (
    n: object, o: object | null, u: object, s?: object,
  ) => void;
  const pharmacist = { name: 'pharma.rose', roles: ['org:org-moh-ss', 'role:pharmacist'] };

  const verdict = (newDoc: object, oldDoc: object | null): string | null => {
    try { validate(newDoc, oldDoc, pharmacist, {}); return null; } catch (e) { return (e as { forbidden?: string }).forbidden ?? 'threw'; }
  };

  /** What CouchDB hands the validator for a replicated revision: the parent
   *  revision's body if the server has that revision, otherwise null. */
  async function oldDocSeenByServer(server: PouchDB.Database, device: PouchDB.Database, id: string) {
    const amended = await device.get(id, { revs: true });
    const { start, ids } = (amended as unknown as { _revisions: { start: number; ids: string[] } })._revisions;
    const parentRev = `${start - 1}-${ids[1]}`;
    try { return await server.get(id, { rev: parentRev }); } catch { return null; }
  }

  const amend = async (db: PouchDB.Database, id: string) => {
    const existing = await db.get(id);
    const next = { ...existing, orderStatus: 'cleared_for_dispensing', status: 'pending', updatedAt: new Date().toISOString() };
    await db.put(next);
    return next;
  };

  it('is accepted when the device holds the server-seeded revision (pulled)', async () => {
    const server = fresh();
    await server.bulkDocs(planMissingDocs([rx()], new Set()));
    // Pull: the device receives the server's revision history verbatim.
    const pulled = await server.get('rx-wf-1', { revs: true });
    const device = fresh();
    await device.bulkDocs([pulled], { new_edits: false });

    const amended = await amend(device, 'rx-wf-1');
    const old = await oldDocSeenByServer(server, device, 'rx-wf-1');
    expect(old).not.toBeNull();
    expect(verdict(amended, old)).toBeNull();
  });

  it('is refused as a create when the device seeded the document itself (the old behaviour)', async () => {
    const server = fresh();
    await server.bulkDocs(planMissingDocs([rx()], new Set()));
    // Another device's own seed run: same id, its own clock => its own rev 1.
    const device = fresh();
    await device.put(rx({ createdAt: '2026-10-17T09:00:00.000Z', updatedAt: '2026-10-17T09:00:00.000Z' }) as PouchDB.Core.PutDocument<object>);

    const amended = await amend(device, 'rx-wf-1');
    const old = await oldDocSeenByServer(server, device, 'rx-wf-1');
    expect(old).toBeNull();
    expect(verdict(amended, old)).toMatch(/role pharmacist may not write documents of type prescription/);
  });
});
