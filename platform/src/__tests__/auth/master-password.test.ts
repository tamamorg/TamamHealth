/**
 * @jest-environment node
 *
 * The dev walkthrough's break-glass key: with SUPERADMIN_MASTER_PASSWORD=true
 * on a non-production server, the platform operator's own password signs in as
 * any account (`authenticateWithMasterPassword` in server-users.ts).
 *
 * It is a master key, so the tests that matter most are the ones proving it is
 * OFF. This module has been here before: a demo branch keyed on a single flag
 * that failed open would have accepted three dozen seeded credentials on a
 * production server with the variable simply unset (commit 40407a14). Both
 * locks are asserted independently below, and both are asserted to fail
 * CLOSED — unset, empty, mis-cased, or production, the key does not turn.
 */

export {};

// bcrypt at cost 12 is deliberately slow, and this suite runs a dozen of them.
jest.setTimeout(60_000);

const store = new Map<string, Record<string, unknown>>();
const usersDB = () => ({
  async get(id: string) {
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

/** Set explicitly per test — other suites in this worker swap process.env. */
const MANAGED_KEYS = [
  'NEXT_PUBLIC_DEMO_MODE',
  'SEED_CREDENTIALS_SECRET',
  'SUPERADMIN_INITIAL_PASSWORD',
  'ADMIN_INITIAL_PASSWORD',
  'SUPERADMIN_MASTER_PASSWORD',
  'NODE_ENV',
] as const;

const ORIGINAL_ENV: Record<string, string | undefined> = Object.fromEntries(
  MANAGED_KEYS.map(k => [k, process.env[k]]),
);

function applyEnv(next: Record<string, string | undefined>) {
  // Assign onto the live object — replacing it breaks every module in this
  // worker that captured a reference. Cast because @types/node declares
  // NODE_ENV readonly, and swapping it is exactly what one of these tests is
  // for: proving the branch is dead in a production build.
  const env = process.env as Record<string, string | undefined>;
  for (const key of MANAGED_KEYS) {
    const value = next[key];
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
}

const OPERATOR_PASSWORD = 'Operator-Master-2026';
const NURSE_PASSWORD = 'Nurse-Own-Password-9';

async function seed() {
  const bcrypt = (await import('bcryptjs')).default;
  store.clear();
  store.set('user-superadmin', {
    _id: 'user-superadmin',
    type: 'user',
    username: 'superadmin',
    name: 'Platform Admin',
    role: 'super_admin',
    isActive: true,
    passwordHash: await bcrypt.hash(OPERATOR_PASSWORD, 12),
  });
  store.set('user-nurse.grace', {
    _id: 'user-nurse.grace',
    type: 'user',
    username: 'nurse.grace',
    name: 'Grace Akol',
    role: 'nurse',
    hospitalId: 'hospital-juba',
    orgId: 'org-moh',
    isActive: true,
    passwordHash: await bcrypt.hash(NURSE_PASSWORD, 12),
  });
}

async function load(env: Record<string, string | undefined>) {
  jest.resetModules();
  await seed();
  applyEnv({
    NEXT_PUBLIC_DEMO_MODE: 'false',
    SEED_CREDENTIALS_SECRET: 'jest-seed-secret-0123456789abcdef0123456789abcdef',
    NODE_ENV: 'test',
    ...env,
  });
  return import('@/modules/identity/core/server-users');
}

afterAll(() => {
  applyEnv(ORIGINAL_ENV);
});

describe('superadmin master password — enabled', () => {
  test("opens another account with the operator's password", async () => {
    const { authenticateUser } = await load({ SUPERADMIN_MASTER_PASSWORD: 'true' });
    const user = await authenticateUser('nurse.grace', OPERATOR_PASSWORD);
    expect(user).not.toBeNull();
    // The session is the TARGET's, not the operator's — that is the whole
    // point: you are looking at the nurse's workspace, as the nurse.
    expect(user!.username).toBe('nurse.grace');
    expect(user!.role).toBe('nurse');
    expect(user!.hospitalId).toBe('hospital-juba');
  });

  test("the account's own password still works", async () => {
    const { authenticateUser } = await load({ SUPERADMIN_MASTER_PASSWORD: 'true' });
    const user = await authenticateUser('nurse.grace', NURSE_PASSWORD);
    expect(user!.username).toBe('nurse.grace');
  });

  test('a wrong password is still refused', async () => {
    const { authenticateUser } = await load({ SUPERADMIN_MASTER_PASSWORD: 'true' });
    expect(await authenticateUser('nurse.grace', 'neither-password')).toBeNull();
  });

  test('a disabled account stays disabled', async () => {
    const { authenticateUser } = await load({ SUPERADMIN_MASTER_PASSWORD: 'true' });
    const doc = store.get('user-nurse.grace')!;
    doc.isActive = false;
    store.set('user-nurse.grace', doc);
    expect(await authenticateUser('nurse.grace', OPERATOR_PASSWORD)).toBeNull();
  });

  test('an account that does not exist is not conjured into one', async () => {
    const { authenticateUser } = await load({ SUPERADMIN_MASTER_PASSWORD: 'true' });
    expect(await authenticateUser('nurse.nobody', OPERATOR_PASSWORD)).toBeNull();
    expect(store.has('user-nurse.nobody')).toBe(false);
  });

  test('rotating the operator password rotates the master key', async () => {
    const { authenticateUser } = await load({ SUPERADMIN_MASTER_PASSWORD: 'true' });
    const bcrypt = (await import('bcryptjs')).default;
    const operator = store.get('user-superadmin')!;
    operator.passwordHash = await bcrypt.hash('Rotated-Operator-1', 12);
    store.set('user-superadmin', operator);

    expect(await authenticateUser('nurse.grace', OPERATOR_PASSWORD)).toBeNull();
    expect(await authenticateUser('nurse.grace', 'Rotated-Operator-1')).not.toBeNull();
  });
});

describe('superadmin master password — off unless both locks say on', () => {
  test.each([
    ['unset', undefined],
    ['empty', ''],
    ["the string 'false'", 'false'],
    ['mis-cased TRUE', 'TRUE'],
    ['truthy-looking 1', '1'],
  ])('refuses when the flag is %s', async (_label, value) => {
    const { authenticateUser } = await load({ SUPERADMIN_MASTER_PASSWORD: value });
    expect(await authenticateUser('nurse.grace', OPERATOR_PASSWORD)).toBeNull();
    // The account's own password is unaffected by the flag being off.
    expect(await authenticateUser('nurse.grace', NURSE_PASSWORD)).not.toBeNull();
  });

  test('refuses in production even with the flag set', async () => {
    const { authenticateUser } = await load({
      SUPERADMIN_MASTER_PASSWORD: 'true',
      NODE_ENV: 'production',
    });
    expect(await authenticateUser('nurse.grace', OPERATOR_PASSWORD)).toBeNull();
    expect(await authenticateUser('nurse.grace', NURSE_PASSWORD)).not.toBeNull();
  });
});
