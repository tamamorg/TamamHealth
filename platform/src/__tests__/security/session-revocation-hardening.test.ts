/**
 * @jest-environment node
 *
 * PR #258 review follow-ups: shared-store failures surface on logout-all,
 * revocation lookups are one round trip, and the user-wide cutoff follows the
 * session start (`sat`) so a renewal minted after it is still revoked.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SignJWT } from 'jose';
import { resolveJwtSecret } from '@/modules/identity/core/jwt-secret';

const upstashPipeline = jest.fn();
jest.mock('@/lib/upstash', () => ({
  getUpstashConfig: jest.fn(() => ({ url: 'https://x', token: 't' })),
  upstashPipeline: (...a: unknown[]) => upstashPipeline(...a),
  withRetry: async (fn: () => Promise<unknown>) => fn(),
  hashKey: async (k: string) => `h(${k})`,
}));
jest.mock('@/lib/services/audit-service', () => ({ logAuditSafe: jest.fn(async () => undefined) }));
jest.mock('@/lib/services/tenant-control-service', () => ({ isOrgAccessAllowed: jest.fn(async () => true) }));
jest.mock('@/modules/identity/services/user-service', () => ({
  getUserById: jest.fn(async () => ({ _id: 'u1', username: 'u', role: 'nurse', name: 'U', type: 'user', isActive: true })),
}));
jest.mock('@/lib/rate-limit', () => ({
  rateLimit: jest.fn(async () => ({ allowed: true, resetAt: 0, remaining: 10 })),
}));

import { NextRequest } from 'next/server';
import { getUpstashConfig } from '@/lib/upstash';
import {
  isTokenRevoked, revokeUserSessions, revokeSession, _resetTokenBlacklistForTest,
} from '@/modules/identity/core/token-blacklist';
import { createToken } from '@/modules/identity/core/auth-token';
import { POST as logoutAll } from '@/app/api/auth/logout-all/route';

let tmpDir: string;
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tamam-hard-'));
  process.env.TOKEN_BLACKLIST_FILE = path.join(tmpDir, '.bl.json');
  _resetTokenBlacklistForTest();
  upstashPipeline.mockReset();
  (getUpstashConfig as jest.Mock).mockReturnValue({ url: 'https://x', token: 't' });
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(async () => {
  jest.restoreAllMocks();
  _resetTokenBlacklistForTest();
  delete process.env.TOKEN_BLACKLIST_FILE;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const USER = { _id: 'u1', username: 'u', role: 'nurse', name: 'U' };

describe('shared-store failure on sign out everywhere', () => {
  it('revokeUserSessions and revokeSession throw when the shared write fails', async () => {
    upstashPipeline.mockRejectedValue(new Error('upstash down'));
    await expect(revokeUserSessions('u1')).rejects.toThrow();
    await expect(revokeSession('sid-1')).rejects.toThrow();
  });

  it('logout-all returns 503 and not success', async () => {
    const token = await createToken(USER);
    upstashPipeline.mockImplementation(async (_c: unknown, cmds: string[][]) => {
      if (cmds[0][0] === 'SET') throw new Error('upstash down');
      return cmds.map(() => ({ result: null }));
    });
    const res = await logoutAll(new NextRequest('http://localhost/api/auth/logout-all', {
      method: 'POST', headers: { cookie: `tamamhealth-token=${token}` },
    }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('Sessions not signed out. Try again.');
  });

  it('does not throw when no shared store is configured (local only)', async () => {
    (getUpstashConfig as jest.Mock).mockReturnValue(null);
    await expect(revokeUserSessions('u1')).resolves.toBeUndefined();
  });
});

describe('one round trip per lookup', () => {
  it('batches token, sid and user checks into a single pipeline call', async () => {
    const token = await createToken(USER);
    upstashPipeline.mockResolvedValue([{ result: null }, { result: null }, { result: null }]);
    expect(await isTokenRevoked(token)).toBe(false);
    expect(upstashPipeline).toHaveBeenCalledTimes(1);
    expect(upstashPipeline.mock.calls[0][1]).toHaveLength(3);
  });
});

describe('cutoff follows the session start', () => {
  it('revokes a renewal minted after the cutoff when its session began before it', async () => {
    (getUpstashConfig as jest.Mock).mockReturnValue(null);
    const now = Math.floor(Date.now() / 1000);
    await revokeUserSessions('u1'); // cutoff = now
    const secret = new TextEncoder().encode(resolveJwtSecret());
    const mint = (sat: number | undefined, iat: number) =>
      new SignJWT({ sub: 'u1', sid: 's', ...(sat !== undefined ? { sat } : {}) })
        .setProtectedHeader({ alg: 'HS256' }).setIssuedAt(iat).sign(secret);
    // Renewal after the cutoff, session started before it: revoked.
    expect(await isTokenRevoked(await mint(now - 3600, now + 5))).toBe(true);
    // Fresh sign-in after the cutoff: unaffected.
    expect(await isTokenRevoked(await mint(now + 5, now + 5))).toBe(false);
  });
});
