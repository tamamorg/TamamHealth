import type { TourStep } from '../types';
import { finishStep, messagingStep } from './_shared';

// ── Government (MoH) — §10 ─────────────────────────────────────────────────
export const GOVERNMENT_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/government',
    target: '',
    title: 'Welcome to the national dashboard',
    body: 'Weekly disease trends, facility distribution, and performance by state — with chart-type switches, fullscreen views, and drill-downs.',
  },
  {
    id: 'surveillance',
    route: '/surveillance',
    target: '',
    title: 'Surveillance',
    body: 'Notifiable diseases across the 28 states; create outbreak alerts and export line lists.',
  },
  {
    id: 'epidemic',
    route: '/epidemic-intelligence',
    target: '',
    title: 'Epidemic intelligence',
    body: 'Signal detection, outbreak risk, and hotspot mapping — the epidemic curves aggregate real weekly case reports.',
  },
  {
    id: 'dhis2',
    route: '/dhis2-export',
    target: '',
    title: 'DHIS2',
    body: 'National-level exports and sync into the HMIS — with a persisted, honest sync log.',
  },
  messagingStep('/government'),
  finishStep('/government'),
];

// ── Super admin — §11.1 ────────────────────────────────────────────────────
