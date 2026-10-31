/**
 * Receipt Service — generates printable and emailable receipts for payments.
 */
import type { PaymentDoc } from '../db-types-payments';
import { escapeHtml, openIsolatedHtmlWindow } from '../safe-html';
import { buildClinicalPrintDocument, printFields } from '../print-document';
import { printDate } from '../print-identity';

export interface ReceiptData {
  receiptNumber: string;
  patientName: string;
  patientId: string;
  date: string;
  time: string;
  /** `date` as the printed sheet shows it (YYYY-MM-DD). */
  dateIso?: string;
  method: string;
  methodLabel: string;
  amount: number;
  currency: string;
  reference?: string;
  processedBy: string;
  facilityName: string;
  notes?: string;
}

function getMethodLabel(method: string): string {
  const labels: Record<string, string> = {
    cash: 'Cash', mpesa: 'M-Pesa', airtel: 'Airtel Money', mtn_momo: 'MTN Mobile Money',
    card: 'Card (Flutterwave)', bank_transfer: 'Bank Transfer',
    insurance: 'Insurance', waiver: 'Fee Waiver', payment_plan: 'Payment Plan',
  };
  return labels[method] || method;
}

/**
 * `hospitalNumber` is what the receipt shows as the patient's ID. The payment
 * record only holds the internal document id ("pat-00001"), which means
 * nothing to the patient or to a billing desk reading the slip back — so the
 * caller, who has the chart, passes the number printed on the patient's card.
 */
export function buildReceiptData(payment: PaymentDoc, facilityName?: string, hospitalNumber?: string): ReceiptData {
  const date = new Date(payment.processedAt);
  return {
    receiptNumber: payment.reference || payment._id,
    patientName: payment.patientName,
    patientId: hospitalNumber?.trim() || payment.patientId,
    date: date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    time: date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    dateIso: printDate(date),
    method: payment.method,
    methodLabel: getMethodLabel(payment.method),
    amount: payment.amount,
    currency: payment.currency,
    reference: payment.reference,
    processedBy: payment.processedByName,
    facilityName: facilityName || 'TamamHealth Health Facility',
    notes: payment.notes,
  };
}

export function generateReceiptHTML(receipt: ReceiptData): string {
  const body = `
    <section class="section keep">
      <h2 class="section-title">Payment Details</h2>
      ${printFields([
        { label: 'Receipt Number', value: receipt.receiptNumber },
        { label: 'Time', value: receipt.time },
        { label: 'Method', value: receipt.methodLabel },
        { label: 'Processed By', value: receipt.processedBy },
        // The receipt number is the payment's reference unless a separate one was keyed.
        { label: 'Transaction Reference', value: receipt.reference === receipt.receiptNumber ? '' : receipt.reference },
        { label: 'Notes', value: receipt.notes },
      ])}
      <div class="totals">
        <div class="total-row grand"><strong>Amount Paid</strong><strong>${escapeHtml(receipt.amount.toLocaleString())} ${escapeHtml(receipt.currency)}</strong></div>
        <div class="total-row"><span>Status</span><strong class="status">Paid</strong></div>
      </div>
    </section>`;

  return buildClinicalPrintDocument({
    title: receipt.receiptNumber,
    documentLabel: 'Payment Receipt',
    date: receipt.dateIso || receipt.date,
    facilityName: receipt.facilityName,
    metaTitle: 'Patient Information',
    meta: [
      { label: 'Patient Name', value: receipt.patientName },
      { label: 'Patient ID', value: receipt.patientId },
    ],
    safeBodyHtml: body,
    footer: 'Thank you for your payment. For questions, contact the billing desk.',
  });
}

export function printReceipt(receipt: ReceiptData): void {
  const html = generateReceiptHTML(receipt);
  openIsolatedHtmlWindow(html, '', true);
}

/**
 * Email a receipt via /api/receipts/email (SendGrid/Resend/SMTP behind an
 * EMAIL_PROVIDER switch; a dev-only "log" provider counts as delivered).
 *
 * Returns the route's honest `delivered` flag — callers must gate their
 * "Receipt sent" UI on it. A cashier being told an email went out when it
 * didn't is worse than surfacing the failure.
 */
export type ReceiptEmailFailure = 'forbidden' | 'no_email' | 'rate_limited' | 'not_found' | 'failed';
export interface ReceiptEmailResult {
  delivered: boolean;
  /** Set when delivered is false; maps the route's status codes (403/422/429/404). */
  failure?: ReceiptEmailFailure;
}

/**
 * Same as {@link emailReceipt} but keeps the reason a send was refused so the UI
 * can say why. The server builds the subject/body from the stored payment and
 * only mails the patient's address on file; `paymentId` binds the request.
 */
export async function sendReceiptEmail(receipt: ReceiptData, toEmail: string, paymentId?: string): Promise<ReceiptEmailResult> {
  try {
    const { apiFetch } = await import('@/lib/api-fetch');
    const response = await apiFetch('/api/receipts/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: toEmail,
        ...(paymentId ? { paymentId } : {}),
        receiptNumber: receipt.receiptNumber,
      }),
    });
    if (!response.ok) {
      console.warn(`[Receipt Service] Email API returned ${response.status} for receipt ${receipt.receiptNumber}`);
      const failure: ReceiptEmailFailure =
        response.status === 403 ? 'forbidden'
        : response.status === 422 ? 'no_email'
        : response.status === 429 ? 'rate_limited'
        : response.status === 404 ? 'not_found'
        : 'failed';
      return { delivered: false, failure };
    }
    const body = await response.json().catch(() => null) as { delivered?: boolean } | null;
    return body?.delivered === true ? { delivered: true } : { delivered: false, failure: 'failed' };
  } catch (err) {
    console.warn('[Receipt Service] Email send failed', err);
    return { delivered: false, failure: 'failed' };
  }
}

export async function emailReceipt(receipt: ReceiptData, toEmail: string, paymentId?: string): Promise<boolean> {
  return (await sendReceiptEmail(receipt, toEmail, paymentId)).delivered;
}
