import type { TourStep } from '../types';
import { finishStep, messagingStep } from './_shared';

// ── County health director — §10 ───────────────────────────────────────────
// State-level oversight (the role lands on /dashboard/state, not the national
// /government console): aggregate-only surveillance, facility readiness, and
// HMIS reporting for one state, never a single patient record. Several
// targets below are shared with the government journey (the same panels
// exist on the same shared pages) — kept honest here to this role's own
// scope and allowed routes (see permissions.ts / role-routes.ts).
export const COUNTY_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/dashboard/state',
    target: '[data-tour="side-cards"]',
    placement: 'left',
    title: 'Welcome to your county dashboard',
    body: 'Births and deaths this month, facilities, ANC1 coverage, and immunizations year-to-date for your state — aggregate only, never patient-level.',
  },
  {
    id: 'counties',
    route: '/dashboard/state',
    target: '[data-tour="station-queue"]',
    placement: 'right',
    title: 'Counties in your state',
    body: 'Every county, with births, deaths, and tracked pregnancies. Open a row for its ANC1/ANC4 cascade and which facilities are behind on reporting.',
  },
  {
    id: 'surveillance',
    route: '/surveillance',
    target: '[data-tour="surv-alerts-panel"]',
    placement: 'left',
    title: 'Disease surveillance',
    body: 'Notifiable-disease counts across the states, ranked by severity — report a new alert, or export the current line list.',
  },
  {
    id: 'epidemic-intelligence',
    route: '/epidemic-intelligence',
    target: '[data-tour="epi-rt-panel"]',
    placement: 'bottom',
    title: 'Epidemic intelligence',
    body: 'The Rt tracker flags which diseases are still growing (Rt above 1). The tabs above break the same data into curves, syndromic thresholds, geographic spread, and the IDSR report.',
  },
  {
    id: 'assessments',
    route: '/facility-assessments',
    target: '[data-tour="facility-assess-summary"]',
    placement: 'bottom',
    title: 'Facility assessments',
    body: 'Supervisor scorecards for every facility in your jurisdiction — equipment, diagnostics, staffing, and reporting completeness, each becoming a facility’s readiness record.',
  },
  {
    id: 'data-quality',
    route: '/data-quality',
    target: '',
    title: 'Data quality',
    body: 'Completeness, timeliness, and consistency scoring per facility — check it before your county’s figures go into DHIS2.',
  },
  {
    id: 'dhis2',
    route: '/dhis2-export',
    target: '',
    title: 'DHIS2 & HMIS reporting',
    body: 'Pick the period and level, then sync your county’s data to DHIS2 or download it — the sync log here is real and persisted.',
  },
  {
    id: 'public-stats',
    route: '/public-stats',
    target: '[data-tour="public-stats-overview"]',
    placement: 'bottom',
    title: 'Public statistics',
    body: 'The transparency-facing rollup for facilities, population served, and DHIS2 coverage — birth, mortality, and readiness detail sit a click away in the side nav.',
  },
  messagingStep('/dashboard/state'),
  finishStep('/dashboard/state'),
];

// ── Government (MoH) — §10 ─────────────────────────────────────────────────
