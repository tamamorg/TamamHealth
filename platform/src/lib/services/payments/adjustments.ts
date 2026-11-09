/** Payment service split: adjustments. Re-exported through ../payment-service. */
import type { AdjustmentDoc, AdjustmentType } from '../../db-types-payments';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from '../audit-service';
import { emitSyncEvent } from '../sync-event-service';
import { createLedgerEntry } from '../ledger-service';
import type { UserRole } from '../../db-types';
import { WAIVER_APPROVERS } from '../../sync/write-permissions';
import { adjustmentsDB } from './shared';

// ═══════════════════════════════════════════════════════════════════
// ADJUSTMENTS
// ═══════════════════════════════════════════════════════════════════

export type AdjustmentErrorCode = 'APPROVER_REQUIRED' | 'SELF_APPROVAL' | 'APPROVER_ROLE' | 'INVALID_ADJUSTMENT';

export class AdjustmentError extends Error {
  constructor(public readonly code: AdjustmentErrorCode, message: string) {
    super(message);
    this.name = 'AdjustmentError';
  }
}

/**
 * Record a waiver or adjustment. The approver is a second person (manager
 * override): `createdBy` is who entered it and `approvedBy` must be someone
 * else holding an approver role. Both are checked here and again by the
 * CouchDB validator.
 */
export async function createAdjustment(input: {
  patientId: string;
  encounterId?: string;
  chargeId?: string;
  claimId?: string;
  adjustmentType: AdjustmentType;
  amount: number;
  reason: string;
  reasonCode?: string;
  /** The signed-in cashier who entered the adjustment. */
  createdBy: string;
  createdByName: string;
  approvedBy: string;
  approvedByName: string;
  approvedByRole: string;
  /** The server's signature over the approval, from /api/auth/manager-override. */
  approvalToken?: string;
  facilityId: string;
  orgId?: string;
}): Promise<AdjustmentDoc> {
  const db = adjustmentsDB();
  const now = new Date().toISOString();
  if (!Number.isFinite(input.amount) || input.amount <= 0 || !input.reason?.trim()) {
    throw new AdjustmentError('INVALID_ADJUSTMENT', 'Enter an amount above zero and the reason.');
  }
  if (!input.approvedBy?.trim() || !input.approvedByRole) {
    throw new AdjustmentError('APPROVER_REQUIRED', 'Adjustment not recorded. A manager must approve it with their own password.');
  }
  if (input.approvedBy === input.createdBy) {
    throw new AdjustmentError('SELF_APPROVAL', 'Adjustment not recorded. You cannot approve your own adjustment. Ask another manager.');
  }
  if (!WAIVER_APPROVERS.includes(input.approvedByRole as UserRole)) {
    throw new AdjustmentError('APPROVER_ROLE', 'Adjustment not recorded. The approver must be a manager or administrator.');
  }

  // An adjustment taken from the account page names no visit. Tie it to the
  // oldest visit still owing so the checkout of THAT visit sees it.
  let encounterId = input.encounterId;
  if (!encounterId && input.orgId) {
    try {
      const { getBillsByPatient } = await import('../billing-service');
      const { orgOnlyScope } = await import('../data-scope');
      const open = (await getBillsByPatient(input.patientId, orgOnlyScope(input.orgId)))
        .filter(b => ['pending', 'partial', 'insurance_pending', 'insurance_approved', 'insurance_rejected'].includes(b.status)
          && !b.chargeReversedAt && (b.balanceDue || 0) > 0 && !!b.encounterId)
        .sort((x, y) => String(x.createdAt).localeCompare(String(y.createdAt)));
      encounterId = open[0]?.encounterId;
    } catch { /* an adjustment with no visit still counts on the account */ }
  }

  const doc: AdjustmentDoc = {
    _id: `adj-${uuidv4()}`,
    type: 'adjustment',
    patientId: input.patientId,
    encounterId,
    chargeId: input.chargeId,
    claimId: input.claimId,
    adjustmentType: input.adjustmentType,
    amount: input.amount,
    reason: input.reason,
    reasonCode: input.reasonCode,
    approvedBy: input.approvedBy,
    approvedByName: input.approvedByName,
    approvedByRole: input.approvedByRole,
    ...(input.approvalToken ? { approvalToken: input.approvalToken } : {}),
    facilityId: input.facilityId,
    orgId: input.orgId,
    approvedDate: now,
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy,
  };

  const resp = await db.put(doc);
  doc._rev = resp.rev;

  // Create ledger entry (negative = credit = balance decreases)
  await createLedgerEntry({
    patientId: input.patientId,
    encounterId,
    entryType: input.adjustmentType === 'write_off' || input.adjustmentType === 'bad_debt' ? 'write_off' : 'adjustment',
    amount: -input.amount,
    description: `${input.adjustmentType}: ${input.reason}`,
    referenceId: doc._id,
    referenceType: 'adjustment',
    facilityId: input.facilityId,
    orgId: input.orgId,
    createdBy: input.createdBy,
  });

  await logAuditSafe('ADJUSTMENT_CREATED', input.createdBy, input.createdByName,
    `${input.adjustmentType} of ${input.amount}; approved by ${input.approvedByName} (${input.approvedBy}); reason recorded on the adjustment`);

  emitSyncEvent({
    resourceType: 'adjustment',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });

  return doc;
}
