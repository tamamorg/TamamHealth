/** Payment service split: refunds. Re-exported through ../payment-service. */
import { getDB } from '../../db';
import { findByType } from '../db-query';
import type { PaymentDoc, PaymentMethodType, RefundDoc } from '../../db-types-payments';
import type { DataScope } from '../data-scope';
import { filterByScope, orgOnlyScope } from '../data-scope';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from '../audit-service';
import { emitSyncEvent } from '../sync-event-service';
import { createLedgerEntry } from '../ledger-service';
import { paymentsDB, refundsDB } from './shared';
import { PaymentOperationError } from './collection';

// ═══════════════════════════════════════════════════════════════════
// REFUNDS
// ═══════════════════════════════════════════════════════════════════

export type RefundErrorCode =
  | 'PAYMENT_NOT_FOUND' | 'PAYMENT_NOT_REFUNDABLE' | 'INVALID_AMOUNT'
  | 'REFUND_EXCEEDS_REMAINING' | 'CURRENCY_MISMATCH' | 'PAYMENT_MISMATCH' | 'RETRY_MISMATCH';

const cents = (n: number) => Math.round(n * 100);

/** Processed refund documents against one payment (the single source of "already refunded"). */
export async function processedRefundsFor(paymentId: string, patientId: string): Promise<RefundDoc[]> {
  const rows = await findByType<RefundDoc>(refundsDB(), 'refund', { patientId }, { indexFields: ['type', 'patientId'] });
  return rows.filter(r => r.paymentId === paymentId && r.status === 'processed');
}

const refundLedgerId = (refundId: string) => `ledger-idem-${refundId.replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 120)}`;

/**
 * Close the check-then-write race in issueRefund. Two callers (a double click
 * with no idempotency key, two tabs) can both pass the "amount remaining"
 * check before either document exists. After writing, every caller re-reads
 * ALL processed refunds and walks them in a deterministic order: refunds whose
 * ledger entry is already posted first (they have been honoured), then by
 * createdAt, then _id. A refund that would push the running total past the
 * payment amount loses; if that is this caller's refund it is voided (status
 * `failed`, no ledger entry is ever posted for it) and the caller is refused.
 */
async function voidIfOverRefunded(doc: RefundDoc, paymentAmount: number): Promise<void> {
  const rows = await processedRefundsFor(doc.paymentId, doc.patientId);
  if (!rows.some(r => r._id === doc._id)) rows.push(doc);
  const posted = new Set<string>();
  for (const r of rows) {
    try { await getDB('tamamhealth_ledger').get(refundLedgerId(r._id)); posted.add(r._id); } catch { /* not posted */ }
  }
  rows.sort((a, b) =>
    (posted.has(b._id) ? 1 : 0) - (posted.has(a._id) ? 1 : 0)
    || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)
    || (a._id < b._id ? -1 : a._id > b._id ? 1 : 0));
  const cap = cents(paymentAmount);
  let running = 0;
  for (const r of rows) {
    if (running + cents(r.amount) > cap) {
      if (r._id !== doc._id) continue; // another caller's loser; it voids itself
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const fresh = await refundsDB().get(doc._id) as RefundDoc & { voidReason?: string };
          fresh.status = 'failed';
          fresh.voidReason = 'Concurrent refund exceeded the amount remaining on the payment';
          fresh.updatedAt = new Date().toISOString();
          await refundsDB().put(fresh);
          break;
        } catch (err) {
          if ((err as { status?: number }).status !== 409 || attempt === 2) throw err;
        }
      }
      throw new PaymentOperationError('REFUND_EXCEEDS_REMAINING', 'The refund is more than the amount remaining on this payment.');
    }
    running += cents(r.amount);
  }
}

/**
 * Refund (part of) a posted payment. patientId / orgId / facility / currency
 * come from the PAYMENT document; the caller's copies are only checked against
 * it. Refused for a payment that is not posted (reversed, voided, already fully
 * refunded, pending, failed), a non-positive / non-finite amount, an amount
 * above what is left after earlier processed refunds, or a currency mismatch.
 *
 * Idempotent when `idempotencyKey` is given: a retry with the same key and the
 * same operation resumes the ledger / payment updates without posting twice.
 * When the payment becomes fully refunded it is marked `refunded` and the bill
 * settlements it made are undone like a reversal.
 */
export async function issueRefund(input: {
  idempotencyKey?: string;
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
  const pdb = paymentsDB();
  const now = new Date().toISOString();
  const fail = (code: RefundErrorCode, msg: string) => new PaymentOperationError(code, msg);

  if (typeof input.amount !== 'number' || !Number.isFinite(input.amount) || input.amount <= 0 || cents(input.amount) <= 0) {
    throw fail('INVALID_AMOUNT', 'Refund amount must be a number greater than zero');
  }
  const amount = cents(input.amount) / 100;

  // The money being refunded: normally a PaymentDoc. Admission-deposit refunds
  // (ward-service) instead name a PaymentRecord embedded on a bill, which has
  // no PaymentDoc; its patient / amount / currency / tenancy come from that
  // bill record, and there is no payment document to flag as refunded.
  let pmtDoc: PaymentDoc | null = null;
  let pmt: { _id: string; patientId: string; patientName: string; amount: number; currency: string; orgId?: string; facilityId: string; status: string };
  try {
    pmtDoc = await pdb.get(input.paymentId) as PaymentDoc;
    pmt = pmtDoc;
  } catch (err) {
    const e = err as { status?: number; name?: string } | undefined;
    if (!(e && (e.status === 404 || e.name === 'not_found'))) throw err;
    const { getBillsByPatient } = await import('../billing-service');
    const bills = input.patientId ? await getBillsByPatient(input.patientId, orgOnlyScope(input.orgId)) : [];
    const bill = bills.find(b => (b.payments || []).some(r => r.id === input.paymentId && !r.reversed));
    const rec = bill?.payments.find(r => r.id === input.paymentId);
    if (!bill || !rec) throw fail('PAYMENT_NOT_FOUND', 'Payment not found. Reload the page and try again.');
    pmt = {
      _id: rec.id, patientId: bill.patientId, patientName: bill.patientName, amount: rec.amount,
      currency: bill.currency, orgId: bill.orgId, facilityId: bill.facilityId, status: 'posted',
    };
  }
  if (input.patientId && input.patientId !== pmt.patientId) throw fail('PAYMENT_MISMATCH', 'Payment belongs to a different patient');
  if (input.orgId !== undefined && pmt.orgId !== undefined && input.orgId !== pmt.orgId) throw fail('PAYMENT_MISMATCH', 'Payment belongs to a different organisation');
  if (input.currency && input.currency !== pmt.currency) throw fail('CURRENCY_MISMATCH', 'Refund currency must match the payment currency');

  const refundId = input.idempotencyKey ? `ref-${encodeURIComponent(input.idempotencyKey)}` : `ref-${uuidv4()}`;

  let doc: RefundDoc | null = null;
  if (input.idempotencyKey) {
    try {
      doc = await db.get(refundId) as RefundDoc;
      if (doc.paymentId !== pmt._id || cents(doc.amount) !== cents(amount)) throw fail('RETRY_MISMATCH', 'Refund retry does not match the original operation');
      if (doc.status === 'failed') throw fail('REFUND_EXCEEDS_REMAINING', 'This refund was voided because it exceeded the amount remaining on the payment');
    } catch (err) {
      if (err instanceof PaymentOperationError) throw err;
      const e = err as { status?: number; name?: string } | undefined;
      if (!e || (e.status !== 404 && e.name !== 'not_found')) throw err;
    }
  }

  if (!doc) {
    if (pmt.status !== 'posted') throw fail('PAYMENT_NOT_REFUNDABLE', 'Only a posted payment can be refunded.');
    const existing = await processedRefundsFor(pmt._id, pmt.patientId);
    const alreadyRefunded = existing.reduce((sum, r) => sum + cents(r.amount), 0);
    if (cents(amount) > cents(pmt.amount) - alreadyRefunded) {
      throw fail('REFUND_EXCEEDS_REMAINING', 'The refund is more than the amount remaining on this payment.');
    }

    doc = {
      _id: refundId,
      type: 'refund',
      paymentId: pmt._id,
      patientId: pmt.patientId,
      patientName: pmt.patientName,
      amount,
      currency: pmt.currency,
      method: input.method,
      reason: input.reason,
      processedBy: input.processedBy,
      processedByName: input.processedByName,
      facilityId: pmt.facilityId,
      orgId: pmt.orgId,
      reference: `REF-${uuidv4().slice(0, 8).toUpperCase()}`,
      status: 'processed',
      processedAt: now,
      createdAt: now,
      updatedAt: now,
      createdBy: input.processedBy,
    };
    try {
      const resp = await db.put(doc);
      doc._rev = resp.rev;
      await voidIfOverRefunded(doc, pmt.amount);
    } catch (error) {
      if (!input.idempotencyKey || (error as { status?: number }).status !== 409) throw error;
      doc = await db.get(refundId) as RefundDoc;
    }
  }

  // Resume the ledger write after a partial failure without duplicating it.
  await createLedgerEntry({
    patientId: doc.patientId,
    entryType: 'refund',
    amount: doc.amount,
    description: `Refund: ${doc.reason}`,
    referenceId: doc._id,
    referenceType: 'refund',
    idempotencyKey: doc._id,
    method: doc.method,
    currency: doc.currency,
    facilityId: doc.facilityId,
    orgId: doc.orgId,
    createdBy: doc.processedBy,
  });

  // Record the refunded total on the payment (recomputed from the refund
  // documents, so it is idempotent) and flag it fully refunded when exhausted.
  let fullyRefunded = false;
  const refundedTotal = async () => (await findByType<RefundDoc>(db, 'refund', { patientId: pmt.patientId }, { indexFields: ['type', 'patientId'] }))
    .filter(r => r.paymentId === pmt._id && r.status === 'processed')
    .reduce((sum, r) => sum + cents(r.amount), 0);
  if (!pmtDoc) {
    fullyRefunded = (await refundedTotal()) >= cents(pmt.amount);
  } else {
    for (let attempt = 0; attempt < 3; attempt++) {
      const fresh = await pdb.get(pmt._id) as PaymentDoc;
      const total = await refundedTotal();
      fullyRefunded = total >= cents(fresh.amount);
      const nextStatus = fullyRefunded && fresh.status === 'posted' ? 'refunded' : fresh.status;
      if (fresh.refundedAmount === total / 100 && fresh.status === nextStatus) break;
      fresh.refundedAmount = total / 100;
      fresh.status = nextStatus;
      fresh.updatedAt = new Date().toISOString();
      try {
        await pdb.put(fresh);
        break;
      } catch (err) {
        if ((err as { status?: number }).status !== 409 || attempt === 2) throw err;
      }
    }
  }

  if (fullyRefunded && pmtDoc) {
    // Same bill undo as a reversal (idempotent). Best-effort; the ledger and
    // payment status above are authoritative.
    try {
      const { unsettleBillsForPayment } = await import('../billing-service');
      await unsettleBillsForPayment(pmt._id, pmt.patientId, input.processedBy, input.processedByName, orgOnlyScope(pmt.orgId));
    } catch (err) {
      console.warn('[payment] could not unsettle bills for refunded payment', pmt._id, err);
    }
  }

  await logAuditSafe('REFUND_ISSUED', input.processedBy, input.processedByName,
    `Refund ${doc.amount} ${doc.currency} to patient ${doc.patientId}; reason recorded on the refund`);

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

export async function getRefundsByPatient(patientId: string, scope: DataScope): Promise<RefundDoc[]> {
  const rows = await findByType<RefundDoc>(refundsDB(), 'refund', { patientId }, { indexFields: ['type', 'patientId'] });
  return filterByScope(rows, scope);
}
