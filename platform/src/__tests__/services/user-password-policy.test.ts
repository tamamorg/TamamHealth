/**
 * @jest-environment node
 *
 * Server-side password policy for admin-provisioned credentials
 * (lib/services/user-service.ts). The browser UIs generate strong temporary
 * passwords, but the service is the enforcement boundary: a direct API caller
 * must not be able to create or reset an account with a trivial password,
 * and every admin-set credential must be single-use (mustChangePassword).
 */

export {};

// In-memory users DB shared with the module under test. Function declaration
// (not const) so the hoisted jest.mock factory can reference it without a TDZ
// error when user-service's static import evaluates first.
const store = new Map<string, Record<string, unknown>>();
function usersDBMock() {
  return {
    async get(id: string) {
      if (store.has(id)) return { ...store.get(id)! };
      const err = new Error('missing') as Error & { status: number };
      err.status = 404;
      throw err;
    },
    async put(doc: Record<string, unknown>) {
      store.set(doc._id as string, { ...doc });
      return { ok: true, id: doc._id, rev: '1-x' };
    },
  };
}

jest.mock('@/lib/db', () => ({ usersDB: usersDBMock }));
jest.mock('@/lib/services/audit-service', () => ({ logAudit: jest.fn(async () => undefined) }));
// bcrypt with cost 12 is ~300ms per call — irrelevant to what these tests pin.
jest.mock('@/lib/auth', () => ({
  hashPassword: jest.fn(async (pw: string) => `hashed:${pw}`),
  verifyPassword: jest.fn(async (pw: string, hash: string) => hash === `hashed:${pw}`),
}));

import { createUser, resetPassword, changeOwnPassword, updateUser } from '@/lib/services/user-service';

beforeEach(() => store.clear());

describe('createUser password policy', () => {
  const base = { username: 'nurse.jane', name: 'Jane Poni', role: 'nurse' as const, hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital' };

  test('rejects passwords shorter than 8 characters', async () => {
    await expect(createUser({ ...base, password: 'short1' })).rejects.toThrow(/^Password must be at least 8/);
    expect(store.size).toBe(0);
  });

  test('accepts a valid temporary password and forces first-login change', async () => {
    const created = await createUser({ ...base, password: 'Kq7mHn2pWx4Z' });
    expect(created.mustChangePassword).toBe(true);
    expect(created.passwordUpdatedAt).toBeTruthy();
    expect(created.passwordHash).toBe('hashed:Kq7mHn2pWx4Z');
  });
});

describe('resetPassword policy', () => {
  test('rejects short passwords and leaves the account untouched', async () => {
    await createUser({ username: 'desk.amira', name: 'Amira Juma', role: 'front_desk', hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', password: 'Kq7mHn2pWx4Z' });
    await expect(resetPassword('user-desk.amira', 'tiny')).rejects.toThrow(/^Password must be at least 8/);
    expect((store.get('user-desk.amira') as { passwordHash: string }).passwordHash).toBe('hashed:Kq7mHn2pWx4Z');
  });

  test('a reset bumps the password epoch and re-arms the forced change', async () => {
    await createUser({ username: 'desk.amira', name: 'Amira Juma', role: 'front_desk', hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', password: 'Kq7mHn2pWx4Z' });
    const before = (store.get('user-desk.amira') as { passwordUpdatedAt: string }).passwordUpdatedAt;
    await new Promise(r => setTimeout(r, 5));
    await resetPassword('user-desk.amira', 'Fresh9Temp3Pw');
    const after = store.get('user-desk.amira') as { passwordUpdatedAt: string; mustChangePassword: boolean; passwordHash: string };
    expect(after.passwordHash).toBe('hashed:Fresh9Temp3Pw');
    expect(after.mustChangePassword).toBe(true);
    expect(Date.parse(after.passwordUpdatedAt)).toBeGreaterThan(Date.parse(before));
  });
});

describe('partial user updates', () => {
  test('does not erase identity fields whose update values are undefined', async () => {
    store.set('user-org.admin', {
      _id: 'user-org.admin', _rev: '1-a', type: 'user', username: 'org.admin',
      name: 'Organization Admin', role: 'org_admin', isActive: true,
    });

    const updated = await updateUser('user-org.admin', {
      name: undefined,
      role: undefined,
      orgId: 'org-a',
    });

    expect(updated).toEqual(expect.objectContaining({
      username: 'org.admin',
      name: 'Organization Admin',
      role: 'org_admin',
      orgId: 'org-a',
      isActive: true,
    }));
  });
});

describe('changeOwnPassword', () => {
  test('returns the updated document so the caller can re-mint the session with the new epoch', async () => {
    await createUser({ username: 'nurse.jane', name: 'Jane Poni', role: 'nurse', hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', password: 'Kq7mHn2pWx4Z' });
    const updated = await changeOwnPassword('user-nurse.jane', 'Kq7mHn2pWx4Z', 'MyOwn8Secret');
    expect(updated.mustChangePassword).toBe(false);
    expect(updated.passwordUpdatedAt).toBeTruthy();
    expect(updated.passwordHash).toBe('hashed:MyOwn8Secret');
  });
});
