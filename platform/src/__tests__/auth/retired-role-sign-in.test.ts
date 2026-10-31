/**
 * @jest-environment node
 *
 * Signing in is what converts an account off a retired role, so the session
 * and the stored document have to agree on the role it became. A dormant
 * account is the migration script's job; an active one relies on this.
 */

export {};

const store = new Map<string, Record<string, unknown>>();
const puts: Record<string, unknown>[] = [];
let refuseWrites = false;

const usersDB = () => ({
  async get(id: string) {
    if (store.has(id)) return store.get(id);
    const err = new Error('missing') as Error & { status: number };
    err.status = 404;
    throw err;
  },
  async put(doc: Record<string, unknown>) {
    if (refuseWrites) throw new Error('conflict');
    puts.push(doc);
    store.set(doc._id as string, doc);
    return { ok: true, id: doc._id, rev: '2-x' };
  },
});

jest.mock('@/lib/db', () => ({ usersDB }));

const PASSWORD = 'Own-Password-2026';

async function seed(role: string) {
  const bcrypt = (await import('bcryptjs')).default;
  store.set('user-probe', {
    _id: 'user-probe', _rev: '1-x', type: 'user', username: 'probe', name: 'Probe', role,
    passwordHash: await bcrypt.hash(PASSWORD, 4), isActive: true,
  });
}

beforeEach(() => {
  store.clear();
  puts.length = 0;
  refuseWrites = false;
  delete process.env.NEXT_PUBLIC_DEMO_MODE;
});

async function signIn(password = PASSWORD) {
  const { authenticateUser } = await import('@/modules/identity/core/server-users');
  return authenticateUser('probe', password);
}

describe('signing in on a retired role', () => {
  it.each([
    ['triage_nurse', 'nurse'],
    ['clinician', 'doctor'],
    ['records_hmis_officer', 'hrio'],
    ['clinic_clerk', 'front_desk'],
    ['central_registration_clerk', 'front_desk'],
  ])('%s becomes %s in the session and on the account', async (from, to) => {
    await seed(from);
    expect((await signIn())?.role).toBe(to);
    expect(store.get('user-probe')?.role).toBe(to);
  });

  it('does not rewrite an account on a current role', async () => {
    await seed('doctor');
    expect((await signIn())?.role).toBe('doctor');
    expect(puts).toHaveLength(0);
  });

  it('does not rewrite the account on a wrong password', async () => {
    await seed('clinic_clerk');
    await signIn('Wrong-Password-2026').catch(() => null);
    expect(store.get('user-probe')?.role).toBe('clinic_clerk');
  });

  it('still lets the user in when the rewrite loses a race', async () => {
    await seed('clinic_clerk');
    refuseWrites = true;
    expect((await signIn())?.role).toBe('front_desk');
    expect(store.get('user-probe')?.role).toBe('clinic_clerk');
  });
});
