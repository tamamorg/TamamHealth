import type { TourStep } from '../types';
import { finishStep, messagingStep } from './_shared';

// ── Org admin — §11.2 ──────────────────────────────────────────────────────
// /org-admin/settings is a compatibility redirect only (it immediately
// router.replace()s to /settings — see that page's own comment) — routing a
// tour step there would fight the redirect every time pathname changes, so
// the "org settings" stop below targets /settings directly, where the
// Organization nav group (Profile, Branding, Billing,
// Security…) actually lives now.
export const ORG_ADMIN_STEPS: TourStep[] = [
  // 2026-11-05: the dashboard was redesigned (KPI row, charts, Today's
  // operations, the Facilities list); the greeting, queue tabs and side cards
  // these steps pointed at are gone, so they anchor on what is there now.
  {
    id: 'welcome',
    route: '/facility-management',
    target: '.sadb-kpi-row',
    title: 'Welcome, Org Admin',
    body: 'You run the organization: facilities, staff accounts, branding, and the price list. The row across the top counts staff, doctors, nurses, patients, free beds and open issues across every facility you run.',
    placement: 'bottom',
  },
  {
    id: 'today-ops',
    route: '/facility-management',
    target: '.sadb-kv-fill',
    title: 'Today’s operations',
    body: 'Today’s shifts, unfilled shifts, pending leave and the staff available now. Schedule, in the card’s corner, opens today’s roster.',
    placement: 'left',
  },
  {
    id: 'org-overview',
    route: '/facility-management',
    target: '.sadb-lower-row',
    title: 'Your facilities at a glance',
    body: 'Every facility in your organization with its type, location, beds, patients and status. Search the list, or open a facility for its staff and settings. You see only your own organization: the device holds every organization’s data, but every screen is filtered down to yours.',
    placement: 'top',
  },
  {
    // Staff accounts no longer have a list of their own (/org-admin/users
    // and /admin/users redirect to /manage); they live with their facility,
    // and new ones start from this button.
    id: 'users-create',
    route: '/facility-management',
    target: '[data-action="dashboard-create-staff"]',
    title: 'Add a staff member',
    body: 'Set their name, role, and facility. The temporary password shown after creating is theirs to change at first login, so they can sign in on any device. To reset a password or deactivate an account, open their facility from the list, then the person.',
    placement: 'left',
  },
  {
    id: 'hospitals',
    route: '/manage',
    target: '[data-tour="org-hospitals-table"]',
    title: 'Your facilities',
    body: 'Every hospital, clinic, and health post in your organization, with the number of staff attached to each. Open one for its record and the sections you actually work in — staff, wards, equipment, inventory, schedules, performance and settings.',
    placement: 'bottom',
  },
  {
    id: 'hospitals-add',
    route: '/manage',
    target: '[data-tour="org-hospitals-add"]',
    title: 'Onboard a new facility',
    body: 'Name, state, town, and facility type — a new site is ready to assign staff and price services against as soon as it’s created.',
    placement: 'left',
  },
  {
    id: 'pricing',
    route: '/org-admin/pricing',
    target: '[data-tour="org-pricing-table"]',
    title: 'The price list',
    body: 'The fee schedule that powers billing: category, service code, unit price. Unpriced services are skipped, never charged at zero.',
    placement: 'bottom',
  },
  {
    id: 'branding',
    route: '/org-admin/branding',
    target: '[data-tour="org-branding-colors"]',
    title: 'Branding',
    body: 'Your logo and theme colors, applied across every facility in the organization — the live preview on the right shows exactly what staff will see.',
    placement: 'right',
  },
  {
    id: 'analytics',
    route: '/org-admin/analytics',
    target: '[data-tour="org-analytics-stats"]',
    title: 'Usage & activity',
    body: 'Daily and weekly active users, sessions, and events across your organization, plus the top modules, top actions, and a per-event activity log — useful for spotting adoption gaps.',
    placement: 'bottom',
  },
  {
    id: 'org-settings',
    route: '/settings',
    target: '.ehr-set-nav',
    title: 'Organization settings, all in one place',
    body: 'Profile, subscription, branding, modules, billing, security policy, and integrations live here. Facilities and people stay in Management, so each job has one home.',
    placement: 'right',
  },
  messagingStep('/facility-management'),
  finishStep('/facility-management'),
];

// ── County health director — §10 ───────────────────────────────────────────
