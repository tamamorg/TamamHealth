import type { TourStep } from '../types';
import { finishStep, messagingStep } from './_shared';

// ── Records / HMIS (hrio, records officer, data entry) — §9 ────────────────
export const RECORDS_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/dashboard/data-entry',
    target: '',
    title: 'Welcome to Records & HMIS',
    body: 'From daily census to DHIS2 export — the facility’s reporting spine. Let’s walk it in order.',
  },
  {
    id: 'census',
    route: '/dashboard/data-entry',
    target: '[data-tour="station-queue"]',
    placement: 'right',
    title: 'Daily census entry',
    body: 'OPD attendance, admissions, deliveries, immunizations given, bed occupancy, and disease counts — entered here daily.',
  },
  {
    id: 'births',
    route: '/births',
    target: '',
    title: 'Register births',
    body: 'Child + parents + birth details; the certificate number auto-generates (SS-B-…), and the mother’s chart links when she’s a registered patient.',
  },
  {
    id: 'deaths',
    route: '/deaths',
    target: '',
    title: 'Register deaths',
    body: 'Decedent details, WHO cause chain, certificate number. Ward “death” discharges route here automatically.',
  },
  {
    id: 'vitals-stats',
    route: '/vital-statistics',
    target: '',
    title: 'Vital statistics',
    body: 'Read-only rollups: sex ratios, crude rates, monthly trends.',
  },
  {
    id: 'quality',
    route: '/data-quality',
    target: '',
    title: 'Data quality',
    body: 'Completeness, timeliness, and consistency scoring — check it before you export.',
  },
  {
    id: 'dhis2',
    route: '/dhis2-export',
    target: '',
    title: 'DHIS2 export',
    body: 'Pick the period and level, then Sync to DHIS2 or download JSON/CSV. Statuses and the sync log here are real and persisted — “Never synced” means never synced.',
  },
  {
    id: 'reports',
    route: '/reports',
    target: '',
    title: 'Monthly reports',
    body: 'Downloadable facility reports; MCH analytics has the maternal/child indicator dashboards.',
  },
  messagingStep('/dashboard/data-entry'),
  finishStep('/dashboard/data-entry'),
];

// ── Hospital manager — §11.3 ───────────────────────────────────────────────
