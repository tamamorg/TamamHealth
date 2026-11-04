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

export function isManagementSurface(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return MANAGEMENT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
