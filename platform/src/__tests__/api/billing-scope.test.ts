/**
 * /api/billing POST `record_payment` and `waive` used to load a bill by a
 * client-supplied billId and mutate it with NO tenant scope check — the same
 * cross-tenant shape fixed in /api/referrals and /api/appointments. A cashier
 * in org A could pay down or waive any org B bill by id. Out-of-scope now
 * resolves to 404 (not 403), so the response does not confirm the bill exists.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.mock('@/lib/api-auth', () => {
  const actual = jest.requireActual('@/lib/api-auth');
  return {
    ...actual,
    getAuthPayload: jest.fn(),
  };
});
// See referral-appointment-scope.test.ts for why next/server needs undici's
// spec-compliant fetch classes swapped in before it first loads.
jest.mock('next/server', () => {
   
  const { ReadableStream, WritableStream, TransformStream } = require('node:stream/web');
   
  const { MessageChannel, MessagePort } = require('node:worker_threads');
  Object.assign(globalThis, { ReadableStream, WritableStream, TransformStream, MessageChannel, MessagePort });
   
  const undici = require('undici');
  Object.assign(globalThis, {
    Response: undici.Response,
    Request: undici.Request,
    Headers: undici.Headers,
    fetch: undici.fetch,
  });
  return jest.requireActual('next/server');
});

// Route-handler tests do real request plumbing plus PouchDB seeding per case;
// the 5s default flakes on a loaded machine.
jest.setTimeout(30000);

import type { NextRequest } from 'next/server';
import { teardownTestDBs } from '../helpers/test-db';
import { getAuthPayload, type AuthPayload } from '@/lib/api-auth';
import { createBill, getBillById } from '@/lib/services/billing-service';
import { POST as billingPOST } from '@/app/api/billing/route';

const mockGetAuth = getAuthPayload as jest.MockedFunction<typeof getAuthPayload>;

function cashierIn(orgId: string, hospitalId: string): AuthPayload {
  return { sub: 'user-cashier', username: 'cashier', role: 'cashier', name: 'Cash Ier', orgId, hospitalId };
}

function postRequest(body: unknown): NextRequest {
  return new Request('http://test/api/billing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

async function seedBill(orgId: string, facilityId: string) {
  return createBill({
    patientId: 'pat-1', patientName: 'Test Patient',
    facilityId, facilityName: 'Facility', facilityLevel: 'clinic',
    encounterDate: '2026-08-08',
    items: [{ id: 'li-1', category: 'consultation', description: 'Consult', quantity: 1, unitPrice: 100, totalPrice: 100 } as never],
    generatedBy: 'user-x', generatedByName: 'X', state: 'CES',
    orgId,
  });
}

afterEach(async () => {
  await teardownTestDBs();
  uuidCounter = 0;
  jest.clearAllMocks();
});

describe('/api/billing record_payment / waive scope guard', () => {
  test('getBillById hides a bill outside the caller tenant', async () => {
    const bill = await seedBill('org-b', 'hosp-b1');
    const scope = { role: 'cashier' as const, orgId: 'org-a', hospitalId: 'hosp-a1' };
    expect(await getBillById(bill._id, scope)).toBeNull();
    expect((await getBillById(bill._id, { ...scope, orgId: 'org-b', hospitalId: 'hosp-b1' }))?._id).toBe(bill._id);
  });

  test('a cashier cannot record a payment against another org bill', async () => {
    const bill = await seedBill('org-b', 'hosp-b1');
    mockGetAuth.mockResolvedValue(cashierIn('org-a', 'hosp-a1'));

    const res = await billingPOST(postRequest({
      action: 'record_payment', billId: bill._id, amount: 100, method: 'cash',
    }));

    expect(res.status).toBe(404);
    const after = await getBillById(bill._id);
    expect(after?.amountPaid ?? 0).toBe(0);
    expect(after?.status).toBe(bill.status);
  });

  test('a cashier cannot waive another org bill', async () => {
    const bill = await seedBill('org-b', 'hosp-b1');
    mockGetAuth.mockResolvedValue(cashierIn('org-a', 'hosp-a1'));

    const res = await billingPOST(postRequest({
      action: 'waive', billId: bill._id, reason: 'Hardship',
    }));

    expect(res.status).toBe(404);
    expect((await getBillById(bill._id))?.status).toBe(bill.status);
  });

  test('a cashier in the owning org can still record a payment', async () => {
    const bill = await seedBill('org-a', 'hosp-a1');
    mockGetAuth.mockResolvedValue(cashierIn('org-a', 'hosp-a1'));

    const res = await billingPOST(postRequest({
      action: 'record_payment', billId: bill._id, amount: 100, method: 'cash',
    }));

    expect(res.status).toBe(200);
    const after = await getBillById(bill._id);
    expect(after?.amountPaid).toBe(100);
  });
});
