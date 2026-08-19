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
};

const GROUPS: RouteGroup[] = [
  {
    root: '/admin',
    rootLabelKey: 'breadcrumb.admin',
    children: {
      analytics: 'routeContext.analytics',
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
    root: '/org-admin',
    rootLabelKey: 'breadcrumb.orgAdmin',
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
  '/settings/manage': context('/settings', 'breadcrumb.settings', 'routeContext.manageSettings'),
};

type DynamicRoute = {
  matches: (segments: string[]) => boolean;
  context: RouteContext;
};

const DYNAMIC_ROUTES: DynamicRoute[] = [
  dynamic(segments => segments.length === 2 && segments[0] === 'patients', '/patients', 'breadcrumb.patients', 'routeContext.patientRecord'),
  dynamic(segments => segments.length === 2 && segments[0] === 'notes', '/notes', 'routeContext.notes', 'routeContext.noteDetails'),
  dynamic(segments => segments.length === 2 && segments[0] === 'billing', '/billing', 'routeContext.billing', 'routeContext.billDetails'),
  dynamic(segments => segments.length === 3 && segments[0] === 'hospitals' && segments[2] === 'manage', '/hospitals', 'nav.hospitals', 'routeContext.manageFacility'),
  dynamic(segments => segments.length === 3 && segments[0] === 'telehealth' && segments[1] === 'visit', '/appointments', 'routeContext.appointments', 'routeContext.telehealthVisit'),
  dynamic(segments => segments.length === 2 && segments[0] === 'rooming', '/dashboard', 'breadcrumb.dashboard', 'routeContext.rooming'),
  dynamic(segments => segments.length === 2 && segments[0] === 'triage', '/dashboard', 'breadcrumb.dashboard', 'routeContext.triage'),
  dynamic(segments => segments.length === 3 && segments[0] === 'wards' && segments[1] === 'mar', '/wards', 'routeContext.wards', 'routeContext.medicationAdministration'),
];

/**
 * Resolve the compact navigation context shown above hierarchical desktop
 * pages. Routes absent from this curated registry are intentionally treated as
 * top-level destinations and do not receive an extra navigation bar.
 */
export function resolveRouteContext(pathname: string): RouteContext | null {
  const normalizedPath = normalizePath(pathname);
  const exact = EXACT_ROUTES[normalizedPath];
  if (exact) return exact;

  const segments = normalizedPath.split('/').filter(Boolean);
  const dynamicRoute = DYNAMIC_ROUTES.find(route => route.matches(segments));
  if (dynamicRoute) return dynamicRoute.context;

  for (const group of GROUPS) {
    if (!normalizedPath.startsWith(`${group.root}/`)) continue;
    const child = normalizedPath.slice(group.root.length + 1);
    const childLabelKey = group.children[child];
    if (!childLabelKey) return null;
    return context(group.root, group.rootLabelKey, childLabelKey, true);
  }

  return null;
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
): DynamicRoute {
  return { matches, context: context(parentHref, parentLabelKey, currentLabelKey) };
}

function normalizePath(pathname: string): string {
  if (!pathname) return '/';
  const withoutQuery = pathname.split(/[?#]/, 1)[0];
  return withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, '') : withoutQuery;
}
