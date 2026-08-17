/**
 * Claims Service — insurance claim submission, adjudication, appeal, and
 * resubmission. Split out of payment-service.ts; re-exported from there so no
 * caller needs to change.
 */
import type { ClaimDoc, ClaimStatus, PayerType } from '../db-types-payments';
import type { BillingDoc } from '../db-types-billing';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { findByType } from './db-query';
import { createLedgerEntry } from './ledger-service';
import { claimsDB, billingDB } from './payment-dbs';

// ═══════════════════════════════════════════════════════════════════
// CLAIMS
// ═══════════════════════════════════════════════════════════════════

export interface SubmitClaimInput {
  // Optional — see ClaimDoc.encounterId. Many claims raised from a
  // BillingDoc that has no linked clinical encounter still need to be
  // submittable.
  encounterId?: string;
  // Links the claim back to the BillingDoc it was raised against, if any.
  billingId?: string;
  patientId: string;
  patientName: string;
  policyId: string;
  payerName: string;
  payerType: PayerType;
  chargeIds: string[];
  totalBilled: number;
  facilityId: string;
  facilityName: string;
  submittedBy: string;
  orgId?: string;
}

/**
 * Best-effort mirror of a claim's outcome onto the BillingDoc it was raised
 * against (`ClaimDoc.billingId`), so the billing view reflects insurance
 * status without every caller having to remember to update both records.
 * Never throws — a bill that was deleted/edited concurrently, or a claim with
 * no `billingId` (e.g. seeded data), just means there's nothing to sync.
 */
async function syncBillInsuranceStatus(
  billingId: string | undefined,
  status: NonNullable<BillingDoc['insuranceClaimStatus']>,
  approvedAmount?: number,
): Promise<void> {
  if (!billingId) return;
  try {
    const db = billingDB();
    const bill = await db.get(billingId) as BillingDoc;
    bill.insuranceClaimStatus = status;
    if (approvedAmount !== undefined) {
      bill.insuranceApprovedAmount = approvedAmount;
    } else if (status === 'submitted') {
      // A freshly (re)submitted claim is pending adjudication — clear any
      // approved amount left over from a prior claim on the same bill, so the
      // bill never shows "submitted" alongside a stale approved figure.
      bill.insuranceApprovedAmount = undefined;
    }
    bill.updatedAt = new Date().toISOString();
    const resp = await db.put(bill);
    emitSyncEvent({
      resourceType: 'billing',
      resourceId: bill._id,
      operation: 'update',
      resourceVersion: resp.rev,
      orgId: bill.orgId,
      hospitalId: bill.facilityId,
    });
  } catch (err) {
    console.warn(`[syncBillInsuranceStatus] Could not sync bill ${billingId}:`, err);
  }
}

export async function submitClaim(input: SubmitClaimInput): Promise<ClaimDoc> {
  const db = claimsDB();
  const now = new Date().toISOString();

  const doc: ClaimDoc = {
    _id: `clm-${uuidv4().slice(0, 10)}`,
    type: 'claim',
    ...input,
    claimNumber: `CLM-${Date.now().toString(36).toUpperCase()}`,
    submittedDate: now,
    status: 'submitted' as ClaimStatus,
    createdAt: now,
    updatedAt: now,
    createdBy: input.submittedBy,
  };

  const resp = await db.put(doc);
  doc._rev = resp.rev;

  await logAuditSafe('CLAIM_SUBMITTED', input.submittedBy, input.submittedBy,
    `Claim ${doc.claimNumber}: ${input.totalBilled} to ${input.payerName}`);

  emitSyncEvent({
    resourceType: 'claim',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });

  await syncBillInsuranceStatus(input.billingId, 'submitted');

  return doc;
}

/**
 * Derive the claim status a set of adjudicated amounts implies. Exported so
 * the claims UI can render a "this is what will happen" preview from the
 * exact same rule the service applies — no separate status control that
 * could silently diverge from what gets persisted.
 *
 *   - Nothing approved, something denied  -> 'denied'
 *   - Something approved, nothing denied  -> 'paid' (write-offs are expected
 *     contractual reductions, not denials, so they don't block "paid")
 *   - A mix of approved and denied        -> 'partial'
 *   - Nothing approved or denied yet       -> 'partial' (fallback; e.g. only a
 *     write-off was recorded, or amounts are still all zero)
 */
export function computeAdjudicatedStatus(approved: number, denied: number): ClaimStatus {
  if (approved <= 0 && denied > 0) return 'denied';
  if (approved > 0 && denied <= 0) return 'paid';
  return 'partial';
}

export interface AdjudicateClaimOptions {
  denialReasons?: string[];
  notes?: string;
  /** What the payer allowed for the claim (the ERA's allowed amount). The
   *  adjudication form has always collected this; it was never written, so the
   *  claims table's "Allowed" column stayed at zero after adjudication. */
  totalAllowed?: number;
}

export async function adjudicateClaim(
  claimId: string,
  approved: number,
  denied: number,
  writeOff: number,
  patientResponsibility: number,
  adjudicatedBy: string,
  opts?: AdjudicateClaimOptions,
): Promise<ClaimDoc | null> {
  const db = claimsDB();
  try {
    const claim = await db.get(claimId) as ClaimDoc;
    const now = new Date().toISOString();
    const status = computeAdjudicatedStatus(approved, denied);

    claim.totalApproved = approved;
    // Fall back to approved + denied when the caller doesn't state an allowed
    // amount: for a fully paid claim those are the same number, and a stale
    // zero reads as "the payer allowed nothing", which is a different claim.
    claim.totalAllowed = opts?.totalAllowed ?? (approved + denied);
    claim.totalDenied = denied;
    claim.totalWriteOff = writeOff;
    claim.patientResponsibility = patientResponsibility;
    claim.adjudicatedDate = now;
    claim.status = status;
    claim.adjudicatedBy = adjudicatedBy;
    claim.adjudicationNotes = opts?.notes || undefined;
    // Only a denied/partial outcome carries denial reasons; a fully paid
    // claim shouldn't keep stale reasons from a prior adjudication pass.
    claim.denialReasons = status === 'denied' || status === 'partial' ? opts?.denialReasons : undefined;
    claim.updatedAt = now;

    const resp = await db.put(claim);
    claim._rev = resp.rev;

    await logAuditSafe('CLAIM_ADJUDICATED', adjudicatedBy, adjudicatedBy,
      `Claim ${claim.claimNumber || claim._id} -> ${status} (approved ${approved}, denied ${denied}, write-off ${writeOff})`);

    emitSyncEvent({
      resourceType: 'claim',
      resourceId: claim._id,
      operation: 'update',
      resourceVersion: claim._rev,
      orgId: claim.orgId,
      hospitalId: claim.facilityId,
    });

    // Create ledger entries for insurance payment and write-off
    if (approved > 0) {
      await createLedgerEntry({
        patientId: claim.patientId,
        encounterId: claim.encounterId,
        entryType: 'insurance_payment',
        amount: -approved,
        description: `Insurance payment from ${claim.payerName}: ${approved}`,
        referenceId: claim._id,
        referenceType: 'claim',
        facilityId: claim.facilityId,
        orgId: claim.orgId,
      });
    }
    if (writeOff > 0) {
      await createLedgerEntry({
        patientId: claim.patientId,
        encounterId: claim.encounterId,
        entryType: 'write_off',
        amount: -writeOff,
        description: `Contractual write-off: ${writeOff}`,
        referenceId: claim._id,
        referenceType: 'claim',
        facilityId: claim.facilityId,
        orgId: claim.orgId,
      });
    }

    await syncBillInsuranceStatus(
      claim.billingId,
      status === 'denied' ? 'rejected' : status === 'paid' ? 'approved' : 'partial',
      approved,
    );

    return claim;
  } catch { return null; }
}

/**
 * File an appeal against a denied claim. Denied-only transition — a claim
 * that hasn't been adjudicated (or was fully/partially paid) has nothing to
 * appeal. Does not change financial totals; adjudicateClaim/resubmitClaim own
 * those once the payer responds to the appeal.
 */
export async function appealClaim(
  claimId: string,
  note: string,
  appealedBy: string,
  appealedByName: string,
): Promise<ClaimDoc | null> {
  const db = claimsDB();
  try {
    const claim = await db.get(claimId) as ClaimDoc;
    if (claim.status !== 'denied') {
      throw new Error(`Claim ${claimId} is '${claim.status}' — only a denied claim can be appealed.`);
    }

    const now = new Date().toISOString();
    claim.status = 'appealed';
    claim.appealNote = note;
    claim.appealedAt = now;
    claim.appealedBy = appealedBy;
    claim.updatedAt = now;

    const resp = await db.put(claim);
    claim._rev = resp.rev;

    await logAuditSafe('CLAIM_APPEALED', appealedBy, appealedByName,
      `Claim ${claim.claimNumber || claim._id} appealed: ${note}`);

    emitSyncEvent({
      resourceType: 'claim',
      resourceId: claim._id,
      operation: 'update',
      resourceVersion: claim._rev,
      orgId: claim.orgId,
      hospitalId: claim.facilityId,
    });

    return claim;
  } catch (err) {
    if (err instanceof Error && err.message.includes('only a denied claim')) throw err;
    return null;
  }
}

/**
 * Resubmit a denied or appealed claim to the payer. Moves the claim back to
 * 'submitted' and clears the prior adjudication outcome (denial reasons,
 * approved/denied/write-off amounts) so it reads as freshly pending rather
 * than carrying a stale verdict — adjudicateClaim will set new totals when
 * the payer responds again. `resubmissionCount` tracks how many times this
 * has happened, for billing-ops visibility into chronically-denied claims.
 */
export async function resubmitClaim(
  claimId: string,
  resubmittedBy: string,
  resubmittedByName: string,
): Promise<ClaimDoc | null> {
  const db = claimsDB();
  try {
    const claim = await db.get(claimId) as ClaimDoc;
    if (claim.status !== 'denied' && claim.status !== 'appealed') {
      throw new Error(`Claim ${claimId} is '${claim.status}' — only a denied or appealed claim can be resubmitted.`);
    }

    const now = new Date().toISOString();
    claim.status = 'submitted';
    claim.submittedDate = now;
    claim.resubmissionCount = (claim.resubmissionCount || 0) + 1;
    claim.lastResubmittedAt = now;
    claim.lastResubmittedBy = resubmittedBy;
    // Clear the prior verdict — it's being re-adjudicated from scratch.
    claim.denialReasons = undefined;
    claim.totalApproved = undefined;
    claim.totalDenied = undefined;
    claim.totalWriteOff = undefined;
    claim.patientResponsibility = undefined;
    claim.adjudicatedDate = undefined;
    claim.updatedAt = now;

    const resp = await db.put(claim);
    claim._rev = resp.rev;

    await logAuditSafe('CLAIM_RESUBMITTED', resubmittedBy, resubmittedByName,
      `Claim ${claim.claimNumber || claim._id} resubmitted (attempt #${claim.resubmissionCount})`);

    emitSyncEvent({
      resourceType: 'claim',
      resourceId: claim._id,
      operation: 'update',
      resourceVersion: claim._rev,
      orgId: claim.orgId,
      hospitalId: claim.facilityId,
    });

    await syncBillInsuranceStatus(claim.billingId, 'submitted');

    return claim;
  } catch (err) {
    if (err instanceof Error && err.message.includes('only a denied or appealed')) throw err;
    return null;
  }
}

export async function getClaimsByPatient(patientId: string): Promise<ClaimDoc[]> {
  const rows = await findByType<ClaimDoc>(claimsDB(), 'claim', { patientId }, { indexFields: ['type', 'patientId'] });
  return rows
    .sort((a, b) => (b.submittedDate || '').localeCompare(a.submittedDate || ''));
}

export async function getAllClaims(scope?: DataScope): Promise<ClaimDoc[]> {
  const db = claimsDB();
  const all = await findByType<ClaimDoc>(db, 'claim');
  all.sort((a, b) => (b.submittedDate || '').localeCompare(a.submittedDate || ''));
  return scope ? filterByScope(all, scope) : all;
}
