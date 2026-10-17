/**
 * Money-correctness regressions: refunds, reversals, waivers, payment
 * validation, unsettle guards and cross-device invoice numbers.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.mock('@/lib/services/ledger-service', () => {
  const actual = jest.requireActual('@/lib/services/ledger-service');
  return { ...actual, createLedgerEntry: jest.fn(actual.createLedgerEntry) };
});
jest.setTimeout(30000);

import { teardownTestDBs } from '../helpers/test-db';
import {
  createBill, recordPayment, waiveBill, getBillById, unsettleBillsForPayment,
  reversePaidBillCharge, BillingError,
} from '@/lib/services/billing-service';
import { collectPayment, reversePayment, issueRefund } from '@/lib/services/payment-service';
import { getPatientBalance, getPatientLedger } from '@/lib/services/ledger-service';
import * as ledger from '@/lib/services/ledger-service';
import { getDB } from '@/lib/db';
import type { DataScope as __DS } from '@/lib/services/data-scope';
// Legacy fixtures carry no org; super_admin keeps the national view that filterByScope grants.
const SUPER: __DS = { role: 'super_admin' };

afterEach(async () => {
  await teardownTestDBs();
  uuidCounter = 0;
});

function seedBill(total = 100, extra: Record<string, unknown> = {}) {
  return createBill({
    patientId: 'pat-1', patientName: 'Test Patient',
    facilityId: 'hosp-1', facilityName: 'F', facilityLevel: 'clinic',
    encounterDate: '2026-08-08',
    items: [{ id: 'li-1', category: 'consultation', description: 'Consult', quantity: 1, unitPrice: total, totalPrice: total } as never],
    generatedBy: 'u', generatedByName: 'U', state: 'CES', orgId: 'org-a',
    ...extra,
  });
}

function pay(amount = 100) {
  return collectPayment({
    patientId: 'pat-1', patientName: 'Test Patient', method: 'cash', amount,
    processedBy: 'u', processedByName: 'U', facilityId: 'hosp-1', orgId: 'org-a',
  });
}

function refundInput(paymentId: string, amount: number, extra: Record<string, unknown> = {}) {
  return {
    paymentId, patientId: 'pat-1', patientName: 'Test Patient', amount,
    method: 'cash' as const, reason: 'r', processedBy: 'u', processedByName: 'U',
    facilityId: 'hosp-1', orgId: 'org-a', ...extra,
  };
}

const refundEntries = async () => (await getPatientLedger('pat-1', undefined, SUPER)).filter(e => e.entryType === 'refund');

describe('issueRefund', () => {
  test('refuses a second full refund', async () => {
    const p = await pay(100);
    await issueRefund(refundInput(p._id, 100));
    await expect(issueRefund(refundInput(p._id, 100))).rejects.toMatchObject({ code: 'PAYMENT_NOT_REFUNDABLE' });
    expect(await refundEntries()).toHaveLength(1);
  });

  test('refuses more than remains after a partial refund', async () => {
    const p = await pay(100);
    await issueRefund(refundInput(p._id, 60));
    await expect(issueRefund(refundInput(p._id, 50))).rejects.toMatchObject({ code: 'REFUND_EXCEEDS_REMAINING' });
    await issueRefund(refundInput(p._id, 40));
    const db = getDB('tamamhealth_payments');
    const doc = await db.get(p._id) as unknown as { status: string; refundedAmount: number };
    expect(doc).toMatchObject({ status: 'refunded', refundedAmount: 100 });
  });

  test('refuses bad amounts, currency mismatch and unknown payment', async () => {
    const p = await pay(100);
    for (const a of [0, -5, NaN, Infinity]) {
      await expect(issueRefund(refundInput(p._id, a))).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
    }
    await expect(issueRefund(refundInput(p._id, 10, { currency: 'USD' }))).rejects.toMatchObject({ code: 'CURRENCY_MISMATCH' });
    await expect(issueRefund(refundInput('nope', 10))).rejects.toMatchObject({ code: 'PAYMENT_NOT_FOUND' });
    expect(await refundEntries()).toHaveLength(0);
  });

  test('patient / org come from the payment, not the caller', async () => {
    const p = await pay(100);
    await expect(issueRefund(refundInput(p._id, 10, { patientId: 'pat-other' }))).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' });
    const r = await issueRefund(refundInput(p._id, 10, { facilityId: 'spoofed' }));
    expect(r.facilityId).toBe('hosp-1');
    expect(r.currency).toBe(p.currency);
  });

  test('idempotent retry posts exactly one ledger entry', async () => {
    const p = await pay(100);
    const a = await issueRefund(refundInput(p._id, 100, { idempotencyKey: 'k1' }));
    const b = await issueRefund(refundInput(p._id, 100, { idempotencyKey: 'k1' }));
    expect(b._id).toBe(a._id);
    expect(await refundEntries()).toHaveLength(1);
  });

  test('full refund undoes bill settlement; a void after refund is refused and refund after void too', async () => {
    const bill = await seedBill(100);
    const p = await pay(100);
    expect((await getBillById(bill._id, SUPER))?.status).toBe('paid');
    await issueRefund(refundInput(p._id, 100));
    expect((await getBillById(bill._id, SUPER))?.status).toBe('pending');
    await expect(reversePayment(p._id, 'x', 'u', 'U')).rejects.toMatchObject({ code: 'PAYMENT_REFUNDED' });

    const p2 = await pay(50);
    await reversePayment(p2._id, 'x', 'u', 'U');
    await expect(issueRefund(refundInput(p2._id, 10))).rejects.toMatchObject({ code: 'PAYMENT_NOT_REFUNDABLE' });
  });
});

describe('issueRefund concurrency', () => {
  test('two concurrent full refunds with different keys: exactly one stands, one ledger entry', async () => {
    const p = await pay(100);
    const results = await Promise.allSettled([
      issueRefund(refundInput(p._id, 100, { idempotencyKey: 'a' })),
      issueRefund(refundInput(p._id, 100, { idempotencyKey: 'b' })),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ name: 'PaymentOperationError' });
    expect(await refundEntries()).toHaveLength(1);
    const refunds = (await getDB('tamamhealth_refunds').allDocs({ include_docs: true })).rows
      .map(r => r.doc as unknown as { status: string }).filter(d => d && (d as { status?: string }).status);
    expect(refunds.filter(r => r.status === 'processed')).toHaveLength(1);
    expect(refunds.filter(r => r.status === 'failed')).toHaveLength(1);
  });

  test('two concurrent keyless full refunds: exactly one stands', async () => {
    const p = await pay(100);
    const results = await Promise.allSettled([issueRefund(refundInput(p._id, 100)), issueRefund(refundInput(p._id, 100))]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await refundEntries()).toHaveLength(1);
  });
});

describe('reversePayment vs a half-written refund', () => {
  test('refuses a void when a processed refund exists although the payment is still posted', async () => {
    const p = await pay(100);
    await getDB('tamamhealth_refunds').put({
      _id: 'ref-half', type: 'refund', paymentId: p._id, patientId: 'pat-1', patientName: 'Test Patient',
      amount: 40, currency: p.currency, method: 'cash', reason: 'r', status: 'processed',
      processedBy: 'u', processedByName: 'U', facilityId: 'hosp-1', orgId: 'org-a',
      createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
    });
    await expect(reversePayment(p._id, 'x', 'u', 'U')).rejects.toMatchObject({ code: 'PAYMENT_REFUNDED' });
    expect((await getDB('tamamhealth_payments').get(p._id) as unknown as { status: string }).status).toBe('posted');
  });
});

describe('reversePayment', () => {
  test('retry after a ledger failure ends with exactly one reversal entry', async () => {
    const p = await pay(100);
    (ledger.createLedgerEntry as jest.Mock).mockRejectedValueOnce(new Error('disk'));
    await expect(reversePayment(p._id, 'dup', 'u', 'U')).rejects.toThrow('disk');
    const res = await reversePayment(p._id, 'dup', 'u', 'U');
    expect(res?.status).toBe('reversed');
    await reversePayment(p._id, 'dup', 'u', 'U');
    const reversals = (await getPatientLedger('pat-1', undefined, SUPER)).filter(e => e.description.startsWith('Payment reversal'));
    expect(reversals).toHaveLength(1);
    expect(reversals[0]).toMatchObject({ currency: p.currency, createdBy: 'u' });
    expect(await getPatientBalance('pat-1', SUPER)).toBe(0);
  });

  test('returns null only when not found', async () => {
    expect(await reversePayment('missing', 'x', 'u', 'U')).toBeNull();
  });
});

describe('waiveBill', () => {
  test('posts a ledger adjustment for the waived balance', async () => {
    const bill = await seedBill(100);
    expect(await getPatientBalance('pat-1', SUPER)).toBe(100);
    const w = await waiveBill(bill._id, 'u', 'U', 'hardship');
    expect(w?.status).toBe('waived');
    expect(await getPatientBalance('pat-1', SUPER)).toBe(0);
  });

  test('refuses paid, cancelled-style, already waived and partly paid bills', async () => {
    const paid = await seedBill(100);
    await recordPayment(paid._id, 100, 'cash', 'u', 'U');
    await expect(waiveBill(paid._id, 'u', 'U', 'x')).rejects.toMatchObject({ code: 'BILL_PAID' });

    const partial = await seedBill(100);
    await recordPayment(partial._id, 30, 'cash', 'u', 'U');
    await expect(waiveBill(partial._id, 'u', 'U', 'x')).rejects.toMatchObject({ code: 'BILL_HAS_PAYMENTS' });

    const b = await seedBill(100);
    await waiveBill(b._id, 'u', 'U', 'x');
    await expect(waiveBill(b._id, 'u', 'U', 'x')).rejects.toMatchObject({ code: 'BILL_WAIVED' });
    expect(await waiveBill('missing', 'u', 'U', 'x')).toBeNull();
  });
});

describe('recordPayment validation', () => {
  test('refuses negative, zero, NaN, over-balance, bad method', async () => {
    const bill = await seedBill(100);
    for (const a of [-1, 0, NaN, Infinity]) {
      await expect(recordPayment(bill._id, a, 'cash', 'u', 'U')).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
    }
    await expect(recordPayment(bill._id, 100.01, 'cash', 'u', 'U')).rejects.toMatchObject({ code: 'AMOUNT_EXCEEDS_BALANCE' });
    await expect(recordPayment(bill._id, 10, 'bitcoin' as never, 'u', 'U')).rejects.toMatchObject({ code: 'INVALID_METHOD' });
    expect((await getBillById(bill._id, SUPER))?.amountPaid).toBe(0);
  });

  test('refuses cancelled / waived / paid bills, accepts exact balance, null for missing', async () => {
    const w = await seedBill(100);
    await waiveBill(w._id, 'u', 'U', 'x');
    await expect(recordPayment(w._id, 10, 'cash', 'u', 'U')).rejects.toBeInstanceOf(BillingError);
    const b = await seedBill(100);
    expect((await recordPayment(b._id, 100, 'cash', 'u', 'U'))?.status).toBe('paid');
    await expect(recordPayment(b._id, 1, 'cash', 'u', 'U')).rejects.toMatchObject({ code: 'BILL_PAID' });
    expect(await recordPayment('missing', 10, 'cash', 'u', 'U')).toBeNull();
  });
});

describe('unsettleBillsForPayment', () => {
  test('leaves a charge-reversed bill closed', async () => {
    const bill = await seedBill(100);
    const p = await pay(100);
    await reversePaidBillCharge(bill._id, 'u', 'U', 'outside pharmacy');
    await unsettleBillsForPayment(p._id, 'pat-1', 'u', 'U', SUPER);
    const after = await getBillById(bill._id, SUPER);
    expect(after?.balanceDue).toBe(0);
    expect(after?.chargeReversedAt).toBeTruthy();
    expect(after?.payments[0].reversed).toBe(true);
    expect(after?.status).toBe('paid');
  });
});

describe('invoice numbers across devices', () => {
  test('two devices with identical counters get different numbers', async () => {
    const a = await seedBill(10);
    // Simulate a second device: fresh local counter + fresh device code.
    const db = getDB('tamamhealth_billing');
    for (const id of ['_local/invoice_device_code', '_local/counter_invoice_' + a.invoiceNumber.split('-')[1]]) {
      const d = await db.get(id) as { _rev: string };
      await db.remove(id, d._rev);
    }
    const b = await seedBill(10);
    expect(a.invoiceNumber).not.toBe(b.invoiceNumber);
    expect(a.invoiceNumber.split('-')[3]).not.toBe(b.invoiceNumber.split('-')[3]);
    expect(a.invoiceNumber).toMatch(/^INV-\d{8}-\d{4}-[0-9A-Z]{4}$/);
  });
});
