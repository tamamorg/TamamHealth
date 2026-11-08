/**
 * A payment taken against one billing line settles that visit's bill first, so
 * the bill and the chart's line agree. Without an aim, oldest first still holds.
 */
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { getDB } from '@/lib/db';
import { applyDiscount, getBillById, settleOpenBillsWithPayment } from '@/lib/services/billing-service';
import type { DataScope } from '@/lib/services/data-scope';

const scope = { orgId: 'org-a', hospitalId: 'h-a', role: 'org_admin' } as DataScope;
const bill = (id: string, createdAt: string, encounterId: string) => putDoc(getDB('tamamhealth_billing'), {
  _id: id, type: 'billing', orgId: 'org-a', facilityId: 'h-a', patientId: 'p1', encounterId, createdAt, updatedAt: createdAt,
  status: 'pending', items: [], payments: [], totalAmount: 100, subtotal: 100, discount: 0, taxAmount: 0, amountPaid: 0, balanceDue: 100, currency: 'SSP',
} as never);
const pay = (paymentId: string, amount: number, aimedAt?: { encounterId?: string; billId?: string }) => settleOpenBillsWithPayment({
  patientId: 'p1', amount, currency: 'SSP', method: 'cash', receivedBy: 'u', receivedByName: 'U', paymentId, aimedAt, scope,
});

beforeEach(async () => {
  await bill('bill-old', '2026-01-01T00:00:00.000Z', 'enc-old');
  await bill('bill-new', '2026-02-01T00:00:00.000Z', 'enc-new');
});
afterEach(async () => { await teardownTestDBs(); });

describe('settleOpenBillsWithPayment', () => {
  test('pays the oldest bill when nothing is aimed at', async () => {
    await pay('pay-1', 100);
    expect((await getBillById('bill-old', scope))?.status).toBe('paid');
    expect((await getBillById('bill-new', scope))?.status).toBe('pending');
  });

  test('pays the visit it was aimed at first', async () => {
    await pay('pay-1', 100, { encounterId: 'enc-new' });
    expect((await getBillById('bill-new', scope))?.status).toBe('paid');
    expect((await getBillById('bill-old', scope))?.status).toBe('pending');
  });

  test('finds the aimed bill by id, then spills what is left to the oldest', async () => {
    await pay('pay-1', 150, { billId: 'bill-new' });
    expect((await getBillById('bill-new', scope))?.status).toBe('paid');
    expect((await getBillById('bill-old', scope))?.balanceDue).toBe(50);
  });
});

describe('applyDiscount', () => {
  const discount = (id: string, amount: number) => applyDiscount(id, amount, 'Indigent patient', 'u', 'U');
  // A bill with a real line, so the totals are recomputed from items as in the app.
  beforeEach(async () => {
    const db = getDB('tamamhealth_billing');
    const doc = await db.get('bill-old') as Record<string, unknown>;
    await db.put({ ...doc, taxRate: 0, items: [{ id: 'i1', description: 'Consultation', category: 'consultation', quantity: 1, unitPrice: 100, totalPrice: 100 }] });
  });

  test('takes a discount off what is still owed', async () => {
    const result = await discount('bill-old', 40);
    expect(result?.balanceDue).toBe(60);
  });

  test('refuses a discount that would go below what was already paid', async () => {
    await pay('pay-1', 60, { billId: 'bill-old' });
    expect(await discount('bill-old', 60)).toBeNull();
    expect((await getBillById('bill-old', scope))?.discount).toBe(0);
    // Up to the unpaid remainder is still allowed, and settles the bill.
    expect((await discount('bill-old', 40))?.status).toBe('paid');
  });

  // Review 2026-11-08: the remaining paths around the new floor.
  test('a discount can be taken back to zero', async () => {
    await discount('bill-old', 20);
    const reset = await discount('bill-old', 0);
    expect(reset?.discount).toBe(0);
    expect(reset?.balanceDue).toBe(100);
  });

  test('payments carrying float dust do not refuse a discount that settles the bill exactly', async () => {
    await pay('pay-1', 33.1, { billId: 'bill-old' });
    await pay('pay-2', 33.2, { billId: 'bill-old' });
    await pay('pay-3', 33.4, { billId: 'bill-old' });
    expect((await discount('bill-old', 0.3))?.status).toBe('paid');
  });
});
