import { getDB } from '@/lib/db';
import type { ClaimDoc, InsurancePolicyDoc } from '@/lib/db-types-payments';
import { filterByScope, type DataScope } from '@/lib/services/data-scope';
import { BILLING } from '@/lib/sync/write-permissions';
import { emitSyncEvent } from '@/lib/services/sync-event-service';
import { logAuditSafe } from '@/lib/services/audit-service';
import { createLedgerEntry } from '@/lib/services/ledger-service';
import type { BillingDoc } from '@/lib/db-types-billing';
import { v4 as uuidv4 } from 'uuid';

export function requireInsuranceWriter(scope: DataScope | undefined): asserts scope is DataScope & { userId: string } {
  if (!scope?.userId || !BILLING.includes(scope.role)) throw new Error('INSURANCE_FORBIDDEN');
}

export async function scopedInsuranceDoc<T extends ClaimDoc | InsurancePolicyDoc>(
  database: string, id: string, scope: DataScope,
): Promise<T> {
  requireInsuranceWriter(scope);
  const doc = await getDB(database).get(id) as T;
  if (!filterByScope([doc], scope).length) throw new Error('INSURANCE_NOT_FOUND');
  return doc;
}

export async function insurancePolicyForPatient(policyId: string, patientId: string, facilityId: string, orgId: string | undefined, scope: DataScope) {
  const policy = await scopedInsuranceDoc<InsurancePolicyDoc>('tamamhealth_insurance_policies', policyId, scope);
  if (policy.patientId !== patientId || policy.facilityId !== facilityId || !orgId || policy.orgId !== orgId) {
    throw new Error('INSURANCE_LINK_MISMATCH');
  }
  const patient = await getDB('tamamhealth_patients').get(patientId);
  if (!filterByScope([patient], scope!).length) throw new Error('INSURANCE_NOT_FOUND');
  return policy;
}

function referenceValue(value: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 160) throw new Error('INSURANCE_REFERENCE_REQUIRED');
  return value.trim();
}

async function persistClaim(claim: ClaimDoc, scope: DataScope) {
  claim.updatedAt = new Date().toISOString();
  const result = await getDB('tamamhealth_claims').put(claim);
  claim._rev = result.rev;
  emitSyncEvent({ resourceType: 'claim', resourceId: claim._id, operation: 'update', resourceVersion: result.rev, orgId: claim.orgId, hospitalId: claim.facilityId });
  await logAuditSafe('CLAIM_EVIDENCE_RECORDED', scope.userId!, scope.userId!, `Claim ${claim._id}: ${claim.status}`);
  return claim;
}

/** Staff transcription of a payer receipt; NOT an authenticated API acknowledgement. */
export async function recordClaimReceipt(id: string, reference: string, method: 'portal' | 'written', scope: DataScope) {
  requireInsuranceWriter(scope);
  const claim = await scopedInsuranceDoc<ClaimDoc>('tamamhealth_claims', id, scope);
  const normalized = referenceValue(reference);
  if (!['portal', 'written'].includes(method)) throw new Error('INSURANCE_INVALID_METHOD');
  if (claim.payerReceipt?.reference === normalized && claim.payerReceipt.method === method) return claim;
  if (!['queued', 'submitted'].includes(claim.status)) throw new Error('INSURANCE_INVALID_TRANSITION');
  claim.payerReceipt = { reference: normalized, method, recordedAt: new Date().toISOString(), recordedBy: scope.userId };
  claim.status = 'accepted';
  claim.submittedDate = claim.payerReceipt.recordedAt;
  return persistClaim(claim, scope);
}

/** Full approved balance only. Settlement evidence is frozen before posting so retries cannot double-credit. */
export async function recordClaimSettlement(id: string, reference: string, scope: DataScope) {
  requireInsuranceWriter(scope);
  const claim = await scopedInsuranceDoc<ClaimDoc>('tamamhealth_claims', id, scope);
  const normalized = referenceValue(reference);
  if (!['approved', 'partial', 'paid'].includes(claim.status) || !Number.isFinite(claim.totalApproved) || (claim.totalApproved || 0) <= 0) {
    throw new Error('INSURANCE_INVALID_TRANSITION');
  }
  if (!claim.adjudicationKey || !claim.payerReceipt) throw new Error('INSURANCE_LEGACY_SETTLEMENT_REVIEW');
  if (claim.status === 'paid' && !claim.settlement) throw new Error('INSURANCE_LEGACY_SETTLEMENT_REVIEW');
  if (claim.settlement && claim.settlement.reference !== normalized) throw new Error('INSURANCE_SETTLEMENT_PENDING');
  if (!claim.currency) throw new Error('INSURANCE_CURRENCY_REQUIRED');
  if (!claim.settlement) {
    claim.settlement = { reference: normalized, amount: claim.totalApproved!, recordedAt: new Date().toISOString(), recordedBy: scope.userId, ledgerKey: uuidv4() };
    await persistClaim(claim, scope);
  }
  // Mirror the receipt on the originating bill once, before marking the claim paid.
  if (claim.billingId) {
    const db = getDB('tamamhealth_billing');
    const bill = await db.get(claim.billingId) as BillingDoc;
    if (!filterByScope([bill], scope).length || bill.patientId !== claim.patientId || bill.orgId !== claim.orgId || bill.facilityId !== claim.facilityId || bill.currency !== claim.currency) throw new Error('INSURANCE_LINK_MISMATCH');
    const paymentId = `insurance-${claim.settlement.ledgerKey}`;
    if (!(bill.payments || []).some(payment => payment.id === paymentId)) {
      if (claim.settlement.amount > bill.balanceDue) throw new Error('INSURANCE_OVERPAYMENT_REVIEW');
      bill.payments = [...(bill.payments || []), { id: paymentId, amount: claim.settlement.amount, method: 'insurance', reference: normalized, receivedBy: scope.userId, receivedByName: scope.userId, receivedAt: claim.settlement.recordedAt }];
      bill.amountPaid = Math.round(((bill.amountPaid || 0) + claim.settlement.amount) * 100) / 100;
      bill.balanceDue = Math.round((bill.totalAmount - bill.amountPaid) * 100) / 100;
      bill.status = bill.balanceDue <= 0 ? 'paid' : 'partial';
      bill.updatedAt = new Date().toISOString();
      const result = await db.put(bill);
      emitSyncEvent({ resourceType: 'billing', resourceId: bill._id, operation: 'update', resourceVersion: result.rev, orgId: bill.orgId, hospitalId: bill.facilityId });
    }
  }
  await createLedgerEntry({ patientId: claim.patientId, encounterId: claim.encounterId, entryType: 'insurance_payment', amount: -claim.settlement.amount,
    description: 'Insurance settlement', referenceId: claim._id, referenceType: 'claim', facilityId: claim.facilityId, orgId: claim.orgId,
    currency: claim.currency, createdBy: scope.userId, idempotencyKey: `insurance-settlement-${claim.settlement.ledgerKey}` });
  if (claim.status !== 'paid') { claim.status = 'paid'; await persistClaim(claim, scope); }
  return claim;
}
