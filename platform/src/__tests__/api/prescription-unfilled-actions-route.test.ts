/** @jest-environment node
 *
 * PATCH /api/prescriptions/:id — the pharmacy's own outcomes (stock_out,
 * request_clarification) and a dispense from the wrong role.
 *
 * The route's write roles are broader than the pharmacy (a prescriber may
 * amend an order), but holding an order or recording a stock-out is the
 * pharmacist's act, and neither may be applied to an order that is already
 * closed.
 */
jest.mock('@/lib/audit/with-audit', () => ({
  AUDIT_ACTION_HEADER: 'x-audit-action',
  withAuditLog: (handler: (...args: unknown[]) => Promise<Response>) => handler,
}));

const actor: { sub: string; username: string; name: string; role: string; orgId?: string; hospitalId?: string } = {
  sub: 'user-actor', username: 'actor', name: 'Actor',
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

const rx = {
  _id: 'rx-1', type: 'prescription', patientId: 'pat-1', patientName: 'Test Patient',
  medication: 'Amoxicillin', status: 'pending', prescribedBy: 'Dr. A',
  hospitalId: 'hosp-001', orgId: 'org-moh-ss',
};
jest.mock('@/lib/services/prescription-service', () => ({
  getPrescriptionById: jest.fn(async () => rx),
}));
jest.mock('@/lib/services/data-scope', () => ({
  buildScopeFromAuth: jest.fn(() => ({})),
  filterByScope: jest.fn((rows: unknown[]) => rows),
}));

class FakeDispenseError extends Error {
  constructor(message: string, public readonly code: string) { super(message); this.name = 'DispenseError'; }
}
const recordUnfilled = jest.fn();
const dispenseMedication = jest.fn();
jest.mock('@/lib/services/dispensing-service', () => ({
  DispenseError: FakeDispenseError,
  recordUnfilled: (...args: unknown[]) => recordUnfilled(...args),
  dispenseMedication: (...args: unknown[]) => dispenseMedication(...args),
}));

import { NextRequest } from 'next/server';
import { PATCH } from '@/app/api/prescriptions/[id]/route';

const patch = (body: Record<string, unknown>) => PATCH(
  new NextRequest('https://app.example.org/api/prescriptions/rx-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
  { params: Promise.resolve({ id: 'rx-1' }) },
);

const ENV_KEYS = ['NEXT_PUBLIC_DEMO_MODE', 'COUCHDB_ADMIN_USER', 'COUCHDB_ADMIN_PASSWORD'] as const;
const ORIGINAL = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_DEMO_MODE;
  recordUnfilled.mockReset();
  dispenseMedication.mockReset();
  actor.role = 'pharmacist';
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ORIGINAL[k] === undefined) delete process.env[k]; else process.env[k] = ORIGINAL[k];
  }
});

describe('PATCH /api/prescriptions/:id pharmacy outcomes', () => {
  it.each(['stock_out', 'request_clarification'])('%s: a doctor is refused and nothing is written', async action => {
    actor.role = 'doctor';
    const res = await patch({ action, note: 'x' });
    expect(res.status).toBe(403);
    expect(recordUnfilled).not.toHaveBeenCalled();
  });

  it('a pharmacist records a stock-out', async () => {
    recordUnfilled.mockResolvedValue({ ...rx, orderStatus: 'stockout_partial_referred' });
    const res = await patch({ action: 'stock_out', note: 'None on the shelf' });
    expect(res.status).toBe(200);
    expect(recordUnfilled).toHaveBeenCalledWith(rx, 'stock_out', 'None on the shelf', { id: 'user-actor', name: 'Actor' });
  });

  it('answers 409 with the service message when the order is already closed', async () => {
    recordUnfilled.mockRejectedValue(new FakeDispenseError('This order is already closed, so it cannot be held.', 'NOT_CLEARED'));
    const res = await patch({ action: 'request_clarification', note: 'Query' });
    expect(res.status).toBe(409);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_CLEARED');
  });

  it('a dispense from a doctor is answered 403 (only a pharmacist dispenses)', async () => {
    actor.role = 'doctor';
    dispenseMedication.mockRejectedValue(new FakeDispenseError('Only a pharmacist may dispense medication.', 'NOT_AUTHORISED'));
    const res = await patch({ action: 'dispense', quantity: 1 });
    expect(res.status).toBe(403);
  });
});
