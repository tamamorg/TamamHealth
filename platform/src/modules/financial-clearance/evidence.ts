import type { BillingDoc } from '@/lib/db-types-billing';
import type { EncounterDoc } from '@/lib/db-types';

export type FinancialEvidenceStatus = 'not_reviewed' | 'awaiting_payment' | 'awaiting_authorization' | 'payment_verified' | 'review_required';
export interface InvoiceEvidence {
  billId: string;
  invoiceNumber: string;
  currency: string;
  amount: number;
  paid: number;
  due: number;
  status: FinancialEvidenceStatus;
}
export interface VisitFinancialEvidence {
  encounterId: string;
  status: FinancialEvidenceStatus;
  invoices: InvoiceEvidence[];
}

const SETTLEMENT_METHODS = new Set(['cash', 'mobile_money', 'bank_transfer', 'insurance']);
const cents = (value: number) => Math.round(value * 100);
const validMoney = (value: number) => Number.isFinite(value) && value >= 0;

/** Payment evidence only: not a waiver/credit authorization or permission to deliver care.
 * Never net currencies, use another visit's payment, or trust a 'paid' label alone.
 */
export function evaluateVisitFinancialEvidence(
  encounter: Pick<EncounterDoc, '_id' | 'patientId' | 'hospitalId' | 'orgId'>,
  bills: Array<BillingDoc & { _conflicts?: string[] }>,
): VisitFinancialEvidence {
  const invoices = bills.filter(bill =>
    !!encounter.orgId && bill.orgId === encounter.orgId &&
    bill.patientId === encounter.patientId && bill.encounterId === encounter._id &&
    bill.facilityId === encounter.hospitalId && bill.status !== 'cancelled'
  ).map((bill): InvoiceEvidence => {
    const records = bill.payments.filter(payment => !payment.reversed);
    const paid = records.filter(payment => SETTLEMENT_METHODS.has(payment.method))
      .reduce((sum, payment) => sum + cents(payment.amount), 0) / 100;
    let status: FinancialEvidenceStatus;
    const invalid = !!bill._conflicts?.length || !/^[A-Z]{3}$/.test(bill.currency) ||
      !validMoney(bill.totalAmount) || !validMoney(bill.amountPaid) || !validMoney(bill.balanceDue) ||
      records.some(payment => !validMoney(payment.amount) || !payment.id || !payment.receivedBy || !Number.isFinite(Date.parse(payment.receivedAt))) ||
      new Set(records.map(payment => payment.id)).size !== records.length ||
      cents(paid) !== cents(bill.amountPaid) ||
      cents(Math.max(0, bill.totalAmount - paid)) !== cents(bill.balanceDue);
    if (invalid) status = 'review_required';
    // Legacy waivers do not store an attributable approver on the bill.
    else if (bill.status === 'waived' || bill.totalAmount === 0) status = 'review_required';
    else if (!bill.finalizedAt || !bill.finalizedBy || bill.status === 'draft' || !bill.items.length) status = 'not_reviewed';
    else if (bill.status === 'insurance_pending' || bill.status === 'insurance_approved' || bill.status === 'insurance_rejected') status = 'awaiting_authorization';
    else if (cents(paid) >= cents(bill.totalAmount) && bill.status === 'paid') status = 'payment_verified';
    else status = 'awaiting_payment';
    return { billId: bill._id, invoiceNumber: bill.invoiceNumber, currency: bill.currency,
      amount: bill.totalAmount, paid, due: bill.balanceDue, status };
  });
  const status = (['review_required', 'not_reviewed', 'awaiting_authorization', 'awaiting_payment'] as const)
    .find(candidate => invoices.some(invoice => invoice.status === candidate)) ??
    (invoices.length ? 'payment_verified' : 'not_reviewed');
  return { encounterId: encounter._id, status, invoices };
}
