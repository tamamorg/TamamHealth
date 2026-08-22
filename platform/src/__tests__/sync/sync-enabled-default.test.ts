/**
 * Replication is on unless somebody stopped it.
 *
 * The rule used to be `NEXT_PUBLIC_SYNC_ENABLED === 'true'`, so the easiest
 * state to be in — unset — meant no replication at all, and nothing on screen
 * said so: writes land in the browser's PouchDB and look saved while the
 * server never sees them. The symptom that finally named it was a facility
 * registered on a device and then refused by /api/users ("has not reached the
 * server yet"), because the server reads CouchDB and the facility was never
 * going to arrive.
 *
 * These pin the inversion, and the two states that still stop sync.
 */

const ORIGINAL = { ...process.env };

async function loadRule() {
  jest.resetModules();
  const mod = await import('@/lib/sync/sync-config');
  return mod.syncFlagAllowsSync;
}

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('sync is on by default', () => {
  test('an unset flag replicates, as long as there is somewhere to replicate to', async () => {
    process.env.NEXT_PUBLIC_COUCHDB_URL = 'http://localhost:5984';
    delete process.env.NEXT_PUBLIC_SYNC_ENABLED;
    expect((await loadRule())()).toBe(true);
  });

  test('an explicit true still replicates', async () => {
    process.env.NEXT_PUBLIC_COUCHDB_URL = 'http://localhost:5984';
    process.env.NEXT_PUBLIC_SYNC_ENABLED = 'true';
    expect((await loadRule())()).toBe(true);
  });

  test('the stop switch stops it', async () => {
    // The standalone seeded demo runs this way on purpose.
    process.env.NEXT_PUBLIC_COUCHDB_URL = 'http://localhost:5984';
    process.env.NEXT_PUBLIC_SYNC_ENABLED = 'false';
    expect((await loadRule())()).toBe(false);
  });

  test('no CouchDB URL means no replication, whatever the flag says', async () => {
    delete process.env.NEXT_PUBLIC_COUCHDB_URL;
    delete process.env.NEXT_PUBLIC_SYNC_ENABLED;
    expect((await loadRule())()).toBe(false);

    process.env.NEXT_PUBLIC_SYNC_ENABLED = 'true';
    expect((await loadRule())()).toBe(false);
  });
});
