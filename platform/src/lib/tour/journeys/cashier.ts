import type { TourStep } from '../types';
import { finishStep, messagingStep, searchStep } from './_shared';

// ── Cashier — §8.2 ─────────────────────────────────────────────────────────
export const CASHIER_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/payments',
    target: '',
    title: 'Welcome to Payments',
    body: 'Patient accounts sorted outstanding-first, with A/R aging buckets. Let’s walk a collection.',
  },
  {
    id: 'collect',
    route: '/payments',
    target: '',
    title: 'Collect a payment',
    body: 'Pick the patient (or arrive deep-linked from front-desk checkout), choose the tender — cash, mobile money (m-Gurush, M-Pesa, MTN, Airtel), bank transfer, insurance, or waiver — and the payment posts and credits the ledger.',
  },
  {
    id: 'receipt',
    route: '/payments',
    target: '',
    title: 'Receipts',
    body: 'Print or email the receipt right from the confirmation — the “Sent” badge only shows when the email provider actually accepted it.',
  },
  {
    id: 'pending',
    route: '/payments',
    target: '',
    title: 'Verify pending payments',
    body: 'Pay-by-link and patient-portal payments arrive pending. The amber verification queue appears whenever something needs review: Approve posts it and credits the patient’s balance; Reject records why.',
  },
  {
    id: 'plans',
    route: '/payments',
    target: '',
    title: 'Plans, refunds & waivers',
    body: 'Record installments on payment plans, void or refund posted payments (with confirmation), and waive bills through the exemption path — reason required.',
  },
  searchStep('/payments'),
  messagingStep('/payments'),
  finishStep('/payments'),
];

// ── Medical biller — §8.3 ──────────────────────────────────────────────────
