import type { TourStep } from '../types';
import { finishStep, messagingStep } from './_shared';

// ── Hospital manager — §11.3 ───────────────────────────────────────────────
export const MANAGER_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/facility-management',
    target: '',
    title: 'Welcome to Facility Management',
    body: 'Reviews score, today’s appointments, enquiries, and staff shortcuts — your operational home.',
  },
  {
    id: 'hospitals',
    route: '/hospitals',
    target: '',
    title: 'Facility console',
    body: 'Open a facility to quick-create wards, staff, and stock, or edit its details.',
  },
  {
    id: 'settings',
    route: '/facility-settings',
    target: '',
    title: 'Facility settings',
    body: 'Payment methods offered, tax rate, exam rooms, and feature flags like fingerprint identification.',
  },
  {
    id: 'hr',
    route: '/hr',
    target: '',
    title: 'HR & leave',
    body: 'Staff roster, shift schedule, leave requests, and payroll — with CSV export.',
  },
  {
    id: 'equipment',
    route: '/equipment',
    target: '',
    title: 'Assets & equipment',
    body: 'Register assets with service intervals, log services and repairs, and watch the “service due soon” 30-day lookahead.',
  },
  messagingStep('/facility-management'),
  finishStep('/facility-management'),
];

// ── Org admin — §11.2 ──────────────────────────────────────────────────────
