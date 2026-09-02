/**
 * The offlineSync metadata writers, and the two feedback loops they must not
 * re-enter. The metadata lives INSIDE the replicated document, so every mark
 * is itself a revision that replicates and comes back through the next
 * 'change' event:
 *
 *  - markDocsSynced used to re-mark on its own write (its skip compared
 *    lastSyncedRev to the rev it had just replaced, which never matches), and
 *  - markDocsConflicted re-stamped unconditionally while `_conflicts`
 *    existed, ping-ponging between devices.
 *
 * Together they drove seed patients to 4000+ revisions and kept every doc's
 * status at pending/conflict — the "Pending sync never clears while online"
 * bug. These tests pin the terminating conditions.
 */
import {
  healStaleOfflineMetadata,
  markDocsConflicted,
  markDocsSynced,
} from '@/lib/sync/offline-metadata';

type AnyDoc = Record<string, unknown>;

function fakeDb(docs: Record<string, AnyDoc>) {
  const put = jest.fn(async (doc: AnyDoc) => ({ ok: true, id: doc._id, rev: 'next' }));
  const bulkDocs = jest.fn(async (list: AnyDoc[]) => list.map(d => ({ ok: true, id: d._id })));
  const db = {
    get: jest.fn(async (id: string) => {
      const doc = docs[id];
      if (!doc) { const err = new Error('missing') as Error & { status: number }; err.status = 404; throw err; }
      return doc;
    }),
    put,
    bulkDocs,
    allDocs: jest.fn(async () => ({ rows: Object.values(docs).map(doc => ({ id: doc._id, doc })) })),
  };
  return { db: db as unknown as PouchDB.Database, put, bulkDocs };
}

describe('markDocsSynced', () => {
  it('flips a pending doc to synced', async () => {
    const { db, put } = fakeDb({
      d1: { _id: 'd1', _rev: '2-a', type: 'patient', offlineSync: { status: 'pending' } },
    });
    await markDocsSynced(db, [{ _id: 'd1', _rev: '2-a' }]);
    expect(put).toHaveBeenCalledTimes(1);
    const written = put.mock.calls[0][0] as AnyDoc;
    expect((written.offlineSync as AnyDoc).status).toBe('synced');
    expect((written.offlineSync as AnyDoc).lastSyncedRev).toBe('2-a');
  });

  it('THE LOOP: does not re-mark a doc that is already synced', async () => {
    // The push 'change' event for the metadata write itself lands here. Any
    // put in response starts an infinite mark → push → change → mark cycle.
    const { db, put } = fakeDb({
      d1: {
        _id: 'd1', _rev: '3-b', type: 'patient',
        // lastSyncedRev intentionally the PREVIOUS rev — exactly the state
        // the old rev-comparison skip failed on.
        offlineSync: { status: 'synced', lastSyncedRev: '2-a' },
      },
    });
    await markDocsSynced(db, [{ _id: 'd1', _rev: '3-b' }]);
    expect(put).not.toHaveBeenCalled();
  });

  it('leaves a doc with live sibling revisions to the conflict path', async () => {
    const { db, put } = fakeDb({
      d1: { _id: 'd1', _rev: '5-c', type: 'patient', _conflicts: ['4-x'], offlineSync: { status: 'pending' } },
    });
    await markDocsSynced(db, [{ _id: 'd1', _rev: '5-c' }]);
    expect(put).not.toHaveBeenCalled();
  });

  it('never touches design docs', async () => {
    const { db, put } = fakeDb({
      '_design/x': { _id: '_design/x', _rev: '1-a' },
    });
    await markDocsSynced(db, [{ _id: '_design/x', _rev: '1-a' }]);
    expect(put).not.toHaveBeenCalled();
  });
});

describe('markDocsConflicted', () => {
  it('stamps a conflicted doc once', async () => {
    const { db, put } = fakeDb({
      d1: { _id: 'd1', _rev: '6-a', type: 'patient', _conflicts: ['5-z'], offlineSync: { status: 'pending' } },
    });
    await markDocsConflicted(db, [{ _id: 'd1', _rev: '6-a' }]);
    expect(put).toHaveBeenCalledTimes(1);
    expect(((put.mock.calls[0][0] as AnyDoc).offlineSync as AnyDoc).status).toBe('conflict');
  });

  it('THE PING-PONG: does not re-stamp a doc already marked conflict', async () => {
    const { db, put } = fakeDb({
      d1: { _id: 'd1', _rev: '7-a', type: 'patient', _conflicts: ['5-z'], offlineSync: { status: 'conflict' } },
    });
    await markDocsConflicted(db, [{ _id: 'd1', _rev: '7-a' }]);
    expect(put).not.toHaveBeenCalled();
  });

  it('does nothing for a doc with no sibling revisions', async () => {
    const { db, put } = fakeDb({
      d1: { _id: 'd1', _rev: '2-a', type: 'patient', offlineSync: { status: 'pending' } },
    });
    await markDocsConflicted(db, [{ _id: 'd1', _rev: '2-a' }]);
    expect(put).not.toHaveBeenCalled();
  });
});

describe('healStaleOfflineMetadata', () => {
  it('flips stale pending/failed stamps to synced once push is caught up', async () => {
    const { db, bulkDocs } = fakeDb({
      stale: { _id: 'stale', _rev: '9-a', type: 'patient', offlineSync: { status: 'pending' } },
      failed: { _id: 'failed', _rev: '4-b', type: 'patient', offlineSync: { status: 'failed', error: 'x' } },
      fine: { _id: 'fine', _rev: '2-c', type: 'patient', offlineSync: { status: 'synced' } },
      unstamped: { _id: 'unstamped', _rev: '1-d', type: 'patient' },
    });
    const healed = await healStaleOfflineMetadata(db);
    expect(healed).toBe(2);
    const written = (bulkDocs.mock.calls[0][0] as AnyDoc[]).map(d => d._id).sort();
    expect(written).toEqual(['failed', 'stale']);
  });

  it('keeps (or gains) conflict status for docs with live sibling revisions', async () => {
    const { db, bulkDocs } = fakeDb({
      fighting: { _id: 'fighting', _rev: '8-a', type: 'patient', _conflicts: ['7-z'], offlineSync: { status: 'pending' } },
      already: { _id: 'already', _rev: '8-b', type: 'patient', _conflicts: ['7-y'], offlineSync: { status: 'conflict' } },
    });
    const healed = await healStaleOfflineMetadata(db);
    expect(healed).toBe(1);
    const written = bulkDocs.mock.calls[0][0] as AnyDoc[];
    expect(written[0]._id).toBe('fighting');
    expect((written[0].offlineSync as AnyDoc).status).toBe('conflict');
  });

  it('leaves docs the push filter excludes — their pending is the truth', async () => {
    const { db, bulkDocs } = fakeDb({
      mine: { _id: 'mine', _rev: '3-a', type: 'patient', offlineSync: { status: 'pending' } },
      notMine: { _id: 'notMine', _rev: '3-b', type: 'lab_result', offlineSync: { status: 'pending' } },
    });
    const healed = await healStaleOfflineMetadata(db, doc => doc.type === 'patient');
    expect(healed).toBe(1);
    expect((bulkDocs.mock.calls[0][0] as AnyDoc[])[0]._id).toBe('mine');
  });

  it('writes nothing when there is nothing to heal', async () => {
    const { db, bulkDocs } = fakeDb({
      fine: { _id: 'fine', _rev: '2-c', type: 'patient', offlineSync: { status: 'synced' } },
    });
    const healed = await healStaleOfflineMetadata(db);
    expect(healed).toBe(0);
    expect(bulkDocs).not.toHaveBeenCalled();
  });
});
