/**
 * The local wipe has to satisfy two demands that pull against each other.
 *
 * A tablet must not keep a ward's charts after the session that opened them
 * ends — and a clinic that has been offline all morning must not lose the
 * morning's work to a security sweep. So the rule under test is: destroy what
 * the server already has, keep what only this device has.
 *
 * These tests drive the real module against in-memory PouchDB; only the
 * `@/lib/db` accessor layer is substituted.
 */
import PouchDB from 'pouchdb-browser';
import memoryAdapter from 'pouchdb-adapter-memory';

PouchDB.plugin(memoryAdapter);

const NAMES = ['tamamhealth_patients', 'tamamhealth_lab_results'] as const;

const live: Record<string, PouchDB.Database> = {};
/** Names whose destroy() should fail, simulating a held IndexedDB handle. */
const blocked = new Set<string>();

function openDB(name: string): PouchDB.Database {
  if (!live[name]) live[name] = new PouchDB(name, { adapter: 'memory' });
  return live[name];
}

jest.mock('@/lib/db', () => ({
  LOCAL_DATABASE_NAMES: ['tamamhealth_patients', 'tamamhealth_lab_results'],
  getDB: (name: string) => openDB(name),
  destroyLocalDatabase: async (name: string) => {
    if (blocked.has(name)) throw new Error('blocked by an open connection');
    if (live[name]) {
      await live[name].destroy();
      delete live[name];
    }
  },
}));

import {
  completePendingWipe,
  enforceDeviceUser,
  getDirtyDatabases,
  getPendingWipe,
  recordSyncedSequences,
  wipeLocalData,
} from '@/lib/security/local-wipe';

/** True when the database still holds documents (i.e. survived a wipe). */
async function stillHasData(name: string): Promise<boolean> {
  const info = await openDB(name).info();
  return info.doc_count > 0;
}

beforeEach(async () => {
  window.localStorage.clear();
  blocked.clear();
  for (const name of Object.keys(live)) {
    try {
      await live[name].destroy();
    } catch {
      // already gone
    }
    delete live[name];
  }
});

describe('local wipe — what it removes', () => {
  it('destroys databases whose contents already reached the server', async () => {
    await openDB('tamamhealth_patients').put({ _id: 'pat-1', name: 'Mary Lado' });
    await openDB('tamamhealth_lab_results').put({ _id: 'lab-1', result: 'negative' });
    // Sync completed here: everything on disk is also on the server.
    await recordSyncedSequences();

    const result = await wipeLocalData('logout');

    expect(result.ok).toBe(true);
    expect(result.kept).toEqual([]);
    expect(result.wiped).toEqual(expect.arrayContaining([...NAMES]));
    expect(await stillHasData('tamamhealth_patients')).toBe(false);
    expect(await stillHasData('tamamhealth_lab_results')).toBe(false);
  });

  it('keeps a database written to after the last successful sync', async () => {
    await openDB('tamamhealth_patients').put({ _id: 'pat-1', name: 'Mary Lado' });
    await recordSyncedSequences();
    // The clinic goes offline and registers a patient the server has never seen.
    await openDB('tamamhealth_patients').put({ _id: 'pat-2', name: 'Deng Garang' });

    expect(await getDirtyDatabases()).toContain('tamamhealth_patients');

    const result = await wipeLocalData('session-expired');

    expect(result.kept).toContain('tamamhealth_patients');
    expect(result.wiped).not.toContain('tamamhealth_patients');
    expect(await stillHasData('tamamhealth_patients')).toBe(true);
  });

  it('treats a never-synced database with documents as unsafe to delete', async () => {
    await openDB('tamamhealth_patients').put({ _id: 'pat-1', name: 'Mary Lado' });
    // No recordSyncedSequences() — sync has never completed on this device.

    const result = await wipeLocalData('logout');

    expect(result.kept).toContain('tamamhealth_patients');
    expect(await stillHasData('tamamhealth_patients')).toBe(true);
  });

  it('force skips the safety check, for callers that own the decision', async () => {
    await openDB('tamamhealth_patients').put({ _id: 'pat-1', name: 'Mary Lado' });

    const result = await wipeLocalData('logout', { force: true });

    expect(result.kept).toEqual([]);
    expect(await stillHasData('tamamhealth_patients')).toBe(false);
  });
});

describe('local wipe — when the browser refuses to delete', () => {
  it('reports what survived instead of reporting success', async () => {
    await openDB('tamamhealth_patients').put({ _id: 'pat-1', name: 'Mary Lado' });
    await recordSyncedSequences();
    blocked.add('tamamhealth_patients');

    const result = await wipeLocalData('logout');

    expect(result.ok).toBe(false);
    expect(result.remaining).toContain('tamamhealth_patients');
    expect(getPendingWipe()?.databases).toContain('tamamhealth_patients');
  });

  it('finishes the job on the next boot', async () => {
    await openDB('tamamhealth_patients').put({ _id: 'pat-1', name: 'Mary Lado' });
    await recordSyncedSequences();
    blocked.add('tamamhealth_patients');
    await wipeLocalData('logout');

    // Next launch: whatever held the handle is gone.
    blocked.clear();
    const followUp = await completePendingWipe();

    expect(followUp?.ok).toBe(true);
    expect(await stillHasData('tamamhealth_patients')).toBe(false);
    expect(getPendingWipe()).toBeNull();
  });
});

describe('device handover', () => {
  it('does not wipe when the same person signs back in', async () => {
    await openDB('tamamhealth_patients').put({ _id: 'pat-1', name: 'Mary Lado' });
    await recordSyncedSequences();

    expect(await enforceDeviceUser('user-amira')).toBeNull();
    const second = await enforceDeviceUser('user-amira');

    expect(second).toBeNull();
    expect(await stillHasData('tamamhealth_patients')).toBe(true);
  });

  it('clears the previous user before the next one starts work', async () => {
    await enforceDeviceUser('user-amira');
    await openDB('tamamhealth_patients').put({ _id: 'pat-1', name: 'Mary Lado' });
    await recordSyncedSequences();

    const handover = await enforceDeviceUser('user-peter');

    expect(handover?.wiped).toContain('tamamhealth_patients');
    expect(await stillHasData('tamamhealth_patients')).toBe(false);
  });

  it('still tells two users apart without Web Crypto', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      await enforceDeviceUser('aaa');
      await openDB('tamamhealth_patients').put({ _id: 'pat-1', name: 'Mary Lado' });
      await recordSyncedSequences();

      // Same length as 'aaa' — the earlier length-based fallback saw these as
      // the same clinician and left the ward on the device.
      const handover = await enforceDeviceUser('bbb');

      expect(handover?.wiped).toContain('tamamhealth_patients');
    } finally {
      if (original) Object.defineProperty(globalThis, 'crypto', original);
    }
  });
});
