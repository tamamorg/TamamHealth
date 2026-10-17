/**
 * @jest-environment node
 *
 * The stored user document is authoritative for privileges. A 30-day JWT must
 * not keep the role / org / facilities the account had when it signed in.
 */
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test';

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const getUserById = jest.fn();
jest.mock('@/modules/identity/services/user-service', () => ({ getUserById }));
jest.mock('@/lib/services/tenant-control-service', () => ({ isOrgAccessAllowed: jest.fn(async () => true) }));

import { NextRequest } from 'next/server';
import { createToken } from '@/modules/identity/core/auth-token';
import { getAuthPayload, hasRole } from '@/modules/identity/core/api-auth';
import { _resetTokenBlacklistForTest } from '@/modules/identity/core/token-blacklist';

let tmpDir: string;
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tamam-stale-'));
  process.env.TOKEN_BLACKLIST_FILE = path.join(tmpDir, '.bl.json');
  _resetTokenBlacklistForTest();
  getUserById.mockReset();
});
afterEach(async () => {
  _resetTokenBlacklistForTest();
  delete process.env.TOKEN_BLACKLIST_FILE;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const req = (token: string) => ({ cookies: { get: () => ({ value: token }) } }) as unknown as NextRequest;
const live = (over: Record<string, unknown>) => ({
  _id: 'u1', type: 'user', username: 'u1', name: 'U One', isActive: true,
  role: 'org_admin', orgId: 'org-a', hospitalId: 'h1', ...over,
});

describe('stale privileges', () => {
  it('a demoted user\'s old admin token no longer carries admin', async () => {
    const token = await createToken({ _id: 'u1', username: 'u1', name: 'U One', role: 'org_admin', orgId: 'org-a', hospitalId: 'h1' });
    getUserById.mockResolvedValue(live({ role: 'nurse' }));
    const auth = await getAuthPayload(req(token));
    expect(auth?.role).toBe('nurse');
    expect(hasRole(auth!, ['org_admin'])).toBe(false);
  });

  it('a user moved to another org / facility uses the live scope', async () => {
    const token = await createToken({ _id: 'u1', username: 'u1', name: 'U One', role: 'nurse', orgId: 'org-a', hospitalId: 'h1', facilityIds: ['h1', 'h2'] });
    getUserById.mockResolvedValue(live({ role: 'nurse', orgId: 'org-b', hospitalId: 'h9', facilityIds: ['h9'] }));
    const auth = await getAuthPayload(req(token));
    expect(auth).toMatchObject({ orgId: 'org-b', hospitalId: 'h9', facilityIds: ['h9'] });
  });

  it('super_admin impersonation keeps the borrowed identity while the account is still super_admin', async () => {
    const token = await createToken({ _id: 'u1', username: 'u1', name: 'U One', role: 'nurse', actualRole: 'super_admin', orgId: 'org-x', hospitalId: 'hx' });
    getUserById.mockResolvedValue(live({ role: 'super_admin', orgId: undefined, hospitalId: undefined }));
    const auth = await getAuthPayload(req(token));
    expect(auth).toMatchObject({ role: 'nurse', actualRole: 'super_admin', orgId: 'org-x', hospitalId: 'hx' });
  });

  it('impersonation ends if the account was demoted from super_admin', async () => {
    const token = await createToken({ _id: 'u1', username: 'u1', name: 'U One', role: 'nurse', actualRole: 'super_admin', orgId: 'org-x', hospitalId: 'hx' });
    getUserById.mockResolvedValue(live({ role: 'nurse', orgId: 'org-a', hospitalId: 'h1' }));
    const auth = await getAuthPayload(req(token));
    expect(auth?.actualRole).toBeUndefined();
    expect(auth).toMatchObject({ role: 'nurse', orgId: 'org-a' });
  });

  it('the synthetic bootstrap admin (no stored user) keeps its token claims', async () => {
    const token = await createToken({ _id: 'admin', username: 'admin', name: 'Admin', role: 'super_admin' });
    getUserById.mockResolvedValue(null);
    const auth = await getAuthPayload(req(token));
    expect(auth?.role).toBe('super_admin');
  });

  it('a deployment with no user store keeps its token claims', async () => {
    const token = await createToken({ _id: 'demo-1', username: 'demo', name: 'Demo', role: 'doctor', orgId: 'org-d', hospitalId: 'hd' });
    getUserById.mockResolvedValue(null);
    const auth = await getAuthPayload(req(token));
    expect(auth).toMatchObject({ role: 'doctor', orgId: 'org-d', hospitalId: 'hd' });
  });

  it('legacy nursing role names are canonicalised', async () => {
    const token = await createToken({ _id: 'u1', username: 'u1', name: 'U One', role: 'midwife', orgId: 'org-a' });
    getUserById.mockResolvedValue(live({ role: 'midwife', hospitalId: undefined }));
    const auth = await getAuthPayload(req(token));
    expect(auth?.role).toBe('nurse');
  });
});
