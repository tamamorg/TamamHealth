jest.mock('uuid', () => ({ v4: () => `insurance-${++mockSequence}` }));
let mockSequence = 0;
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.mock('@/lib/services/audit-service', () => ({ logAuditSafe: jest.fn() }));
jest.mock('@/lib/services/sync-event-service', () => ({ emitSyncEvent: jest.fn() }));
import { getDB } from '@/lib/db';
import { teardownTestDBs } from '../helpers/test-db';
import { checkEligibility, getLatestEligibility, submitClaim, adjudicateClaim } from '@/lib/services/payment-service';
import { recordClaimReceipt, recordClaimSettlement } from '@/modules/insurance/services/insurance-workflow-service';
import type { DataScope } from '@/lib/services/data-scope';

const scope: DataScope = { role: 'medical_biller', userId: 'biller', orgId: 'org', hospitalId: 'facility' };
const input = { policyId: 'policy', patientId: 'patient', facilityId: 'facility', orgId: 'org', checkedBy: 'biller' };
const claimInput = { ...input, patientName: 'Test patient', payerName: 'Ignored', payerType: 'private' as const, billingId: 'bill', chargeIds: [], totalBilled: 100, facilityName: 'Test facility', submittedBy: 'biller' };
beforeEach(async () => {
  await getDB('tamamhealth_patients').put({ _id: 'patient', type: 'patient', orgId: 'org', facilityId: 'facility' });
  await getDB('tamamhealth_insurance_policies').put({ _id: 'policy', type: 'insurance_policy', patientId: 'patient', orgId: 'org', facilityId: 'facility', payerName: 'Test payer', payerType: 'private', effectiveDate: '2020-01-01', isActive: true, copayAmount: 7 });
  await getDB('tamamhealth_billing').put({ _id: 'bill', type: 'billing', patientId: 'patient', orgId: 'org', facilityId: 'facility', totalAmount: 100, amountPaid: 0, balanceDue: 100, currency: 'SSP', payments: [], items: [] });
});
afterEach(async () => { jest.restoreAllMocks(); await teardownTestDBs(); });

test('caller cannot label an unverified local estimate as API verified', async () => {
  await expect(checkEligibility({ ...input, source: 'api' }, scope)).rejects.toThrow('CONNECTOR_NOT_CONFIGURED');
  expect((await checkEligibility(input, scope)).status).toBe('unverified');
});
test('selected policy and scope are enforced', async () => {
  await expect(checkEligibility({ ...input, patientId: 'another' }, scope)).rejects.toThrow('LINK_MISMATCH');
  await expect(checkEligibility(input, { ...scope, orgId: 'other' })).rejects.toThrow('NOT_FOUND');
  await expect(submitClaim(claimInput, undefined as unknown as DataScope)).rejects.toThrow('FORBIDDEN');
});
test('manual eligibility requires reference and future expiry', async () => {
  await expect(checkEligibility({ ...input, manualEvidence: { reference: '', decision: 'verified', method: 'phone', expiresAt: '2099-01-01' } }, scope)).rejects.toThrow('INVALID_EVIDENCE');
  const doc = await checkEligibility({ ...input, manualEvidence: { reference: 'TEST-COVER', decision: 'verified', method: 'phone', expiresAt: '2099-01-01' } }, scope);
  expect(doc.source).toBe('manual'); expect(doc.copayAmount).toBe(7);
  const db = getDB('tamamhealth_eligibility_checks');
  await db.put({ ...doc, expiresAt: '2000-01-01' });
  expect((await getLatestEligibility('patient', scope, 'policy'))?.status).toBe('expired');
  expect(await getLatestEligibility('patient', scope, 'another-policy')).toBeNull();
});
test('queue retry does not create a second claim or pretend it was sent', async () => {
  const claim = await submitClaim(claimInput, scope);
  expect(claim.status).toBe('queued'); expect(claim.submittedDate).toBeUndefined();
  expect(claim.payerName).toBe('Test payer');
  expect((await submitClaim(claimInput, scope))._id).toBe(claim._id);
  expect((await getDB('tamamhealth_billing').get('bill') as { insuranceClaimStatus: string }).insuranceClaimStatus).toBe('queued');
});
test('receipt then approval does not post a payment; settlement retry posts once', async () => {
  const claim = await submitClaim(claimInput, scope);
  await expect(adjudicateClaim(claim._id, 100, 0, 0, 0, 'biller', undefined, scope)).rejects.toThrow('RECEIPT_REQUIRED');
  await recordClaimReceipt(claim._id, 'TEST-RECEIPT', 'portal', scope);
  expect((await adjudicateClaim(claim._id, 100, 0, 0, 0, 'biller', undefined, scope))?.status).toBe('approved');
  expect((await getDB('tamamhealth_ledger').allDocs()).rows.filter(r => !r.id.startsWith('_design/'))).toHaveLength(0);
  await recordClaimSettlement(claim._id, 'TEST-SETTLEMENT', scope);
  await recordClaimSettlement(claim._id, 'TEST-SETTLEMENT', scope);
  expect((await getDB('tamamhealth_ledger').allDocs()).rows.filter(r => !r.id.startsWith('_design/'))).toHaveLength(1);
  const bill = await getDB('tamamhealth_billing').get('bill') as { amountPaid: number; balanceDue: number };
  expect(bill.amountPaid).toBe(100); expect(bill.balanceDue).toBe(0);
});
test('settlement retries recover after the final claim update fails', async () => {
  const claim = await submitClaim(claimInput, scope);
  await recordClaimReceipt(claim._id, 'TEST-R', 'written', scope);
  await adjudicateClaim(claim._id, 100, 0, 0, 0, 'biller', undefined, scope);
  const db = getDB('tamamhealth_claims'); const put = db.put.bind(db); let fail = true;
  jest.spyOn(db, 'put').mockImplementation((async (doc: { status?: string }) => {
    if (doc.status === 'paid' && fail) { fail = false; throw new Error('interrupted'); }
    return put(doc as never);
  }) as typeof db.put);
  await expect(recordClaimSettlement(claim._id, 'TEST-S', scope)).rejects.toThrow('interrupted');
  expect((await recordClaimSettlement(claim._id, 'TEST-S', scope)).status).toBe('paid');
  expect((await getDB('tamamhealth_ledger').allDocs()).rows.filter(r => !r.id.startsWith('_design/'))).toHaveLength(1);
});
