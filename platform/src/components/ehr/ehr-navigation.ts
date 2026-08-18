import type { NavItem } from '@/lib/permissions';
import type { UserRole } from '@/lib/db-types';

// Routes dropped from a role's top-rail quick-shortcut row because that
// role's own default dashboard body already has a dedicated, same-intent
// button for the same route (e.g. the front-desk board's quick-action row
// already has a "Register new patient" button, so the header doesn't need
// one too). Only routes with a *verified* body-level duplicate are listed
// here — a route missing from a role's list still shows in the header as
// normal.
//
// Clinician- and nurse-family roles (doctor, clinical_officer, clinician,
// nurse, midwife, triage_nurse, rooming_nurse) have no entries: the routes
// they once listed were verified against dashboard bodies that no longer
// exist, so those shortcuts went back to showing in the header like any
// other role until something in the shared clinical shell verifiably
// duplicates them again.
const HEADER_SHORTCUT_DUPLICATE_ROUTES: Partial<Record<UserRole, string[]>> = {
  medical_superintendent: ['/payments'],
  front_desk: ['/patients', '/referrals', '/appointments'],
  central_registration_clerk: ['/patients', '/appointments', '/referrals'],
  clinic_clerk: ['/patients', '/appointments'],
  lab_tech: ['/lab'],
  pharmacist: ['/pharmacy', '/controlled-substances'],
  data_entry_clerk: ['/facility-assessments', '/data-quality', '/vital-statistics', '/immunizations', '/anc', '/births', '/deaths'],
  hrio: ['/patients', '/reports', '/data-quality', '/vital-statistics', '/immunizations', '/anc', '/births', '/deaths', '/facility-assessments'],
  records_hmis_officer: ['/patients', '/reports', '/data-quality', '/vital-statistics', '/facility-assessments'],
  nutritionist: ['/patients'],
  radiologist: ['/patients', '/lab'],
  county_health_director: ['/reports', '/surveillance', '/hospitals', '/mch-analytics'],
  org_admin: ['/patients', '/reports', '/wards', '/hr'],
  hospital_manager: ['/patients', '/reports', '/wards', '/hr'],
};

const PRIMARY_SHORTCUT_PRIORITY = [
  '/payments',
  '/payments/claims',
  '/consultation',
  '/patients',
  '/appointments',
  '/lab',
  '/reports',
  '/surveillance',
  '/pharmacy',
  '/wards',
  '/facility-management',
  '/government',
  '/hospitals',
  '/data-quality',
  '/dhis2-export',
  '/settings',
];

export function isHrefAllowed(href: string, allowedRoutes: readonly string[]) {
  // Nav items may deep-link with a query string (e.g. /data-quality?view=x) —
  // permission is decided by the path alone.
  const path = href.split('?')[0];
  return allowedRoutes.some(route => path === route || path.startsWith(route + '/'));
}

/**
 * Which module the user is currently in — the single answer the trigger icon,
 * the module dropdown and the shortcut row all read from.
 *
 * Longest match wins, because nav lists nest: a role holding both `/dashboard`
 * and `/dashboard/lab` is inside Lab when the path is `/dashboard/lab`, not
 * inside both. Matching on a bare prefix per-surface is what let the dropdown
 * highlight two rows while the trigger showed a third icon.
 *
 * A query string never decides the module (`/patients/x?tab=labs` is still
 * Patients), matching how `isHrefAllowed` reads a path.
 */
export function activeNavItem(items: NavItem[], pathname: string | null): NavItem | null {
  if (!pathname) return null;
  const path = pathname.split('?')[0];
  return items
    .filter(item => !!item.href && (path === item.href || path.startsWith(item.href + '/')))
    .sort((a, b) => b.href.length - a.href.length)[0] || null;
}

export function uniqueAllowedNavItems(items: NavItem[], allowedRoutes: readonly string[]) {
  const seen = new Set<string>();
  return items.filter(item => {
    if (!item.href || seen.has(item.href) || !isHrefAllowed(item.href, allowedRoutes)) return false;
    seen.add(item.href);
    return true;
  });
}

export function groupNavItemsBySection(items: NavItem[]): { section: string | null; items: NavItem[] }[] {
  const groups: { section: string | null; items: NavItem[] }[] = [];
  let current: { section: string | null; items: NavItem[] } | null = null;

  for (const item of items) {
    const section = item.section || null;
    if (!current || current.section !== section) {
      current = { section, items: [item] };
      groups.push(current);
    } else {
      current.items.push(item);
    }
  }

  return groups;
}

/** Sort a nav-item list by top-rail shortcut priority, then original order. */
function sortByShortcutPriority(list: NavItem[]): NavItem[] {
  return list
    .map((item, index) => ({ item, index, priority: PRIMARY_SHORTCUT_PRIORITY.indexOf(item.href) }))
    .sort((a, b) => {
      const aPriority = a.priority === -1 ? Number.MAX_SAFE_INTEGER : a.priority;
      const bPriority = b.priority === -1 ? Number.MAX_SAFE_INTEGER : b.priority;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return a.index - b.index;
    })
    .map(entry => entry.item);
}

/**
 * The top-rail shortcut row next to the module dropdown. Returns up to
 * `maxItems` shortcuts from the active role's permitted navigation. Routes
 * already represented by the role dashboard are preferred only as fallbacks,
 * so the header stays useful without introducing unauthorized or unrelated
 * destinations. The fallback also keeps specialist roles with small menus
 * from ending up with an incomplete header.
 *
 * Tiers, in fill order:
 *   1. Primary destinations — not the home dashboard, messages, or a route the
 *      role's own dashboard body already duplicates.
 *   2. Messages.
 *   3. Dashboard-duplicate destinations — used when still needed to reach the
 *      requested header size.
 *   4. The role's own dashboard, last. The module trigger beside this row
 *      carries the dashboard glyph and its menu leads with Dashboard, so a
 *      shortcut to it was the same destination twice in adjacent buttons. It
 *      stays as the final fallback rather than being dropped outright, so a
 *      specialist role with a short menu still fills the row.
 *
 * `homeHref` is what makes tier 4 work for every role, not just the ones whose
 * home lives under `/dashboard`. An org admin lands on `/facility-management`
 * and a super admin on `/admin` — both labelled "Dashboard" in their nav — so
 * without it those roles spent a shortcut slot on the button the user is
 * already standing on, and a real destination fell off the end of the row.
 */
export function getPrimaryShortcutItems(items: NavItem[], role?: UserRole, maxItems = 5, homeHref?: string) {
  const duplicateRoutes = role ? HEADER_SHORTCUT_DUPLICATE_ROUTES[role] : undefined;
  const home = homeHref?.split('?')[0];
  const isDashboard = (href: string) =>
    href === '/dashboard' || href.startsWith('/dashboard/') || (!!home && href === home);

  const tier1 = sortByShortcutPriority(
    items.filter(item => !isDashboard(item.href) && item.href !== '/messages' && !duplicateRoutes?.includes(item.href)),
  );
  const duplicateFallbacks = sortByShortcutPriority(
    items.filter(item => !isDashboard(item.href) && item.href !== '/messages' && duplicateRoutes?.includes(item.href)),
  );
  const messagesFallback = sortByShortcutPriority(items.filter(item => item.href === '/messages'));

  // No dashboard shortcut, ever — not even to fill an empty slot on a role
  // with few destinations. The rail already offers it twice: the brand mark
  // goes home, and the module menu lists it. A third route drew the dashboard
  // glyph immediately beside the hamburger, so two adjacent buttons meant
  // roughly the same thing and the shortcut row's job ("somewhere else, fast")
  // stopped being legible. A short row is the honest answer for a role that
  // genuinely has few places to be.

  // De-duplicate by href across tiers (defensive; nav items are already unique).
  const seen = new Set<string>();
  const ordered = [...tier1, ...messagesFallback, ...duplicateFallbacks].filter(item => {
    if (seen.has(item.href)) return false;
    seen.add(item.href);
    return true;
  });

  return ordered.slice(0, maxItems);
}

/** How many destinations the top rail keeps as always-visible shortcuts. */
export const RAIL_SHORTCUT_COUNT = 4;

/** How many more the dashboard header strip carries, below the rail's four. */
export const PAGE_HEADER_NAV_COUNT = 5;

/**
 * The navigations a dashboard promotes into its own header strip: the next
 * rung down the same priority order the rail uses, so the two rows read as one
 * continuous list rather than two competing opinions about what matters.
 *
 * Both dashboard shells call this — the clinical worklist and the station
 * shell behind front desk, pharmacy, lab, radiology, nutrition, HR, state and
 * facility management — so every module's header offers the same depth of
 * navigation and the module menu is correspondingly shorter.
 *
 * The role's own dashboard is never included: it is the page the strip is
 * being rendered on.
 */
export function getPageHeaderNavItems(
  items: NavItem[],
  role?: UserRole,
  homeHref?: string,
  count = PAGE_HEADER_NAV_COUNT,
): NavItem[] {
  // Ask for both tiers at once and drop the rail's share, so the header picks
  // up exactly where the rail left off with no separate ordering to keep in
  // sync. No over-fetch and no home filter needed: dashboard and home routes
  // are excluded from the shortcut tiers outright, so nothing here has to
  // compensate for one arriving last.
  const promoted = getPrimaryShortcutItems(items, role, RAIL_SHORTCUT_COUNT + count, homeHref);
  return promoted
    .slice(RAIL_SHORTCUT_COUNT)
    .slice(0, count);
}
