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
    id: 'supplies',
    route: '/dashboard/nutrition',
    target: '[data-tour="station-body"]',
    placement: 'top',
    title: 'Therapeutic supplies',
    body: 'Track RUTF, F-75/F-100, ReSoMal, Vitamin A and MUAC tapes with reorder-level statuses; +/− adjustments persist and survive reload.',
  },
  searchStep('/dashboard/nutrition'),
  messagingStep('/dashboard/nutrition'),
  finishStep('/dashboard/nutrition'),
];

// ── Front desk (front_desk, clerks) — §4 ───────────────────────────────────
