/**
 * Management surfaces: the screens the management roles run the organisation
 * from (platform admin, organisation admin, facility management, ministry and
 * county oversight, the facility operations registers and the reporting and
 * analytics modules).
 *
 * The dashboard layout stamps `data-surface="management"` on `<main>` for
 * these routes, and `app/management-frame.css` dresses everything inside it in
 * the patient chart's frame: one body face, sentence-case headings, the
 * chart's section titles, table heads, KPI band and section list. Clinical
 * workspaces (the chart itself, the queues, the station homes) are not on the
 * list; they already wear the chart's look.
 *
 * Prefix match on a whole segment: `/admin` covers `/admin/users/42`, never
 * `/administration`.
 */
const MANAGEMENT_PREFIXES: readonly string[] = [
  // Platform and tenancy consoles
  '/admin', '/manage', '/org-admin', '/facility-management', '/facility-overview',
  '/my-facility', '/facility-settings', '/it', '/system-admin',
  // Ministry and county oversight
  '/government', '/dashboard/state', '/public-stats',
  // Facility operations registers
  '/hr', '/dashboard/hr', '/equipment', '/inquiries', '/departments',
  '/blood-bank', '/controlled-substances', '/emergency-preparedness',
  // Reporting, surveillance and analytics
  '/reports', '/data-quality', '/vital-statistics', '/facility-assessments',
  '/dhis2-export', '/epidemic-intelligence', '/mch-analytics', '/surveillance',
];

/**
 * Roles whose home is the shared `/dashboard` URL but whose dashboard there is
 * a management one (SuperintendentDashboard). Clinical roles share the URL
 * with the clinical workspace, so `/dashboard` is a management surface only
 * for these.
 */
const MANAGEMENT_DASHBOARD_ROLES: readonly string[] = ['medical_superintendent'];

/**
 * Roles with no clinical pages at all: every screen they open is a
 * management one, including the registers (births, deaths, immunization,
 * ANC) that clinical staff also use in their own frame.
 */
const ALL_MANAGEMENT_ROLES: readonly string[] = ['government', 'county_health_director'];

export function isManagementSurface(pathname: string | null | undefined, role?: string | null): boolean {
  if (!pathname) return false;
  if (role && ALL_MANAGEMENT_ROLES.includes(role) && pathname !== '/settings' && !pathname.startsWith('/settings/') && pathname !== '/messages' && !pathname.startsWith('/messages/')) return true;
  if (pathname === '/dashboard' && role && MANAGEMENT_DASHBOARD_ROLES.includes(role)) return true;
  return MANAGEMENT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
