/**
 * Who plants the demo corpus.
 *
 * On a sync-enabled stack the browser must NOT seed (the server's copy,
 * written once by scripts/seed-demo-corpus.mjs, arrives by replication);
 * the standalone demo has no CouchDB and keeps seeding in the browser.
 */

export {};

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.resetModules();
  jest.dontMock('@/lib/db');
  jest.dontMock('@/lib/security/local-wipe');
});

/** `./db` where every accessor the seed would use fails loudly when touched. */
function mockDb(overrides: Record<string, unknown>) {
  jest.doMock('@/lib/db', () => new Proxy({}, {
    get: (_t, prop: string) => {
      if (prop === '__esModule') return true;
      if (prop in overrides) return overrides[prop];
      return () => { throw new Error(`seed touched ${prop}`); };
    },
  }));
}

function configure(env: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  jest.resetModules();
}

describe('seedComesFromServer', () => {
  test.each([
    ['demo + CouchDB configured', { NEXT_PUBLIC_DEMO_MODE: 'true', NEXT_PUBLIC_COUCHDB_URL: 'http://localhost:5984', NEXT_PUBLIC_SYNC_ENABLED: undefined }, true],
    ['standalone demo, sync switched off', { NEXT_PUBLIC_DEMO_MODE: 'true', NEXT_PUBLIC_COUCHDB_URL: 'http://localhost:5984', NEXT_PUBLIC_SYNC_ENABLED: 'false' }, false],
    ['standalone demo, no CouchDB URL', { NEXT_PUBLIC_DEMO_MODE: 'true', NEXT_PUBLIC_COUCHDB_URL: undefined, NEXT_PUBLIC_SYNC_ENABLED: undefined }, false],
    ['not a demo build', { NEXT_PUBLIC_DEMO_MODE: undefined, NEXT_PUBLIC_COUCHDB_URL: 'http://localhost:5984', NEXT_PUBLIC_SYNC_ENABLED: undefined }, false],
  ])('%s', async (_label, env, expected) => {
    configure(env);
    const { seedComesFromServer } = await import('@/lib/db-seed');
    expect(seedComesFromServer()).toBe(expected);
  });
});

describe('seedDatabase', () => {
  test('on a sync-enabled stack the browser plants nothing and adopts the server seed', async () => {
    configure({ NEXT_PUBLIC_DEMO_MODE: 'true', NEXT_PUBLIC_COUCHDB_URL: 'http://localhost:5984', NEXT_PUBLIC_SYNC_ENABLED: undefined });
    const markSeeded = jest.fn(async () => undefined);
    const wipeLocalData = jest.fn(async () => ({ wiped: [], kept: [], remaining: [], ok: true }));
    mockDb({ isSeeded: async () => false, markSeeded });
    jest.doMock('@/lib/security/local-wipe', () => ({ wipeLocalData }));

    const { seedDatabase } = await import('@/lib/db-seed');
    // Any database accessor the seed touched would throw "seed touched ...".
    await expect(seedDatabase()).resolves.toBeUndefined();
    expect(wipeLocalData).toHaveBeenCalledWith('seed-reset');
    expect(markSeeded).toHaveBeenCalledTimes(1);
  });

  test('an already-adopted device is left alone (no migrations re-put pulled documents)', async () => {
    configure({ NEXT_PUBLIC_DEMO_MODE: 'true', NEXT_PUBLIC_COUCHDB_URL: 'http://localhost:5984', NEXT_PUBLIC_SYNC_ENABLED: undefined });
    const markSeeded = jest.fn(async () => undefined);
    const wipeLocalData = jest.fn();
    mockDb({ isSeeded: async () => true, markSeeded });
    jest.doMock('@/lib/security/local-wipe', () => ({ wipeLocalData }));

    const { seedDatabase } = await import('@/lib/db-seed');
    await expect(seedDatabase()).resolves.toBeUndefined();
    expect(wipeLocalData).not.toHaveBeenCalled();
    expect(markSeeded).not.toHaveBeenCalled();
  });

  test('the standalone demo still seeds in the browser', async () => {
    configure({ NEXT_PUBLIC_DEMO_MODE: 'true', NEXT_PUBLIC_COUCHDB_URL: undefined, NEXT_PUBLIC_SYNC_ENABLED: undefined });
    const wipeLocalData = jest.fn();
    mockDb({ isSeeded: async () => false, isSeedInProgress: async () => false });
    jest.doMock('@/lib/security/local-wipe', () => ({ wipeLocalData }));

    const { seedDatabase } = await import('@/lib/db-seed');
    // It proceeds into the full seed, whose first act is to reset the stores.
    await expect(seedDatabase()).rejects.toThrow(/seed touched/);
    expect(wipeLocalData).not.toHaveBeenCalled();
  });
});
