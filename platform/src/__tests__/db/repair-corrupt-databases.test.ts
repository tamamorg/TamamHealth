/**
 * The boot-time repair for zero-store IndexedDB corpses.
 *
 * The failure it ends: an interrupted create/delete leaves a database that
 * EXISTS with no object stores; PouchDB's upgrade transaction aborts on it,
 * `listLocalDatabases()` keeps re-listing it by name, and every consumer of
 * that list (wipe check, dirty check, sync manager) re-opens the corpse —
 * observed as a dashboard stuck on "Loading facility data…" indefinitely.
 *
 * The full IndexedDB behaviour is exercised in the browser; what a unit test
 * can pin is the contract that makes the repair safe to run at every boot.
 */

import { repairCorruptLocalDatabases } from '@/lib/db';

describe('repairCorruptLocalDatabases', () => {
  it('is a silent no-op where IndexedDB (or databases()) is unavailable', async () => {
    // jsdom has no indexedDB.databases — exactly the Firefox situation, where
    // enumeration is impossible and the repair must do nothing rather than
    // throw during boot.
    await expect(repairCorruptLocalDatabases()).resolves.toEqual([]);
  });

  it('never rejects — a repair that crashes boot is worse than the corruption', async () => {
    const g = globalThis as { indexedDB?: unknown };
    const prev = g.indexedDB;
    g.indexedDB = { databases: () => { throw new Error('enumeration exploded'); } };
    try {
      await expect(repairCorruptLocalDatabases()).resolves.toEqual([]);
    } finally {
      if (prev === undefined) delete g.indexedDB; else g.indexedDB = prev;
    }
  });
});
