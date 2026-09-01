/**
 * Receipt Service — generates printable and emailable receipts for payments.
 */
import type { PaymentDoc } from '../db-types-payments';
import { escapeHtml, openIsolatedHtmlWindow } from '../safe-html';
import { buildClinicalPrintDocument } from '../print-document';

export interface ReceiptData {
  receiptNumber: string;
  patientName: string;
  patientId: string;
  date: string;
  time: string;
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

export function buildReceiptData(payment: PaymentDoc, facilityName?: string): ReceiptData {
  const date = new Date(payment.processedAt);
  return {
    receiptNumber: payment.reference || payment._id,
    patientName: payment.patientName,
    patientId: payment.patientId,
    date: date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    time: date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
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
  const facilityName = receipt.facilityName;
  const receiptNumber = receipt.receiptNumber;
  const patientName = escapeHtml(receipt.patientName);
  const methodLabel = escapeHtml(receipt.methodLabel);
  const reference = escapeHtml(receipt.reference);
  const currency = escapeHtml(receipt.currency);
  const processedBy = escapeHtml(receipt.processedBy);
  const notes = escapeHtml(receipt.notes);
  const body = `
    <section class="section">
      <h2 class="section-title">Payment details</h2>
      <table><tbody>
        <tr><td class="muted">Patient</td><td class="num"><strong>${patientName}</strong></td></tr>
        <tr><td class="muted">Patient ID</td><td class="num">${escapeHtml(receipt.patientId)}</td></tr>
        <tr><td class="muted">Method</td><td class="num">${methodLabel}</td></tr>
        ${receipt.reference ? `<tr><td class="muted">Transaction reference</td><td class="num">${reference}</td></tr>` : ''}
        <tr><td class="muted">Processed by</td><td class="num">${processedBy}</td></tr>
        ${receipt.notes ? `<tr><td class="muted">Notes</td><td class="num">${notes}</td></tr>` : ''}
      </tbody></table>
      <div class="totals">
        <div class="total-row grand"><strong>Amount paid</strong><strong>${escapeHtml(receipt.amount.toLocaleString())} ${currency}</strong></div>
        <div class="total-row"><span>Status</span><strong class="status status-paid">Paid</strong></div>
      </div>
    </section>`;

  return buildClinicalPrintDocument({
    title: receiptNumber,
    documentLabel: 'Payment receipt',
    facilityName,
    meta: [
      { label: 'Receipt number', value: receipt.receiptNumber },
      { label: 'Date', value: receipt.date },
      { label: 'Time', value: receipt.time },
    ],
    safeBodyHtml: body,
    page: 'receipt',
    footer: 'Thank you for your payment. For questions, contact the billing desk.',
  });
}

export function printReceipt(receipt: ReceiptData): void {
  const html = generateReceiptHTML(receipt);
  openIsolatedHtmlWindow(html, 'width=400,height=600', true);
}

/**
 * Email a receipt via /api/receipts/email (SendGrid/Resend/SMTP behind an
 * EMAIL_PROVIDER switch; a dev-only "log" provider counts as delivered).
 *
 * Returns the route's honest `delivered` flag — callers must gate their
 * "Receipt sent" UI on it. A cashier being told an email went out when it
 * didn't is worse than surfacing the failure.
 */
export async function emailReceipt(receipt: ReceiptData, toEmail: string): Promise<boolean> {
  try {
    // Goes through apiFetch so the CSRF token from the session cookie is
    // auto-attached.
    const { apiFetch } = await import('@/lib/api-fetch');
    const response = await apiFetch('/api/receipts/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: toEmail,
        subject: `Payment Receipt — ${receipt.receiptNumber}`,
        html: generateReceiptHTML(receipt),
        receiptNumber: receipt.receiptNumber,
        amount: receipt.amount,
        currency: receipt.currency,
      }),
    });

    if (!response.ok) {
      console.warn(`[Receipt Service] Email API returned ${response.status} for receipt ${receipt.receiptNumber}`);
      return false;
    }
    const body = await response.json().catch(() => null) as { delivered?: boolean } | null;
    return body?.delivered === true;
  } catch (err) {
    console.warn('[Receipt Service] Email send failed', err);
    return false;
  }
}
