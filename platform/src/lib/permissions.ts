import type { ComponentType, CSSProperties, SVGProps } from 'react';
import type { UserRole } from './db-types';
import {
  ROLE_ROUTE_TABLE,
  isPathAllowed as isPathAllowedFromTable,
  getDefaultDashboard as getDefaultDashboardFromTable,
} from './role-routes';
// Clean single-stroke Tailwind Labs Heroicons via the local compatibility shim.
import {
  LayoutDashboard,
  Users,
  Pill,
  BarChart3,
  Building2,
  Hospital as HospitalIcon,
  MessageSquare,
  Database,
  Download,
  ClipboardCheck,
  Syringe,
  HeartPulse,
  Globe,
  CreditCard,
  Settings,
  Calendar,
  ScanLine,
  Server,
  Gauge,
  // Bills have ONE nav home in every role: the Wallet on /payments (the Bills &
  // Claims workspace). The invoice list (/billing) and the claims queue
  // (/payments/claims) stay routable — reached from that workspace's Actions
  // menu and its Claims tab — rather than each adding another billing glyph.
  Wallet,
  BedDouble,
  Stethoscope,
  Package,
  Microscope,
  Droplets,
  Biohazard,
  ClipboardPen,
  Siren,
  Baby,
  UserX,
  Shield,
  ShieldAlert,
  Eye,
  TrendingUp,
  GitCompareArrows,
  ArrowRightLeft,
  FileText,
  RefreshCw,
  Flag,
  KeyRound,
  CalendarClock,
  ClipboardList,
} from '@/components/icons/lucide';
import { BRAND_DARKER, BRAND_PRIMARY, BRAND_SECONDARY } from './theme-colors';

// Lenient shape so either lucide or our duotone wrappers type-check.
export type NavIcon = ComponentType<
  Omit<SVGProps<SVGSVGElement>, 'color'> & {
    size?: number | string;
    strokeWidth?: number | string;
    color?: string;
    style?: CSSProperties;
    className?: string;
    absoluteStrokeWidth?: boolean;
  }
>;

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  section?: string;
  /** Key used to look up live badge count from useSidebarBadges (e.g. 'messages', 'referrals'). */
  badgeKey?: string;
  /**
   * When set, the item is rendered as an in-place trigger rather than a route
   * link. 'availability' opens the "Add availability" modal so providers can
   * publish bookable windows from the sidebar's Schedule tab. `href` is then
   * just a stable React key / sentinel and is never navigated to.
   */
  action?: 'availability';
}

export interface RoleConfig {
  label: string;
  defaultDashboard: string;
  allowedRoutes: string[];
  navItems: NavItem[];
  color: string;
  gradientFrom: string;
  gradientTo: string;
  badgeLabel: string;
}

export const ROLE_PERMISSIONS: Record<UserRole, RoleConfig> = {
  super_admin: {
    label: 'Super Admin',
    defaultDashboard: ROLE_ROUTE_TABLE.super_admin.defaultDashboard,
    allowedRoutes: [...ROLE_ROUTE_TABLE.super_admin.allowed],
    // Platform-governance IA: the super admin is a platform operator, not a
    // hospital worker — primary nav is command/tenants/operations/business/
    // governance. Clinical routes stay reachable (allowedRoutes) for support
    // work but are deliberately NOT in this list.
    navItems: [
      { href: '/admin', label: 'Platform Dashboard', icon: Gauge, section: 'COMMAND' },
      { href: '/admin/risk', label: 'Risk Center', icon: ShieldAlert, section: 'COMMAND' },
      { href: '/admin/audit', label: 'Audit Logs', icon: FileText, section: 'COMMAND' },
      { href: '/admin/organizations', label: 'Organizations', icon: Building2, section: 'TENANTS' },
      { href: '/hospitals', label: 'Facilities', icon: HospitalIcon, section: 'TENANTS' },
      // Account administration is listed once, under PEOPLE & HR below —
      // it was also here under TENANTS, giving one page two nav homes.
      { href: '/admin/support', label: 'Support Operations', icon: MessageSquare, section: 'TENANTS' },
      { href: '/admin/system', label: 'System Health', icon: Server, section: 'PLATFORM OPERATIONS' },
      { href: '/admin/sync', label: 'Sync & Jobs', icon: RefreshCw, section: 'PLATFORM OPERATIONS' },
      { href: '/admin/interop', label: 'Interoperability', icon: Globe, section: 'PLATFORM OPERATIONS' },
      { href: '/admin/data', label: 'Data Governance', icon: Database, section: 'PLATFORM OPERATIONS' },
      { href: '/admin/billing', label: 'Billing & Subscriptions', icon: CreditCard, section: 'BUSINESS' },
      { href: '/admin/analytics', label: 'Usage Analytics', icon: TrendingUp, section: 'BUSINESS' },
      { href: '/reports', label: 'Reports', icon: ClipboardCheck, section: 'BUSINESS' },
      { href: '/admin/security', label: 'Security & Compliance', icon: Shield, section: 'GOVERNANCE' },
      { href: '/admin/config', label: 'Configuration', icon: Settings, section: 'GOVERNANCE' },
      { href: '/admin/flags', label: 'Feature Flags', icon: Flag, section: 'GOVERNANCE' },
      // WORKSPACES removed 2026-08-19: the platform operator is not a clinical
      // user, and a menu of live facility stations put real patient queues one
      // click from the governance console. The clinical workspaces now belong
      // to org_admin, who actually runs the facilities. Support/QA entry into a
      // station is still available — and better — through the login role
      // picker, which records `actualRole: 'super_admin'` on the session so the
      // access is auditable rather than ambient. Route access itself is
      // unchanged (the super_admin wildcard in isPathAllowed still permits deep
      // links); this only stops the console advertising them.
      // Facility Ops (/facility-management) removed from the super-admin nav
      // 2026-08-15: it renders the facility-admin dashboard language inside
      // the governance console. The route stays in allowedRoutes for deep
      // links; facility operators keep it as their own dashboard.
      // PEOPLE & HR — the whole workforce area in one section (see org_admin).
      { href: '/admin/users', label: 'User Accounts', icon: KeyRound, section: 'PEOPLE & HR' },
      { href: '/hr/leave', label: 'Leave Requests', icon: ClipboardList, section: 'PEOPLE & HR' },
      { href: '/hr/schedule', label: 'Shift Schedule', icon: CalendarClock, section: 'PEOPLE & HR' },
      { href: '/hr/payroll', label: 'Payroll', icon: Wallet, section: 'PEOPLE & HR' },
      { href: '/inquiries', label: 'Patient Inquiries', icon: MessageSquare, section: 'PEOPLE & HR' },
    ],
    color: BRAND_SECONDARY,
    gradientFrom: BRAND_DARKER,
    gradientTo: BRAND_SECONDARY,
    badgeLabel: 'Admin User',
  },

  org_admin: {
    label: 'Organization Admin',
    defaultDashboard: ROLE_ROUTE_TABLE.org_admin.defaultDashboard,
    allowedRoutes: [...ROLE_ROUTE_TABLE.org_admin.allowed],
    // Main navigation is for daily operational work. Setup/configuration
    // destinations (users, pricing, branding, facility settings) live under
    // Settings so org admins do not see duplicate management surfaces.
    navItems: [
      { href: '/facility-management', label: 'Dashboard', icon: Gauge, section: 'OVERVIEW' },
      // The separate /org-admin "Org Overview" dashboard was merged into this
      // one on 2026-08-19 and deleted — facilities, visits, inpatients, staff
      // and revenue are the band above the work queue now, so there is one
      // home rather than a nav entry and a hidden twin.
      // This is staff-to-staff chat. It was labelled "Enquiries", which sent
      // anyone looking for inbound patient enquiries to the wrong screen —
      // those now have their own page, reachable from the People & HR menu.
      { href: '/messages', label: 'Messages', icon: MessageSquare, section: 'OVERVIEW' },
      { href: '/hospitals', label: 'Facilities', icon: HospitalIcon, section: 'FACILITIES & OPERATIONS' },
      { href: '/wards', label: 'Bed Management', icon: BedDouble, section: 'FACILITIES & OPERATIONS' },
      { href: '/appointments', label: 'Appointments', icon: Calendar, section: 'FACILITIES & OPERATIONS' },
      // PEOPLE & HR — one section, seven real destinations, so the whole
      // workforce area is reachable from the module menu instead of hiding
      // behind a single "Doctors & Staff" link that landed on a roster with
      // no way back out to leave, shifts or payroll.
      { href: '/org-admin/users', label: 'User Accounts', icon: KeyRound, section: 'PEOPLE & HR' },
      { href: '/hr/leave', label: 'Leave Requests', icon: ClipboardList, section: 'PEOPLE & HR' },
      { href: '/hr/schedule', label: 'Shift Schedule', icon: CalendarClock, section: 'PEOPLE & HR' },
      { href: '/hr/payroll', label: 'Payroll', icon: Wallet, section: 'PEOPLE & HR' },
      { href: '/inquiries', label: 'Patient Inquiries', icon: MessageSquare, section: 'PEOPLE & HR' },
      { href: '/patients', label: 'Patients', icon: Users, section: 'CLINICAL SERVICES' },
      { href: '/pharmacy', label: 'Prescriptions & Medicines', icon: Pill, section: 'CLINICAL SERVICES' },
      { href: '/blood-bank', label: 'Blood Bank', icon: Droplets, section: 'CLINICAL SERVICES' },
      { href: '/payments', label: 'Billing & Payments', icon: Wallet, section: 'FINANCE' },
      { href: '/reports', label: 'Reports', icon: ClipboardCheck, section: 'INTELLIGENCE & REPORTING' },
      { href: '/equipment', label: 'Assets', icon: Package, section: 'RISK, ASSETS & PREPAREDNESS' },
      { href: '/emergency-preparedness', label: 'Emergency Prep', icon: ShieldAlert, section: 'RISK, ASSETS & PREPAREDNESS' },
      // WORKSPACES moved here from super_admin 2026-08-19. The org admin runs
      // these facilities, so a station shortcut is part of the job rather than
      // a platform operator reaching into a tenant's clinical floor. Each entry
      // is also added to org_admin's `allowed` list in role-routes.ts — a nav
      // item without the matching route is silently 302'd by the Edge proxy.
      // County (/dashboard/state) and Government (/government) deliberately did
      // NOT come along: both are supra-organisational surfaces, and granting
      // them here would let one tenant's admin see across tenants.
      { href: '/dashboard/front-desk', label: 'Front Desk', icon: MessageSquare, section: 'WORKSPACES' },
      { href: '/dashboard/lab', label: 'Laboratory', icon: Microscope, section: 'WORKSPACES' },
      { href: '/dashboard/pharmacy', label: 'Pharmacy', icon: Pill, section: 'WORKSPACES' },
      { href: '/dashboard/radiology', label: 'Radiology', icon: ScanLine, section: 'WORKSPACES' },
      { href: '/dashboard/data-entry', label: 'Records / HMIS', icon: BarChart3, section: 'WORKSPACES' },
      { href: '/dashboard/nutrition', label: 'Nutrition', icon: LayoutDashboard, section: 'WORKSPACES' },
      // IT Operations and System Administration both live inside the personal
      // Settings page now (Settings -> System administration); /it and
      // /system-admin stay routable for deep links but have no nav entry.
      // Org settings live inside the personal Settings page (Settings →
      // Organization); /org-admin/settings redirects there, so no nav item.
    ],
    color: BRAND_PRIMARY,
    gradientFrom: BRAND_SECONDARY,
    gradientTo: BRAND_PRIMARY,
    badgeLabel: 'Org Admin',
  },

  doctor: {
    label: 'Doctor',
    defaultDashboard: ROLE_ROUTE_TABLE.doctor.defaultDashboard,
    allowedRoutes: [...ROLE_ROUTE_TABLE.doctor.allowed],
    navItems: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/messages', label: 'Messages', icon: MessageSquare, badgeKey: 'messages' },
      { href: '/patients', label: 'Patients', icon: Users, section: 'CLINICAL' },
      { href: '/consultation', label: 'Consultation', icon: Stethoscope, section: 'CLINICAL' },
      { href: '/wards', label: 'Wards', icon: BedDouble, section: 'CLINICAL' },
      { href: '/appointments', label: 'Appointments', icon: Calendar, section: 'CLINICAL' },
      { href: '/referrals', label: 'Referrals', icon: ArrowRightLeft, section: 'CLINICAL', badgeKey: 'referrals' },
      { href: '/alerts', label: 'Alerts', icon: Siren, section: 'CLINICAL' },
      { href: '/lab', label: 'Lab Results', icon: Microscope, section: 'SERVICES' },
      { href: '/pharmacy', label: 'Pharmacy', icon: Pill, section: 'SERVICES' },
      { href: '/blood-bank', label: 'Blood Bank', icon: Droplets, section: 'SERVICES' },
      { href: '/anc', label: 'Antenatal Care', icon: HeartPulse, section: 'MATERNAL & CHILD' },
      { href: '/immunizations', label: 'Immunizations', icon: Syringe, section: 'MATERNAL & CHILD' },
      { href: '/births', label: 'Birth Registration', icon: Baby, section: 'REGISTRATION' },
      { href: '/deaths', label: 'Death Registration', icon: UserX, section: 'REGISTRATION' },
    ],
    color: BRAND_PRIMARY,
    gradientFrom: BRAND_SECONDARY,
    gradientTo: BRAND_PRIMARY,
    badgeLabel: 'Med. Doctor',
  },

  clinical_officer: {
    label: 'Clinical Officer',
    defaultDashboard: ROLE_ROUTE_TABLE.clinical_officer.defaultDashboard,
    allowedRoutes: [...ROLE_ROUTE_TABLE.clinical_officer.allowed],
    navItems: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/messages', label: 'Messages', icon: MessageSquare, badgeKey: 'messages' },
      { href: '/patients', label: 'Patients', icon: Users, section: 'CLINICAL' },
      { href: '/consultation', label: 'Consultation', icon: Stethoscope, section: 'CLINICAL' },
      { href: '/wards', label: 'Wards', icon: BedDouble, section: 'CLINICAL' },
      { href: '/appointments', label: 'Appointments', icon: Calendar, section: 'CLINICAL' },
      { href: '/referrals', label: 'Referrals', icon: ArrowRightLeft, section: 'CLINICAL', badgeKey: 'referrals' },
      { href: '/alerts', label: 'Alerts', icon: Siren, section: 'CLINICAL' },
      { href: '/lab', label: 'Lab Results', icon: Microscope, section: 'SERVICES' },
      { href: '/pharmacy', label: 'Pharmacy', icon: Pill, section: 'SERVICES' },
      { href: '/blood-bank', label: 'Blood Bank', icon: Droplets, section: 'SERVICES' },
      { href: '/anc', label: 'Antenatal Care', icon: HeartPulse, section: 'MATERNAL & CHILD' },
      { href: '/immunizations', label: 'Immunizations', icon: Syringe, section: 'MATERNAL & CHILD' },
      { href: '/births', label: 'Birth Registration', icon: Baby, section: 'REGISTRATION' },
      { href: '/deaths', label: 'Death Registration', icon: UserX, section: 'REGISTRATION' },
    ],
    color: BRAND_PRIMARY,
    gradientFrom: BRAND_SECONDARY,
    gradientTo: BRAND_PRIMARY,
    badgeLabel: 'Clin. Officer',
  },

  nurse: {
    label: 'Nurse',
    defaultDashboard: ROLE_ROUTE_TABLE.nurse.defaultDashboard,
    allowedRoutes: [...ROLE_ROUTE_TABLE.nurse.allowed],
    navItems: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, section: 'CLINICAL' },
      { href: '/patients', label: 'Patients', icon: Users, section: 'CLINICAL' },
      { href: '/wards', label: 'Wards', icon: BedDouble, section: 'CLINICAL' },
      { href: '/wards/handoff', label: 'Shift Handoff', icon: ArrowRightLeft, section: 'CLINICAL' },
      { href: '/appointments', label: 'Appointments', icon: Calendar, section: 'CLINICAL' },
      { href: '/messages', label: 'Messages', icon: MessageSquare, section: 'CLINICAL' },
      { href: '/immunizations', label: 'Immunizations', icon: Syringe, section: 'CARE PROGRAMS' },
      { href: '/anc', label: 'Antenatal Care', icon: HeartPulse, section: 'CARE PROGRAMS' },
      { href: '/births', label: 'Births', icon: Baby, section: 'VITAL EVENTS' },
      { href: '/deaths', label: 'Deaths', icon: UserX, section: 'VITAL EVENTS' },
      { href: '/lab', label: 'Lab Results', icon: Microscope, section: 'MORE' },
    ],
    color: BRAND_PRIMARY,
    gradientFrom: BRAND_SECONDARY,
    gradientTo: BRAND_PRIMARY,
    badgeLabel: 'Staff Nurse',
  },

  midwife: {
    label: 'Midwife',
    defaultDashboard: ROLE_ROUTE_TABLE.midwife.defaultDashboard,
    allowedRoutes: [...ROLE_ROUTE_TABLE.midwife.allowed],
    navItems: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, section: 'MATERNITY' },
      { href: '/patients', label: 'Mothers & Babies', icon: Users, section: 'MATERNITY' },
      { href: '/anc', label: 'Antenatal Care', icon: HeartPulse, section: 'MATERNITY' },
      { href: '/births', label: 'Deliveries', icon: Baby, section: 'MATERNITY' },
      { href: '/wards', label: 'Maternity Ward', icon: BedDouble, section: 'MATERNITY' },
      { href: '/wards/handoff', label: 'Shift Handoff', icon: ClipboardList, section: 'MATERNITY' },
      { href: '/immunizations', label: 'Newborn Immunizations', icon: Syringe, section: 'CARE' },
      { href: '/deaths', label: 'Maternal/Perinatal Deaths', icon: UserX, section: 'CARE' },
      { href: '/referrals', label: 'Referrals', icon: ArrowRightLeft, section: 'CARE' },
      { href: '/appointments', label: 'Appointments', icon: Calendar, section: 'CARE' },
      { href: '/messages', label: 'Messages', icon: MessageSquare, section: 'MORE' },
    ],
    color: BRAND_PRIMARY,
    gradientFrom: BRAND_SECONDARY,
    gradientTo: BRAND_PRIMARY,
    badgeLabel: 'Staff Midwife',
  },

  lab_tech: {
    label: 'Lab Technician',
    defaultDashboard: ROLE_ROUTE_TABLE.lab_tech.defaultDashboard,
    allowedRoutes: [...ROLE_ROUTE_TABLE.lab_tech.allowed],
    navItems: [
      { href: '/dashboard/lab', label: 'Lab Command Center', icon: LayoutDashboard, section: 'LABORATORY' },
      { href: '/lab', label: 'Lab Orders & Results', icon: Microscope, section: 'LABORATORY' },
      { href: '/blood-bank', label: 'Blood Bank', icon: Droplets, section: 'LABORATORY' },
      { href: '/messages', label: 'Messages', icon: MessageSquare, section: 'MORE' },
    ],
    color: BRAND_PRIMARY,
    gradientFrom: BRAND_SECONDARY,
    gradientTo: BRAND_PRIMARY,
    badgeLabel: 'Lab Tech',
  },

  pharmacist: {
    label: 'Pharmacist',
    defaultDashboard: ROLE_ROUTE_TABLE.pharmacist.defaultDashboard,
    allowedRoutes: [...ROLE_ROUTE_TABLE.pharmacist.allowed],
    navItems: [
      { href: '/dashboard/pharmacy', label: 'Pharmacy Ops', icon: LayoutDashboard, section: 'PHARMACY' },
      { href: '/pharmacy', label: 'Dispensing', icon: Pill, section: 'PHARMACY' },
      { href: '/controlled-substances', label: 'Controlled Substances', icon: ClipboardCheck, section: 'PHARMACY' },
      { href: '/messages', label: 'Messages', icon: MessageSquare, section: 'MORE' },
    ],
    color: BRAND_PRIMARY,
    gradientFrom: BRAND_SECONDARY,
    gradientTo: BRAND_PRIMARY,
    badgeLabel: 'Pharmacy',
  },

  front_desk: {
    label: 'Medical Receptionist',
    defaultDashboard: ROLE_ROUTE_TABLE.front_desk.defaultDashboard,
    allowedRoutes: [...ROLE_ROUTE_TABLE.front_desk.allowed],
    navItems: [
      { href: '/dashboard/front-desk', label: 'Reception', icon: LayoutDashboard, section: 'RECEPTION' },
      // No Check-In module: a patient is checked in from their appointment
      // row, so Appointments is the single front door for starting a visit.
      { href: '/patients', label: 'Patient Registry', icon: Users, section: 'RECEPTION' },
      { href: '/referrals', label: 'Referrals', icon: ArrowRightLeft, section: 'RECEPTION' },
      { href: '/appointments', label: 'Appointments', icon: Calendar, section: 'RECEPTION' },
      { href: '/messages', label: 'Messages', icon: MessageSquare, section: 'MORE' },
    ],
    color: BRAND_PRIMARY,
    gradientFrom: BRAND_SECONDARY,
    gradientTo: BRAND_PRIMARY,
    badgeLabel: 'Reception',
  },

  cashier: {
    label: 'Cashier',
    defaultDashboard: ROLE_ROUTE_TABLE.cashier.defaultDashboard,
    allowedRoutes: [...ROLE_ROUTE_TABLE.cashier.allowed],
    navItems: [
      { href: '/payments', label: 'Collect Payment', icon: Wallet, section: 'CASHIER' },
      { href: '/patients', label: 'Patient Lookup', icon: Users, section: 'CASHIER' },
      { href: '/appointments', label: 'Appointments', icon: Calendar, section: 'CASHIER' },
      { href: '/messages', label: 'Messages', icon: MessageSquare, section: 'MORE' },
    ],
    color: BRAND_PRIMARY,
    gradientFrom: BRAND_SECONDARY,
    gradientTo: BRAND_PRIMARY,
    badgeLabel: 'Cashier Desk',
  },

  government: {
    label: 'Ministry of Health',
    defaultDashboard: ROLE_ROUTE_TABLE.government.defaultDashboard,
    allowedRoutes: [...ROLE_ROUTE_TABLE.government.allowed],
    // Public-health intelligence IA (WHO RHIS / DHIS2-aligned): command,
    // surveillance, system performance, programs, CRVS, data quality,
    // exchange, equity. Query-string hrefs deep-link into a page's view.
    navItems: [
      { href: '/government', label: 'National Dashboard', icon: LayoutDashboard, section: 'NATIONAL COMMAND' },
      { href: '/government/alerts', label: 'Priority Alerts', icon: Siren, section: 'NATIONAL COMMAND' },
      { href: '/government/briefing', label: 'Executive Briefing', icon: ClipboardPen, section: 'NATIONAL COMMAND' },
      { href: '/surveillance', label: 'Surveillance', icon: Eye, section: 'SURVEILLANCE & RESPONSE' },
      { href: '/epidemic-intelligence', label: 'Epidemic Intelligence', icon: Biohazard, section: 'SURVEILLANCE & RESPONSE' },
      { href: '/epidemic-intelligence?tab=alerts', label: 'Alert Verification', icon: ShieldAlert, section: 'SURVEILLANCE & RESPONSE' },
      { href: '/hospitals', label: 'Facilities & Services', icon: HospitalIcon, section: 'HEALTH SYSTEM PERFORMANCE' },
      { href: '/facility-assessments', label: 'Assessments & Readiness', icon: ClipboardCheck, section: 'HEALTH SYSTEM PERFORMANCE' },
      { href: '/immunizations', label: 'Immunization', icon: Syringe, section: 'PROGRAMS' },
      { href: '/anc', label: 'ANC / RMNCAH', icon: HeartPulse, section: 'PROGRAMS' },
      { href: '/mch-analytics', label: 'MCH Analytics', icon: Baby, section: 'PROGRAMS' },
      { href: '/government/programs', label: 'Disease Programs', icon: Shield, section: 'PROGRAMS' },
      { href: '/births', label: 'Births', icon: Baby, section: 'VITAL EVENTS & CRVS' },
      { href: '/deaths', label: 'Deaths', icon: UserX, section: 'VITAL EVENTS & CRVS' },
      { href: '/vital-statistics', label: 'Vital Statistics', icon: TrendingUp, section: 'VITAL EVENTS & CRVS' },
      { href: '/data-quality?view=completeness', label: 'Reporting Completeness', icon: Database, section: 'DATA QUALITY' },
      { href: '/data-quality?view=timeliness', label: 'Reporting Timeliness', icon: Gauge, section: 'DATA QUALITY' },
      { href: '/data-quality?view=outliers', label: 'Outliers & Validation', icon: ShieldAlert, section: 'DATA QUALITY' },
      { href: '/data-quality?view=scores', label: 'Facility DQ Scores', icon: BarChart3, section: 'DATA QUALITY' },
      { href: '/reports', label: 'Reports & Downloads', icon: ClipboardCheck, section: 'REPORTS & EXCHANGE' },
      { href: '/dhis2-export', label: 'DHIS2 Export', icon: Download, section: 'REPORTS & EXCHANGE' },
      { href: '/public-stats', label: 'Public Statistics', icon: Globe, section: 'REPORTS & EXCHANGE' },
      { href: '/government/equity', label: 'County Comparison', icon: GitCompareArrows, section: 'EQUITY & PLANNING' },
      { href: '/government/equity?view=burden', label: 'High Burden / Low Coverage', icon: TrendingUp, section: 'EQUITY & PLANNING' },
      { href: '/government/equity?view=access', label: 'Service Access Gaps', icon: Building2, section: 'EQUITY & PLANNING' },
    ],
    color: BRAND_SECONDARY,
    gradientFrom: BRAND_DARKER,
    gradientTo: BRAND_SECONDARY,
    badgeLabel: 'MoH',
  },

  county_health_director: {
    label: 'County Health Director',
    defaultDashboard: ROLE_ROUTE_TABLE.county_health_director.defaultDashboard,
    allowedRoutes: [...ROLE_ROUTE_TABLE.county_health_director.allowed],
    navItems: [
      { href: '/dashboard/state', label: 'County Overview', icon: LayoutDashboard, section: 'OVERSIGHT' },
      { href: '/hospitals', label: 'Facility Network', icon: HospitalIcon, section: 'OVERSIGHT' },
      { href: '/surveillance', label: 'Surveillance', icon: Eye, section: 'INTELLIGENCE' },
      { href: '/epidemic-intelligence', label: 'Epidemic Intelligence', icon: Biohazard, section: 'INTELLIGENCE' },
      { href: '/mch-analytics', label: 'MCH Analytics', icon: HeartPulse, section: 'INTELLIGENCE' },
      { href: '/vital-statistics', label: 'Vital Statistics', icon: TrendingUp, section: 'POPULATION HEALTH' },
      { href: '/immunizations', label: 'Immunizations', icon: Syringe, section: 'POPULATION HEALTH' },
      { href: '/anc', label: 'Maternal Health', icon: HeartPulse, section: 'POPULATION HEALTH' },
      { href: '/births', label: 'Births', icon: Baby, section: 'POPULATION HEALTH' },
      { href: '/deaths', label: 'Deaths', icon: UserX, section: 'POPULATION HEALTH' },
      { href: '/facility-assessments', label: 'Facility Assessments', icon: ClipboardCheck, section: 'GOVERNANCE' },
      { href: '/data-quality', label: 'Data Quality', icon: Database, section: 'GOVERNANCE' },
      { href: '/reports', label: 'Reports', icon: BarChart3, section: 'GOVERNANCE' },
      { href: '/dhis2-export', label: 'DHIS2 Export', icon: Download, section: 'GOVERNANCE' },
      { href: '/public-stats', label: 'Public Statistics', icon: Globe, section: 'GOVERNANCE' },
      { href: '/messages', label: 'Messages', icon: MessageSquare, section: 'MORE' },
    ],
    color: BRAND_PRIMARY,
    gradientFrom: BRAND_SECONDARY,
    gradientTo: BRAND_PRIMARY,
    badgeLabel: 'County Dir.',
  },

  data_entry_clerk: {
    label: 'Data Entry Clerk',
    defaultDashboard: ROLE_ROUTE_TABLE.data_entry_clerk.defaultDashboard,
    allowedRoutes: [...ROLE_ROUTE_TABLE.data_entry_clerk.allowed],
    navItems: [
      { href: '/dashboard/data-entry', label: 'Data Entry', icon: LayoutDashboard, section: 'FACILITY DATA' },
      { href: '/facility-assessments', label: 'Facility Assessments', icon: ClipboardCheck, section: 'FACILITY DATA' },
      { href: '/data-quality', label: 'Data Quality', icon: Database, section: 'FACILITY DATA' },
      { href: '/vital-statistics', label: 'Vital Statistics', icon: TrendingUp, section: 'RECORDS' },
      { href: '/immunizations', label: 'Immunizations', icon: Syringe, section: 'RECORDS' },
      { href: '/anc', label: 'Antenatal Care', icon: HeartPulse, section: 'RECORDS' },
      { href: '/births', label: 'Births', icon: Baby, section: 'RECORDS' },
      { href: '/deaths', label: 'Deaths', icon: UserX, section: 'RECORDS' },
      { href: '/messages', label: 'Messages', icon: MessageSquare, section: 'MORE' },
    ],
    color: BRAND_PRIMARY,
    gradientFrom: BRAND_SECONDARY,
    gradientTo: BRAND_PRIMARY,
    badgeLabel: 'Data Clerk',
  },

  medical_superintendent: {
    label: 'Medical Superintendent',
    defaultDashboard: ROLE_ROUTE_TABLE.medical_superintendent.defaultDashboard,
    allowedRoutes: [...ROLE_ROUTE_TABLE.medical_superintendent.allowed],
    navItems: [
      { href: '/dashboard', label: 'Hospital Dashboard', icon: LayoutDashboard, section: 'ADMINISTRATION' },
      { href: '/hospitals', label: 'Hospital Network', icon: HospitalIcon, section: 'ADMINISTRATION' },
      { href: '/my-facility', label: 'My Facility', icon: Building2, section: 'ADMINISTRATION' },
      { href: '/facility-overview', label: 'Facility Overview', icon: Gauge, section: 'ADMINISTRATION' },
      { href: '/equipment', label: 'Assets', icon: Package, section: 'ADMINISTRATION' },
      { href: '/facility-assessments', label: 'Facility Assessments', icon: ClipboardCheck, section: 'ADMINISTRATION' },
      // PEOPLE & HR — the whole workforce area in one section (see org_admin).
      { href: '/org-admin/users', label: 'User Accounts', icon: KeyRound, section: 'PEOPLE & HR' },
      { href: '/hr/leave', label: 'Leave Requests', icon: ClipboardList, section: 'PEOPLE & HR' },
      { href: '/hr/schedule', label: 'Shift Schedule', icon: CalendarClock, section: 'PEOPLE & HR' },
      { href: '/hr/payroll', label: 'Payroll', icon: Wallet, section: 'PEOPLE & HR' },
      { href: '/inquiries', label: 'Patient Inquiries', icon: MessageSquare, section: 'PEOPLE & HR' },
      { href: '/emergency-preparedness', label: 'Emergency Prep', icon: ShieldAlert, section: 'ADMINISTRATION' },
      { href: '/controlled-substances', label: 'Controlled Substances', icon: ClipboardCheck, section: 'SERVICES' },
      { href: '/data-quality', label: 'Data Quality', icon: Database, section: 'ADMINISTRATION' },
      { href: '/it', label: 'IT Operations', icon: Server, section: 'ADMINISTRATION' },
      { href: '/patients', label: 'Patients', icon: Users, section: 'CLINICAL' },
      { href: '/wards', label: 'Wards', icon: BedDouble, section: 'CLINICAL' },
      { href: '/consultation', label: 'Consultation', icon: Stethoscope, section: 'CLINICAL' },
      { href: '/referrals', label: 'Referrals', icon: ArrowRightLeft, section: 'CLINICAL' },
      { href: '/appointments', label: 'Appointments', icon: Calendar, section: 'CLINICAL' },
      { href: '/lab', label: 'Laboratory', icon: Microscope, section: 'SERVICES' },
      { href: '/pharmacy', label: 'Pharmacy', icon: Pill, section: 'SERVICES' },
      { href: '/blood-bank', label: 'Blood Bank', icon: Droplets, section: 'SERVICES' },
      { href: '/payments', label: 'Bills', icon: Wallet, section: 'SERVICES' },
      { href: '/epidemic-intelligence', label: 'Epidemic Intel', icon: Biohazard, section: 'INTELLIGENCE' },
      { href: '/mch-analytics', label: 'MCH Analytics', icon: HeartPulse, section: 'INTELLIGENCE' },
      { href: '/surveillance', label: 'Surveillance', icon: Eye, section: 'INTELLIGENCE' },
      { href: '/reports', label: 'Reports', icon: BarChart3, section: 'MORE' },
      { href: '/messages', label: 'Messages', icon: MessageSquare, section: 'MORE' },
    ],
    color: BRAND_SECONDARY,
    gradientFrom: BRAND_DARKER,
    gradientTo: BRAND_SECONDARY,
    badgeLabel: 'Med. Supt.',
  },

  hrio: {
    label: 'Health Records Officer',
    defaultDashboard: ROLE_ROUTE_TABLE.hrio.defaultDashboard,
    allowedRoutes: [...ROLE_ROUTE_TABLE.hrio.allowed],
    navItems: [
      { href: '/dashboard/data-entry', label: 'Records Dashboard', icon: LayoutDashboard, section: 'RECORDS' },
      { href: '/patients', label: 'Patient Registry', icon: Users, section: 'RECORDS' },
      { href: '/data-quality', label: 'Data Quality', icon: Database, section: 'RECORDS' },
      { href: '/it', label: 'IT Operations', icon: Server, section: 'RECORDS' },
      { href: '/reports', label: 'Reports', icon: BarChart3, section: 'RECORDS' },
      { href: '/vital-statistics', label: 'Vital Statistics', icon: TrendingUp, section: 'VITAL EVENTS' },
      { href: '/immunizations', label: 'Immunizations', icon: Syringe, section: 'VITAL EVENTS' },
      { href: '/anc', label: 'Antenatal Care', icon: HeartPulse, section: 'VITAL EVENTS' },
      { href: '/births', label: 'Births', icon: Baby, section: 'VITAL EVENTS' },
      { href: '/deaths', label: 'Deaths', icon: UserX, section: 'VITAL EVENTS' },
      { href: '/facility-assessments', label: 'Facility Assessments', icon: ClipboardCheck, section: 'GOVERNANCE' },
      { href: '/hospitals', label: 'Facility Network', icon: Building2, section: 'GOVERNANCE' },
      { href: '/dhis2-export', label: 'DHIS2 Export', icon: Download, section: 'GOVERNANCE' },
      { href: '/messages', label: 'Messages', icon: MessageSquare, section: 'MORE' },
    ],
    color: BRAND_PRIMARY,
    gradientFrom: BRAND_SECONDARY,
    gradientTo: BRAND_PRIMARY,
    badgeLabel: 'HMIS Officer',
  },

  nutritionist: {
    label: 'Nutritionist',
    defaultDashboard: ROLE_ROUTE_TABLE.nutritionist.defaultDashboard,
    allowedRoutes: [...ROLE_ROUTE_TABLE.nutritionist.allowed],
    navItems: [
      { href: '/dashboard/nutrition', label: 'Nutrition Dashboard', icon: LayoutDashboard, section: 'NUTRITION' },
      { href: '/patients', label: 'Patients', icon: Users, section: 'NUTRITION' },
      { href: '/referrals', label: 'Referrals', icon: ArrowRightLeft, section: 'NUTRITION' },
      { href: '/mch-analytics', label: 'MCH Analytics', icon: HeartPulse, section: 'PROGRAMS' },
      { href: '/messages', label: 'Messages', icon: MessageSquare, section: 'MORE' },
    ],
    color: BRAND_PRIMARY,
    gradientFrom: BRAND_SECONDARY,
    gradientTo: BRAND_PRIMARY,
    badgeLabel: 'Nutrition',
  },

  radiologist: {
    label: 'Radiologist',
    defaultDashboard: ROLE_ROUTE_TABLE.radiologist.defaultDashboard,
    allowedRoutes: [...ROLE_ROUTE_TABLE.radiologist.allowed],
    navItems: [
      { href: '/dashboard/radiology', label: 'Imaging Dashboard', icon: LayoutDashboard, section: 'IMAGING' },
      { href: '/patients', label: 'Patients', icon: Users, section: 'IMAGING' },
      { href: '/lab', label: 'Lab & Imaging', icon: ScanLine, section: 'IMAGING' },
      { href: '/messages', label: 'Messages', icon: MessageSquare, section: 'MORE' },
    ],
    color: BRAND_PRIMARY,
    gradientFrom: BRAND_SECONDARY,
    gradientTo: BRAND_PRIMARY,
    badgeLabel: 'Radiology',
  },

  hospital_manager: {
    label: 'Hospital Manager',
    defaultDashboard: ROLE_ROUTE_TABLE.hospital_manager.defaultDashboard,
    allowedRoutes: [...ROLE_ROUTE_TABLE.hospital_manager.allowed],
    navItems: [
      { href: '/facility-management', label: 'Dashboard', icon: LayoutDashboard, section: 'OVERVIEW' },
      { href: '/epidemic-intelligence', label: 'Epidemic Intelligence', icon: Biohazard, section: 'INTELLIGENCE' },
      { href: '/mch-analytics', label: 'MCH Analytics', icon: HeartPulse, section: 'INTELLIGENCE' },
      { href: '/surveillance', label: 'Surveillance', icon: Eye, section: 'INTELLIGENCE' },
      { href: '/hospitals', label: 'Hospital Network', icon: HospitalIcon, section: 'FACILITY' },
      { href: '/my-facility', label: 'My Facility', icon: Building2, section: 'FACILITY' },
      { href: '/facility-overview', label: 'Facility Overview', icon: Gauge, section: 'FACILITY' },
      { href: '/facility-assessments', label: 'Facility Assessments', icon: ClipboardCheck, section: 'FACILITY' },
      { href: '/equipment', label: 'Assets & Equipment', icon: Package, section: 'FACILITY' },
      // PEOPLE & HR — the whole workforce area in one section (see org_admin).
      { href: '/org-admin/users', label: 'User Accounts', icon: KeyRound, section: 'PEOPLE & HR' },
      { href: '/hr/leave', label: 'Leave Requests', icon: ClipboardList, section: 'PEOPLE & HR' },
      { href: '/hr/schedule', label: 'Shift Schedule', icon: CalendarClock, section: 'PEOPLE & HR' },
      { href: '/hr/payroll', label: 'Payroll', icon: Wallet, section: 'PEOPLE & HR' },
      { href: '/inquiries', label: 'Patient Inquiries', icon: MessageSquare, section: 'PEOPLE & HR' },
      { href: '/payments', label: 'Revenue & Bills', icon: Wallet, section: 'FINANCE' },
      { href: '/reports', label: 'Reports', icon: BarChart3, section: 'REPORTING' },
      { href: '/data-quality', label: 'Data Quality', icon: Database, section: 'REPORTING' },
      { href: '/it', label: 'IT Operations', icon: Server, section: 'REPORTING' },
      { href: '/vital-statistics', label: 'Vital Statistics', icon: TrendingUp, section: 'REPORTING' },
      { href: '/dhis2-export', label: 'DHIS2 Export', icon: Download, section: 'REPORTING' },
      { href: '/public-stats', label: 'Public Statistics', icon: Globe, section: 'REPORTING' },
      { href: '/patients', label: 'Patients', icon: Users, section: 'CLINICAL' },
      { href: '/wards', label: 'Wards', icon: BedDouble, section: 'CLINICAL' },
      { href: '/referrals', label: 'Referrals', icon: ArrowRightLeft, section: 'CLINICAL' },
      { href: '/messages', label: 'Messages', icon: MessageSquare, section: 'MORE' },
    ],
    color: BRAND_SECONDARY,
    gradientFrom: BRAND_DARKER,
    gradientTo: BRAND_SECONDARY,
    badgeLabel: 'Hosp. Mgr.',
  },

  medical_biller: {
    label: 'Medical Biller',
    defaultDashboard: ROLE_ROUTE_TABLE.medical_biller.defaultDashboard,
    allowedRoutes: [...ROLE_ROUTE_TABLE.medical_biller.allowed],
    navItems: [
      { href: '/payments', label: 'Bills & Invoices', icon: Wallet, section: 'BILLING' },
      { href: '/patients', label: 'Patients', icon: Users, section: 'PATIENTS' },
      { href: '/appointments', label: 'Appointments', icon: Calendar, section: 'PATIENTS' },
      { href: '/messages', label: 'Messages', icon: MessageSquare, section: 'MORE' },
    ],
    color: BRAND_PRIMARY,
    gradientFrom: BRAND_SECONDARY,
    gradientTo: BRAND_PRIMARY,
    badgeLabel: 'Med. Biller',
  },

  // ───────── Clinical-flow workflow stations (EHR Clinical Flow doc §4) ─────────
  central_registration_clerk: {
    label: 'Registration Clerk',
    defaultDashboard: ROLE_ROUTE_TABLE.central_registration_clerk.defaultDashboard,
    allowedRoutes: [...ROLE_ROUTE_TABLE.central_registration_clerk.allowed],
    navItems: [
      { href: '/dashboard/front-desk', label: 'Reception', icon: LayoutDashboard, section: 'RECEPTION' },
      { href: '/patients', label: 'Patient Registry', icon: Users, section: 'RECEPTION' },
      { href: '/appointments', label: 'Appointments', icon: Calendar, section: 'RECEPTION' },
      { href: '/referrals', label: 'Referrals', icon: ArrowRightLeft, section: 'RECEPTION' },
      { href: '/payments', label: 'Checkout Payments', icon: Wallet, section: 'CHECKOUT' },
      { href: '/messages', label: 'Messages', icon: MessageSquare, section: 'MORE' },
    ],
    color: BRAND_PRIMARY, gradientFrom: BRAND_SECONDARY, gradientTo: BRAND_PRIMARY, badgeLabel: 'Reg. Clerk',
  },

  clinic_clerk: {
    label: 'Clinic Clerk',
    defaultDashboard: ROLE_ROUTE_TABLE.clinic_clerk.defaultDashboard,
    allowedRoutes: [...ROLE_ROUTE_TABLE.clinic_clerk.allowed],
    navItems: [
      { href: '/dashboard/front-desk', label: 'Reception', icon: LayoutDashboard, section: 'CLINIC' },
      { href: '/patients', label: 'Patients', icon: Users, section: 'CLINIC' },
      { href: '/appointments', label: 'Appointments', icon: Calendar, section: 'CLINIC' },
      { href: '/messages', label: 'Messages', icon: MessageSquare, section: 'MORE' },
    ],
    color: BRAND_PRIMARY, gradientFrom: BRAND_SECONDARY, gradientTo: BRAND_PRIMARY, badgeLabel: 'Clinic Clerk',
  },

  triage_nurse: {
    label: 'Triage Nurse',
    defaultDashboard: ROLE_ROUTE_TABLE.triage_nurse.defaultDashboard,
    allowedRoutes: [...ROLE_ROUTE_TABLE.triage_nurse.allowed],
    navItems: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, section: 'CLINICAL' },
      { href: '/patients', label: 'Patients', icon: Users, section: 'CLINICAL' },
      { href: '/wards', label: 'Wards', icon: BedDouble, section: 'CLINICAL' },
      { href: '/wards/handoff', label: 'Shift Handoff', icon: ArrowRightLeft, section: 'CLINICAL' },
      { href: '/appointments', label: 'Appointments', icon: Calendar, section: 'CLINICAL' },
      { href: '/messages', label: 'Messages', icon: MessageSquare, section: 'CLINICAL' },
      { href: '/immunizations', label: 'Immunizations', icon: Syringe, section: 'CARE PROGRAMS' },
      { href: '/anc', label: 'Antenatal Care', icon: HeartPulse, section: 'CARE PROGRAMS' },
      { href: '/births', label: 'Births', icon: Baby, section: 'VITAL EVENTS' },
      { href: '/deaths', label: 'Deaths', icon: UserX, section: 'VITAL EVENTS' },
      { href: '/lab', label: 'Lab Results', icon: Microscope, section: 'MORE' },
    ],
    color: BRAND_PRIMARY, gradientFrom: BRAND_SECONDARY, gradientTo: BRAND_PRIMARY, badgeLabel: 'Triage RN',
  },

  rooming_nurse: {
    label: 'Rooming Nurse',
    defaultDashboard: ROLE_ROUTE_TABLE.rooming_nurse.defaultDashboard,
    allowedRoutes: [...ROLE_ROUTE_TABLE.rooming_nurse.allowed],
    navItems: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, section: 'CLINICAL' },
      { href: '/patients', label: 'Patients', icon: Users, section: 'CLINIC' },
      { href: '/wards', label: 'Wards', icon: BedDouble, section: 'CLINIC' },
      { href: '/wards/handoff', label: 'Shift Handoff', icon: ArrowRightLeft, section: 'CLINIC' },
      { href: '/appointments', label: 'Appointments', icon: Calendar, section: 'CLINIC' },
      { href: '/immunizations', label: 'Immunizations', icon: Syringe, section: 'CARE' },
      { href: '/anc', label: 'Antenatal Care', icon: HeartPulse, section: 'CARE' },
      { href: '/births', label: 'Births', icon: Baby, section: 'VITAL EVENTS' },
      { href: '/deaths', label: 'Deaths', icon: UserX, section: 'VITAL EVENTS' },
      { href: '/lab', label: 'Lab', icon: Microscope, section: 'MORE' },
      { href: '/messages', label: 'Messages', icon: MessageSquare, section: 'MORE' },
    ],
    color: BRAND_PRIMARY, gradientFrom: BRAND_SECONDARY, gradientTo: BRAND_PRIMARY, badgeLabel: 'Rooming RN',
  },

  clinician: {
    label: 'Doctor',
    defaultDashboard: ROLE_ROUTE_TABLE.clinician.defaultDashboard,
    allowedRoutes: [...ROLE_ROUTE_TABLE.clinician.allowed],
    navItems: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, section: 'CLINICAL' },
      { href: '/patients', label: 'Patients', icon: Users, section: 'CLINICAL' },
      { href: '/consultation', label: 'Consultation', icon: Stethoscope, section: 'CLINICAL' },
      { href: '/referrals', label: 'Referrals', icon: ArrowRightLeft, section: 'CLINICAL' },
      { href: '/wards', label: 'Wards', icon: BedDouble, section: 'CLINICAL' },
      { href: '/appointments', label: 'Appointments', icon: Calendar, section: 'CLINICAL' },
      { href: '/lab', label: 'Laboratory', icon: Microscope, section: 'SERVICES' },
      { href: '/pharmacy', label: 'Pharmacy', icon: Pill, section: 'SERVICES' },
      { href: '/blood-bank', label: 'Blood Bank', icon: Droplets, section: 'SERVICES' },
      { href: '/immunizations', label: 'Immunizations', icon: Syringe, section: 'VITAL EVENTS' },
      { href: '/anc', label: 'Antenatal Care', icon: HeartPulse, section: 'VITAL EVENTS' },
      { href: '/births', label: 'Births', icon: Baby, section: 'VITAL EVENTS' },
      { href: '/deaths', label: 'Deaths', icon: UserX, section: 'VITAL EVENTS' },
      { href: '/messages', label: 'Messages', icon: MessageSquare, section: 'MORE' },
    ],
    color: BRAND_PRIMARY, gradientFrom: BRAND_SECONDARY, gradientTo: BRAND_PRIMARY, badgeLabel: 'Med. Doctor',
  },

  records_hmis_officer: {
    label: 'Records / HMIS Officer',
    defaultDashboard: ROLE_ROUTE_TABLE.records_hmis_officer.defaultDashboard,
    allowedRoutes: [...ROLE_ROUTE_TABLE.records_hmis_officer.allowed],
    navItems: [
      { href: '/dashboard/data-entry', label: 'Records Dashboard', icon: LayoutDashboard, section: 'RECORDS' },
      { href: '/patients', label: 'Patient Registry', icon: Users, section: 'RECORDS' },
      { href: '/data-quality', label: 'Data Quality', icon: Database, section: 'RECORDS' },
      { href: '/reports', label: 'Reports', icon: BarChart3, section: 'RECORDS' },
      { href: '/dhis2-export', label: 'DHIS2 Export', icon: Download, section: 'GOVERNANCE' },
      { href: '/vital-statistics', label: 'Vital Statistics', icon: TrendingUp, section: 'VITAL EVENTS' },
      { href: '/facility-assessments', label: 'Facility Assessments', icon: ClipboardCheck, section: 'GOVERNANCE' },
      { href: '/messages', label: 'Messages', icon: MessageSquare, section: 'MORE' },
    ],
    color: BRAND_PRIMARY, gradientFrom: BRAND_SECONDARY, gradientTo: BRAND_PRIMARY, badgeLabel: 'HMIS Off.',
  },

};

/**
 * Role labels that stay distinguishable inside one picker.
 *
 * Two roles legitimately share a written label — `doctor` and `clinician` are
 * both "Doctor" — which is fine in a badge (they mean the same thing to a
 * patient) and useless in a list of checkboxes, where it rendered as two
 * identical "Doctor" rows with no way to tell which was which. Only the
 * colliding labels get the identifier appended; everything else reads exactly
 * as it did.
 */
export function labelRolesDistinctly(roles: UserRole[]): { role: UserRole; label: string }[] {
  const counts = new Map<string, number>();
  for (const role of roles) {
    const label = getRoleConfig(role).label;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return roles.map(role => {
    const label = getRoleConfig(role).label;
    return {
      role,
      label: (counts.get(label) ?? 0) > 1 ? `${label} (${role.replace(/_/g, ' ')})` : label,
    };
  });
}

export function getRoleConfig(role: UserRole): RoleConfig {
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.doctor;
}

// Both helpers delegate to `role-routes.ts` so the page-route gating logic
// is identical between Edge middleware and server/client callers. The route
// arrays embedded in `ROLE_PERMISSIONS` come from the same table, so this is
// just guaranteeing consistency at the call site too.
export function isRouteAllowed(role: UserRole, pathname: string): boolean {
  return isPathAllowedFromTable(role, pathname);
}

export function getDefaultDashboard(role: UserRole): string {
  return getDefaultDashboardFromTable(role);
}

/**
 * Roles authorized to view and act on the Conflict Reconciliation queue.
 * Kept here (not duplicated in pages) so middleware, UI, and tests share one source.
 */
export const CONFLICT_RESOLUTION_ROLES: UserRole[] = [
  'super_admin',
  'org_admin',
  'medical_superintendent',
  'hrio',
];

const WORKFLOW_ROLES: UserRole[] = ['central_registration_clerk', 'clinic_clerk', 'triage_nurse', 'rooming_nurse', 'clinician', 'records_hmis_officer'];
const PRIVATE_SECTOR_ROLES: UserRole[] = ['org_admin', 'doctor', 'clinical_officer', 'nurse', 'midwife', 'lab_tech', 'pharmacist', 'front_desk', 'cashier', 'data_entry_clerk', 'medical_superintendent', 'hrio', 'nutritionist', 'radiologist', 'hospital_manager', 'medical_biller', ...WORKFLOW_ROLES];
const ALL_ROLES: UserRole[] = ['super_admin', 'org_admin', 'doctor', 'clinical_officer', 'nurse', 'midwife', 'lab_tech', 'pharmacist', 'front_desk', 'cashier', 'government', 'county_health_director', 'data_entry_clerk', 'medical_superintendent', 'hrio', 'nutritionist', 'radiologist', 'hospital_manager', 'medical_biller', ...WORKFLOW_ROLES];

export function getAvailableRoles(orgType: 'public' | 'private', isSuperAdmin = false): UserRole[] {
  if (isSuperAdmin) return ALL_ROLES;
  if (orgType === 'private') return PRIVATE_SECTOR_ROLES;
  return ALL_ROLES;
}

/**
 * The roles an organization administrator may hand out.
 *
 * `orgType` is optional on purpose. It only chooses between the full list and
 * the private-sector subset, so not knowing it should narrow nothing — the
 * caller must still get a usable list. The org-admin user page used to compute
 * this only when `currentUser.organization` was present, which left the Role
 * picker with NO options whenever the organization record had not reached the
 * local replica: an org admin could not create a single user, and the empty
 * dropdown gave no reason.
 *
 * `enabledRoles` is the organization's own roster of roles, set by the platform
 * super-admin (see `OrganizationDoc.enabledRoles`). It NARROWS the list so a
 * clinic that employs four kinds of staff doesn't scroll past twenty-five, and
 * it follows the same "not knowing narrows nothing" rule: absent or empty means
 * the full list for the org type. Anything in it that the org type does not
 * allow is dropped, so the list can only ever be a subset of what was already
 * permitted — it is a convenience, never the gate. The API re-checks every
 * assignment independently.
 *
 * `super_admin` is never assignable here — an organization administrator must
 * not be able to mint a platform-wide account.
 */
export function assignableRolesForOrgAdmin(
  orgType?: 'public' | 'private',
  enabledRoles?: UserRole[],
): UserRole[] {
  const allowed = getAvailableRoles(orgType ?? 'public').filter(r => r !== 'super_admin');
  if (!enabledRoles || enabledRoles.length === 0) return allowed;
  const enabled = new Set(enabledRoles);
  const narrowed = allowed.filter(r => enabled.has(r));
  // An org whose list somehow intersects nothing assignable still has to leave
  // the admin a usable picker rather than the empty dropdown this function was
  // written to prevent.
  return narrowed.length > 0 ? narrowed : allowed;
}
