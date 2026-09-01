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
  county_health_director: ['/reports', '/surveillance', '/admin/organizations', '/mch-analytics'],
  org_admin: ['/patients', '/reports', '/wards', '/hr'],
  hospital_manager: ['/patients', '/reports', '/wards', '/hr'],
};

const PRIMARY_SHORTCUT_PRIORITY = [
  // /payments only. Claims is a tab inside that same workspace, not a
  // destination of its own — ranking it here is what once put two adjacent
  // money glyphs at the head of the rail for one page.
  '/payments',
  // No /consultation. It ranked second here while being a redirect stub to
  // /patients, so the clinician roles spent one of four rail shortcuts on the
  // button next to it. Its nav rows went with it (see permissions.ts).
  '/patients',
  '/appointments',
  // Cross-facility handoff is a primary clinical workflow, not an overflow
  // destination. Keeping it beside Patients and Appointments also makes it a
  // stable top-rail shortcut on the constrained tablet header.
  '/referrals',
  '/lab',
  '/reports',
  '/surveillance',
  '/pharmacy',
  '/wards',
  '/facility-management',
  '/government',
  '/admin/organizations',
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
 * Fill order:
 *   1. Every destination the role holds, ranked by PRIMARY_SHORTCUT_PRIORITY.
 *      Whether the role's own dashboard repeats a route only breaks ties: that
 *      argument holds while the user is standing ON their dashboard, and the
 *      rail is the only navigation on every other screen.
 *   2. Messages, after the work. It used to outrank the dashboard-duplicate
 *      routes, which is how eight roles ended up with the inbox as their FIRST
 *      rail button — Messages ahead of Pharmacy for a pharmacist, ahead of
 *      Patients for the front desk, ahead of Lab for the laboratory. The
 *      rail's job is "somewhere else, fast", and for a role at work that
 *      somewhere is the work.
 *   3. The role's own dashboard, last. The module trigger beside this row
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

  // Destinations rank by PRIMARY_SHORTCUT_PRIORITY across the whole set, not
  // by whether the role's dashboard happens to repeat them. Ranking duplicates
  // as a separate lower tier demoted precisely the route each role needs most:
  // Lab for the laboratory, Patients for the records desk, Surveillance for
  // the county director — each pushed behind a secondary destination that only
  // ranked higher for being absent from its dashboard. `duplicateRoutes` still
  // breaks ties, so a route the dashboard already shows loses to one it does
  // not when the priority list rates them equally.
  const destinations = sortByShortcutPriority(
    items.filter(item => !isDashboard(item.href) && item.href !== '/messages'),
  ).sort((a, b) => {
    const ap = PRIMARY_SHORTCUT_PRIORITY.indexOf(a.href);
    const bp = PRIMARY_SHORTCUT_PRIORITY.indexOf(b.href);
    if (ap !== bp) return 0; // sortByShortcutPriority already ordered these
    const ad = duplicateRoutes?.includes(a.href) ? 1 : 0;
    const bd = duplicateRoutes?.includes(b.href) ? 1 : 0;
    return ad - bd;
  });
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
  const ordered = [...destinations, ...messagesFallback].filter(item => {
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

/** Management dashboards already contain task tabs and action queues. */
const ROLES_WITHOUT_DASHBOARD_NAV_STRIP = new Set<UserRole>([
  'super_admin', 'org_admin', 'hospital_manager',
]);

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
  if (role && ROLES_WITHOUT_DASHBOARD_NAV_STRIP.has(role)) return [];
  if (role === 'medical_superintendent') count = Math.min(count, 2);
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


/**
 * The canonical name for a destination, whatever a role's nav table calls it.
 *
 * The same page is labelled differently by different roles — `/payments` had
 * six names across the product (Bills · Revenue & Bills · Checkout Payments ·
 * Collect Payment · Bills & Invoices · Billing & Payments), `/lab` five. Some
 * of that is deliberate framing worth keeping (a midwife's "Mothers & Babies"
 * for the patient registry). Most is drift, and it made a support answer
 * unanswerable: "open Bills" names one of six rows.
 *
 * The desktop rail already resolved this through a private keymap. The mobile
 * module sheet did not — it rendered `item.label` raw, so the two surfaces
 * disagreed with each other. Sharing the resolver is what makes them agree;
 * the labels in `permissions.ts` stay the fallback they already were.
 */
const NAV_LABEL_KEYS: Record<string, string> = {
  '/dashboard': 'nav.dashboard',
  '/patients': 'nav.patients',
  '/appointments': 'nav.appointments',
  '/referrals': 'nav.referrals',
  '/lab': 'nav.lab',
  '/pharmacy': 'nav.pharmacy',
  '/immunizations': 'nav.immunizations',
  '/anc': 'nav.anc',
  '/births': 'nav.births',
  '/deaths': 'nav.deaths',
  '/surveillance': 'nav.surveillance',
  '/admin/organizations': 'nav.organizations',
  '/reports': 'nav.reports',
  '/messages': 'nav.messages',
  '/settings': 'nav.settings',
  '/government': 'nav.government',
  '/facility-settings': 'nav.facilitySettings',
  '/payments': 'nav.payments',
  '/payments/claims': 'nav.claims',
  '/wards': 'nav.wards',
  '/blood-bank': 'nav.bloodBank',
};

/** Hrefs with one agreed name. Exported so a test can assert the coverage. */
export const CANONICAL_NAV_HREFS = Object.keys(NAV_LABEL_KEYS);

/**
 * Resolve a nav item's display name.
 *
 * `translate` is the caller's `t`; a missing key returns the key itself, which
 * is the signal to fall back to the role's own label rather than render
 * `nav.payments` at somebody.
 */
export function navItemLabel(item: NavItem, translate: (key: string) => string): string {
  const key = item.href ? NAV_LABEL_KEYS[item.href] : undefined;
  if (key) {
    const translated = translate(key);
    if (translated !== key) return translated;
  }
  return item.label;
}

/**
 * The top rail's two centre lines — one shape for every role, matching the
 * one the platform operator always had ("TAMAMHEALTH PLATFORM ADMIN /
 * COMMAND CENTER"): the organization on the main line, and the SITE the
 * session is scoped to on the quieter line under it — "REPUBLIC OF SOUTH
 * SUDAN / JUBA TEACHING HOSPITAL".
 *
 * The second line used to carry the role instead, with the facility demoted
 * to a hover tooltip. Between them those two lines answer "where am I", and a
 * multi-site organization is exactly where that question is asked — while the
 * role is something the signed-in user already knows, and which their own
 * dashboard header now prints under the greeting on every workspace. So the
 * rail names the place and the page names the job.
 *
 * `roleLabel` (the role's written label from ROLE_PERMISSIONS, the one source
 * covering all 25 roles) stays the fallback for the accounts that have no
 * facility at all — a platform operator, a ministry account, an org admin
 * between postings — because a blank second line says less than the workspace
 * does. It is passed in rather than looked up here so this stays a pure
 * function a test can drive without the permissions table's icon imports.
 */
export function railCenterLabels(input: {
  role?: UserRole;
  /** The signed-in user's display name — the platform operator's main line. */
  name?: string;
  orgName?: string;
  facilityName?: string;
  /** getRoleConfig(role).label — the workspace line. */
  roleLabel?: string;
}): { centerLabel?: string; centerSubLabel?: string } {
  const { role, name, orgName, facilityName, roleLabel } = input;
  if (!role) return {};
  // The platform administrator belongs to no tenant and no site, so the only
  // true answer for the main line is who they are: their own display name,
  // which they can change in Settings and see reflected here (it seeds as
  // "TamamHealth Platform Admin", so the console reads the same until they
  // rename it).
  if (role === 'super_admin') {
    return { centerLabel: name || 'TamamHealth Platform Admin', centerSubLabel: 'Command Center' };
  }
  // The facility console names itself, because its dashboard no longer prints
  // a title above its own numbers: for org_admin and hospital_manager the
  // useful workspace line is the console they are standing in ("Facility
  // Management"), not their own role label ("Organization Admin"), which the
  // organization name above it already implies. Only used when the account has
  // no facility of its own to name.
  const workspace = role === 'org_admin' || role === 'hospital_manager'
    ? 'Facility Management'
    : roleLabel;
  const centerLabel = orgName
    || (role === 'government' ? 'Ministry of Health' : facilityName || workspace);
  // The site under the organization. Two accounts never reach it: one with no
  // facility at all — a ministry or county account, an org admin between
  // postings — and one whose missing org name already pushed the facility up
  // to the main line. Both keep the workspace there rather than going blank or
  // printing the same words twice.
  const secondLine = facilityName && facilityName !== centerLabel ? facilityName : workspace;
  const centerSubLabel = centerLabel !== secondLine ? secondLine : undefined;
  return { centerLabel, centerSubLabel };
}

/**
 * Prefer the live facility directory over session-denormalised names. This is
 * what lets a facility rename or a late sync update the header immediately,
 * while the session claim remains the first-paint/offline fallback.
 */
export function resolveRailFacilityName(input: {
  liveName?: string;
  hydratedName?: string;
  sessionName?: string;
}): string | undefined {
  return input.liveName || input.hydratedName || input.sessionName;
}

export interface ImpersonationChipInfo {
  /** The role the session is actually acting as right now. */
  activeRoleLabel: string;
  /** The real account behind the session — who to blame/credit, not who the
   *  screen is currently dressed as. */
  actualRoleLabel: string;
}

/**
 * Whether the top rail's support-session chip should render, and the two
 * role names it needs to say so.
 *
 * `actualRole` is minted into the JWT the moment a platform super-admin signs
 * in AS another role (see `resolveEffectiveIdentity` in
 * `modules/identity/core/login-session.ts`), round-tripped through
 * `/api/auth/me`, and canonicalised onto `AppUser` in `context.tsx` — and
 * until this existed, nothing on screen named it: a workspace impersonated by
 * support looked byte-for-byte identical to that role's own ordinary session.
 *
 * Pure and exported so the "when does this show, and what does it say" rule
 * is testable without EhrTopRail's dozen hook dependencies (useHospitals,
 * usePatients, useOrganizations, useUsers, useNotifications, useAuth, ...) —
 * the same reason `railCenterLabels` above is a plain function rather than
 * inline JSX logic.
 */
export function impersonationChipInfo(input: {
  role?: UserRole;
  actualRole?: UserRole;
  /** getRoleConfig(role).label for the ACTIVE role. */
  roleLabel?: string;
  /** getRoleConfig(actualRole).label for the REAL role. */
  actualRoleLabel?: string;
}): ImpersonationChipInfo | null {
  const { role, actualRole, roleLabel, actualRoleLabel } = input;
  if (!actualRole || actualRole === role) return null;
  return {
    activeRoleLabel: roleLabel || role || '',
    actualRoleLabel: actualRoleLabel || actualRole,
  };
}
