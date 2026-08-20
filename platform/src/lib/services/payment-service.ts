/**
 * Payment Service — handles collecting payments, managing insurance,
 * payment plans, refunds, invoicing, and eligibility verification.
 * All financial mutations create corresponding ledger entries.
 */
import { getDB } from '../db';
import { findByType } from './db-query';

/**
 * Referential-integrity guard: throw if an id is provided but the referenced
 * document doesn't exist, so charges/payments can't be created pointing at a
 * missing encounter/invoice (which would silently break reports + audit trails).
 */
async function assertRefExists(dbName: string, id: string | undefined, label: string): Promise<void> {
  if (!id) return;
  try {
    await getDB(dbName).get(id);
  } catch {
    throw new Error(`${label} ${id} does not exist — refusing to create an orphaned record.`);
  }
}
import type {
  PaymentDoc, PaymentMethodType, PaymentStatus, PaymentAllocation,
  InsurancePolicyDoc, PayerType,
  EligibilityCheckDoc, EligibilityStatus, EligibilitySource,
  RefundDoc,
  SavedPaymentMethodDoc, SavedPaymentMethodType,
  PaymentPlanDoc, PlanInstallment,
  InvoiceDoc, InvoiceLineItem, InvoiceStatus,
  ClaimDoc, ClaimStatus,
  AdjustmentDoc, AdjustmentType,
  ChargeDoc, ChargeStatus,
  PatientFinancialSummary,
} from '../db-types-payments';
import type { BaseDoc } from '../db-types';
import type { BillingDoc, PaymentMethod as BillingPaymentMethod } from '../db-types-billing';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { nextSequence } from './doc-counter';
import { createLedgerEntry, getPatientBalance } from './ledger-service';
import { jubaDate } from '../time-juba';
import { getSettings } from '../settings/settings-store';
import { toIsoDate, todayIso } from '@/lib/date-utils';

const COLLECTION_STAGE_DAYS = {
  followUp: Number(process.env.COLLECTION_STAGE_FOLLOWUP_DAYS) || 30,
  warning: Number(process.env.COLLECTION_STAGE_WARNING_DAYS) || 60,
  preWriteOff: Number(process.env.COLLECTION_STAGE_PREWRITEOFF_DAYS) || 90,
};

// ═══ Database accessors ════════════════════════════════════════════
const paymentsDB = () => getDB('tamamhealth_payments');
const insurancePoliciesDB = () => getDB('tamamhealth_insurance_policies');
const eligibilityChecksDB = () => getDB('tamamhealth_eligibility_checks');
const refundsDB = () => getDB('tamamhealth_refunds');
const savedPaymentMethodsDB = () => getDB('tamamhealth_saved_payment_methods');
const paymentPlansDB = () => getDB('tamamhealth_payment_plans');
const invoicesDB = () => getDB('tamamhealth_invoices');
const claimsDB = () => getDB('tamamhealth_claims');
const adjustmentsDB = () => getDB('tamamhealth_adjustments');
const chargesDB = () => getDB('tamamhealth_charges');
const billingDB = () => getDB('tamamhealth_billing');

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
  /** CAS-protected reservation for the one active checkout attempt. */
  pendingPaymentId?: string;
  pendingReference?: string;
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

export interface StartPaymentLinkAttemptInput {
  linkId: string;
  method: PaymentMethodType;
  payerPhone?: string;
}

export interface StartPaymentLinkAttemptResult {
  payment: PaymentDoc;
  created: boolean;
}

/**
 * Reserve and create the single active payment attempt for a public link.
 * The PaymentLink revision is the compare-and-swap lock: concurrent submits
 * race on the same revision, one wins, and the loser returns that winner's
 * payment rather than creating a duplicate.
 */
export async function startPaymentLinkAttempt(
  input: StartPaymentLinkAttemptInput,
): Promise<StartPaymentLinkAttemptResult> {
  const db = paymentsDB();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const link = await getPaymentLink(input.linkId);
    if (!link) throw new Error('PAYMENT_LINK_NOT_FOUND');
    if (link.status === 'used') throw new Error('PAYMENT_LINK_USED');
    if (link.status === 'expired' || (link.expiresAt && new Date(link.expiresAt).getTime() < Date.now())) {
      throw new Error('PAYMENT_LINK_EXPIRED');
    }

    if (link.pendingPaymentId && link.pendingReference) {
      try {
        const existing = await db.get(link.pendingPaymentId) as PaymentDoc;
        if (existing.status === 'pending' || existing.status === 'posted') {
          return { payment: existing, created: false };
        }
      } catch {
        // A concurrent request may be between reserving the link and writing
        // its payment. Give it time to finish; only clear reservations old
        // enough to indicate an interrupted process.
        const reservationAge = Date.now() - new Date(link.updatedAt).getTime();
        if (Number.isFinite(reservationAge) && reservationAge < 120_000) {
          await new Promise(resolve => setTimeout(resolve, 10));
          continue;
        }
      }
      delete link.pendingPaymentId;
      delete link.pendingReference;
      link.updatedAt = new Date().toISOString();
      try {
        await db.put(link);
      } catch (error) {
        if ((error as { status?: number }).status === 409) continue;
        throw error;
      }
      continue;
    }

    const now = new Date().toISOString();
    const reference = `PBL-${link.linkId.slice(0, 8).toUpperCase()}-${uuidv4().slice(0, 6).toUpperCase()}`;
    const paymentId = `pmt-${uuidv4()}`;
    link.pendingPaymentId = paymentId;
    link.pendingReference = reference;
    link.updatedAt = now;

    try {
      const reservation = await db.put(link);
      link._rev = reservation.rev;
    } catch (error) {
      if ((error as { status?: number }).status === 409) continue;
      throw error;
    }

    const payment: PaymentDoc = {
      _id: paymentId,
      type: 'payment',
      patientId: link.patientId,
      patientName: '',
      method: input.method,
      amount: link.amount,
      currency: link.currency,
      reference,
      paymentLinkId: link.linkId,
      mobileMoneyPhone: input.payerPhone,
      status: 'pending',
      processedAt: now,
      processedBy: 'pay-by-link',
      processedByName: 'Pay-by-link (payer self-service)',
      notes: '[PAY_BY_LINK] pending_verification — awaiting provider or staff confirmation',
      facilityId: link.facilityId,
      orgId: link.orgId,
      createdAt: now,
      updatedAt: now,
      createdBy: 'pay-by-link',
    };

    try {
      const response = await db.put(payment);
      payment._rev = response.rev;
    } catch (error) {
      // Release only our own reservation so a retry is possible.
      try {
        const latest = await db.get(link._id) as PaymentLinkDoc;
        if (latest.pendingPaymentId === paymentId) {
          delete latest.pendingPaymentId;
          delete latest.pendingReference;
          latest.updatedAt = new Date().toISOString();
          await db.put(latest);
        }
      } catch { /* original storage error is more useful */ }
      throw error;
    }

    await logAuditSafe(
      'PAY_BY_LINK_SUBMITTED', 'pay-by-link', 'Pay-by-link',
      `Pending payment ${payment._id} recorded for payment link ${link.linkId}`,
    );
    emitSyncEvent({
      resourceType: 'payment', resourceId: payment._id, operation: 'create',
      resourceVersion: payment._rev, orgId: payment.orgId, hospitalId: payment.facilityId,
    });
    emitSyncEvent({
      resourceType: 'payment_link', resourceId: link._id, operation: 'update',
      resourceVersion: link._rev, orgId: link.orgId, hospitalId: link.facilityId,
    });
    return { payment, created: true };
  }

  throw new Error('PAYMENT_LINK_CONFLICT');
}

async function reconcilePaymentLinkState(payment: PaymentDoc, status: PaymentLinkDoc['status']): Promise<void> {
  if (!payment.paymentLinkId) return;
  const db = paymentsDB();
  try {
    const link = await db.get(`plink-${payment.paymentLinkId}`) as PaymentLinkDoc;
    if (status === 'used') {
      link.status = 'used';
    } else if (link.pendingPaymentId === payment._id) {
      link.status = 'active';
      delete link.pendingPaymentId;
      delete link.pendingReference;
    } else {
      return;
    }
    link.updatedAt = new Date().toISOString();
    const response = await db.put(link);
    link._rev = response.rev;
    emitSyncEvent({
      resourceType: 'payment_link', resourceId: link._id, operation: 'update',
      resourceVersion: link._rev, orgId: link.orgId, hospitalId: link.facilityId,
    });
  } catch (error) {
    // A payment posting must remain retryable when the link state cannot be
    // persisted. Propagate conflicts/storage failures to the webhook route.
    throw error;
  }
}

export type PaymentProvider = NonNullable<PaymentDoc['provider']>;

export interface ProviderReconciliationInput {
  reference: string;
  provider: PaymentProvider;
  status: Extract<PaymentStatus, 'posted' | 'failed'>;
  providerReference?: string;
  amount?: number;
  currency?: string;
  reason?: string;
}

export interface ProviderReconciliationResult {
  outcome: 'updated' | 'duplicate' | 'not_found' | 'mismatch' | 'invalid_state';
  payment?: PaymentDoc;
  reason?: string;
}

const PROVIDER_METHODS: Record<PaymentProvider, PaymentMethodType[]> = {
  flutterwave: ['card'],
  airtel: ['airtel'],
  mpesa: ['mpesa'],
};

function sameMoneyAmount(expected: number, received: number): boolean {
  return Number.isFinite(received) && received > 0
    && Math.abs(Math.round(expected * 100) - Math.round(received * 100)) === 0;
}

/**
 * Validate every gateway-asserted value before allowing a pending payment to
 * post. Mismatches are acknowledged by routes but never mutate the payment.
 */
export async function reconcileProviderPayment(
  input: ProviderReconciliationInput,
): Promise<ProviderReconciliationResult> {
  const payment = await getPaymentByReference(input.reference);
  if (!payment) return { outcome: 'not_found' };

  if (!PROVIDER_METHODS[input.provider].includes(payment.method)) {
    return { outcome: 'mismatch', payment, reason: 'provider_method' };
  }
  if (payment.provider && payment.provider !== input.provider) {
    return { outcome: 'mismatch', payment, reason: 'provider' };
  }
  if (input.status === 'posted') {
    if (input.amount === undefined || !sameMoneyAmount(payment.amount, input.amount)) {
      return { outcome: 'mismatch', payment, reason: 'amount' };
    }
    if (!input.currency || payment.currency.toUpperCase() !== input.currency.toUpperCase()) {
      return { outcome: 'mismatch', payment, reason: 'currency' };
    }
    if (!input.providerReference) {
      return { outcome: 'mismatch', payment, reason: 'provider_reference' };
    }

    const reused = await findByType<PaymentDoc>(
      paymentsDB(), 'payment', { providerReference: input.providerReference },
      { indexFields: ['type', 'providerReference'] },
    );
    if (reused.some(candidate => candidate._id !== payment._id)) {
      return { outcome: 'mismatch', payment, reason: 'provider_reference_reused' };
    }
  }

  if (payment.status === input.status) {
    if (payment.providerReference && input.providerReference
      && payment.providerReference !== input.providerReference) {
      return { outcome: 'mismatch', payment, reason: 'provider_reference' };
    }
    await updatePaymentStatus(input.reference, input.status, {
      provider: input.provider,
      providerReference: input.providerReference,
    });
    return { outcome: 'duplicate', payment };
  }
  if (payment.status !== 'pending') {
    return { outcome: 'invalid_state', payment, reason: payment.status };
  }

  const updated = await updatePaymentStatus(input.reference, input.status, {
    provider: input.provider,
    providerReference: input.providerReference,
    reason: input.reason,
  });
  return { outcome: 'updated', payment: updated || payment };
}

// ═══════════════════════════════════════════════════════════════════
// INSURANCE POLICIES
// ═══════════════════════════════════════════════════════════════════

export interface CreateInsurancePolicyInput {
  patientId: string;
  payerType: PayerType;
  payerName: string;
  payerCode?: string;
  memberId?: string;
  groupNumber?: string;
  policyNumber?: string;
  subscriberName?: string;
  subscriberRelationship?: 'self' | 'spouse' | 'child' | 'other';
  effectiveDate: string;
  terminationDate?: string;
  isPrimary: boolean;
  copayAmount?: number;
  coinsurancePct?: number;
  deductibleAmount?: number;
  deductibleRemaining?: number;
  oopMax?: number;
  coverageNotes?: string;
  donorProgramId?: string;
  donorCoverageType?: 'full' | 'partial' | 'emergency_only';
  facilityId: string;
  orgId?: string;
  createdBy?: string;
}

export async function createInsurancePolicy(input: CreateInsurancePolicyInput): Promise<InsurancePolicyDoc> {
  const db = insurancePoliciesDB();
  const now = new Date().toISOString();

  // If marking as primary, unmark other policies for this patient
  if (input.isPrimary) {
    const existing = await getPatientInsurancePolicies(input.patientId);
    for (const p of existing) {
      if (p.isPrimary) {
        p.isPrimary = false;
        p.updatedAt = now;
        await db.put(p);
      }
    }
  }

  const doc: InsurancePolicyDoc = {
    _id: `ins-${uuidv4()}`,
    type: 'insurance_policy',
    ...input,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy,
  };

  const resp = await db.put(doc);
  doc._rev = resp.rev;
  emitSyncEvent({
    resourceType: 'insurance_policy',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });
  return doc;
}

export async function getPatientInsurancePolicies(patientId: string): Promise<InsurancePolicyDoc[]> {
  const db = insurancePoliciesDB();
  const rows = await findByType<InsurancePolicyDoc>(db, 'insurance_policy', { patientId }, { indexFields: ['type', 'patientId'] });
  return rows
    .filter(d => d && d.isActive)
    .sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0));
}

/** Patient ids holding at least one active insurance policy — one bulk query
 *  so list views can badge every row without a per-patient lookup. */
export async function getInsuredPatientIds(): Promise<Set<string>> {
  const rows = await findByType<InsurancePolicyDoc>(insurancePoliciesDB(), 'insurance_policy');
  return new Set(rows.filter(d => d && d.isActive).map(d => d.patientId));
}

export async function getPrimaryPolicy(patientId: string): Promise<InsurancePolicyDoc | null> {
  const policies = await getPatientInsurancePolicies(patientId);
  return policies.find(p => p.isPrimary) || policies[0] || null;
}

export async function updateInsurancePolicy(id: string, updates: Partial<InsurancePolicyDoc>): Promise<InsurancePolicyDoc | null> {
  const db = insurancePoliciesDB();
  try {
    const doc = await db.get(id) as InsurancePolicyDoc;
    Object.assign(doc, updates, { updatedAt: new Date().toISOString() });
    const resp = await db.put(doc);
    doc._rev = resp.rev;
    emitSyncEvent({
      resourceType: 'insurance_policy',
      resourceId: doc._id,
      operation: 'update',
      resourceVersion: doc._rev,
      orgId: doc.orgId,
      hospitalId: doc.facilityId,
    });
    return doc;
  } catch { return null; }
}

export async function deactivateInsurancePolicy(id: string): Promise<boolean> {
  const db = insurancePoliciesDB();
  try {
    const doc = await db.get(id) as InsurancePolicyDoc;
    doc.isActive = false;
    doc.updatedAt = new Date().toISOString();
    const resp = await db.put(doc);
    doc._rev = resp.rev;
    emitSyncEvent({
      resourceType: 'insurance_policy',
      resourceId: doc._id,
      operation: 'update',
      resourceVersion: doc._rev,
      orgId: doc.orgId,
      hospitalId: doc.facilityId,
    });
    return true;
  } catch { return false; }
}

// ═══════════════════════════════════════════════════════════════════
// ELIGIBILITY VERIFICATION
// ═══════════════════════════════════════════════════════════════════

export interface CheckEligibilityInput {
  policyId: string;
  patientId: string;
  source?: EligibilitySource;
  checkedBy: string;
  facilityId: string;
  orgId?: string;
}

export async function checkEligibility(input: CheckEligibilityInput): Promise<EligibilityCheckDoc> {
  const db = eligibilityChecksDB();
  const now = new Date().toISOString();

  // Get the policy to pull payer details
  const policy = await getPrimaryPolicy(input.patientId);

  // This is NOT an external payer verification — we have no EDI 270/271 or
  // payer-API integration here. We're producing a LOCAL ESTIMATE off the
  // stored policy terms. Be honest about that: report `unverified` (the doc's
  // status union has no `estimated` value) and record the basis in
  // `rawResponse` so downstream consumers/auditors don't mistake this for a
  // confirmed payer response. Only when a real external source is explicitly
  // passed in (api/edi271/donor_list) do we treat it as verified.
  const isExternal = input.source === 'api' || input.source === 'edi271' || input.source === 'donor_list';
  const status: EligibilityStatus = isExternal ? 'verified' : 'unverified';
  const source: EligibilitySource = input.source || 'manual';

  const doc: EligibilityCheckDoc = {
    _id: `elig-${uuidv4()}`,
    type: 'eligibility_check',
    policyId: input.policyId,
    patientId: input.patientId,
    checkDate: now,
    status,
    deductibleRemaining: policy?.deductibleRemaining,
    copayAmount: policy?.copayAmount,
    coinsurancePct: policy?.coinsurancePct,
    oopUsed: policy?.oopUsed,
    oopMax: policy?.oopMax,
    source,
    rawResponse: isExternal
      ? undefined
      : JSON.stringify({ method: 'local_policy_estimate', note: 'Local estimate from stored policy terms; not confirmed with the payer.' }),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    checkedBy: input.checkedBy,
    facilityId: input.facilityId,
    orgId: input.orgId,
    createdAt: now,
    updatedAt: now,
  };

  const resp = await db.put(doc);
  doc._rev = resp.rev;
  emitSyncEvent({
    resourceType: 'eligibility_check',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });
  return doc;
}

export async function getLatestEligibility(patientId: string): Promise<EligibilityCheckDoc | null> {
  const db = eligibilityChecksDB();
  const checks = (await findByType<EligibilityCheckDoc>(db, 'eligibility_check', { patientId }, { indexFields: ['type', 'patientId'] }))
    .sort((a, b) => (b.checkDate || '').localeCompare(a.checkDate || ''));
  return checks[0] || null;
}

export function estimatePatientResponsibility(
  billedAmount: number,
  copay: number = 0,
  coinsurancePct: number = 0,
  deductibleRemaining: number = 0,
): number {
  // Patient pays deductible first, then coinsurance on the rest
  const afterDeductible = Math.max(0, billedAmount - deductibleRemaining);
  const deductiblePortion = Math.min(billedAmount, deductibleRemaining);
  const coinsurancePortion = afterDeductible * (coinsurancePct / 100);
  return Math.round((copay + deductiblePortion + coinsurancePortion) * 100) / 100;
}

// ═══════════════════════════════════════════════════════════════════
// CHARGES
// ═══════════════════════════════════════════════════════════════════

export interface CreateChargeInput {
  encounterId: string;
  patientId: string;
  cptCode?: string;
  icdCodes?: string[];
  modifier?: string;
  description: string;
  category: string;
  units: number;
  billedAmount: number;
  serviceDate: string;
  providerId?: string;
  providerName?: string;
  facilityId: string;
  orgId?: string;
  createdBy?: string;
}

export async function createCharge(input: CreateChargeInput): Promise<ChargeDoc> {
  const db = chargesDB();
  const now = new Date().toISOString();
  // Don't create a charge linked to a non-existent encounter.
  await assertRefExists('tamamhealth_encounters', input.encounterId, 'Encounter');

  const doc: ChargeDoc = {
    _id: `chg-${uuidv4()}`,
    type: 'charge',
    ...input,
    status: 'pending' as ChargeStatus,
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy,
  };

  const resp = await db.put(doc);
  doc._rev = resp.rev;

  // Create ledger entry (positive = debit = patient owes more)
  await createLedgerEntry({
    patientId: input.patientId,
    encounterId: input.encounterId,
    entryType: 'charge',
    amount: input.billedAmount * input.units,
    description: `Charge: ${input.description} (${input.units}x $${input.billedAmount})`,
    referenceId: doc._id,
    referenceType: 'charge',
    currency: 'SSP',
    facilityId: input.facilityId,
    orgId: input.orgId,
    createdBy: input.createdBy,
  });

  emitSyncEvent({
    resourceType: 'charge',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });

  return doc;
}

export async function getChargesByEncounter(encounterId: string): Promise<ChargeDoc[]> {
  const db = chargesDB();
  return findByType<ChargeDoc>(db, 'charge', { encounterId }, { indexFields: ['type', 'encounterId'] });
}

export async function getChargesByPatient(patientId: string): Promise<ChargeDoc[]> {
  const rows = await findByType<ChargeDoc>(chargesDB(), 'charge', { patientId }, { indexFields: ['type', 'patientId'] });
  return rows
    .sort((a, b) => (b.serviceDate || '').localeCompare(a.serviceDate || ''));
}

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
    _id: `clm-${uuidv4()}`,
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
    _id: `ref-${uuidv4()}`,
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
// PAYMENT PLANS
// ═══════════════════════════════════════════════════════════════════

export async function createPaymentPlan(input: {
  patientId: string;
  patientName: string;
  totalBalance: number;
  termMonths: number;
  apr?: number;
  encounterIds: string[];
  autoPayMethodId?: string;
  createdByStaff: string;
  createdByStaffName: string;
  facilityId: string;
  orgId?: string;
}): Promise<PaymentPlanDoc> {
  const db = paymentPlansDB();
  const now = new Date().toISOString();
  const apr = input.apr || 0;
  const monthlyAmount = Math.ceil((input.totalBalance / input.termMonths) * 100) / 100;

  // Generate installment schedule
  const installments: PlanInstallment[] = [];
  const startDate = new Date();
  for (let i = 0; i < input.termMonths; i++) {
    const dueDate = new Date(startDate);
    dueDate.setMonth(dueDate.getMonth() + i + 1);
    dueDate.setDate(1); // Due on the 1st of each month
    const isLast = i === input.termMonths - 1;
    const amt = isLast
      ? Math.round((input.totalBalance - monthlyAmount * (input.termMonths - 1)) * 100) / 100
      : monthlyAmount;
    installments.push({
      number: i + 1,
      dueDate: toIsoDate(dueDate),
      amount: amt,
      status: 'pending',
    });
  }

  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + input.termMonths + 1);

  const doc: PaymentPlanDoc = {
    _id: `plan-${uuidv4()}`,
    type: 'payment_plan',
    patientId: input.patientId,
    patientName: input.patientName,
    totalBalance: input.totalBalance,
    termMonths: input.termMonths,
    monthlyAmount,
    apr,
    startDate: now.slice(0, 10),
    endDate: toIsoDate(endDate),
    status: 'active',
    nextDueDate: installments[0]?.dueDate,
    paidToDate: 0,
    remainingBalance: input.totalBalance,
    missedPayments: 0,
    autoPayEnabled: !!input.autoPayMethodId,
    autoPayMethodId: input.autoPayMethodId,
    encounterIds: input.encounterIds,
    installments,
    createdByStaff: input.createdByStaff,
    createdByStaffName: input.createdByStaffName,
    facilityId: input.facilityId,
    orgId: input.orgId,
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdByStaff,
  };

  const resp = await db.put(doc);
  doc._rev = resp.rev;

  await logAuditSafe('PAYMENT_PLAN_CREATED', input.createdByStaff, input.createdByStaffName,
    `Plan for ${input.patientName}: ${input.totalBalance} over ${input.termMonths} months`);

  emitSyncEvent({
    resourceType: 'payment_plan',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });

  return doc;
}

export async function getPaymentPlansByPatient(patientId: string): Promise<PaymentPlanDoc[]> {
  const rows = await findByType<PaymentPlanDoc>(paymentPlansDB(), 'payment_plan', { patientId }, { indexFields: ['type', 'patientId'] });
  return rows
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export async function getAllPaymentPlans(scope?: DataScope): Promise<PaymentPlanDoc[]> {
  const db = paymentPlansDB();
  const all = await findByType<PaymentPlanDoc>(db, 'payment_plan');
  all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return scope ? filterByScope(all, scope) : all;
}

export async function recordPlanPayment(planId: string, installmentNumber: number, paymentId: string, amount: number): Promise<PaymentPlanDoc | null> {
  const db = paymentPlansDB();
  try {
    const plan = await db.get(planId) as PaymentPlanDoc;
    const installment = plan.installments.find(i => i.number === installmentNumber);
    if (installment) {
      installment.status = amount >= installment.amount ? 'paid' : 'partial';
      installment.paidAmount = amount;
      installment.paidDate = todayIso();
      installment.paymentId = paymentId;
    }

    plan.paidToDate = Math.round((plan.paidToDate + amount) * 100) / 100;
    plan.remainingBalance = Math.round((plan.totalBalance - plan.paidToDate) * 100) / 100;
    plan.lastPaymentDate = new Date().toISOString();

    // Find next pending installment
    const next = plan.installments.find(i => i.status === 'pending');
    plan.nextDueDate = next?.dueDate;

    if (plan.remainingBalance <= 0) {
      plan.status = 'completed';
      plan.remainingBalance = 0;
    }

    plan.updatedAt = new Date().toISOString();
    const resp = await db.put(plan);
    plan._rev = resp.rev;
    emitSyncEvent({
      resourceType: 'payment_plan',
      resourceId: plan._id,
      operation: 'update',
      resourceVersion: plan._rev,
      orgId: plan.orgId,
      hospitalId: plan.facilityId,
    });
    return plan;
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════
// INVOICES
// ═══════════════════════════════════════════════════════════════════

/**
 * Highest invoice number already issued, so a fresh counter starts above any
 * number an existing dataset already used.
 */
async function highestInvoiceNumber(db: Parameters<typeof nextSequence>[0]): Promise<number> {
  const invoices = await findByType<InvoiceDoc>(db as never, 'invoice');
  let highest = 0;
  for (const inv of invoices) {
    const num = inv.invoiceNumber;
    if (typeof num !== 'string' || !num.startsWith('INV-')) continue;
    const parsed = Number.parseInt(num.slice(4), 10);
    if (Number.isFinite(parsed) && parsed > highest) highest = parsed;
  }
  return highest;
}

export async function generateInvoice(input: {
  patientId: string;
  patientName: string;
  encounterId?: string;
  lineItems: InvoiceLineItem[];
  insurancePayments?: number;
  adjustments?: number;
  priorPayments?: number;
  currency?: string;
  dueInDays?: number;
  facilityId: string;
  facilityName: string;
  orgId?: string;
  createdBy?: string;
}): Promise<InvoiceDoc> {
  const db = invoicesDB();
  const now = new Date().toISOString();

  const subtotal = input.lineItems.reduce((s, li) => s + li.patientResponsibility, 0);
  const insurancePayments = input.insurancePayments || 0;
  const adjustments = input.adjustments || 0;
  const priorPayments = input.priorPayments || 0;
  const totalDue = Math.max(0, Math.round((subtotal - insurancePayments - adjustments - priorPayments) * 100) / 100);

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + (input.dueInDays || 30));

  // Monotonic counter rather than `allDocs().total_rows`. The old count fell
  // when an invoice was deleted, so the next invoice reissued a number already
  // in use — two distinct invoices sharing one reference, and a payment that
  // could be reconciled against either. See doc-counter.ts.
  const seqNum = await nextSequence(db, 'invoice', () => highestInvoiceNumber(db));
  const seq = String(seqNum).padStart(5, '0');

  const doc: InvoiceDoc = {
    _id: `inv-${uuidv4()}`,
    type: 'invoice',
    invoiceNumber: `INV-${seq}`,
    patientId: input.patientId,
    patientName: input.patientName,
    encounterId: input.encounterId,
    lineItems: input.lineItems,
    subtotal,
    insurancePayments,
    adjustments,
    priorPayments,
    totalDue,
    currency: input.currency || 'SSP',
    issuedDate: now.slice(0, 10),
    dueDate: toIsoDate(dueDate),
    status: 'draft' as InvoiceStatus,
    paymentLinkToken: uuidv4(),
    facilityId: input.facilityId,
    facilityName: input.facilityName,
    orgId: input.orgId,
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy,
  };

  const resp = await db.put(doc);
  doc._rev = resp.rev;
  emitSyncEvent({
    resourceType: 'invoice',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });
  return doc;
}

export async function getInvoicesByPatient(patientId: string): Promise<InvoiceDoc[]> {
  const rows = await findByType<InvoiceDoc>(invoicesDB(), 'invoice', { patientId }, { indexFields: ['type', 'patientId'] });
  return rows
    .sort((a, b) => (b.issuedDate || '').localeCompare(a.issuedDate || ''));
}

export async function updateInvoiceStatus(id: string, status: InvoiceStatus): Promise<InvoiceDoc | null> {
  const db = invoicesDB();
  try {
    const doc = await db.get(id) as InvoiceDoc;
    doc.status = status;
    if (status === 'sent') doc.sentAt = new Date().toISOString();
    if (status === 'viewed') doc.viewedAt = new Date().toISOString();
    if (status === 'paid') doc.paidAt = new Date().toISOString();
    doc.updatedAt = new Date().toISOString();
    const resp = await db.put(doc);
    doc._rev = resp.rev;
    emitSyncEvent({
      resourceType: 'invoice',
      resourceId: doc._id,
      operation: 'update',
      resourceVersion: doc._rev,
      orgId: doc.orgId,
      hospitalId: doc.facilityId,
    });
    return doc;
  } catch { return null; }
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
    _id: `spm-${uuidv4()}`,
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

// ═══════════════════════════════════════════════════════════════════
// PATIENT FINANCIAL SUMMARY (Computed)
// ═══════════════════════════════════════════════════════════════════

export async function getPatientFinancialSummary(patientId: string): Promise<PatientFinancialSummary> {
  const [balance, policies, eligibility, payments, plans, methods] = await Promise.all([
    getPatientBalance(patientId),
    getPatientInsurancePolicies(patientId),
    getLatestEligibility(patientId),
    getPaymentsByPatient(patientId),
    getPaymentPlansByPatient(patientId),
    getPatientPaymentMethods(patientId),
  ]);

  const activePlans = plans.filter(p => p.status === 'active');
  const activePlanBalance = activePlans.reduce((s, p) => s + p.remainingBalance, 0);
  const today = jubaDate();
  const invoices = await getInvoicesByPatient(patientId);
  const overdueInvoices = invoices.filter(i => i.status !== 'paid' && i.status !== 'cancelled' && i.dueDate < today);
  const overdueBalance = overdueInvoices.reduce((s, i) => s + i.totalDue, 0);

  let collectionStage: PatientFinancialSummary['collectionStage'] = 'current';
  if (overdueBalance > 0) {
    const oldestOverdue = overdueInvoices.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    if (oldestOverdue) {
      const stageDays = getSettings().collectionStageDays || COLLECTION_STAGE_DAYS;
      const daysPastDue = Math.floor((Date.now() - new Date(oldestOverdue.dueDate).getTime()) / (1000 * 60 * 60 * 24));
      if (daysPastDue > 120) collectionStage = '120_plus';
      else if (daysPastDue > stageDays.preWriteOff) collectionStage = '90_day';
      else if (daysPastDue > stageDays.warning) collectionStage = '60_day';
      else if (daysPastDue > stageDays.followUp) collectionStage = '30_day';
    }
  }

  const lastPayment = payments[0];
  const nextPlanPayment = activePlans[0];

  return {
    patientId,
    totalBalance: Math.max(0, balance),
    totalInCollections: collectionStage === '120_plus' ? overdueBalance : 0,
    currentBalance: Math.max(0, balance - overdueBalance),
    overdueBalance,
    activePlanBalance,
    insurancePolicies: policies,
    primaryPolicy: policies.find(p => p.isPrimary) || policies[0],
    eligibilityStatus: eligibility?.status || 'none',
    lastPaymentDate: lastPayment?.processedAt,
    lastPaymentAmount: lastPayment?.amount,
    nextPlanPaymentDate: nextPlanPayment?.nextDueDate,
    nextPlanPaymentAmount: nextPlanPayment?.monthlyAmount,
    savedPaymentMethods: methods,
    preferredMethod: methods.find(m => m.isDefault) || methods[0],
    collectionStage,
  };
}
