/** @jest-environment node
 *
 * GET /api/crypto/org-key — who may receive which organisation's data key.
 * A member gets their own organisation's key only; platform accounts may ask
 * for any; every issue is audited and never cached.
 */
const actor: { sub: string; username: string; name: string; role: string; actualRole?: string; orgId?: string } = {
  sub: 'user-1', username: 'dr.one', name: 'Dr. One', role: 'doctor', orgId: 'org-a',
};
let signedIn = true;
jest.mock('@/modules/identity/core/api-auth', () => ({
  getAuthPayload: jest.fn(async () => (signedIn ? actor : null)),
  unauthorized: jest.fn(() => Response.json({ error: 'unauthorized' }, { status: 401 })),
  forbidden: jest.fn((error = 'forbidden') => Response.json({ error }, { status: 403 })),
  hasRole: jest.fn(() => true),
  serverError: jest.fn(() => Response.json({ error: 'Internal server error' }, { status: 500 })),
  logApiError: jest.fn(),
}));
const audit = jest.fn();
jest.mock('@/lib/services/audit-service', () => ({ logAuditSafe: (...args: unknown[]) => audit(...args) }));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/crypto/org-key/route';
import { deriveOrgKeyBytes } from '@/lib/org-data-cipher';

const get = (q = '') => GET(new NextRequest(`http://localhost/api/crypto/org-key${q}`));

beforeEach(() => {
  signedIn = true;
  Object.assign(actor, { role: 'doctor', actualRole: undefined, orgId: 'org-a' });
  audit.mockClear();
});

test('requires a session', async () => {
  signedIn = false;
  expect((await get()).status).toBe(401);
});

test("issues the member's own organisation key, uncached and audited", async () => {
  const res = await get();
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toMatch(/no-store/);
  const body = await res.json();
  expect(body.orgId).toBe('org-a');
  expect(Buffer.from(body.key, 'base64')).toEqual(Buffer.from(await deriveOrgKeyBytes('org-a')));
  expect(audit).toHaveBeenCalledWith('ORG_KEY_ISSUED', 'user-1', 'dr.one', expect.stringContaining('org-a'));
});

test("refuses another organisation's key to a member", async () => {
  expect((await get('?orgId=org-b')).status).toBe(403);
  expect((await get('?orgId=_platform')).status).toBe(403);
  expect(audit).not.toHaveBeenCalled();
});

test('a super-admin viewing the app as a doctor still has cross-organisation reach', async () => {
  Object.assign(actor, { role: 'doctor', actualRole: 'super_admin', orgId: undefined });
  expect((await get('?orgId=org-b')).status).toBe(200);
  expect((await get('?orgId=_platform')).status).toBe(200);
});

test('an account with no organisation gets the platform key as its own', async () => {
  Object.assign(actor, { orgId: undefined });
  const res = await get();
  expect((await res.json()).orgId).toBe('_platform');
});
