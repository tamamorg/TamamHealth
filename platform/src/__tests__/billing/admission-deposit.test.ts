jest.mock('uuid', () => ({ v4: () => `id-${++mockSequence}` }));
let mockSequence = 0;
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.mock('@/lib/services/audit-service', () => ({ logAuditSafe: jest.fn() }));
jest.mock('@/lib/services/sync-event-service', () => ({ emitSyncEvent: jest.fn() }));

import { wardDB, billingDB, getDB } from '@/lib/db';
import { teardownTestDBs } from '../helpers/test-db';
import { ensureAdmissionDepositBill, refundAdmissionDeposit } from '@/lib/services/ward-service';
import type { DataScope } from '@/lib/services/data-scope';

const scope: DataScope = { role: 'cashier', orgId: 'org', hospitalId: 'facility' };
const input = { admissionId: 'admission', scope, paymentId: 'payment', amount: 20, method: 'cash' as const, reason: 'Deposit return', actor: { id: 'cashier', name: 'Cashier' } };
beforeEach(async () => {
  await wardDB().put({ _id: 'admission', type: 'admission', patientId: 'patient', patientName: 'Patient', orgId: 'org', facilityId: 'facility', admissionDepositRequired: 100, admissionDepositPaid: 100, admissionDepositBillId: 'bill', admissionDepositStatus: 'refund_due', admissionDepositRefundDue: 20, tariffCurrency: 'SSP' });
  await billingDB().put({ _id: 'bill', type: 'billing', patientId: 'patient', orgId: 'org', facilityId: 'facility', currency: 'SSP', amountPaid: 100, payments: [{ id: 'payment', amount: 100, method: 'cash' }] });
});
afterEach(async () => { jest.restoreAllMocks(); await teardownTestDBs(); });

test.each(['refund_due', 'refunded', 'waived', 'forfeited'])('reconciliation preserves %s', async status => {
  const doc = await wardDB().get('admission');
  await wardDB().put({ ...doc, admissionDepositStatus: status });
  expect((await ensureAdmissionDepositBill('admission', scope)).admissionDepositStatus).toBe(status);
});
test('rejects a payment not recorded on the linked invoice', async () => {
  await expect(refundAdmissionDeposit({ ...input, paymentId: 'unrelated' })).rejects.toThrow('payment recorded');
  expect((await getDB('tamamhealth_refunds').allDocs()).rows).toHaveLength(0);
});
test('retry after admission commit failure creates one refund and one ledger entry', async () => {
  const db = wardDB();
  const put = db.put.bind(db);
  let fail = true;
  jest.spyOn(db, 'put').mockImplementation((async (doc: { admissionDepositStatus?: string }) => {
    if (doc.admissionDepositStatus === 'refunded' && fail) { fail = false; throw Object.assign(new Error('conflict'), { status: 409 }); }
    return put(doc as never);
  }) as typeof db.put);
  await expect(refundAdmissionDeposit(input)).rejects.toThrow('conflict');
  expect((await refundAdmissionDeposit(input)).admissionDepositStatus).toBe('refunded');
  expect((await getDB('tamamhealth_refunds').allDocs()).rows.filter(row => !row.id.startsWith('_design/'))).toHaveLength(1);
  expect((await getDB('tamamhealth_ledger').allDocs()).rows.filter(row => !row.id.startsWith('_design/'))).toHaveLength(1);
});
test('clinical role cannot process a deposit refund', async () => {
  await expect(refundAdmissionDeposit({ ...input, scope: { ...scope, role: 'nurse' } })).rejects.toThrow('role');
});
