/**
 * Payments Service — collecting/reversing payments, pay-by-link, financial
 * adjustments, refunds, and saved payment methods. Split out of
 * payment-service.ts; re-exported from there so no caller needs to change.
 */
import type {
  PaymentDoc, PaymentMethodType, PaymentStatus, PaymentAllocation,
  RefundDoc,
  SavedPaymentMethodDoc, SavedPaymentMethodType,
  AdjustmentDoc, AdjustmentType,
} from '../db-types-payments';
import type { BaseDoc } from '../db-types';
import type { PaymentMethod as BillingPaymentMethod } from '../db-types-billing';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { findByType } from './db-query';
import { createLedgerEntry } from './ledger-service';
import { assertRefExists, paymentsDB, refundsDB, adjustmentsDB, savedPaymentMethodsDB } from './payment-dbs';

// ═══════════════════════════════════════════════════════════════════
// PAYMENTS
// ═══════════════════════════════════════════════════════════════════

/**
 * `collectPayment`'s tender/provider is more granular than the BillingDoc
 * `PaymentRecord.method` union (predates mobile-money providers and card).
 * Map onto the closest billing category so a settled bill's payment history
 * stays readable — the exact tender is still on the authoritative PaymentDoc
 * this collectPayment call creates.
 */
function toBillingPaymentMethod(method: PaymentMethodType): BillingPaymentMethod {
  switch (method) {
    case 'cash': return 'cash';
    case 'bank_transfer': return 'bank_transfer';
    case 'insurance': return 'insurance';
    case 'waiver': return 'waiver';
    case 'mpesa':
    case 'airtel':
    case 'mtn_momo':
    case 'm_gurush':
      return 'mobile_money';
    // No card/payment-plan category on the bill side — an electronic
    // bank-rail settlement is the closest existing bucket.
    case 'card':
    case 'payment_plan':
      return 'bank_transfer';
    default:
      return 'cash';
  }
}

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
    _id: `pmt-${uuidv4().slice(0, 10)}`,
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
    const { settleOpenBillsWithPayment } = await import('./billing-service');
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
      scope: input.orgId ? ({ role: 'org_admin', orgId: input.orgId } as DataScope) : undefined,
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
    `${input.amount} ${doc.currency} via ${input.method} from ${input.patientName} (ref: ${doc.reference})`
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

export async function getPaymentsByPatient(patientId: string): Promise<PaymentDoc[]> {
  const rows = await findByType<PaymentDoc>(paymentsDB(), 'payment', { patientId }, { indexFields: ['type', 'patientId'] });
  return rows
    .sort((a, b) => (b.processedAt || '').localeCompare(a.processedAt || ''));
}

export async function getAllPayments(scope?: DataScope): Promise<PaymentDoc[]> {
  const db = paymentsDB();
  const all = await findByType<PaymentDoc>(db, 'payment');
  all.sort((a, b) => (b.processedAt || '').localeCompare(a.processedAt || ''));
  return scope ? filterByScope(all, scope) : all;
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
  details?: { providerReference?: string; reason?: string },
): Promise<PaymentDoc | null> {
  const db = paymentsDB();
  const pmt = await getPaymentByReference(reference);
  if (!pmt) return null;

  // Idempotency: gateways may retry callbacks. Don't re-process an already
  // terminal payment or churn the ledger.
  if (pmt.status === status) return pmt;

  const wasPending = pmt.status === 'pending';
  pmt.status = status;
  if (details?.reason) {
    pmt.notes = pmt.notes ? `${pmt.notes}\n${details.reason}` : details.reason;
  }
  pmt.updatedAt = new Date().toISOString();
  const resp = await db.put(pmt);
  pmt._rev = resp.rev;

  // Posting a previously-pending payment (gateway webhook confirmation, or a
  // finance user approving a cash/bank pay-by-link payment) is the moment the
  // money becomes real — credit the patient ledger exactly like collectPayment
  // does for posted-at-creation payments. Without this, webhook-confirmed
  // payments never reduced the patient's balance.
  if (wasPending && status === 'posted') {
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
      const { settleOpenBillsWithPayment } = await import('./billing-service');
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
        scope: pmt.orgId ? ({ role: 'org_admin', orgId: pmt.orgId } as DataScope) : undefined,
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

export async function reversePayment(
  paymentId: string, reason: string, reversedBy: string, reversedByName: string
): Promise<PaymentDoc | null> {
  const db = paymentsDB();
  try {
    const pmt = await db.get(paymentId) as PaymentDoc;
    if (pmt.status === 'reversed') return pmt;

    pmt.status = 'reversed';
    pmt.reversedAt = new Date().toISOString();
    pmt.reversalReason = reason;
    pmt.updatedAt = pmt.reversedAt;
    const resp = await db.put(pmt);
    pmt._rev = resp.rev;

    // Reverse the ledger entry (positive = debit = balance increases)
    await createLedgerEntry({
      patientId: pmt.patientId,
      encounterId: pmt.encounterId,
      entryType: 'payment',
      amount: pmt.amount, // positive reversal
      description: `Payment reversal: ${reason}`,
      referenceId: pmt._id,
      referenceType: 'payment',
      facilityId: pmt.facilityId,
      orgId: pmt.orgId,
    });

    // Undo whatever this payment mirrored onto BillingDoc(s) (see
    // settleOpenBillsWithPayment). Before that mirror existed this was
    // symmetric — payments never touched bills, so a reversal had nothing to
    // undo there. Now a payment can flip a bill to 'partial'/'paid', so
    // without this a reversed payment credits the ledger back (patient owes
    // again) while every bill-reading screen still shows the invoice paid —
    // permanently and silently contradictory. Best-effort: the ledger
    // reversal above is authoritative and must stand even if a bill can't be
    // updated; a failure is recorded on the payment doc, not retried here.
    try {
      const { unsettleBillsForPayment } = await import('./billing-service');
      const { failedBillIds } = await unsettleBillsForPayment(pmt._id, pmt.patientId, reversedBy, reversedByName);
      if (failedBillIds.length > 0) {
        pmt.billSettlementError = `Reversal could not update bill(s): ${failedBillIds.join(', ')}`;
        pmt.updatedAt = new Date().toISOString();
        const resp2 = await db.put(pmt);
        pmt._rev = resp2.rev;
      }
    } catch (err) {
      console.warn('[payment] could not unsettle bills for reversed payment', pmt._id, err);
    }

    await logAuditSafe('PAYMENT_REVERSED', reversedBy, reversedByName,
      `Reversed ${pmt.amount} ${pmt.currency} — ${reason}`);

    emitSyncEvent({
      resourceType: 'payment',
      resourceId: pmt._id,
      operation: 'update',
      resourceVersion: pmt._rev,
      orgId: pmt.orgId,
      hospitalId: pmt.facilityId,
    });

    return pmt;
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════
// PAYMENT LINKS (pay-by-link)
// ═══════════════════════════════════════════════════════════════════

/**
 * A "pay-by-link" record. There's no dedicated payment-link database, so these
 * persist as small docs in the existing payments DB (distinguished by
 * `type: 'payment_link'`). The link's public id doubles as the doc `_id` so a
 * GET by id is a direct `db.get` lookup.
 */
export interface PaymentLinkDoc extends BaseDoc {
  type: 'payment_link';
  linkId: string;
  url: string;
  amount: number;
  currency: string;
  description: string;
  expiresAt: string;
  status: 'active' | 'expired' | 'used';
  patientId: string;
  facilityId: string;
  orgId?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export interface CreatePaymentLinkInput {
  linkId: string;
  url: string;
  patientId: string;
  amount: number;
  currency: string;
  description: string;
  expiresAt: string;
  facilityId: string;
  orgId?: string;
  createdBy?: string;
}

export async function createPaymentLink(input: CreatePaymentLinkInput): Promise<PaymentLinkDoc> {
  const db = paymentsDB();
  const now = new Date().toISOString();
  const doc: PaymentLinkDoc = {
    _id: `plink-${input.linkId}`,
    type: 'payment_link',
    linkId: input.linkId,
    url: input.url,
    patientId: input.patientId,
    amount: input.amount,
    currency: input.currency,
    description: input.description,
    expiresAt: input.expiresAt,
    status: 'active',
    facilityId: input.facilityId,
    orgId: input.orgId,
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy,
  };
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  emitSyncEvent({
    resourceType: 'payment_link',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });
  return doc;
}

/**
 * Fetch a payment link by its public id. Returns null if unknown. The stored
 * `status` is reconciled against `expiresAt` so an expired link reads as such
 * even if it was never explicitly marked.
 */
export async function getPaymentLink(linkId: string): Promise<PaymentLinkDoc | null> {
  const db = paymentsDB();
  try {
    const doc = await db.get(`plink-${linkId}`) as PaymentLinkDoc;
    if (doc.status === 'active' && doc.expiresAt && new Date(doc.expiresAt).getTime() < Date.now()) {
      doc.status = 'expired';
    }
    return doc;
  } catch {
    return null;
  }
}

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
    _id: `adj-${uuidv4().slice(0, 10)}`,
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
    `${input.adjustmentType} of ${input.amount}: ${input.reason}`);

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

// ═══════════════════════════════════════════════════════════════════
// REFUNDS
// ═══════════════════════════════════════════════════════════════════

export async function issueRefund(input: {
  paymentId: string;
  patientId: string;
  patientName: string;
  amount: number;
  currency?: string;
  method: PaymentMethodType;
  reason: string;
  processedBy: string;
  processedByName: string;
  facilityId: string;
  orgId?: string;
}): Promise<RefundDoc> {
  const db = refundsDB();
  const now = new Date().toISOString();

  const doc: RefundDoc = {
    _id: `ref-${uuidv4().slice(0, 10)}`,
    type: 'refund',
    ...input,
    currency: input.currency || 'SSP',
    reference: `REF-${uuidv4().slice(0, 8).toUpperCase()}`,
    status: 'processed',
    processedAt: now,
    createdAt: now,
    updatedAt: now,
    createdBy: input.processedBy,
  };

  const resp = await db.put(doc);
  doc._rev = resp.rev;

  // Create ledger entry (positive = debit = balance increases because we gave money back)
  await createLedgerEntry({
    patientId: input.patientId,
    entryType: 'refund',
    amount: input.amount,
    description: `Refund: ${input.reason}`,
    referenceId: doc._id,
    referenceType: 'refund',
    method: input.method,
    currency: doc.currency,
    facilityId: input.facilityId,
    orgId: input.orgId,
    createdBy: input.processedBy,
  });

  await logAuditSafe('REFUND_ISSUED', input.processedBy, input.processedByName,
    `Refund ${input.amount} ${doc.currency} to ${input.patientName}: ${input.reason}`);

  emitSyncEvent({
    resourceType: 'refund',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });

  return doc;
}

export async function getRefundsByPatient(patientId: string): Promise<RefundDoc[]> {
  const rows = await findByType<RefundDoc>(refundsDB(), 'refund', { patientId }, { indexFields: ['type', 'patientId'] });
  return rows;
}

// ═══════════════════════════════════════════════════════════════════
// SAVED PAYMENT METHODS
// ═══════════════════════════════════════════════════════════════════

export async function savePaymentMethod(input: {
  patientId: string;
  methodType: SavedPaymentMethodType;
  phoneNumber?: string;
  cardToken?: string;
  cardLast4?: string;
  cardBrand?: string;
  cardExpiry?: string;
  bankName?: string;
  bankAccountLast4?: string;
  label?: string;
  isDefault?: boolean;
  facilityId: string;
  orgId?: string;
}): Promise<SavedPaymentMethodDoc> {
  const db = savedPaymentMethodsDB();
  const now = new Date().toISOString();

  // Auto-generate label
  let label = input.label;
  if (!label) {
    if (input.phoneNumber) label = `${input.methodType === 'mpesa' ? 'M-Pesa' : input.methodType === 'airtel' ? 'Airtel' : 'MTN'} \u2022\u2022\u2022${input.phoneNumber.slice(-4)}`;
    else if (input.cardLast4) label = `${input.cardBrand || 'Card'} \u2022\u2022\u2022${input.cardLast4}`;
    else if (input.bankAccountLast4) label = `${input.bankName || 'Bank'} \u2022\u2022\u2022${input.bankAccountLast4}`;
    else label = input.methodType;
  }

  const doc: SavedPaymentMethodDoc = {
    _id: `spm-${uuidv4().slice(0, 10)}`,
    type: 'saved_payment_method',
    ...input,
    label,
    isDefault: input.isDefault || false,
    createdAt: now,
    updatedAt: now,
  };

  const resp = await db.put(doc);
  doc._rev = resp.rev;
  return doc;
}

export async function getPatientPaymentMethods(patientId: string): Promise<SavedPaymentMethodDoc[]> {
  const rows = await findByType<SavedPaymentMethodDoc>(savedPaymentMethodsDB(), 'saved_payment_method', { patientId }, { indexFields: ['type', 'patientId'] });
  return rows;
}

/** Remove a saved payment method (patient-managed convenience record). */
export async function deletePaymentMethod(id: string): Promise<boolean> {
  const db = savedPaymentMethodsDB();
  try {
    const doc = await db.get(id);
    await db.remove(doc);
    await logAuditSafe('DELETE_PAYMENT_METHOD', undefined, undefined, `Saved payment method ${id} removed`);
    return true;
  } catch {
    return false;
  }
}
