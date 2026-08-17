import type { TourStep } from '../types';
import { finishStep, messagingStep } from './_shared';

// ── Medical biller — §8.3 ──────────────────────────────────────────────────
export const BILLER_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/payments',
    target: '',
    title: 'Welcome to Billing',
    body: 'You have the cashier’s collections view plus the full insurance-claims lifecycle. Let’s walk both.',
  },
  {
    id: 'collections',
    route: '/payments',
    target: '',
    title: 'Collections & pending verification',
    body: 'Collect payments, verify pending pay-by-link/portal payments, manage plans and refunds — same flow as the cashier.',
  },
  {
    id: 'claims',
    route: '/payments/claims',
    target: '',
    title: 'Claims at a glance',
    body: 'KPIs for billed / pending / approved / denied, plus the payer mix: self-pay, NHIS, CBHI, donor/NGO, government, private, employer.',
  },
  {
    id: 'submit',
    route: '/payments/claims',
    target: '',
    title: 'Submit a claim',
    body: '“New claim”: pick the insured patient, their policy, and the outstanding bill (or enter the amount) — the claim goes to the payer as submitted.',
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
  messagingStep('/payments'),
  finishStep('/payments'),
];

// ── Records / HMIS (hrio, records officer, data entry) — §9 ────────────────
