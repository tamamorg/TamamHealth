import type { TourStep } from '../types';
import { finishStep, messagingStep } from './_shared';

// ── Org admin — §11.2 ──────────────────────────────────────────────────────
export const ORG_ADMIN_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/facility-management',
    target: '',
    title: 'Welcome, Org Admin',
    body: 'You run the organization: facilities, staff accounts, branding, and the price list. Let’s walk each.',
  },
  {
    id: 'hospitals',
    route: '/org-admin/hospitals',
    target: '',
    title: 'Your facilities',
    body: 'Create and manage the hospitals and clinics in your organization.',
  },
  {
    id: 'users',
    route: '/org-admin/users',
    target: '',
    title: 'Staff accounts',
    body: 'Create staff, reset passwords, deactivate. New accounts are provisioned centrally with a temporary password the user must change at first login — so they can sign in on any device.',
  },
  {
    id: 'pricing',
    route: '/org-admin/pricing',
    target: '',
    title: 'The price list',
    body: 'The fee schedule that powers billing: category, service code, unit price. Unpriced services are skipped, never charged at zero.',
  },
  {
    id: 'branding',
    route: '/org-admin/branding',
    target: '',
    title: 'Branding',
    body: 'Your logo and theme, applied across every facility in the organization.',
  },
  messagingStep('/facility-management'),
  finishStep('/facility-management'),
];

// ── County health director — §10 ───────────────────────────────────────────
