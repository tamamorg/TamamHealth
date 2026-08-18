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

// In-memory users DB shared with the module under test.
const store = new Map<string, Record<string, unknown>>();
let putFailure: Error | null = null;
const usersDB = () => ({
  async get(id: string) {
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

const BASE_ENV = process.env;

async function load(env: Record<string, string | undefined>) {
  jest.resetModules();
  store.clear();
  putFailure = null;
  process.env = {
    ...BASE_ENV,
    NEXT_PUBLIC_DEMO_MODE: 'false',
    SEED_CREDENTIALS_SECRET: 'jest-seed-secret-0123456789abcdef0123456789abcdef',
    ...env,
  };
  const mod = await import('@/lib/server-users');
  return mod;
}

afterAll(() => {
  process.env = BASE_ENV;
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
  });

  test('does not authenticate when the bootstrap account cannot be persisted', async () => {
    const { authenticateUser, UsersDbUnavailableError } = await load({});
    putFailure = new Error('couch write unavailable');
    await expect(authenticateUser('superadmin', 'Superadmin!')).rejects.toBeInstanceOf(UsersDbUnavailableError);
    expect(store.has('user-superadmin')).toBe(false);
  });
});
