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
    // Replaces the old /org-admin "Org Overview" stop. That page was merged
    // into this dashboard and deleted on 2026-08-19, and the KPI band it
    // brought with it was removed the same day, so the tour points at the rail
    // that actually carries this dashboard's numbers.
    id: 'org-overview',
    route: '/facility-management',
    target: '[data-tour="side-cards"]',
    title: 'Your facility at a glance',
    body: 'Staff, doctors, nurses, patients, beds, open inquiries, pending leave and today’s shifts — every figure opens a preview, and from there the page that owns it. You see only your own organization here: the local device holds every organization’s data, but every screen is filtered down to yours.',
    placement: 'left',
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
    // The registry above lists the facilities; this is where one is worked.
    // Staff, wards, equipment, inventory, schedules, performance and settings
    // used to be a separate screen behind a Manage button — they are tabs on
    // the facility itself now, which is why the tour can point at them.
    id: 'facility-tabs',
    route: '/admin/organizations',
    target: '[data-tour="facility-row-tabs"]',
    placement: 'left',
    title: 'Inside one facility',
    body: 'Open a facility for its record, and the tabs beside it — Staff, Wards, Equipment, Inventory, Schedules, Performance, Settings. This gear skips the trip: pick a tab and the facility opens straight on it.',
  },
  {
    id: 'users',
    route: '/org-admin/users',
    target: '[data-tour="org-users-list"]',
    title: 'Staff accounts',
    body: 'Every account in the organization: create staff, reset passwords, deactivate. New accounts are provisioned centrally with a temporary password the user must change at first login — so they can sign in on any device.',
    placement: 'bottom',
  },
  {
    id: 'users-create',
    route: '/org-admin/users',
    target: '[data-tour="org-users-create-btn"]',
    title: 'Add a staff member',
    body: 'Set their name, role, and hospital — the temporary password shown after creating is theirs to change at first login. The same dialog opens from a facility\u2019s Staff tab with that facility already filled in, which is the shorter route when you are hiring into one site.',
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
