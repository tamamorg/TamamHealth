/**
 * A payment taken against one billing line settles that visit's bill first, so
 * the bill and the chart's line agree. Without an aim, oldest first still holds.
 */
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { getDB } from '@/lib/db';
import { getBillById, settleOpenBillsWithPayment } from '@/lib/services/billing-service';
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
