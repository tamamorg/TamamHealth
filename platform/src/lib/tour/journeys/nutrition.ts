import type { TourStep } from '../types';
import { finishStep, messagingStep, searchStep } from './_shared';

// ── Nutrition (nutritionist) — §7.7 ────────────────────────────────────────
export const NUTRITION_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/dashboard/nutrition',
    target: '.ehr-care-greeting',
    title: 'Welcome to Nutrition',
    body: 'CMAM screening and therapeutic supplies, in one station.',
    placement: 'bottom',
  },
  {
    id: 'screening',
    route: '/dashboard/nutrition',
    target: '[data-tour="station-queue"]',
    placement: 'right',
    title: 'Screen a child',
    body: 'Name, age, sex, MUAC, weight/height, edema — the classification derives live: SAM, MAM, At Risk, Underweight, or Normal. The worklist filters by classification.',
  },
  {
    id: 'new-screening-form',
    route: '/dashboard/nutrition',
    target: '[data-tour="station-primary-action"]',
    placement: 'bottom',
    title: 'Record a new screening',
    body: 'Link a registered patient when one exists — it’s what lets a flagged case raise a referral or open the chart to start treatment straight from here.',
  },
  {
    id: 'classification-filters',
    route: '/dashboard/nutrition',
    target: '.ehr-filter-group',
    placement: 'right',
    title: 'SAM, MAM, At Risk, Normal',
    body: 'These chips both filter the worklist and total today’s caseload by classification.',
  },
  {
    id: 'follow-up',
    route: '/dashboard/nutrition',
    // Follow-up actions live inside a flagged screening's own expanded row,
    // which only exists once a specific screening is opened — narrative
    // rather than an invented static selector.
    target: '',
    title: 'Follow up when it matters',
    body: 'Every flagged screening opens with Mark followed up, Refer, or Start treatment. Refer sends the patient straight to Referrals; Start treatment opens their chart.',
  },
  {
    id: 'supplies',
    route: '/dashboard/nutrition',
    target: '[data-tour="station-body"]',
    // station-body only renders once one of the header toggles opens a panel
    // (it's empty — and absent from the DOM — by default), so the toggle
    // itself is clicked first to reveal what this step is describing.
    preClickSelector: '[data-tour="nutrition-supplies-toggle"]',
    placement: 'top',
    title: 'Therapeutic supplies',
    body: 'Track RUTF, F-75/F-100, ReSoMal, Vitamin A and MUAC tapes with reorder-level statuses; +/− adjustments persist and survive reload.',
  },
  {
    id: 'mch-analytics',
    route: '/mch-analytics',
    target: '.ehr-set-nav',
    placement: 'bottom',
    title: 'Population nutrition trends',
    body: 'Beyond your own caseload, this tracks ANC, birth, mortality, and immunization trends for the whole catchment — context for whether a spike in SAM referrals is local or wider.',
  },
  searchStep('/dashboard/nutrition'),
  messagingStep('/dashboard/nutrition'),
  finishStep('/dashboard/nutrition'),
];

// ── Front desk (front_desk, clerks) — §4 ───────────────────────────────────
