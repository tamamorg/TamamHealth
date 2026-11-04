/**
 * Module hubs: the management navigation, one row per task.
 *
 * 2026-11-04 (user): "there's a lot of repetition in the navigations in the
 * managements … make sure there's less pages and navigations". The facility
 * management roles carried 24–28 nav rows each, the ministry and county
 * 16–19, and the same records were reachable from several of them (leave and
 * inquiries from their own rows AND a Work Queue; three intelligence pages;
 * five reporting pages).
 *
 * Now the nav lists one row per task area (a hub), and the hub's pages are
 * tabs along the top of each of them (ModuleHubTabs): a small, task-shaped
 * top level in the side menu, tabs only for closely related views. Every
 * page is still one click from any page in its hub.
 *
 * A route belongs to exactly one hub (a test pins it). Members are listed in
 * tab order; the nav row opens the first member the role may open, and a hub
 * the role can open only one page of shows that page's own name instead.
 */
import { isPathAllowed } from '@/lib/role-routes';
import type { UserRole } from '@/lib/db-types';

export interface ModuleHubMember {
  href: string;
  /** The tab's name. */
  label: string;
  /**
   * The page switches between the hub's pages itself (Reports' "Area" field
   * in Choose a report), so the tab strip is not drawn above it.
   */
  ownPicker?: true;
}

export interface ModuleHub {
  id: string;
  /** The nav row's name when the role sees two or more of its pages. */
  label: string;
  members: readonly ModuleHubMember[];
}

export const MODULE_HUBS: readonly ModuleHub[] = [
  {
    id: 'national',
    label: 'National Dashboard',
    members: [
      { href: '/government', label: 'National dashboard' },
      { href: '/government/alerts', label: 'Priority alerts' },
      { href: '/government/briefing', label: 'Executive briefing' },
      { href: '/government/equity', label: 'Equity & access' },
    ],
  },
  {
    id: 'facilities',
    label: 'Facilities',
    members: [
      { href: '/manage', label: 'Facilities & people' },
      { href: '/my-facility', label: 'My facility' },
      { href: '/facility-assessments', label: 'Assessments' },
    ],
  },
  {
    id: 'workforce',
    label: 'Workforce',
    members: [
      { href: '/hr/schedule', label: 'Shift schedule' },
      { href: '/hr/leave', label: 'Leave requests' },
      { href: '/hr/payroll', label: 'Payroll' },
    ],
  },
  {
    id: 'patients',
    label: 'Patients',
    members: [
      { href: '/patients', label: 'Patients' },
      { href: '/appointments', label: 'Appointments' },
      { href: '/inquiries', label: 'Reported issues' },
      { href: '/referrals', label: 'Referrals' },
      { href: '/transfers', label: 'Transfers' },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    members: [
      { href: '/wards', label: 'Beds & wards' },
      { href: '/departments', label: 'Departments' },
      { href: '/equipment', label: 'Assets' },
      { href: '/emergency-preparedness', label: 'Emergency preparedness' },
    ],
  },
  {
    id: 'services',
    label: 'Clinical Services',
    members: [
      { href: '/pharmacy', label: 'Pharmacy' },
      { href: '/lab', label: 'Laboratory' },
      { href: '/blood-bank', label: 'Blood bank' },
      { href: '/controlled-substances', label: 'Controlled substances' },
    ],
  },
  {
    id: 'finance',
    label: 'Billing & Payments',
    members: [
      { href: '/payments', label: 'Billing & payments' },
    ],
  },
  {
    id: 'intelligence',
    label: 'Surveillance',
    members: [
      { href: '/surveillance', label: 'Disease surveillance' },
      { href: '/epidemic-intelligence', label: 'Epidemic intelligence' },
      { href: '/mch-analytics', label: 'Maternal & child health' },
    ],
  },
  {
    id: 'programs',
    label: 'Programs',
    members: [
      { href: '/immunizations', label: 'Immunization' },
      { href: '/anc', label: 'Antenatal care' },
      { href: '/government/programs', label: 'Disease programs' },
    ],
  },
  {
    id: 'vital-events',
    label: 'Vital Events',
    members: [
      { href: '/births', label: 'Births' },
      { href: '/deaths', label: 'Deaths' },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    members: [
      { href: '/reports', label: 'Reports', ownPicker: true },
      { href: '/facility-overview', label: 'Facility statistics' },
      { href: '/data-quality', label: 'Data quality' },
      { href: '/vital-statistics', label: 'Vital statistics' },
      { href: '/dhis2-export', label: 'DHIS2 export' },
      { href: '/public-stats', label: 'Public statistics' },
      { href: '/org-admin/analytics', label: 'Usage analytics' },
    ],
  },
];

function normalize(path: string): string {
  const bare = path.split(/[?#]/, 1)[0];
  return bare.length > 1 ? bare.replace(/\/+$/, '') : bare;
}

/** The hub whose member IS this page (not a page beneath one, like /hr/leave/new). */
export function hubForPath(pathname: string | null | undefined): ModuleHub | null {
  if (!pathname) return null;
  const path = normalize(pathname);
  return MODULE_HUBS.find(hub => hub.members.some(m => m.href === path)) ?? null;
}

/** The hub a page sits in or under (/hr/leave/new → workforce), for the nav's active row. */
export function hubContainingPath(pathname: string | null | undefined): ModuleHub | null {
  if (!pathname) return null;
  const path = normalize(pathname);
  let best: { hub: ModuleHub; length: number } | null = null;
  for (const hub of MODULE_HUBS) {
    for (const m of hub.members) {
      if ((path === m.href || path.startsWith(`${m.href}/`)) && (!best || m.href.length > best.length)) {
        best = { hub, length: m.href.length };
      }
    }
  }
  return best?.hub ?? null;
}

/** The members of a hub this role may open, in tab order. */
export function visibleMembers(hub: ModuleHub, role: UserRole | null | undefined): ModuleHubMember[] {
  if (!role) return [];
  return hub.members.filter(m => isPathAllowed(role, m.href));
}

/**
 * Whether a role's nav reaches `href`: as a row of its own, or as a tab of a
 * hub whose row is in the nav (the row opens one of the hub's pages, and the
 * hub's tabs open the rest). `allowed` is the role's literal route list.
 */
export function navReaches(navHrefs: readonly string[], allowed: readonly string[], href: string): boolean {
  if (navHrefs.includes(href)) return true;
  const isAllowed = (path: string) => allowed.some(route => path === route || path.startsWith(`${route}/`));
  if (!isAllowed(href)) return false;
  const hub = MODULE_HUBS.find(h => h.members.some(m => m.href === href));
  return !!hub && hub.members.some(m => navHrefs.includes(m.href));
}
