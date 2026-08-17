import type { TourStep } from '../types';
import { finishStep } from './_shared';

// ── Government (MoH) — §10 ─────────────────────────────────────────────────
// National scope: aggregate figures across every state, never a single
// patient record. The walk follows the real IDSR/EWARS cycle — notifiable
// alerts, epidemic curves/Rt/syndromic thresholds, the IDSR weekly report,
// geographic spread, facility readiness, equity, programmes — ending on the
// printable executive briefing (src/lib/services/epidemic-intelligence-service.ts
// is the domain source for Rt, syndromic thresholds, and the IDSR fields).
export const GOVERNMENT_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/government',
    target: '.gov-map-panel',
    placement: 'bottom',
    title: 'Welcome to the national dashboard',
    body: 'Weekly disease trends, facility distribution, and performance by state — starting with this choropleth. Switch the shading between alert cases, reporting, immunization, and facilities, and click a state to drill in.',
  },
  {
    id: 'alerts',
    route: '/government/alerts',
    target: '[data-tour="gov-alerts-list"]',
    placement: 'bottom',
    title: 'Disease alerts & the notifiable-case feed',
    body: 'Every active alert nationally, emergency first, searchable by disease, state, or county. Response guidance below ranks the counties carrying the heaviest active case load.',
  },
  {
    id: 'epi-curves',
    route: '/epidemic-intelligence',
    target: '[data-tour="epi-curve-panel"]',
    preClickSelector: '[data-tour="epi-tab-curves"]',
    placement: 'bottom',
    title: 'Epidemic curves & Rt',
    body: 'Weekly case counts per disease, filterable to one at a time. The breakdown table below adds the effective reproduction number (Rt) and trend per disease — Rt above 1 means a disease is still growing.',
  },
  {
    id: 'epi-syndromic',
    route: '/epidemic-intelligence',
    target: '[data-tour="epi-syndromic-panel"]',
    preClickSelector: '[data-tour="epi-tab-syndromic"]',
    placement: 'top',
    title: 'Syndromic surveillance thresholds',
    body: 'Syndromes tracked against an expected baseline. Thresholds exceeded need a response; syndromes trending up but still under threshold are flagged here for watch.',
  },
  {
    id: 'epi-idsr',
    route: '/epidemic-intelligence',
    target: '[data-tour="epi-idsr-panel"]',
    preClickSelector: '[data-tour="epi-tab-idsr"]',
    placement: 'top',
    title: 'The IDSR weekly report',
    body: 'Priority diseases for the reporting week, with case fatality rate, affected states, and a severity rating — the same structure MOH publishes weekly.',
  },
  {
    id: 'epi-geographic',
    route: '/epidemic-intelligence',
    target: '[data-tour="epi-geo-panel"]',
    preClickSelector: '[data-tour="epi-tab-geographic"]',
    placement: 'top',
    title: 'Geographic spread',
    body: 'A risk score per state, combining case load and Rt trend, so response capacity goes where it is actually needed.',
  },
  {
    id: 'facility-assessments',
    route: '/facility-assessments',
    target: '[data-tour="facility-assess-summary"]',
    placement: 'bottom',
    title: 'Facility assessments & reporting completeness',
    body: 'National averages across service readiness — equipment, diagnostics, medicines, staffing, data quality, and reporting completeness — rolled up from every facility scorecard on file.',
  },
  {
    id: 'equity',
    route: '/government/equity',
    target: '[data-tour="gov-equity-header"]',
    placement: 'bottom',
    title: 'Equity & planning',
    body: 'Compare states side by side, then switch to burden vs. visibility to spot high-case, low-reporting states, or facility access to find states thin on service points.',
  },
  {
    id: 'programs',
    route: '/government/programs',
    target: '[data-tour="gov-programs-header"]',
    placement: 'bottom',
    title: 'Disease programmes',
    body: 'Coverage for immunization (EPI) and antenatal care (RMNCAH) at a glance, each linking through to its full module — plus which programmes have no dataset configured yet.',
  },
  {
    id: 'briefing',
    route: '/government/briefing',
    target: '[data-tour="gov-briefing-header"]',
    placement: 'bottom',
    title: 'Executive briefing',
    body: 'A printable, one-page situation report — alerts, service delivery, vital events, data quality, and recommended actions — compiled live from the same data you just walked through.',
  },
  {
    id: 'public-stats',
    route: '/public-stats',
    target: '[data-tour="public-stats-overview"]',
    placement: 'bottom',
    title: 'Public statistics',
    body: 'The transparency-facing rollup — facilities, population served, beds, health workers, and DHIS2 coverage — with birth, mortality, and readiness detail a click away in the side nav.',
  },
  {
    id: 'dhis2',
    route: '/dhis2-export',
    target: '',
    title: 'DHIS2',
    body: 'National-level exports and sync into the HMIS — with a persisted, honest sync log.',
  },
  // No messagingStep: the government role has no messaging module — '/messages'
  // is absent from its allowedRoutes (role-routes.ts) and its navItems
  // (permissions.ts), and MessagingDock's own canMessage gate agrees, so the
  // nav-link anchor other journeys use can never exist here.
  finishStep('/government'),
];

// ── Super admin — §11.1 ────────────────────────────────────────────────────
