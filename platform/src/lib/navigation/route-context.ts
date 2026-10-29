import { safeReturnTo } from './return-to';

export type RouteContextCrumb = {
  labelKey: string;
  href?: string;
};

export type RouteContext = {
  crumbs: RouteContextCrumb[];
  fallbackHref: string;
  /** Detail/workflow pages already render their own context-aware Back control. */
  showBack: boolean;
};

type RouteGroup = {
  root: string;
  rootLabelKey: string;
  children: Record<string, string>;
  /**
   * Set when the group's root is a URL prefix with no page behind it. Back and
   * the parent crumb then resolve to the VIEWER's own home dashboard instead
   * of a route that would only bounce or 302 — the label follows, so the crumb
   * reads "Dashboard" rather than naming a screen that no longer exists.
   */
  rootIsPrefixOnly?: boolean;
};

const GROUPS: RouteGroup[] = [
  {
    root: '/admin',
    rootLabelKey: 'breadcrumb.admin',
    children: {
      analytics: 'routeContext.analytics',
      announcements: 'routeContext.announcements',
      audit: 'routeContext.auditLog',
      billing: 'routeContext.billing',
      config: 'routeContext.configuration',
      conflicts: 'routeContext.conflicts',
      control: 'routeContext.controlCenter',
      data: 'routeContext.dataManagement',
      flags: 'routeContext.featureFlags',
      interop: 'routeContext.interoperability',
      organizations: 'breadcrumb.organizations',
      risk: 'routeContext.risk',
      security: 'routeContext.security',
      support: 'routeContext.support',
      sync: 'routeContext.sync',
      system: 'breadcrumb.system',
      users: 'breadcrumb.users',
    },
  },
  {
    // The Org Overview dashboard at /org-admin was merged into
    // /facility-management on 2026-08-19; only the editors below still live
    // under this prefix, so their Back lands on the caller's own dashboard.
    root: '/org-admin',
    rootLabelKey: 'breadcrumb.orgAdmin',
    rootIsPrefixOnly: true,
    children: {
      analytics: 'routeContext.analytics',
      branding: 'routeContext.branding',
      hospitals: 'nav.hospitals',
      pricing: 'routeContext.pricing',
      settings: 'breadcrumb.settings',
      users: 'breadcrumb.users',
    },
  },
  {
    root: '/government',
    rootLabelKey: 'breadcrumb.government',
    children: {
      alerts: 'routeContext.alerts',
      briefing: 'routeContext.briefing',
      equity: 'routeContext.equity',
      programs: 'routeContext.programs',
    },
  },
  {
    root: '/hr',
    rootLabelKey: 'routeContext.humanResources',
    children: {
      leave: 'routeContext.leave',
      payroll: 'routeContext.payroll',
      schedule: 'routeContext.schedule',
    },
  },
  {
    root: '/dashboard/nurse',
    rootLabelKey: 'routeContext.nursingDashboard',
    children: {
      handoff: 'routeContext.handoff',
      mar: 'routeContext.medicationAdministration',
      triage: 'routeContext.triage',
      ward: 'routeContext.ward',
    },
  },
];

const EXACT_ROUTES: Record<string, RouteContext> = {
  '/patients/new': context('/patients', 'breadcrumb.patients', 'routeContext.newPatient'),
  // Second-level pages whose parent is a page of its own: they get the bar
  // and its Back, which follows ?returnTo= first, the parent otherwise.
  '/facility-management/queue': context('/facility-management', 'routeContext.facilityManagement', 'routeContext.approvalQueue', true),
  '/payments/claims': context('/payments', 'routeContext.payments', 'routeContext.claims', true),
  '/wards/mar': context('/wards', 'routeContext.wards', 'routeContext.medicationAdministration', true),
  '/dashboard/nutrition/supplies': context('/dashboard/nutrition', 'breadcrumb.dashboard', 'nutrition.supplies', true),
  '/settings/manage': context('/settings', 'breadcrumb.settings', 'routeContext.manageSettings'),
};

type DynamicRoute = {
  matches: (segments: string[]) => boolean;
  context: RouteContext;
};

const DYNAMIC_ROUTES: DynamicRoute[] = [
  // The chart draws no Back of its own, so the bar's Back is the way out —
  // to the worklist it was opened from (?returnTo=), or the patient list.
  dynamic(segments => segments.length === 2 && segments[0] === 'patients', '/patients', 'breadcrumb.patients', 'routeContext.patientRecord', true),
  dynamic(segments => segments.length === 2 && segments[0] === 'notes', '/notes', 'routeContext.notes', 'routeContext.noteDetails'),
  dynamic(segments => segments.length === 2 && segments[0] === 'billing', '/billing', 'routeContext.billing', 'routeContext.billDetails'),
  dynamic(segments => segments.length === 2 && segments[0] === 'rooming', '/dashboard', 'breadcrumb.dashboard', 'routeContext.rooming'),
  dynamic(segments => segments.length === 2 && segments[0] === 'triage', '/dashboard', 'breadcrumb.dashboard', 'routeContext.triage'),
  dynamic(segments => segments.length === 3 && segments[0] === 'wards' && segments[1] === 'mar', '/wards', 'routeContext.wards', 'routeContext.medicationAdministration'),
];

/**
 * Resolve the compact navigation context shown above hierarchical desktop
 * pages. Routes absent from this curated registry are intentionally treated as
 * top-level destinations and do not receive an extra navigation bar.
 *
 * `homeHref` is the signed-in role's default dashboard. Only groups marked
 * `rootIsPrefixOnly` use it — those whose URL prefix has no page of its own —
 * and it must be role-derived, because the roles that share such a prefix do
 * not share a dashboard (an org admin lands on /facility-management, a medical
 * superintendent on /dashboard).
 */
export function resolveRouteContext(
  pathname: string,
  homeHref = '/dashboard',
  returnTo?: string | null,
): RouteContext | null {
  const normalizedPath = normalizePath(pathname);
  const exact = EXACT_ROUTES[normalizedPath];
  if (exact) return exact;

  const segments = normalizedPath.split('/').filter(Boolean);
  const dynamicRoute = DYNAMIC_ROUTES.find(route => route.matches(segments));
  if (dynamicRoute) {
    // A patient chart opened from a worklist names that worklist as its first
    // crumb, so the one back affordance returns to where the clinician was.
    if (segments[0] === 'patients') {
      const origin = chartOriginCrumb(returnTo, normalizedPath);
      if (origin) return context(origin.href, origin.labelKey, 'routeContext.patientRecord', true);
    }
    return dynamicRoute.context;
  }

  for (const group of GROUPS) {
    if (!normalizedPath.startsWith(`${group.root}/`)) continue;
    const child = normalizedPath.slice(group.root.length + 1);
    const childLabelKey = group.children[child];
    if (!childLabelKey) return null;
    return group.rootIsPrefixOnly
      ? context(homeHref, 'breadcrumb.dashboard', childLabelKey, true)
      : context(group.root, group.rootLabelKey, childLabelKey, true);
  }

  return null;
}

/** Label for the screen a chart was opened from, keyed on its first path segment. */
const ORIGIN_LABELS: Record<string, string> = {
  dashboard: 'breadcrumb.dashboard',
  appointments: 'routeContext.appointments',
  lab: 'breadcrumb.lab',
  pharmacy: 'breadcrumb.pharmacy',
  billing: 'routeContext.billing',
  messages: 'breadcrumb.messages',
  notes: 'routeContext.notes',
  referrals: 'breadcrumb.referrals',
  wards: 'routeContext.wards',
  rooming: 'routeContext.rooming',
  triage: 'routeContext.triage',
  'front-desk': 'chart.crumb.frontDesk',
  immunizations: 'nav.immunizations',
};

/** Crumb for a safe, non-self, non-/patients returnTo; null otherwise. */
export function chartOriginCrumb(
  returnTo: string | null | undefined,
  currentPathname: string,
): { href: string; labelKey: string } | null {
  if (!returnTo) return null;
  const href = safeReturnTo(returnTo, '');
  if (href !== returnTo) return null;
  const path = normalizePath(href);
  if (path === normalizePath(currentPathname)) return null;
  const first = path.split('/').filter(Boolean)[0];
  if (!first || first === 'patients') return null;
  return { href, labelKey: ORIGIN_LABELS[first] ?? 'chart.crumb.worklist' };
}

/** Resolve a validated returnTo, falling back to the route's real parent. */
export function routeContextBackHref(
  routeContext: RouteContext,
  returnTo: string | null | undefined,
  currentPathname?: string,
): string {
  const href = safeReturnTo(returnTo, routeContext.fallbackHref);
  return normalizePath(href.split(/[?#]/, 1)[0]) === normalizePath(currentPathname ?? '')
    ? routeContext.fallbackHref
    : href;
}

function context(parentHref: string, parentLabelKey: string, currentLabelKey: string, showBack = false): RouteContext {
  return {
    fallbackHref: parentHref,
    showBack,
    crumbs: [
      { href: parentHref, labelKey: parentLabelKey },
      { labelKey: currentLabelKey },
    ],
  };
}

function dynamic(
  matches: DynamicRoute['matches'],
  parentHref: string,
  parentLabelKey: string,
  currentLabelKey: string,
  showBack = false,
): DynamicRoute {
  return { matches, context: context(parentHref, parentLabelKey, currentLabelKey, showBack) };
}

function normalizePath(pathname: string): string {
  if (!pathname) return '/';
  const withoutQuery = pathname.split(/[?#]/, 1)[0];
  return withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, '') : withoutQuery;
}
