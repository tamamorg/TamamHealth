import type { TourStep } from '../types';
import { finishStep, messagingStep, searchStep } from './_shared';

// ── Medical biller — §8.3 ──────────────────────────────────────────────────
export const BILLER_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/payments',
    target: '[data-tour="billing-overview"]',
    placement: 'bottom',
    title: 'Welcome to Billing',
    body: 'You have the cashier’s collections view plus the full insurance-claims lifecycle — Cash Flow, Collected Today, and Open Claims all live here. Let’s walk both.',
  },
  {
    id: 'pending',
    route: '/payments',
    target: '[data-tour="pending-queue"]',
    title: 'Collections & pending verification',
    body: 'Collect payments and record plan installments from the queue below — same flow as the cashier. Pay-by-link and patient-portal payments always land here pending: Approve posts and credits the balance, Reject records why.',
  },
  {
    id: 'bill-list',
    route: '/billing',
    target: '[data-tour="bill-open"]',
    preClickSelector: '[data-tour="bill-open"]',
    title: 'Charges on an encounter',
    body: 'Every bill you raise starts here, invoice-level. Open one to see — and add — the line items a visit actually charged.',
  },
  {
    id: 'bill-workspace',
    route: '/billing/[id]',
    target: '[data-tour="bill-actions"]',
    title: 'Build the charge',
    body: 'Add items from the fee schedule or a custom charge, apply a discount, then Finalize bill — finalizing is what makes it claimable and payable.',
  },
  {
    id: 'portal',
    route: '/payments/portal',
    target: '[data-tour="portal-bills"]',
    title: 'Assisted payments by portal',
    body: 'Walk a patient through paying by phone or in person: pick their bill, choose a method — it records the same way a self-service portal payment does, waiting for your verification above.',
  },
  {
    id: 'submit',
    route: '/payments/claims',
    target: '[data-tour="work-queue"]',
    title: 'Submit a claim',
    body: 'Every claim lists billed vs. allowed vs. paid amounts and status, filterable by payer — self-pay, NHIS, CBHI, donor/NGO, government, private, employer. “New claim”: pick the insured patient, their policy, and the outstanding bill (or enter the amount) — it goes to the payer as submitted.',
  },
  {
    id: 'adjudicate',
    route: '/payments/claims',
    target: '',
    title: 'Adjudicate honestly',
    body: 'Record the allowed and paid amounts — the resulting status (paid / partial / denied) previews live from the same rule that gets saved. Paid 0 against an allowed amount = full denial, with a reason.',
  },
  {
    id: 'appeal',
    route: '/payments/claims',
    target: '',
    title: 'Appeal & resubmit',
    body: 'Denied claims carry row actions: Appeal (with a note for the payer) and Resubmit — the resubmission count is tracked on the claim.',
  },
  {
    id: 'refunds',
    route: '/payments',
    target: '',
    title: 'Refunds & adjustments',
    body: 'Open any patient’s account from the queue: Reverse voids a wrong entry, Refund gives money back — both need a reason and run through the audited payment service.',
  },
  searchStep('/payments'),
  messagingStep('/payments'),
  finishStep('/payments'),
];
