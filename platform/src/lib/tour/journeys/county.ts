import type { TourStep } from '../types';
import { finishStep, messagingStep } from './_shared';

// ── County health director — §10 ───────────────────────────────────────────
export const COUNTY_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/dashboard/state',
    target: '',
    title: 'Welcome to your county dashboard',
    body: 'Jurisdiction-scoped oversight: MCH indicators, births/deaths, immunization coverage, and facilities — aggregate only, never patient-level.',
  },
  {
    id: 'surveillance',
    route: '/surveillance',
    target: '',
    title: 'Disease surveillance',
    body: 'Notifiable-disease counts across the states, outbreak alerts, and exportable line lists.',
  },
  {
    id: 'assessments',
    route: '/facility-assessments',
    target: '',
    title: 'Facility assessments',
    body: 'Supervisor scorecards for the facilities in your jurisdiction; facilities also self-submit via My Facility.',
  },
  messagingStep('/dashboard/state'),
  finishStep('/dashboard/state'),
];

// ── Government (MoH) — §10 ─────────────────────────────────────────────────
