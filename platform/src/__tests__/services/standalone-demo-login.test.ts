/**
 * @jest-environment node
 *
 * Sign-in on the standalone demo deployment (src/lib/server-users.ts).
 *
 * The demo has no CouchDB and therefore no users database: there is no
 * document to read and no administrator to create one, so the seeded
 * credentials are the only way in. The branch that allows it is gated twice —
 * `NEXT_PUBLIC_DEMO_MODE` exactly 'true' AND no users database configured —
 * because an earlier single-flag version failed OPEN: a container that never
 * promoted the build argument to an `ENV` would have accepted three dozen
 * seeded credentials on a production server. These tests hold both halves of
 * that gate, and the demo path's shape (no hash handed back, no forced
 * password change nothing can persist).
 */

export {};

// bcrypt at cost 12 is deliberately expensive; a loaded CI runner needs more
// than Jest's default 5s for a suite that hashes a dozen times.
jest.setTimeout(60_000);

// In-memory users DB shared with the module under test. Every id is missing,
// which is what a deployment with no seeded accounts looks like.
const store = new Map<string, Record<string, unknown>>();
let getCalls = 0;
const usersDB = () => ({
  async get(id: string) {
    getCalls++;
    if (store.has(id)) return store.get(id);
    const err = new Error('missing') as Error & { status: number };
    err.status = 404;
    throw err;
  },
  async put(doc: Record<string, unknown>) {
    store.set(doc._id as string, doc);
    return { ok: true, id: doc._id, rev: '1-x' };
  },
});

jest.mock('@/lib/db', () => ({ usersDB }));

/** Every environment variable this suite's behaviour depends on. Set and
 *  cleared EXPLICITLY per test — other suites in the same worker swap
 *  process.env wholesale, and an inherited SUPERADMIN_INITIAL_PASSWORD or a
 *  stray COUCHDB_USER silently changes the answer. */
const MANAGED_KEYS = [
  'NEXT_PUBLIC_DEMO_MODE',
  'SEED_CREDENTIALS_SECRET',
  'SUPERADMIN_INITIAL_PASSWORD',
  'ADMIN_INITIAL_PASSWORD',
  'COUCHDB_ADMIN_USER',
  'COUCHDB_ADMIN_PASSWORD',
  'COUCHDB_USER',
  'COUCHDB_PASSWORD',
] as const;

const ORIGINAL_ENV: Record<string, string | undefined> = Object.fromEntries(
  MANAGED_KEYS.map(k => [k, process.env[k]]),
);

function applyEnv(next: Record<string, string | undefined>) {
  for (const key of MANAGED_KEYS) {
    const value = next[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/** Load the module under test with a known environment. Defaults describe the
 *  standalone demo: demo mode on, no CouchDB credentials anywhere. */
async function load(env: Record<string, string | undefined> = {}) {
  jest.resetModules();
  store.clear();
  getCalls = 0;
  applyEnv({
    NEXT_PUBLIC_DEMO_MODE: 'true',
    SEED_CREDENTIALS_SECRET: 'jest-seed-secret-0123456789abcdef0123456789abcdef',
    ...env,
  });
  const serverUsers = await import('@/modules/identity/core/server-users');
  const { getOrCreateSeedCredentials } = await import('@/modules/identity/core/seed-credentials');
  const { passwords } = await getOrCreateSeedCredentials();
  return { ...serverUsers, passwords };
}

afterAll(() => {
  applyEnv(ORIGINAL_ENV);
});

describe('standalone demo sign-in', () => {
  test('a seeded staff account signs in against the seed credential', async () => {
    const { authenticateUser, passwords } = await load();
    const user = await authenticateUser('nurse.stella', passwords['nurse.stella']);
    expect(user).not.toBeNull();
    expect(user!.role).toBe('nurse');
    expect(user!.hospitalId).toBe('hosp-003');
    // No users database was consulted — there isn't one.
    expect(getCalls).toBe(0);
  });

  test('superadmin signs in with the documented demo password', async () => {
    const { authenticateUser } = await load({ SUPERADMIN_INITIAL_PASSWORD: undefined });
    const user = await authenticateUser('superadmin', 'Superadmin!');
    expect(user).not.toBeNull();
    expect(user!.role).toBe('super_admin');
  });

  test('the session it returns carries no hash and forces no password change', async () => {
    const { authenticateUser, passwords } = await load();
    const user = await authenticateUser('dr.wani', passwords['dr.wani']);
    // Nothing can persist a change here, so a forced change would dead-end the
    // first sign-in; and the caller has no use for a hash.
    expect(user!.mustChangePassword).toBe(false);
    expect(user!.passwordHash).toBe('');
  });

  test('a wrong password is rejected', async () => {
    const { authenticateUser } = await load();
    expect(await authenticateUser('nurse.stella', 'not-the-password')).toBeNull();
  });

  test('a username outside the seeded roster is rejected', async () => {
    const { authenticateUser, passwords } = await load();
    expect(await authenticateUser('mallory', passwords['nurse.stella'])).toBeNull();
  });
});

describe('the gate that keeps this off real deployments', () => {
  test('a deployment WITH a users database never accepts a seed credential', async () => {
    const { authenticateUser, isStandaloneDemo, passwords } = await load({
      // The flag is set — wrongly, or inherited from a demo build — but this
      // server has somewhere to look users up, so the demo path stays shut.
      COUCHDB_ADMIN_USER: 'admin',
      COUCHDB_ADMIN_PASSWORD: 'couch-secret',
    });
    expect(isStandaloneDemo()).toBe(false);
    expect(await authenticateUser('nurse.stella', passwords['nurse.stella'])).toBeNull();
    // It went to the users database instead, which is the whole point.
    expect(getCalls).toBe(1);
  });

  test('COUCHDB_USER / COUCHDB_PASSWORD close the gate just as well', async () => {
    const { isStandaloneDemo } = await load({
      COUCHDB_USER: 'admin',
      COUCHDB_PASSWORD: 'couch-secret',
    });
    expect(isStandaloneDemo()).toBe(false);
  });

  test('an unset flag is not a demo — the value must be exactly "true"', async () => {
    // The password a real demo would accept, derived from the same secret
    // every load below uses. Read it while the roster still exists: with the
    // flag off, the credential map narrows to the bootstrap accounts.
    const { passwords } = await load();
    const seeded = passwords['nurse.stella'];
    expect(seeded).toBeTruthy();

    for (const flag of [undefined, 'false', 'TRUE', '1', 'yes']) {
      const { authenticateUser, isStandaloneDemo } = await load({
        NEXT_PUBLIC_DEMO_MODE: flag,
      });
      expect(isStandaloneDemo()).toBe(false);
      expect(await authenticateUser('nurse.stella', seeded)).toBeNull();
    }
  });

  test('both halves together are what opens it', async () => {
    const { isStandaloneDemo } = await load();
    expect(isStandaloneDemo()).toBe(true);
  });
});
