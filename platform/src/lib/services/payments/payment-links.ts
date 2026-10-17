/** Payment service split: payment-links. Re-exported through ../payment-service. */
import { findByType } from '../db-query';
import type { PaymentDoc, PaymentMethodType, PaymentStatus } from '../../db-types-payments';
import type { BaseDoc } from '../../db-types';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from '../audit-service';
import { emitSyncEvent } from '../sync-event-service';
import { paymentsDB } from './shared';
import { getPaymentByReference, updatePaymentStatus } from './collection';

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

export async function reconcilePaymentLinkState(payment: PaymentDoc, status: PaymentLinkDoc['status']): Promise<void> {
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
