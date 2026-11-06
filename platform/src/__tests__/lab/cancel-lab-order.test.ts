/**
 * A lab order can be withdrawn only before its specimen is collected: a reason
 * is required, who/when is stamped, the coarse status becomes `cancelled`, and
 * the test's own invoice is withdrawn (cancelled, or reversed once paid). A test
 * billed with others, or cancelled by a role the sync validator does not let
 * amend a bill, is left for billing and reported as `manual`.
 */
jest.mock('uuid', () => { let n = 0; return { v4: () => `${String(++n).padStart(8, '0')}-cancel-uuid` }; });
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.setTimeout(30000);

import { teardownTestDBs } from '../helpers/test-db';
import {
  createLabResult, getLabResultById, cancelLabOrder, advanceLabOrder, effectiveOrderStatus,
  isOpenLabOrder, isCancelledLabOrder, getPendingLabResults, setLabBenchStatus,
} from '@/lib/services/lab-service';
import { createBill, getBillById, recordPayment } from '@/lib/services/billing-service';
import { labOrder, LAB_ORDER_TRANSITIONS } from '@/lib/clinical-flow/order-lifecycles';
import type { LabResultDoc } from '@/lib/db-types';

afterEach(async () => { await teardownTestDBs(); });

const SCOPE = { role: 'super_admin' } as const;
const DOCTOR = { id: 'u-doc', name: 'Dr. Wani', role: 'doctor' };

function order(overrides: Partial<LabResultDoc> = {}) {
  return {
    patientId: 'pat-1', patientName: 'Nyakuma Deng', hospitalNumber: 'JTH-1', testName: 'Malaria RDT',
    specimen: 'Blood', status: 'pending' as const, result: '', unit: '', referenceRange: '', abnormal: false,
    critical: false, orderedBy: 'Dr. Wani', orderedAt: new Date().toISOString(), completedAt: '',
    hospitalId: 'hosp-1', orgId: 'org-a', orderStatus: 'ordered' as const, ...overrides,
  };
}

function billFor(labIds: string[], paid = false) {
  return createBill({
    patientId: 'pat-1', patientName: 'Nyakuma Deng', facilityId: 'hosp-1', facilityName: 'F', facilityLevel: 'clinic',
    encounterDate: '2026-11-05', state: 'CES', orgId: 'org-a', generatedBy: 'u', generatedByName: 'U',
    items: labIds.map((id, i) => ({
      id: `li-${i}`, category: 'laboratory', description: 'Test', quantity: 1, unitPrice: 10, totalPrice: 10,
      referenceId: id, referenceType: 'lab_result',
    })) as never,
  }).then(async bill => (paid ? (await recordPayment(bill._id, 10, 'cash', 'u', 'U'), bill) : bill));
}

describe('lifecycle', () => {
  test('cancelled is reachable only from ordered and is terminal', () => {
    expect(labOrder.can('ordered', 'cancelled')).toBe(true);
    for (const from of Object.keys(LAB_ORDER_TRANSITIONS) as (keyof typeof LAB_ORDER_TRANSITIONS)[]) {
      if (from !== 'ordered') expect(labOrder.can(from, 'cancelled')).toBe(false);
    }
    expect(LAB_ORDER_TRANSITIONS.cancelled).toHaveLength(0);
  });
});

describe('cancelLabOrder', () => {
  test('withdraws an ordered test, stamps reason/who/when and sets the coarse status', async () => {
    const o = await createLabResult(order());
    const { order: done, billing } = await cancelLabOrder(o._id, '  Duplicate order ', DOCTOR);
    expect(done.status).toBe('cancelled');
    expect(done.orderStatus).toBe('cancelled');
    expect(done.cancelledReason).toBe('Duplicate order');
    expect(done.cancelledBy).toBe('Dr. Wani');
    expect(Date.parse(done.cancelledAt!)).not.toBeNaN();
    expect(billing).toBe('none');
    expect(effectiveOrderStatus(done)).toBe('cancelled');
    expect(isOpenLabOrder(done)).toBe(false);
    expect(isCancelledLabOrder(done)).toBe(true);
  });

  test('a cancelled order leaves the pending worklist', async () => {
    const keep = await createLabResult(order({ testName: 'FBC' }));
    const gone = await createLabResult(order());
    await cancelLabOrder(gone._id, 'Ordered in error', DOCTOR);
    const pending = await getPendingLabResults(SCOPE);
    expect(pending.map(p => p._id)).toEqual([keep._id]);
  });

  test('requires a reason', async () => {
    const o = await createLabResult(order());
    await expect(cancelLabOrder(o._id, '   ', DOCTOR)).rejects.toThrow(/reason/i);
    expect((await getLabResultById(o._id))?.status).toBe('pending');
  });

  test('refuses once the specimen is collected', async () => {
    const o = await createLabResult(order());
    await advanceLabOrder(o._id, 'specimen_collected');
    await expect(cancelLabOrder(o._id, 'Changed mind', DOCTOR)).rejects.toThrow(/Reject the specimen/);
    expect(effectiveOrderStatus((await getLabResultById(o._id))!)).toBe('specimen_collected');
  });

  test('refuses a second cancel, and a cancelled order cannot go to the bench', async () => {
    const o = await createLabResult(order());
    await cancelLabOrder(o._id, 'Wrong patient', DOCTOR);
    await expect(cancelLabOrder(o._id, 'Again', DOCTOR)).rejects.toThrow(/already cancelled/);
    await expect(setLabBenchStatus(o._id, 'in_progress')).rejects.toThrow(/Illegal lab order transition/);
  });

  test('an unpaid invoice that holds only this test is cancelled', async () => {
    const o = await createLabResult(order());
    const bill = await billFor([o._id]);
    const { billing } = await cancelLabOrder(o._id, 'Not needed', DOCTOR);
    expect(billing).toBe('cancelled');
    expect((await getBillById(bill._id, SCOPE))?.status).toBe('cancelled');
  });

  test('a paid invoice has its charge reversed so a refund is owed', async () => {
    const o = await createLabResult(order());
    const bill = await billFor([o._id], true);
    const { billing } = await cancelLabOrder(o._id, 'Not needed', DOCTOR);
    expect(billing).toBe('reversed');
    expect((await getBillById(bill._id, SCOPE))?.chargeReversedAt).toBeTruthy();
  });

  test('a test on a shared invoice has just its line removed, totals corrected', async () => {
    const a = await createLabResult(order());
    const b = await createLabResult(order({ testName: 'FBC' }));
    const bill = await billFor([a._id, b._id]);
    const { billing } = await cancelLabOrder(a._id, 'Not needed', DOCTOR);
    expect(billing).toBe('line_removed');
    const after = (await getBillById(bill._id, SCOPE))!;
    expect(after.status).toBe('pending');
    expect(after.items.map(i => i.referenceId)).toEqual([b._id]);
    expect(after.totalAmount).toBe(10);
    expect(after.balanceDue).toBe(10);
  });

  test('a shared invoice that already has a payment is left for billing', async () => {
    const a = await createLabResult(order());
    const b = await createLabResult(order({ testName: 'FBC' }));
    const bill = await billFor([a._id, b._id], true);
    const { billing } = await cancelLabOrder(a._id, 'Not needed', DOCTOR);
    expect(billing).toBe('manual');
    expect((await getBillById(bill._id, SCOPE))?.items).toHaveLength(2);
  });

  test('lab staff leave a shared invoice alone (the validator would refuse the write)', async () => {
    const a = await createLabResult(order());
    const b = await createLabResult(order({ testName: 'FBC' }));
    const bill = await billFor([a._id, b._id]);
    const { billing } = await cancelLabOrder(a._id, 'Not needed', { name: 'Lab Tech', role: 'lab_tech' });
    expect(billing).toBe('manual');
    expect((await getBillById(bill._id, SCOPE))?.items).toHaveLength(2);
  });

  test('lab staff cancel the order but do not touch the bill (the validator would refuse the write)', async () => {
    const o = await createLabResult(order());
    const bill = await billFor([o._id]);
    const { order: done, billing } = await cancelLabOrder(o._id, 'Patient left', { name: 'Lab Tech', role: 'lab_tech' });
    expect(done.status).toBe('cancelled');
    expect(billing).toBe('manual');
    expect((await getBillById(bill._id, SCOPE))?.status).toBe('pending');
  });
});
