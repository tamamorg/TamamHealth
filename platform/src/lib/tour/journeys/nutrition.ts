import type { TourStep } from '../types';
import { finishStep, messagingStep, searchStep } from './_shared';

// ── Nutrition (nutritionist) — §7.7 ────────────────────────────────────────
export const NUTRITION_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/dashboard/nutrition',
    target: '.ehr-care-greeting',
    title: 'Welcome to Nutrition',
    body: 'Your workspace works like a doctor’s: patients who need you, your appointments, and what is outstanding — with the screening itself done in the patient chart.',
    placement: 'bottom',
  },
  {
    id: 'book',
    route: '/dashboard/nutrition',
    target: '.ehr-segmented-single button',
    placement: 'bottom',
    title: 'Book an appointment',
    body: 'Book a MAM review or a feeding follow-up into your own diary; the front desk confirms it.',
  },
  {
    id: 'worklist',
    route: '/dashboard/nutrition',
    target: '.ehr-appointment-list',
    placement: 'right',
    title: 'Who needs you',
    body: 'Children whose latest screening is SAM, MAM or at risk and still needs follow-up, alongside your appointments. Open a row to go to the chart.',
  },
  {
    id: 'screen-in-chart',
    route: '/dashboard/nutrition',
    // The form lives in the patient chart's workspace, which only exists
    // once a chart is open — narrative rather than an invented selector.
    target: '',
    title: 'Screen in the chart',
    body: 'In any patient chart, open Nutrition screening on the right-hand rail: MUAC, weight, height and oedema, with the classification shown as you type. Earlier screenings sit above it with Mark followed up, Start treatment and Refer.',
  },
  {
    id: 'outstanding',
    route: '/dashboard/nutrition',
    target: '.ehr-outstanding-card',
    placement: 'left',
    title: 'SAM, follow-ups and stock',
    body: 'SAM cases to treat come first, then other follow-ups, then supplies running low. Each entry opens the chart with the screening form already up.',
  },
  {
    id: 'supplies',
    route: '/dashboard/nutrition',
    target: '.ehr-schedule-actions',
    placement: 'bottom',
    title: 'Therapeutic supplies',
    body: 'Supplies opens the stock list — RUTF, F-75/F-100, ReSoMal, Vitamin A and MUAC tapes — with reorder levels and +/− adjustments that persist.',
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
