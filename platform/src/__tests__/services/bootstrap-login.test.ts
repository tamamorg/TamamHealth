/**
 * @jest-environment node
 *
 * Production bootstrap login for the platform operator accounts
 * (src/lib/server-users.ts). A fresh production deploy has no user docs, so
 * the 'admin'/'superadmin' accounts must be able to sign in once against
 * their seed credential and get provisioned into the users DB — after which
 * the DB is authoritative and the seed credential can no longer shadow a
 * changed password.
 */

export {};

/**
 * bcrypt at cost 12 is deliberately expensive — that is the point of it — and
 * this suite runs a dozen hashes and comparisons. Jest's default 5s budget is
 * fine on an idle machine and not fine on a loaded CI runner sharing cores
 * with 90-odd other suites, where these tests time out non-deterministically.
 * The work is bounded and known; the default limit is what is wrong.
 */
jest.setTimeout(60_000);

// In-memory users DB shared with the module under test.
const store = new Map<string, Record<string, unknown>>();
let putFailure: Error | null = null;
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
    if (putFailure) throw putFailure;
    store.set(doc._id as string, doc);
    return { ok: true, id: doc._id, rev: '1-x' };
  },
});

jest.mock('@/lib/db', () => ({ usersDB }));

/**
 * Every environment variable this suite's behaviour depends on.
 *
 * Set and cleared EXPLICITLY per test rather than inherited from the ambient
 * environment. Jest runs several test files per worker process, and other
 * suites here swap `process.env` wholesale; one of them leaks
 * SUPERADMIN_INITIAL_PASSWORD, which silently overrides the seed password
 * these tests sign in with. Inheriting the ambient env made this file pass
 * alone and fail in a full parallel run, depending on which suite landed in
 * the same worker first.
 */
const MANAGED_KEYS = [
  'NEXT_PUBLIC_DEMO_MODE',
  'SEED_CREDENTIALS_SECRET',
  'SUPERADMIN_INITIAL_PASSWORD',
  'ADMIN_INITIAL_PASSWORD',
  // Ambient in a developer's .env; it adds two users-DB reads to a failed
  // sign-in, which the read-count assertions here would otherwise trip over.
  'SUPERADMIN_MASTER_PASSWORD',
] as const;

const ORIGINAL_ENV: Record<string, string | undefined> = Object.fromEntries(
  MANAGED_KEYS.map(k => [k, process.env[k]]),
);

/** Assign onto the live `process.env` — replacing the object breaks every
 *  other module in this worker that captured a reference to it. */
function applyEnv(next: Record<string, string | undefined>) {
  for (const key of MANAGED_KEYS) {
    const value = next[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function load(env: Record<string, string | undefined>) {
  jest.resetModules();
  store.clear();
  putFailure = null;
  getCalls = 0;
  applyEnv({
    NEXT_PUBLIC_DEMO_MODE: 'false',
    SEED_CREDENTIALS_SECRET: 'jest-seed-secret-0123456789abcdef0123456789abcdef',
    ...env,
  });
  const mod = await import('@/modules/identity/core/server-users');
  return mod;
}

afterAll(() => {
  applyEnv(ORIGINAL_ENV);
});

describe('production bootstrap login', () => {
  test('superadmin signs in with the initial password and is provisioned', async () => {
    const { authenticateUser } = await load({ SUPERADMIN_INITIAL_PASSWORD: undefined });
    const user = await authenticateUser('superadmin', 'Superadmin!');
    expect(user).not.toBeNull();
    expect(user!.role).toBe('super_admin');
    // The authoritative doc now exists.
    expect(store.has('user-superadmin')).toBe(true);
  });

  test('honours SUPERADMIN_INITIAL_PASSWORD override', async () => {
    const { authenticateUser } = await load({ SUPERADMIN_INITIAL_PASSWORD: 'Rotated#12345678' });
    expect(await authenticateUser('superadmin', 'Superadmin!')).toBeNull();
    expect(await authenticateUser('superadmin', 'Rotated#12345678')).not.toBeNull();
  });

  test('a wrong password never provisions a doc', async () => {
    const { authenticateUser } = await load({});
    expect(await authenticateUser('superadmin', 'not-the-password')).toBeNull();
    expect(store.has('user-superadmin')).toBe(false);
  });

  test('once the password is changed, the seed credential can no longer log in', async () => {
    const { authenticateUser } = await load({});
    // First login provisions the doc.
    await authenticateUser('superadmin', 'Superadmin!');
    // Simulate a password change: the doc now holds a different hash.
    const bcrypt = (await import('bcryptjs')).default;
    const changed = store.get('user-superadmin')!;
    changed.passwordHash = await bcrypt.hash('BrandNewPass!9', 12);
    store.set('user-superadmin', changed);
    // The old seed credential must be rejected (DB is authoritative; bootstrap
    // is skipped because a doc already exists).
    expect(await authenticateUser('superadmin', 'Superadmin!')).toBeNull();
    expect(await authenticateUser('superadmin', 'BrandNewPass!9')).not.toBeNull();
  });

  test('non-bootstrap usernames are never provisioned from a seed credential', async () => {
    const { authenticateUser } = await load({});
    expect(await authenticateUser('nurse.stella', 'whatever')).toBeNull();
    expect(store.size).toBe(0);
    expect(getCalls).toBe(1);
  });

  test('a wrong password for an existing user performs one DB read and one verifier', async () => {
    const { authenticateUser } = await load({});
    const bcrypt = (await import('bcryptjs')).default;
    store.set('user-desk.amira', {
      _id: 'user-desk.amira', type: 'user', username: 'desk.amira',
      name: 'Amira', role: 'front_desk', isActive: true,
      passwordHash: await bcrypt.hash('CorrectPass!9', 12),
    });
    getCalls = 0;

    await expect(authenticateUser('desk.amira', 'WrongPass!9')).resolves.toBeNull();
    expect(getCalls).toBe(1);
  });

  test('does not authenticate when the bootstrap account cannot be persisted', async () => {
    const { authenticateUser, UsersDbUnavailableError } = await load({});
    putFailure = new Error('couch write unavailable');
    await expect(authenticateUser('superadmin', 'Superadmin!')).rejects.toBeInstanceOf(UsersDbUnavailableError);
    expect(store.has('user-superadmin')).toBe(false);
  });
});
