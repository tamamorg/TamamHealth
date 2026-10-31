/**
 * A draft bill is a rebuilt charge nobody has agreed yet. Balances read the
 * ledger, so it must not touch the ledger until a cashier finalizes it: an old
 * charge could otherwise hold a patient at the pharmacy, or a cancel could
 * reverse money that was never charged.
 */
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { getDB } from '@/lib/db';
import {
  cancelBill, finalizeBill, getBillsByPatientUnscopedForPortal, getUnpaidBills, recordPayment, waiveBill,
} from '@/lib/services/billing-service';
import { chargeForServices } from '@/lib/services/fee-schedule-service';
import { getPatientBalance } from '@/lib/services/ledger-service';
import type { DataScope } from '@/lib/services/data-scope';

const scope = { orgId: 'org-a', hospitalId: 'h-a', role: 'org_admin' } as DataScope;
const ledgerRows = async () => (await getDB('tamamhealth_ledger').allDocs({ include_docs: true })).rows.filter(r => !r.id.startsWith('_design'));

beforeEach(async () => {
  await putDoc(getDB('tamamhealth_billing'), {
    _id: 'bill-rebuilt-rx', type: 'billing', orgId: 'org-a', facilityId: 'h-a', patientId: 'p1', invoiceNumber: 'INV-20261020-Rabc',
    status: 'draft', items: [], payments: [], totalAmount: 100, subtotal: 100, discount: 0, taxAmount: 0, amountPaid: 0, balanceDue: 100,
    currency: 'SSP', createdAt: '2026-10-31T00:00:00.000Z', updatedAt: '2026-10-31T00:00:00.000Z',
  } as never);
});
afterEach(async () => { await teardownTestDBs(); });

describe('a draft bill', () => {
  test('is owed by nobody: no balance, not unpaid, not on the portal, and takes no payment', async () => {
    expect(await getPatientBalance('p1', scope)).toBe(0);
    expect(await getUnpaidBills(scope)).toEqual([]);
    expect(await getBillsByPatientUnscopedForPortal('p1')).toEqual([]);
    await expect(recordPayment('bill-rebuilt-rx', 10, 'cash', 'u', 'U')).rejects.toThrow('cannot take payments');
  });

  test('finalizing it posts the charge once and opens it for payment', async () => {
    const bill = await finalizeBill('bill-rebuilt-rx', 'cashier', 'Cashier');
    expect(bill?.status).toBe('pending');
    expect(await getPatientBalance('p1', scope)).toBe(100);
    expect(await finalizeBill('bill-rebuilt-rx', 'cashier', 'Cashier')).toBeNull();
    expect(await ledgerRows()).toHaveLength(1);
  });

  test('deleting or waiving it writes nothing to the ledger', async () => {
    expect((await waiveBill('bill-rebuilt-rx', 'c', 'C', 'paid in cash at the time'))?.status).toBe('waived');
    expect(await ledgerRows()).toHaveLength(0);
  });

  test('cancelling it writes nothing to the ledger', async () => {
    expect((await cancelBill('bill-rebuilt-rx', 'c', 'C'))?.status).toBe('cancelled');
    expect(await ledgerRows()).toHaveLength(0);
  });
});

describe('a bill for an exempt patient', () => {
  const lines = [{ category: 'pharmacy' as const, description: 'Coartem', quantity: 2, unitPrice: 150, referenceId: 'rx-1', referenceType: 'prescription' }];
  const ctx = {
    patientId: 'p2', patientName: 'Child', facilityId: 'h-a', facilityName: 'Juba', facilityLevel: 'clinic', state: '',
    generatedBy: 'dr', generatedByName: 'Dr', orgId: 'org-a', scope,
  } as never;
  const register = (coverageType: string) => putDoc(getDB('tamamhealth_patients'), {
    _id: 'p2', type: 'patient', orgId: 'org-a', hospitalId: 'h-a', payorInfo: { coverageType, exemptionReason: 'Child under 5' },
  } as never);

  test('is created waived, in one write, and owes nothing', async () => {
    await register('exemption');
    const bill = await chargeForServices(ctx, lines);
    expect(bill).toMatchObject({ status: 'waived', totalAmount: 300, balanceDue: 0, discountReason: 'Exempt: Child under 5' });
    expect(bill?._rev?.startsWith('1-')).toBe(true);
    expect(await getPatientBalance('p2', scope)).toBe(0);
    expect(await ledgerRows()).toHaveLength(0);
  });

  test('a paying patient is billed as before', async () => {
    await register('out_of_pocket');
    expect(await chargeForServices(ctx, lines)).toMatchObject({ status: 'pending', balanceDue: 300 });
    expect(await getPatientBalance('p2', scope)).toBe(300);
  });
});
