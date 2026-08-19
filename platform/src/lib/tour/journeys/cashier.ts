import type { TourStep } from '../types';
import { finishStep, messagingStep, searchStep } from './_shared';

// ── Cashier — §8.2 ─────────────────────────────────────────────────────────
export const CASHIER_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/payments',
    target: '[data-tour="billing-overview"]',
    placement: 'bottom',
    title: 'Welcome to Payments',
    body: 'Cash Flow shows received vs. still-outstanding across every invoice, and Collected Today splits your shift’s takings by tender. Let’s walk a day’s collection end to end.',
  },
  {
    id: 'bill-list',
    route: '/billing',
    target: '[data-tour="bill-open"]',
    preClickSelector: '[data-tour="bill-open"]',
    title: 'The day’s outstanding bills',
    body: 'Every bill, invoice-level, Open bills first — filter by status or search by patient name, identifier, or invoice number. Opening a row takes you to its workspace.',
  },
  {
    id: 'bill-workspace',
    route: '/billing/[id]',
    target: '[data-tour="bill-actions"]',
    title: 'Finalize & collect',
    body: 'Add items from the fee schedule, apply a discount, then Finalize bill — finalizing locks the line items and unlocks Record payment in the Payments panel below.',
  },
  {
    id: 'collect',
    route: '/payments',
    target: '',
    title: 'Collect a payment',
    body: 'Or from the patient accounts queue: pick the patient (or arrive deep-linked from front-desk checkout), choose the tender — cash, mobile money (m-Gurush, M-Pesa, MTN, Airtel), bank transfer, insurance, or waiver — and the payment posts, credits the ledger, and offers Print or Email on the confirmation screen.',
  },
  {
    id: 'pending',
    route: '/payments',
    target: '[data-tour="pending-queue"]',
    title: 'Verify pending payments',
    body: 'Pay-by-link and patient-portal payments always land here pending — this queue is your daily gate. Approve posts it and credits the patient’s balance; Reject records why.',
  },
  {
    id: 'portal',
    route: '/payments/portal',
    target: '[data-tour="portal-bills"]',
    title: 'Assisted payments by portal',
    body: 'Walk a patient through paying by phone or in person: pick their bill, choose m-GURUSH, M-Pesa, MTN, Airtel, card, or bank transfer — it records the same way a self-service portal payment does, waiting in the queue above for your verification.',
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
