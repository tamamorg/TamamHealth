// Edge-safe single source of truth for role -> route allow-list.
//
// IMPORTANT: This module is imported by `src/proxy.ts`, which runs on
// the Next.js Edge runtime. It MUST NOT import anything that pulls in
// icon libraries, node:fs, or any non-Edge-safe module. Only type-only imports
// from sibling files are permitted (types are erased at compile time).
//
// The richer `ROLE_PERMISSIONS` map in `./permissions.ts` derives its
// `allowedRoutes` from this table so the page-route gating in proxy and
// server/client `isRouteAllowed` checks share one list. Nav items, icons,
// labels, and colours stay in `permissions.ts` because they pull in icon
// components that are not Edge-safe.

import type { UserRole } from './db-types';

export interface RoleRouteConfig {
  readonly allowed: readonly string[];
  readonly defaultDashboard: string;
}

// Nurse-family roles (nurse, triage_nurse, rooming_nurse) no longer have a
// standalone station dashboard — they land on the shared clinical workspace
// at /dashboard, Epic Hyperspace-style, role-adapted the same way doctors and
// clinicians already do. The former /dashboard/nurse station pages (triage
// board, ward roster, MAR, handoff) are retired in favour of /triage,
// /wards, /wards/mar, and /wards/handoff below.
const NURSE_MODULE_ROUTES = [
  // `/triage` is the per-patient triage page the station's queue rows open —
  // the same ETAT assessment, pinned to one patient.
  '/dashboard', '/patients', '/triage', '/rooming', '/messages',
  '/lab', '/immunizations', '/anc', '/births', '/deaths',
  '/settings', '/appointments',
  // Nurses document their own encounters (the Nurse Visit note type), so the
  // notes module is part of the nursing station, not a clinician-only surface.
  '/notes',
  '/wards', '/wards/mar',
  // Nurse-family roles raise the commonest transfer in the platform (the
  // nurse→doctor hand-off) and may cancel their own, so the queue has rows for
  // them even though they cannot accept one.
  '/transfers',
] as const;

export const ROLE_ROUTE_TABLE: Readonly<Record<UserRole, RoleRouteConfig>> = {
  super_admin: {
    allowed: [
      '/facility-management',
      '/admin', '/admin/control', '/admin/organizations', '/admin/users', '/admin/system', '/admin/conflicts',
      // Command-center modules (risk, audit, support, sync, interop, data
      // governance, security, configuration, feature flags).
      '/admin/risk', '/admin/audit', '/admin/support', '/admin/sync',
      '/admin/interop', '/admin/data', '/admin/security', '/admin/config', '/admin/flags',
      '/it', '/system-admin',
      '/admin/billing', '/admin/analytics',
      // The /org-admin root page (Org Overview) was merged into
      // /facility-management and deleted, so the editors are listed
      // individually rather than inherited from a prefix that no longer
      // resolves to a screen.
      '/org-admin/analytics', '/org-admin/users', '/org-admin/hospitals',
      '/org-admin/branding', '/org-admin/pricing', '/org-admin/settings',
      '/dashboard', '/patients', '/consultation', '/notes', '/referrals', '/messages',
      '/lab', '/pharmacy', '/immunizations', '/anc', '/births', '/deaths',
      '/surveillance', '/reports', '/hospitals', '/settings', '/settings/manage',
      '/epidemic-intelligence', '/mch-analytics', '/government',
      '/vital-statistics', '/facility-assessments', '/data-quality',
      '/dhis2-export', '/public-stats',
      '/appointments',
      '/billing', '/payments', '/payments/claims',
      '/wards', '/equipment', '/hr', '/dashboard/hr', '/inquiries',
      '/blood-bank', '/controlled-substances', '/emergency-preparedness',
      '/transfers',
    ],
    // Platform admins land on the real admin console — the facility-style
    // dashboard's patient/bed stats are meaningless at platform level.
    defaultDashboard: '/admin',
  },

  org_admin: {
    allowed: [
      '/facility-management',
      // No '/org-admin' root: the Org Overview dashboard it served was merged
      // into /facility-management on 2026-08-19. The route still exists as a
      // redirect stub, and leaving it off this list is what makes the Edge
      // proxy send an old bookmark straight to the real dashboard.
      '/org-admin/users', '/org-admin/hospitals',
      '/org-admin/branding', '/org-admin/settings', '/org-admin/pricing',
      '/org-admin/analytics',
      '/facility-settings',
      // Console targets inside the IT/system console: data quality and the
      // conflict queue (org_admin is in CONFLICT_RESOLUTION_ROLES).
      '/it', '/system-admin', '/data-quality', '/admin/conflicts',
      '/hospitals', '/reports', '/settings', '/settings/manage',
      '/patients', '/pharmacy', '/messages',
      '/appointments',
      '/billing', '/payments', '/payments/claims',
      '/wards', '/equipment', '/hr', '/dashboard/hr', '/inquiries',
      '/blood-bank', '/controlled-substances', '/emergency-preparedness',
      // Facility station workspaces, moved off the super-admin console
      // 2026-08-19 (see the WORKSPACES block in permissions.ts). These pair
      // with nav entries there; both halves are required or the proxy 302s the
      // link away. County and Government are intentionally absent — they are
      // supra-organisational and would cross the tenant boundary.
      '/dashboard/front-desk', '/dashboard/lab', '/dashboard/pharmacy',
      '/dashboard/radiology', '/dashboard/data-entry', '/dashboard/nutrition',
      '/transfers',
    ],
    // Org admins land on the Facility Operations dashboard — the single home
    // since the separate /org-admin Org Overview page was deleted.
    defaultDashboard: '/facility-management',
  },

  doctor: {
    allowed: [
      '/dashboard', '/patients', '/triage', '/consultation', '/notes', '/referrals', '/messages',
      '/lab', '/pharmacy', '/immunizations', '/anc', '/births', '/deaths',
      '/settings',
      '/appointments',
      '/wards', '/alerts', '/blood-bank',
      '/transfers',
    ],
    defaultDashboard: '/dashboard',
  },

  clinical_officer: {
    // Diagnoses, treats, prescribes, orders labs, refers
    // visits. Clinical scope only — payment processing belongs to
    // cashier/biller, not clinicians.
    allowed: [
      '/dashboard', '/patients', '/triage', '/consultation', '/notes', '/referrals', '/messages',
      '/lab', '/pharmacy', '/immunizations', '/anc', '/births', '/deaths',
      '/settings',
      '/appointments',
      '/wards', '/alerts', '/blood-bank',
      '/transfers',
    ],
    defaultDashboard: '/dashboard',
  },

  nurse: {
    // Ward & bedside care, immunisation, ANC support, vital-event documentation.
    // Not payment processing (cashier/biller). Lands on the shared clinical
    // workspace (/dashboard), role-adapted for nursing.
    allowed: NURSE_MODULE_ROUTES,
    defaultDashboard: '/dashboard',
  },

  midwife: {
    // ICM scope: antenatal care, conducting deliveries, postnatal & newborn
    // care, obstetric referrals, and maternal/perinatal vital events. Reuses
    // the shared clinical workspace (/dashboard), role-adapted for maternity.
    // No general consultation/prescribing (clinician), no payment handling,
    // and no laboratory operations page — ANC lab results are reviewed inside
    // the patient/ANC record, not the lab orders queue.
    allowed: [
      '/dashboard', '/patients', '/triage', '/messages',
      '/anc', '/births', '/deaths', '/immunizations',
      '/wards', '/referrals', '/appointments',
      '/notes', '/settings',
      '/transfers',
    ],
    defaultDashboard: '/dashboard',
  },

  lab_tech: {
    allowed: [
      // `/patients` is here because lab work now happens in the chart: the
      // queue links a technician to /patients/<id>?tab=labs to walk the bench
      // steps. The chart itself only renders the lab-side tabs for this role
      // (see LAB_TAB_IDS in the chart page), so route access does not widen
      // what they can read.
      '/dashboard/lab', '/lab', '/patients', '/blood-bank', '/messages', '/settings',
    ],
    defaultDashboard: '/dashboard/lab',
  },

  pharmacist: {
    allowed: [
      // `/patients` is here so a pharmacist can open the chart from the name in
      // their queue. The chart renders only the medication-safety tabs for this
      // role (see PHARMACY_TAB_IDS in the chart page), so route access does not
      // widen what they can read.
      '/dashboard/pharmacy', '/pharmacy', '/patients', '/controlled-substances', '/messages', '/settings',
    ],
    defaultDashboard: '/dashboard/pharmacy',
  },

  front_desk: {
    // Reception: registration, appointment booking, and referral intake.
    // Money handling moves to the dedicated cashier role; bed/ward
    // management is a nursing function. Insurance claims belong to the
    // medical biller.
    allowed: [
      // '/check-in' is retired: checking a patient in is an action on their
      // appointment, not a module of its own.
      '/dashboard/front-desk', '/patients', '/referrals', '/messages',
      '/settings',
      '/appointments',

    ],
    defaultDashboard: '/dashboard/front-desk',
  },

  cashier: {
    // Point-of-service collections only: takes payments, records receipts, sets
    // up patient payment plans, looks up the patient/visit being billed. No
    // insurance claim adjudication (biller) and no clinical access.
    allowed: [
      '/billing', '/payments', '/payments/portal',
      '/patients', '/appointments', '/messages', '/settings',
    ],
    defaultDashboard: '/payments',
  },

  government: {
    allowed: [
      '/government', '/dashboard/state',
      '/hospitals', '/vital-statistics', '/immunizations',
      '/anc', '/births', '/deaths', '/facility-assessments', '/data-quality',
      '/surveillance', '/reports', '/dhis2-export', '/public-stats', '/settings',
      '/epidemic-intelligence', '/mch-analytics', '/appointments',
    ],
    defaultDashboard: '/government',
  },

  county_health_director: {
    // Sub-national (county) health-department oversight: supervises facilities &
    // payams, monitors surveillance/outbreaks, reviews data quality and vital
    // statistics, and owns DHIS2/HMIS reporting for the county. Aggregate views
    // only — no individual patient records, prescribing, dispensing, or billing.
    allowed: [
      '/dashboard/state',
      '/hospitals', '/surveillance', '/epidemic-intelligence', '/mch-analytics',
      '/vital-statistics', '/immunizations', '/anc', '/births', '/deaths',
      '/facility-assessments', '/data-quality', '/reports', '/dhis2-export',
      '/public-stats', '/messages', '/settings',
    ],
    defaultDashboard: '/dashboard/state',
  },

  data_entry_clerk: {
    allowed: [
      '/dashboard/data-entry', '/facility-assessments',
      '/data-quality', '/immunizations', '/anc',
      '/births', '/deaths', '/vital-statistics',
      '/messages', '/settings',
    ],
    defaultDashboard: '/dashboard/data-entry',
  },

  medical_superintendent: {
    allowed: [
      '/dashboard', '/patients', '/triage', '/consultation', '/notes', '/referrals', '/messages',
      '/lab', '/pharmacy', '/immunizations', '/anc', '/births', '/deaths',
      '/surveillance', '/reports', '/hospitals', '/settings', '/settings/manage',
      '/facility-settings',
      '/it', '/system-admin',
      '/epidemic-intelligence', '/mch-analytics', '/my-facility', '/facility-overview',
      '/appointments', '/facility-assessments', '/data-quality',
      '/billing', '/payments', '/payments/claims',
      '/wards', '/equipment', '/hr', '/dashboard/hr', '/inquiries',
      // The staff list. The HR module's own "Staff Roster" was the same roster
      // under another name, so the accounts page is now the only one.
      '/org-admin/users',
      '/blood-bank', '/controlled-substances', '/emergency-preparedness',
      '/transfers',
    ],
    defaultDashboard: '/dashboard',
  },

  hrio: {
    // Health Records & Information Officer — records, data quality, and DHIS2
    // reporting. NOT human-resources/payroll (that belongs to the medical
    // superintendent / hospital manager / org admin).
    allowed: [
      '/dashboard/data-entry', '/patients', '/facility-assessments',
      '/data-quality', '/reports', '/vital-statistics',
      '/immunizations', '/anc', '/births', '/deaths',
      '/hospitals', '/messages', '/settings', '/it', '/system-admin',
      '/dhis2-export',
    ],
    defaultDashboard: '/dashboard/data-entry',
  },

  nutritionist: {
    // Nutrition assessment & counselling and MCH nutrition programmes. Vaccine
    // administration (/immunizations) is a nursing/clinical task, not dietetics;
    // antenatal clinical care (/anc) is a midwife/nurse/clinician function —
    // maternal-nutrition data is reviewed via MCH analytics and the patient record.
    // /referrals is allowed so SAM/MAM follow-up can open a referral without
    // bouncing RoleGuard (nutrition dashboard "Refer" action).
    allowed: [
      '/dashboard/nutrition', '/patients', '/messages',
      '/mch-analytics', '/referrals', '/settings',
      '/transfers',
    ],
    defaultDashboard: '/dashboard/nutrition',
  },

  radiologist: {
    allowed: [
      '/dashboard/radiology', '/patients', '/lab', '/messages', '/settings',
    ],
    defaultDashboard: '/dashboard/radiology',
  },

  hospital_manager: {
    allowed: [
      // Facility Management is the manager's home dashboard (the former standalone
      // /dashboard/hospital-manager page was merged into it and deleted).
      '/facility-management',
      // Intelligence & population health
      '/epidemic-intelligence', '/mch-analytics', '/surveillance',
      // Network & facility
      '/hospitals', '/my-facility', '/facility-overview', '/facility-assessments',
      '/facility-settings',
      '/it', '/system-admin',
      // Reporting
      '/reports', '/data-quality', '/vital-statistics', '/dhis2-export', '/public-stats',
      // Facility operations
      '/equipment', '/hr', '/dashboard/hr', '/inquiries',
      // The staff list. The HR module's own "Staff Roster" was the same roster
      // under another name, so the accounts page is now the only one.
      '/org-admin/users',
      // Finance oversight
      '/billing', '/payments', '/payments/claims',
      // Clinical context (read). Lab/pharmacy are operational service queues run
      // by lab techs/pharmacists; the manager sees utilisation via reports, not
      // the live work queues.
      '/patients', '/wards', '/referrals', '/appointments', '/messages',
      '/settings', '/settings/manage',
      '/transfers',
    ],
    defaultDashboard: '/facility-management',
  },

  medical_biller: {
    // The old /billing "Collections" cockpit was retired: A/R aging moved to
    // /payments and the payer mix moved to /payments/claims.
    allowed: [
      '/billing', '/payments', '/payments/claims', '/payments/portal',
      '/patients', '/appointments', '/messages', '/settings',
    ],
    defaultDashboard: '/payments',
  },

  // ───────── Clinical-flow workflow stations (EHR Clinical Flow doc §4) ─────────
  central_registration_clerk: {
    allowed: [
      '/patients', '/appointments', '/referrals', '/messages',
      '/settings', '/dashboard/front-desk', '/payments', '/billing',
    ],
    defaultDashboard: '/dashboard/front-desk',
  },

  clinic_clerk: {
    allowed: [
      '/patients', '/appointments', '/messages',
      '/settings', '/dashboard/front-desk',
    ],
    defaultDashboard: '/dashboard/front-desk',
  },

  triage_nurse: {
    // Specialized nurse login, same merged clinical workspace as nurse.
    allowed: NURSE_MODULE_ROUTES,
    defaultDashboard: '/dashboard',
  },

  rooming_nurse: {
    // Specialized nurse login, same merged clinical workspace as nurse.
    allowed: NURSE_MODULE_ROUTES,
    defaultDashboard: '/dashboard',
  },

  clinician: {
    allowed: [
      '/dashboard', '/patients', '/triage', '/consultation', '/notes', '/referrals', '/messages',
      '/lab', '/pharmacy', '/immunizations', '/anc', '/births', '/deaths',
      '/appointments', '/wards', '/alerts', '/settings',
      '/blood-bank',
      '/transfers',
    ],
    defaultDashboard: '/dashboard',
  },

  records_hmis_officer: {
    allowed: [
      '/dashboard/data-entry', '/patients', '/facility-assessments', '/data-quality',
      '/reports', '/vital-statistics', '/immunizations', '/anc', '/births', '/deaths',
      '/hospitals', '/messages', '/settings', '/dhis2-export', '/system-admin',
    ],
    defaultDashboard: '/dashboard/data-entry',
  },

};

const DEFAULT_DASHBOARD_FALLBACK = '/dashboard';

/**
 * Routes every signed-in role can reach, whatever their module allow-list says.
 * These are personal surfaces rather than clinical modules — the notification
 * feed only ever contains items derived from data the user can already see, so
 * gating it per role would just break the bell for some roles.
 */
const UNIVERSAL_ROUTES: readonly string[] = ['/notifications'];

/**
 * Sub-routes that must be granted explicitly and never inherited from a
 * parent prefix. Without this, `/payments` in a role's allow-list silently
 * grants `/payments/claims`, and the universal `/settings` grants the
 * admin-facing `/settings/manage`. A role reaches these only when the exact
 * entry appears in its own allow-list.
 */
const EXPLICIT_GRANT_ROUTES: readonly string[] = ['/payments/claims', '/settings/manage'];

function getConfig(role: UserRole | string): RoleRouteConfig | undefined {
  return (ROLE_ROUTE_TABLE as Record<string, RoleRouteConfig>)[role];
}

/**
 * Returns true if `role` has an entry in `ROLE_ROUTE_TABLE`. Callers use this
 * to skip route gating for unknown/legacy roles instead of redirecting them
 * into a loop against an empty allow-list.
 */
export function hasRoleRouteConfig(role: UserRole | string): boolean {
  return getConfig(role) !== undefined;
}

/**
 * Returns true if a given role is allowed to navigate to `pathname`.
 * Uses an exact-match or path-prefix match (`pathname.startsWith(route + '/')`)
 * so that nested routes inherit access from their parent allow-list entry.
 *
 * NOTE: Returns `false` for unknown roles. Callers that need the previous
 * "unknown role is unrestricted" behaviour (e.g. middleware) should guard
 * with `hasRoleRouteConfig(role)` first.
 */
export function isPathAllowed(role: UserRole | string, pathname: string): boolean {
  // The platform super-admin has total page access by design — every module,
  // every station dashboard, every console. The super_admin entry in
  // ROLE_ROUTE_TABLE remains the source for NAV derivation only.
  if (role === 'super_admin') return true;
  const config = getConfig(role);
  if (!config) return false;
  // Compare the path only: callers also pass nav hrefs, which may carry a
  // query string or hash (e.g. "/data-quality?view=completeness"). Those
  // target the same route, and a real pathname never contains ? or #.
  const path = pathname.split(/[?#]/)[0];
  const matches = (route: string) => path === route || path.startsWith(route + '/');
  // Explicit-grant routes ignore prefix inheritance: the role's own allow-list
  // must name the route (or something nested beneath it).
  const explicit = EXPLICIT_GRANT_ROUTES.find(matches);
  if (explicit) {
    return config.allowed.some((route) => route === explicit || route.startsWith(explicit + '/'));
  }
  return UNIVERSAL_ROUTES.some(matches) || config.allowed.some(matches);
}

/**
 * Returns the canonical landing page for a role. Falls back to `/dashboard`
 * for unknown roles so callers never have to handle `undefined`.
 */
export function getDefaultDashboard(role: UserRole | string): string {
  return getConfig(role)?.defaultDashboard ?? DEFAULT_DASHBOARD_FALLBACK;
}
