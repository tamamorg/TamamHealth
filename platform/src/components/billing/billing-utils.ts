/**
 * Shared helpers for the Tamam O3-style billing module
 * (/billing bill list + /billing/[id] bill detail).
 */

import { formatDate } from '@/lib/format-utils';
import type { BillingDoc, BillingStatus, ChargeCategory, PaymentMethod } from '@/lib/db-types-billing';

/** "Today, 10:29 AM" / "Yesterday, 4:12 PM" / "May 7, 2026, 9:00 AM" — local time. */
export function formatBillDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return `Today, ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return `${formatDate(iso)}, ${time}`;
}

export const STATUS_CHIP: Partial<Record<BillingStatus, { label: string; cls: string }>> = {
  pending: { label: 'Unpaid', cls: 'bl-chip--unpaid' },
  partial: { label: 'Partial', cls: 'bl-chip--partial' },
  paid: { label: 'Paid', cls: 'bl-chip--paid' },
  waived: { label: 'Waived', cls: 'bl-chip--waived' },
  cancelled: { label: 'Cancelled', cls: 'bl-chip--cancelled' },
};

export const CATEGORY_LABELS: Record<ChargeCategory, string> = {
  consultation: 'Consultation',
  laboratory: 'Laboratory',
  pharmacy: 'Pharmacy',
  radiology: 'Radiology',
  procedure: 'Procedure',
  bed_charge: 'Bed charge',
  surgery: 'Surgery',
  ambulance: 'Ambulance',
  other: 'Other',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  mobile_money: 'Mobile money',
  bank_transfer: 'Bank transfer',
  insurance: 'Insurance',
  credit: 'Credit',
  waiver: 'Waiver',
};

/** Invoice status shown on the bill detail summary strip. */
export function invoiceStatusLabel(bill: BillingDoc): string {
  if (bill.status === 'pending') return bill.finalizedAt ? 'POSTED' : 'PENDING';
  return bill.status.toUpperCase();
}
