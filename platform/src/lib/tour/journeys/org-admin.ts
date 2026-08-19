import type { TourStep } from '../types';
import { finishStep, messagingStep } from './_shared';

// ── Org admin — §11.2 ──────────────────────────────────────────────────────
// /org-admin/settings is a compatibility redirect only (it immediately
// router.replace()s to /settings — see that page's own comment) — routing a
// tour step there would fight the redirect every time pathname changes, so
// the "org settings" stop below targets /settings directly, where the
// Organization nav group (Profile, Branding, Facilities, People, Billing,
// Security…) actually lives now.
export const ORG_ADMIN_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/facility-management',
    target: '.ehr-care-greeting',
    title: 'Welcome, Org Admin',
    body: 'You run the organization: facilities, staff accounts, branding, and the price list. This is your daily operations home — let’s walk each area.',
    placement: 'bottom',
  },
  {
    id: 'facility-queues',
    route: '/facility-management',
    target: '[data-tour="station-tabs"]',
    title: 'Inquiries, leave, and staff — one queue',
    body: 'Patient inquiries, pending leave requests, and your active staff roster share this panel. Switch tabs to work each queue without leaving the dashboard.',
    placement: 'bottom',
  },
  {
    // Was a stop on the standalone /org-admin page; that dashboard was merged
    // into this one (and deleted) on 2026-08-19, so the step points at the band
    // it became rather than a route that now just redirects here.
    id: 'org-overview',
    route: '/facility-management',
    target: '[data-tour="org-overview-band"]',
    title: 'Org Overview',
    body: 'The org-wide command view, right above your work queue: facilities, visits, inpatients, staff, and revenue across every hospital and clinic you run, plus stock, claims, balances and bed capacity. You see only your own organization here — the local device holds every organization’s data, but every screen is filtered down to yours.',
    placement: 'bottom',
  },
  {
    id: 'hospitals',
    route: '/org-admin/hospitals',
    target: '[data-tour="org-hospitals-table"]',
    title: 'Your facilities',
    body: 'Every hospital, clinic, and health post in your organization, with beds and today’s visits at a glance.',
    placement: 'bottom',
  },
  {
    id: 'hospitals-add',
    route: '/org-admin/hospitals',
    target: '[data-tour="org-hospitals-add"]',
    title: 'Onboard a new facility',
    body: 'Name, state, town, and facility type — a new site is ready to assign staff and price services against as soon as it’s created.',
    placement: 'left',
  },
  {
    id: 'users',
    route: '/org-admin/users',
    target: '[data-tour="org-users-list"]',
    title: 'Staff accounts',
    body: 'Create staff, reset passwords, deactivate. New accounts are provisioned centrally with a temporary password the user must change at first login — so they can sign in on any device.',
    placement: 'bottom',
  },
  {
    id: 'users-create',
    route: '/org-admin/users',
    target: '[data-tour="org-users-create-btn"]',
    title: 'Add a staff member',
    body: 'Set their name, role, and hospital — the temporary password shown after creating is theirs to change at first login.',
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
    body: 'Profile, subscription, branding, modules, facilities, people, billing, security policy, and integrations — the full org configuration lives under this Organization section of Settings.',
    placement: 'right',
  },
  {
    id: 'facility-sync',
    route: '/settings/manage',
    target: '[data-tour="settings-sync-panel"]',
    preClickSelector: '[data-tour="settings-tab-sync"]',
    title: 'Facility Sync to the national HMIS',
    body: 'Push each facility’s data to DHIS2 from here, and watch what was included in the last push — separate from the org-wide picture on Org Overview and Analytics.',
    placement: 'top',
  },
  messagingStep('/facility-management'),
  finishStep('/facility-management'),
];

// ── County health director — §10 ───────────────────────────────────────────
