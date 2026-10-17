/** Payment service split: adjustments. Re-exported through ../payment-service. */
import type { AdjustmentDoc, AdjustmentType } from '../../db-types-payments';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from '../audit-service';
import { emitSyncEvent } from '../sync-event-service';
import { createLedgerEntry } from '../ledger-service';
import { adjustmentsDB } from './shared';

// ═══════════════════════════════════════════════════════════════════
// ADJUSTMENTS
// ═══════════════════════════════════════════════════════════════════

export async function createAdjustment(input: {
  patientId: string;
  encounterId?: string;
  chargeId?: string;
  claimId?: string;
  adjustmentType: AdjustmentType;
  amount: number;
  reason: string;
  reasonCode?: string;
  approvedBy: string;
  approvedByName: string;
  facilityId: string;
  orgId?: string;
}): Promise<AdjustmentDoc> {
  const db = adjustmentsDB();
  const now = new Date().toISOString();

  const doc: AdjustmentDoc = {
    _id: `adj-${uuidv4()}`,
    type: 'adjustment',
    ...input,
    approvedDate: now,
    createdAt: now,
    updatedAt: now,
    createdBy: input.approvedBy,
  };

  const resp = await db.put(doc);
  doc._rev = resp.rev;

  // Create ledger entry (negative = credit = balance decreases)
  await createLedgerEntry({
    patientId: input.patientId,
    encounterId: input.encounterId,
    entryType: input.adjustmentType === 'write_off' || input.adjustmentType === 'bad_debt' ? 'write_off' : 'adjustment',
    amount: -input.amount,
    description: `${input.adjustmentType}: ${input.reason}`,
    referenceId: doc._id,
    referenceType: 'adjustment',
    facilityId: input.facilityId,
    orgId: input.orgId,
    createdBy: input.approvedBy,
  });

  await logAuditSafe('ADJUSTMENT_CREATED', input.approvedBy, input.approvedByName,
    `${input.adjustmentType} of ${input.amount}; reason recorded on the adjustment`);

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
