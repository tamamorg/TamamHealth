/** @jest-environment node
 *
 * PATCH /api/prescriptions/:id on a standalone demo deployment
 * (NEXT_PUBLIC_DEMO_MODE=true, no CouchDB admin credentials — see
 * `isStandaloneDemo`).
 *
 * Before this fix, `getPrescriptionById` → `prescriptionsDB().get(id)` always
 * missed on a standalone demo server — every prescription lives only in the
 * browser's own PouchDB, nothing server-side ever has it — so this route
 * answered a bare 404 "Prescription not found" for every id, no matter how
 * valid. That is indistinguishable from a caller passing a bad id, and it is
 * what made "Counsel & dispense" toast "Prescription not found" and leave the
 * modal open for pharma.rose (`usePrescriptions.dispense` used to route this
 * call online whenever `navigator.onLine`, blind to whether the server it was
 * calling had anything to answer with).
 *
 * The route now recognises the deployment shape up front and answers a clear
 * 409 instead of pretending the id doesn't exist. `usePrescriptions.dispense`
 * is fixed separately to never take this path on this deployment at all —
 * see `standalone-demo-dispense.test.ts` — so this route path is now a
 * defence-in-depth answer for a stale tab or a direct API caller, not the
 * happy path.
 *
 * `@/modules/identity/core/server-users` is left UNMOCKED on purpose — the
 * `isStandaloneDemo()` gate under test is real, not stubbed.
 */
jest.mock('@/lib/audit/with-audit', () => ({
  AUDIT_ACTION_HEADER: 'x-audit-action',
  withAuditLog: (handler: (...args: unknown[]) => Promise<Response>) => handler,
}));

const actor: { sub: string; username: string; name: string; role: string; orgId?: string; hospitalId?: string } = {
  sub: 'user-pharma-rose', username: 'pharma.rose', name: 'Rose Pharmacist',
  role: 'pharmacist', orgId: 'org-moh-ss', hospitalId: 'hosp-001',
};
jest.mock('@/modules/identity/core/api-auth', () => ({
  getAuthPayload: jest.fn(async () => actor),
  unauthorized: jest.fn(() => Response.json({ error: 'unauthorized' }, { status: 401 })),
  forbidden: jest.fn((error = 'forbidden') => Response.json({ error }, { status: 403 })),
  hasRole: jest.fn((auth: { role: string }, roles: string[]) => roles.includes(auth.role)),
  serverError: jest.fn(() => Response.json({ error: 'Internal server error' }, { status: 500 })),
  logApiError: jest.fn(),
}));

// getPrescriptionById would hit prescriptionsDB() (pouchdb-browser, which
// references `self` and cannot load in this Node test environment) if the
// standalone-demo gate under test failed to short-circuit before reaching
// it. Fail loudly instead of letting a broken gate surface as an unrelated
// module-load crash.
jest.mock('@/lib/services/prescription-service', () => ({
  getPrescriptionById: jest.fn(() => {
    throw new Error('getPrescriptionById must not be called on a standalone demo server');
  }),
}));

import { NextRequest } from 'next/server';
import { PATCH } from '@/app/api/prescriptions/[id]/route';

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

const patch = (id: string, body: Record<string, unknown>) => PATCH(
  new NextRequest(`https://app.example.org/api/prescriptions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
  { params: Promise.resolve({ id }) },
);

afterEach(() => {
  applyEnv(ORIGINAL_ENV);
});

describe('PATCH /api/prescriptions/:id on a standalone demo server', () => {
  it('answers 409 with a clear message instead of a misleading 404', async () => {
    applyEnv({ NEXT_PUBLIC_DEMO_MODE: 'true' });

    const res = await patch('rx-does-not-matter', { action: 'dispense', quantity: 1 });
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/keeps prescriptions on the device/i);
    expect(body.error).not.toMatch(/not found/i);
  });

  it('still requires a write role before revealing the deployment shape', async () => {
    applyEnv({ NEXT_PUBLIC_DEMO_MODE: 'true' });
    actor.role = 'front_desk';
    try {
      const res = await patch('rx-does-not-matter', { action: 'dispense', quantity: 1 });
      expect(res.status).toBe(403);
    } finally {
      actor.role = 'pharmacist';
    }
  });
});
