/** @jest-environment node
 *
 * GET /api/users on a standalone demo deployment (NEXT_PUBLIC_DEMO_MODE=true,
 * no CouchDB admin credentials — see `isStandaloneDemo`).
 *
 * Before this fix, `getAllUsers` → `usersDB()` threw "Server-side CouchDB
 * access requires COUCHDB_ADMIN_USER…" the moment anything asked this route
 * for the staff directory, and the route turned that into a bare 500
 * "Internal server error" — which is what made pharmacy's "Review & clear"
 * fail (its pharmacist-actor check falls back to this endpoint) and the
 * org-admin dashboard tiles say "Needs attention" on any CouchDB-less server.
 * The route now answers from the same seeded roster every browser on this
 * deployment already carries locally, scoped exactly like a real roster.
 *
 * `@/modules/identity/services/user-service`, `@/lib/services/data-scope` and
 * `@/modules/identity/core/server-users` / `seed-credentials` are left
 * UNMOCKED on purpose — the scoping and redaction behaviour under test is
 * real, not stubbed.
 */
jest.mock('@/lib/audit/with-audit', () => ({
  AUDIT_ACTION_HEADER: 'x-audit-action',
  withAuditLog: (handler: (...args: unknown[]) => Promise<Response>) => handler,
}));

const actor: { sub: string; username: string; name: string; role: string; orgId?: string; hospitalId?: string } = {
  sub: 'user-desk.amira', username: 'desk.amira', name: 'Amira Juma Hassan',
  role: 'front_desk', orgId: 'org-moh-ss', hospitalId: 'hosp-001',
};
jest.mock('@/modules/identity/core/api-auth', () => ({
  getAuthPayload: jest.fn(async () => actor),
  unauthorized: jest.fn(() => Response.json({ error: 'unauthorized' }, { status: 401 })),
  forbidden: jest.fn((error = 'forbidden') => Response.json({ error }, { status: 403 })),
  hasRole: jest.fn((auth: { role: string }, roles: string[]) => roles.includes(auth.role)),
  serverError: jest.fn(() => Response.json({ error: 'Internal server error' }, { status: 500 })),
  logApiError: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/users/route';

const MANAGED_KEYS = [
  'NEXT_PUBLIC_DEMO_MODE', 'COUCHDB_ADMIN_USER', 'COUCHDB_ADMIN_PASSWORD',
  'COUCHDB_USER', 'COUCHDB_PASSWORD',
] as const;
const ORIGINAL_ENV: Record<string, string | undefined> = Object.fromEntries(
  MANAGED_KEYS.map(k => [k, process.env[k]]),
);
function applyEnv(next: Partial<Record<typeof MANAGED_KEYS[number], string | undefined>>) {
  for (const key of MANAGED_KEYS) {
    const value = next[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const get = () => GET(new NextRequest('https://app.example.org/api/users'));

afterEach(() => {
  applyEnv(ORIGINAL_ENV);
});

describe('GET /api/users on a standalone demo server', () => {
  it('returns the seeded roster instead of 500ing when there is no users database', async () => {
    applyEnv({ NEXT_PUBLIC_DEMO_MODE: 'true' });

    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json() as { users: Array<Record<string, unknown>> };
    expect(body.users.length).toBeGreaterThan(0);

    const pharmacist = body.users.find(u => u.username === 'pharma.rose');
    expect(pharmacist).toBeDefined();
    expect(pharmacist!.role).toBe('pharmacist');
    // Redacted like any other roster read — never a credential in the body.
    expect(pharmacist).not.toHaveProperty('passwordHash');
  });

  it('scopes the demo roster to the caller facility, same as a real roster', async () => {
    applyEnv({ NEXT_PUBLIC_DEMO_MODE: 'true' });

    const res = await get();
    const body = await res.json() as { users: Array<Record<string, unknown>> };
    const usernames = body.users.map(u => u.username);

    // Same hospital as the actor (hosp-001, org-moh-ss) — visible.
    expect(usernames).toContain('pharma.rose');
    expect(usernames).toContain('dr.wani');
    // A different facility in the same org — not visible to a facility-scoped actor.
    expect(usernames).not.toContain('dr.wau');
    // A different organisation entirely (Mercy) — not visible.
    expect(usernames).not.toContain('dr.mercy');
    // National roles carry no hospitalId and must never appear as facility staff.
    expect(usernames).not.toContain('superadmin');
    expect(usernames).not.toContain('admin');
  });

  it('answers 503 "User directory unavailable", not a bare 500, when CouchDB is configured-but-unreachable', async () => {
    // Demo mode OFF: isStandaloneDemo() is false regardless of CouchDB creds,
    // so this exercises the ordinary (non-demo) path, which still has no
    // CouchDB configured in this test process. The route must not fabricate
    // a directory here (this is not the standalone-demo deployment), but it
    // must also give callers a distinguishable outage response instead of
    // the generic 500 that used to be indistinguishable from a route bug.
    applyEnv({ NEXT_PUBLIC_DEMO_MODE: 'false' });

    const res = await get();
    expect(res.status).toBe(503);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('User directory unavailable');
  });
});
