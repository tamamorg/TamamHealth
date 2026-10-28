/** Payment service split: collection. Re-exported through ../payment-service. */
import { findByType } from '../db-query';
import type { PaymentDoc, PaymentMethodType, PaymentStatus, PaymentAllocation } from '../../db-types-payments';
import type { DataScope } from '../data-scope';
import { filterByScope, orgOnlyScope } from '../data-scope';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from '../audit-service';
import { emitSyncEvent } from '../sync-event-service';
import { createLedgerEntry } from '../ledger-service';
import { assertRefExists, paymentsDB, toBillingPaymentMethod } from './shared';
import { reconcilePaymentLinkState } from './payment-links';
import { processedRefundsFor } from './refunds';
import type { RefundErrorCode } from './refunds';

export interface CollectPaymentInput {
  patientId: string;
  patientName: string;
  encounterId?: string;
  invoiceId?: string;
  paymentPlanId?: string;
  method: PaymentMethodType;
  amount: number;
  currency?: string;
  reference?: string;
  mobileMoneyPhone?: string;
  cardLast4?: string;
  allocations?: PaymentAllocation[];
  notes?: string;
  processedBy: string;
  processedByName: string;
  facilityId: string;
  orgId?: string;
}

export async function collectPayment(input: CollectPaymentInput): Promise<PaymentDoc> {
  const db = paymentsDB();
  const now = new Date().toISOString();
  // Don't post a payment against an encounter/invoice that doesn't exist.
  await assertRefExists('tamamhealth_encounters', input.encounterId, 'Encounter');
  await assertRefExists('tamamhealth_invoices', input.invoiceId, 'Invoice');

  const doc: PaymentDoc = {
    _id: `pmt-${uuidv4()}`,
    type: 'payment',
    patientId: input.patientId,
    patientName: input.patientName,
    encounterId: input.encounterId,
    invoiceId: input.invoiceId,
    paymentPlanId: input.paymentPlanId,
    method: input.method,
    amount: input.amount,
    currency: input.currency || 'SSP',
    reference: input.reference || `REC-${uuidv4().slice(0, 8).toUpperCase()}`,
    mobileMoneyPhone: input.mobileMoneyPhone,
    cardLast4: input.cardLast4,
    status: 'posted' as PaymentStatus,
    processedAt: now,
    processedBy: input.processedBy,
    processedByName: input.processedByName,
    allocations: input.allocations,
    notes: input.notes,
    facilityId: input.facilityId,
    orgId: input.orgId,
    createdAt: now,
    updatedAt: now,
    createdBy: input.processedBy,
  };

  const resp = await db.put(doc);
  doc._rev = resp.rev;

  // Create ledger entry (negative = credit = balance decreases)
  await createLedgerEntry({
    patientId: input.patientId,
    encounterId: input.encounterId,
    entryType: 'payment',
    amount: -input.amount,
    description: `Payment via ${input.method}: ${input.amount} ${doc.currency}`,
    referenceId: doc._id,
    referenceType: 'payment',
    method: input.method,
    currency: doc.currency,
    facilityId: input.facilityId,
    orgId: input.orgId,
    createdBy: input.processedBy,
  });

  // Settle the patient's open BillingDoc(s) with this payment. collectPayment
  // isn't earmarked for one bill — it pays down the patient's aggregate
  // ledger balance — so without this, the ledger reads paid while the
  // invoice(s) it was actually paying stay 'pending'/'partial' forever and
  // the two permanently disagree. Best-effort: the ledger entry above is the
  // record of the money received and must stand even if this mirror fails —
  // but the outcome (a failure, or an amount that didn't match any open
  // bill) is persisted onto the doc below rather than only console.warn'd, so
  // a caller can tell the difference between "fully settled" and "the ledger
  // moved but this invoice didn't" instead of an unqualified success.
  let settlementError: string | undefined;
  let settlementUnapplied = 0;
  try {
    const { settleOpenBillsWithPayment } = await import('../billing-service');
    const result = await settleOpenBillsWithPayment({
      patientId: input.patientId,
      amount: input.amount,
      currency: doc.currency,
      method: toBillingPaymentMethod(input.method),
      receivedBy: input.processedBy,
      receivedByName: input.processedByName,
      paymentId: doc._id,
      reference: doc.reference,
      notes: input.notes,
      // 'org_admin' is synthetic — never a real user role here — chosen only
      // because filterByScope treats it as org-scoped without the further
      // per-facility narrowing it applies to ordinary staff roles: a payment
      // collected at one facility must be free to settle a bill at any other
      // facility in the SAME org, just never in a different org.
      scope: orgOnlyScope(input.orgId),
    });
    settlementUnapplied = result.unapplied;
  } catch (err) {
    settlementError = err instanceof Error ? err.message : String(err);
    console.warn('[payment] could not settle open bills for', input.patientId, err);
  }

  if (settlementError || settlementUnapplied > 0) {
    doc.billSettlementError = settlementError;
    doc.billSettlementUnapplied = settlementUnapplied > 0 ? settlementUnapplied : undefined;
    doc.updatedAt = new Date().toISOString();
    const resp2 = await db.put(doc);
    doc._rev = resp2.rev;
  }

  await logAuditSafe(
    'PAYMENT_COLLECTED', input.processedBy, input.processedByName,
    `${input.amount} ${doc.currency} via ${input.method} from patient ${input.patientId} (ref: ${doc.reference})`
      + (settlementError ? ` — bill settlement failed: ${settlementError}` : '')
      + (settlementUnapplied > 0 ? ` — ${settlementUnapplied} ${doc.currency} unapplied to any open bill` : '')
  );

  emitSyncEvent({
    resourceType: 'payment',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });

  return doc;
}

export async function getPaymentsByPatient(patientId: string, scope: DataScope): Promise<PaymentDoc[]> {
  return readPaymentsByPatient(patientId, scope);
}

/**
 * UNSCOPED: patient-portal read. The portal authenticates a patient (not a staff
 * DataScope) who legitimately sees their own records across every org that
 * treated them. Caller must pass the verified portal token subject. Never use
 * for staff routes.
 */
export async function getPaymentsByPatientUnscopedForPortal(patientId: string): Promise<PaymentDoc[]> {
  return readPaymentsByPatient(patientId, undefined);
}

export async function readPaymentsByPatient(patientId: string, scope: DataScope | undefined): Promise<PaymentDoc[]> {
  const rows = await findByType<PaymentDoc>(paymentsDB(), 'payment', { patientId }, { indexFields: ['type', 'patientId'] });
  return (scope ? filterByScope(rows, scope) : rows)
    .sort((a, b) => (b.processedAt || '').localeCompare(a.processedAt || ''));
}

export async function getAllPayments(scope: DataScope): Promise<PaymentDoc[]> {
  const db = paymentsDB();
  const all = await findByType<PaymentDoc>(db, 'payment');
  all.sort((a, b) => (b.processedAt || '').localeCompare(a.processedAt || ''));
  return filterByScope(all, scope);
}

/**
 * Look up a payment by its provider/transaction reference. Payment-gateway
 * webhooks (M-Pesa, Airtel, Flutterwave) identify the payment by the reference
 * we passed to the gateway (stored in `PaymentDoc.reference`), not by our `_id`.
 */
export async function getPaymentByReference(reference: string): Promise<PaymentDoc | null> {
  if (!reference) return null;
  const rows = await findByType<PaymentDoc>(paymentsDB(), 'payment', { reference }, { indexFields: ['type', 'reference'] });
  return rows[0] || null;
}

/**
 * Reconcile a payment's status against a payment-gateway callback.
 *
 * Used by the M-Pesa / Airtel / Flutterwave webhook routes: the gateway tells
 * us a previously-initiated payment succeeded or failed, and we move the
 * matching PaymentDoc to the corresponding `PaymentStatus`. The payment is
 * matched by its provider `reference` (transaction id / our reference).
 *
 * Returns the updated doc, or `null` if no payment matches the reference (an
 * unknown/duplicate callback) — callers should still ack the gateway.
 */
export async function updatePaymentStatus(
  reference: string,
  status: PaymentStatus,
  details?: { providerReference?: string; provider?: PaymentDoc['provider']; reason?: string },
): Promise<PaymentDoc | null> {
  const db = paymentsDB();
  const pmt = await getPaymentByReference(reference);
  if (!pmt) return null;

  // Idempotency: gateways may retry callbacks. Persist missing correlators;
  // retry-safe downstream writes use stable idempotency keys.
  const duplicateStatus = pmt.status === status;
  if (duplicateStatus) {
    if ((!pmt.providerReference && details?.providerReference) || (!pmt.provider && details?.provider)) {
      pmt.providerReference ||= details?.providerReference;
      pmt.provider ||= details?.provider;
      pmt.updatedAt = new Date().toISOString();
      const duplicateResp = await db.put(pmt);
      pmt._rev = duplicateResp.rev;
    }
    if (status === 'failed') {
      await reconcilePaymentLinkState(pmt, 'active');
      return pmt;
    }
  }

  pmt.status = status;
  pmt.providerReference = details?.providerReference || pmt.providerReference;
  pmt.provider = details?.provider || pmt.provider;
  if (details?.reason) {
    pmt.notes = pmt.notes ? `${pmt.notes}\n${details.reason}` : details.reason;
  }
  pmt.updatedAt = new Date().toISOString();
  if (!duplicateStatus) {
    const resp = await db.put(pmt);
    pmt._rev = resp.rev;
  }

  // Posting a previously-pending payment (gateway webhook confirmation, or a
  // finance user approving a cash/bank pay-by-link payment) is the moment the
  // money becomes real — credit the patient ledger exactly like collectPayment
  // does for posted-at-creation payments. Without this, webhook-confirmed
  // payments never reduced the patient's balance.
  if (status === 'posted') {
    await createLedgerEntry({
      patientId: pmt.patientId,
      encounterId: pmt.encounterId,
      entryType: 'payment',
      amount: -pmt.amount,
      description: `Payment via ${pmt.method}: ${pmt.amount} ${pmt.currency}`,
      referenceId: pmt._id,
      referenceType: 'payment',
      method: pmt.method,
      currency: pmt.currency,
      facilityId: pmt.facilityId,
      orgId: pmt.orgId,
      createdBy: pmt.processedBy,
      idempotencyKey: `payment:${pmt._id}`,
    });

    // Same bill-settlement mirror as collectPayment, for the same reason:
    // this is a patient-balance payment, not one earmarked to a bill, and
    // without it a webhook-confirmed payment credits the ledger but leaves
    // the BillingDoc(s) it paid down stuck 'pending'/'partial'. Best-effort —
    // the ledger entry above is the record of the money received — but the
    // outcome is persisted onto the doc (see collectPayment) rather than only
    // console.warn'd, so it isn't silently lost.
    let settlementError: string | undefined;
    let settlementUnapplied = 0;
    try {
      const { settleOpenBillsWithPayment } = await import('../billing-service');
      const result = await settleOpenBillsWithPayment({
        patientId: pmt.patientId,
        amount: pmt.amount,
        currency: pmt.currency,
        method: toBillingPaymentMethod(pmt.method),
        receivedBy: pmt.processedBy,
        receivedByName: pmt.processedByName,
        paymentId: pmt._id,
        reference: pmt.reference,
        notes: pmt.notes,
        // See the matching comment in collectPayment — 'org_admin' is a
        // synthetic scope, not a real role, used only to get org-only
        // (not facility-narrowed) filtering out of filterByScope.
        scope: orgOnlyScope(pmt.orgId),
      });
      settlementUnapplied = result.unapplied;
    } catch (err) {
      settlementError = err instanceof Error ? err.message : String(err);
      console.warn('[payment] could not settle open bills for', pmt.patientId, err);
    }

    if (settlementError || settlementUnapplied > 0) {
      pmt.billSettlementError = settlementError;
      pmt.billSettlementUnapplied = settlementUnapplied > 0 ? settlementUnapplied : undefined;
      pmt.updatedAt = new Date().toISOString();
      const resp2 = await db.put(pmt);
      pmt._rev = resp2.rev;
    }
  }

  if (status === 'posted') await reconcilePaymentLinkState(pmt, 'used');
  if (status === 'failed') await reconcilePaymentLinkState(pmt, 'active');

  await logAuditSafe('PAYMENT_STATUS_UPDATED', pmt.processedBy, pmt.processedByName,
    `Payment ${pmt.reference} -> ${status}${details?.providerReference ? ` (provider ref: ${details.providerReference})` : ''}`);

  emitSyncEvent({
    resourceType: 'payment',
    resourceId: pmt._id,
    operation: 'update',
    resourceVersion: pmt._rev,
    orgId: pmt.orgId,
    hospitalId: pmt.facilityId,
  });

  return pmt;
}

export type PaymentReversalErrorCode =
  | 'PAYMENT_NOT_REVERSIBLE' | 'PAYMENT_REFUNDED';

export class PaymentOperationError extends Error {
  constructor(public readonly code: PaymentReversalErrorCode | RefundErrorCode, message: string) {
    super(message);
    this.name = 'PaymentOperationError';
  }
}

/**
 * Void a posted payment. Returns null ONLY when the payment does not exist;
 * every other failure throws so the caller can tell "not found" from "failed".
 *
 * Safe to retry: the status flip is persisted first, but the ledger credit-back
 * uses a deterministic idempotency key and is re-ensured on every call, so a
 * retry after a failed ledger write completes the reversal instead of
 * returning early with the ledger uncorrected. Bill unsettlement is
 * idempotent too (it skips payment records already marked reversed).
 * Refused once any refund has been processed against the payment: the refund
 * already returned (part of) the money, so a full reversal would double it.
 */
export async function reversePayment(
  paymentId: string, reason: string, reversedBy: string, reversedByName: string
): Promise<PaymentDoc | null> {
  const db = paymentsDB();
  let pmt: PaymentDoc;
  try {
    pmt = await db.get(paymentId) as PaymentDoc;
  } catch (err) {
    const e = err as { status?: number; name?: string } | undefined;
    if (e && (e.status === 404 || e.name === 'not_found')) return null;
    throw err;
  }
  if (pmt.status === 'refunded' || (pmt.refundedAmount ?? 0) > 0) {
    throw new PaymentOperationError('PAYMENT_REFUNDED', 'This payment has been refunded and cannot be voided.');
  }
  // A refund document is the record of money returned. issueRefund writes it
  // before it updates the payment, so a crash in between leaves a `posted`
  // payment with refundedAmount 0 - the refund documents decide, not the flag.
  if (pmt.status === 'posted' && (await processedRefundsFor(pmt._id, pmt.patientId)).length > 0) {
    throw new PaymentOperationError('PAYMENT_REFUNDED', 'This payment has been refunded and cannot be voided.');
  }
  if (pmt.status !== 'posted' && pmt.status !== 'reversed') {
    throw new PaymentOperationError('PAYMENT_NOT_REVERSIBLE', 'This payment cannot be voided in its current status.');
  }

  const firstPass = pmt.status !== 'reversed';
  if (firstPass) {
    pmt.status = 'reversed';
    pmt.reversedAt = new Date().toISOString();
    pmt.reversalReason = reason;
    pmt.updatedAt = pmt.reversedAt;
    const resp = await db.put(pmt);
    pmt._rev = resp.rev;
  }

  // Reverse the ledger entry (positive = debit = balance increases). Keyed so
  // a retry returns the existing entry rather than posting a second one.
  await createLedgerEntry({
    patientId: pmt.patientId,
    encounterId: pmt.encounterId,
    entryType: 'payment',
    amount: pmt.amount, // positive reversal
    description: `Payment reversal: ${pmt.reversalReason || reason}`,
    referenceId: pmt._id,
    referenceType: 'payment',
    currency: pmt.currency,
    facilityId: pmt.facilityId,
    orgId: pmt.orgId,
    createdBy: reversedBy,
    idempotencyKey: `payment-reversal:${pmt._id}`,
  });

  // Undo whatever this payment mirrored onto BillingDoc(s) (see
  // settleOpenBillsWithPayment). Without this a reversed payment credits the
  // ledger back while every bill-reading screen still shows the invoice paid.
  // Best-effort: the ledger reversal above is authoritative and must stand even
  // if a bill can't be updated; a failure is recorded on the payment doc.
  try {
    const { unsettleBillsForPayment } = await import('../billing-service');
    const { failedBillIds } = await unsettleBillsForPayment(pmt._id, pmt.patientId, reversedBy, reversedByName, orgOnlyScope(pmt.orgId));
    if (failedBillIds.length > 0) {
      pmt.billSettlementError = `Reversal could not update bill(s): ${failedBillIds.join(', ')}`;
      pmt.updatedAt = new Date().toISOString();
      const resp2 = await db.put(pmt);
      pmt._rev = resp2.rev;
    }
  } catch (err) {
    console.warn('[payment] could not unsettle bills for reversed payment', pmt._id, err);
  }

  if (firstPass) {
    await logAuditSafe('PAYMENT_REVERSED', reversedBy, reversedByName,
      `Reversed payment ${pmt._id}: ${pmt.amount} ${pmt.currency}; reason recorded on the ledger entry`);

    emitSyncEvent({
      resourceType: 'payment',
      resourceId: pmt._id,
      operation: 'update',
      resourceVersion: pmt._rev,
      orgId: pmt.orgId,
      hospitalId: pmt.facilityId,
    });
  }

  return pmt;
}
