// Role-specific onboarding plan generator.
//
// "Learn from the platform, teach all the steps": instead of hand-maintaining a
// checklist per role, we DERIVE the plan from the platform's own source of
// truth — `ROLE_PERMISSIONS[role].navItems`. Every feature a role can reach
// becomes a teaching step, grouped under the platform's own nav-section
// taxonomy (CLINICAL, SERVICES, VITAL EVENTS, …). When a role gains or loses a
// nav item, its onboarding updates automatically with no extra work here.
//
// The only curated layer is `ROUTE_GUIDE`: short, human descriptions keyed by
// route so each step reads like guidance ("Register a patient and open their
// record") rather than a bare link. Anything without an entry falls back to a
// sensible template, so the generator never breaks for a new route.

import type { UserRole } from '../db-types';
import { ROLE_PERMISSIONS, type NavItem } from '../permissions';

export interface OnboardingStep {
  /** Stable ID persisted in the user's progress. Derived from the route. */
  id: string;
  title: string;
  description: string;
  /** Deep link to the feature this step teaches. Omitted for read-only steps. */
  href?: string;
  estMinutes: number;
}

export interface OnboardingSection {
  id: string;
  title: string;
  subtitle: string;
  steps: OnboardingStep[];
}

export interface OnboardingPlan {
  /** Friendly role label, e.g. "Nurse". */
  roleLabel: string;
  /** The route the role lands on — their home dashboard. */
  defaultDashboard: string;
  sections: OnboardingSection[];
}

/** Curated per-route teaching copy. `verb` becomes the step title. */
export const ROUTE_GUIDE: Record<string, { verb: string; desc: string; est?: number }> = {
  '/patients': { verb: 'Register your first patient', desc: 'Add a patient and open their record to see their history, vitals, and visits.', est: 2 },
  '/consultation': { verb: 'Document a consultation', desc: 'Write a SOAP note, record a diagnosis, and order labs or prescriptions.', est: 3 },
  // Shared by clinicians and nurse-family roles alike — for nurses this is
  // also where the "ward" and "MAR" checklist items point, since the
  // standalone nurse station retired and the bedside medication record is
  // reached per admission from here (via the dashboard's Medications due card).
  '/wards': { verb: 'Manage the ward board', desc: 'Admit, transfer, and discharge patients, track bed availability, and open a patient’s bedside medication record (MAR).', est: 2 },
  '/referrals': { verb: 'Create a referral', desc: 'Refer a patient to another facility and track the referral chain.', est: 2 },
  '/messages': { verb: 'Send a secure message', desc: 'Message colleagues about a patient without leaving the platform.', est: 1 },
  '/appointments': { verb: 'Book an appointment', desc: 'Schedule a visit and see the day’s calendar at a glance.', est: 2 },
  '/lab': { verb: 'Work with the lab', desc: 'Place lab orders, then enter and review results.', est: 2 },
  '/pharmacy': { verb: 'Dispense from the pharmacy', desc: 'Fill prescriptions and keep stock levels up to date.', est: 2 },
  '/immunizations': { verb: 'Record an immunization', desc: 'Log a vaccine dose against the schedule and flag what’s due.', est: 2 },
  '/anc': { verb: 'Open antenatal care', desc: 'Register an ANC visit and track the pregnancy through to delivery.', est: 2 },
  '/births': { verb: 'Register a birth', desc: 'Capture a delivery and the newborn’s vital details.', est: 2 },
  '/deaths': { verb: 'Record a death', desc: 'Document a death notification for vital statistics reporting.', est: 2 },
  '/surveillance': { verb: 'Report disease surveillance', desc: 'File a case or outbreak alert and watch community disease trends.', est: 2 },
  '/my-facility': { verb: 'Review your facility profile', desc: 'Confirm your facility’s details, beds, services, and staff.', est: 2 },
  '/reports': { verb: 'Run a report', desc: 'Generate the routine reports your role is responsible for.', est: 2 },
  '/manage': { verb: 'Set up facilities and people', desc: 'Manage the organization structure, register facilities, and create staff accounts from one workspace.', est: 3 },
  // Read-only for most roles; for super_admin and org_admin this page also
  // hosts the create-a-facility dialog, and registering the first facility is
  // the step every staff account depends on (`roleNeedsFacility`).
  '/admin/organizations': { verb: 'Set up organizations and facilities', desc: 'Create and configure the organizations on the platform and review their subscriptions, then browse the facilities they run — status, capacity, performance — and register new ones. Open a facility for its staff, wards, equipment, inventory, schedules and settings.', est: 4 },
  '/vital-statistics': { verb: 'Review vital statistics', desc: 'See births, deaths, and population-health indicators.', est: 2 },
  '/epidemic-intelligence': { verb: 'Open epidemic intelligence', desc: 'Monitor outbreak signals and early-warning indicators.', est: 2 },
  '/mch-analytics': { verb: 'Open MCH analytics', desc: 'Track maternal and child health programme performance.', est: 2 },
  '/facility-assessments': { verb: 'Run a facility assessment', desc: 'Complete a readiness or quality checklist for a facility.', est: 2 },
  '/data-quality': { verb: 'Check data quality', desc: 'Find and resolve missing, late, or inconsistent records.', est: 2 },
  '/dhis2-export': { verb: 'Export to DHIS2', desc: 'Package aggregate data for national HMIS / DHIS2 reporting.', est: 2 },
  '/public-stats': { verb: 'View public statistics', desc: 'See the figures published for the public dashboard.', est: 1 },
  '/equipment': { verb: 'Track assets & equipment', desc: 'Register equipment and monitor maintenance and availability.', est: 2 },
  '/hr': { verb: 'Manage HR & leave', desc: 'Review staff records and approve leave requests.', est: 2 },
  // Bills and claims are one workspace on one route, so they are one step:
  // /payments/claims opens the same screen on its Claims tab and no role's nav
  // lists it, which left a step here that no derived plan could ever show.
  '/payments': { verb: 'Take a payment, then a claim', desc: 'Record a payment, issue a receipt, and view outstanding bills — then switch to Claims to create one and track it through to adjudication.', est: 3 },
  // Admin / org-admin
  // /admin/billing merged into /admin/organizations 2026-08-23, so the one
  // step covers tenants AND their subscriptions.
  '/admin/users': { verb: 'Manage all users', desc: 'Create accounts and assign roles across the platform.', est: 2 },
  '/admin/analytics': { verb: 'Explore platform analytics', desc: 'Track adoption and usage across all organizations.', est: 2 },
  '/admin/system': { verb: 'Check system health', desc: 'Review the local data stores and the running build.', est: 2 },
  '/org-admin/users': { verb: 'Invite your team', desc: 'Create accounts for your staff and assign their roles.', est: 2 },
  '/org-admin/hospitals': { verb: 'Add your facilities', desc: 'Register the facilities your organization operates.', est: 2 },
  '/org-admin/branding': { verb: 'Brand your workspace', desc: 'Add your logo and colours so the app feels like yours.', est: 2 },
  '/org-admin/settings': { verb: 'Configure org settings', desc: 'Set defaults, security, and preferences for your org.', est: 2 },
  '/org-admin/pricing': { verb: 'Set your service pricing', desc: 'Add and edit the fee schedule for consultations, labs, pharmacy, and procedures.', est: 2 },
  '/alerts': { verb: 'Review clinical alerts', desc: 'See critical lab, immunization, and outbreak alerts in one feed and jump straight to the record.', est: 2 },
  // Pharmacy / lab
  '/blood-bank': { verb: 'Manage the blood bank', desc: 'Track blood units by group and status, and log newly donated units before they expire.', est: 2 },
  '/controlled-substances': { verb: 'Log a controlled substance', desc: 'Record intake, dispensing, or waste of scheduled medications with witness sign-off.', est: 2 },
  // Facility / emergency
  '/emergency-preparedness': { verb: 'Manage emergency plans', desc: 'Create and activate response plans for outbreaks, disasters, and mass-casualty events.', est: 2 },
  // Nurse-family tools. The standalone nurse station is retired — nurses now
  // share the clinical workspace at /dashboard (the "ward" and "MAR"
  // checklist items now fold into the shared '/wards' entry above; "triage"
  // folds into the home-dashboard step every role already gets), so the only
  // route left needing its own curated card is the shift handoff page.
  '/wards/handoff': { verb: 'Hand off your shift', desc: 'Write SBAR notes on critical patients and sign a handoff report for the next nurse.', est: 2 },
};

/** Routes that the basics section already covers, so we don't repeat them. */
const SKIP_IN_SECTIONS = new Set(['/settings', '/messages']);

function titleCaseSection(section: string): string {
  return section
    .toLowerCase()
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function stepFromNav(item: NavItem): OnboardingStep {
  const guide = ROUTE_GUIDE[item.href];
  return {
    id: `route:${item.href}`,
    title: guide?.verb ?? `Open ${item.label}`,
    description: guide?.desc ?? `Get familiar with ${item.label} and what you can do there.`,
    href: item.href,
    estMinutes: guide?.est ?? 2,
  };
}

/**
 * Build the onboarding plan for a role. Pure + deterministic so it can run on
 * the server or client and be memoised by callers.
 */
export function getOnboardingPlan(role: UserRole): OnboardingPlan {
  const config = ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.doctor;
  const nav = config.navItems;
  const defaultDashboard = config.defaultDashboard;

  const homeItem = nav.find(n => n.href === defaultDashboard);
  const homeLabel = homeItem?.label ?? 'Dashboard';

  // ── Section 1: the essentials everyone does first ──────────────────────────
  const basics: OnboardingStep[] = [
    {
      id: 'tour',
      title: `See how TamamHealth works`,
      description: `A 2-minute orientation to the ${config.label} workspace and where everything lives.`,
      estMinutes: 2,
    },
    {
      id: `route:${defaultDashboard}`,
      title: `Explore your ${homeLabel}`,
      description: `This is your home base — the numbers, alerts, and shortcuts you’ll use every day.`,
      href: defaultDashboard,
      estMinutes: 1,
    },
  ];
  // The patient information screen — the full chart/record — is reached by
  // opening a patient, so it's not a sidebar nav item and wouldn't otherwise
  // get a tour card. Teach it explicitly for every role that can open patients.
  if (config.allowedRoutes.includes('/patients')) {
    basics.push({
      id: 'patient-record',
      title: 'Open a patient information screen',
      description: 'Open a patient to see their full record — history, problems, medications, vitals, labs, and past visits.',
      href: '/patients',
      estMinutes: 1,
    });
  }
  if (config.allowedRoutes.includes('/settings')) {
    basics.push({
      id: 'route:/settings',
      title: 'Secure your account',
      description: 'Set a screen-lock PIN and review your preferences in Settings.',
      href: '/settings',
      estMinutes: 1,
    });
  }
  const messagesItem = nav.find(n => n.href === '/messages');
  if (messagesItem) {
    basics.push(stepFromNav(messagesItem));
  }

  const sections: OnboardingSection[] = [
    {
      id: 'basics',
      title: 'Start with the basics',
      subtitle: 'Check off the core essentials first',
      steps: basics,
    },
  ];

  // ── Remaining sections: one per nav-section, in nav order ───────────────────
  const usedHrefs = new Set<string>([defaultDashboard, ...SKIP_IN_SECTIONS]);
  const order: string[] = [];
  const grouped = new Map<string, OnboardingStep[]>();

  for (const item of nav) {
    if (usedHrefs.has(item.href)) continue;
    usedHrefs.add(item.href);
    const sectionKey = item.section ?? 'MORE';
    if (!grouped.has(sectionKey)) {
      grouped.set(sectionKey, []);
      order.push(sectionKey);
    }
    grouped.get(sectionKey)!.push(stepFromNav(item));
  }

  for (const key of order) {
    const steps = grouped.get(key)!;
    if (steps.length === 0) continue;
    sections.push({
      id: `nav:${key}`,
      title: titleCaseSection(key),
      subtitle: `Learn the ${titleCaseSection(key).toLowerCase()} tools you’ll use`,
      steps,
    });
  }

  // ── Accessible tools with no sidebar nav item ───────────────────────────────
  // Some routes a role can reach aren't in the sidebar, so
  // the nav-derived sections miss them. Sweep the role's allowed routes and add
  // a card for any that has curated guidance but wasn't already covered, so the
  // tour truly reaches every place the role can go.
  const extraSteps: OnboardingStep[] = [];
  for (const route of config.allowedRoutes) {
    if (usedHrefs.has(route)) continue;
    if (!ROUTE_GUIDE[route]) continue;
    usedHrefs.add(route);
    extraSteps.push(stepFromNav({ href: route, label: route } as NavItem));
  }
  if (extraSteps.length > 0) {
    sections.push({
      id: 'nav:MORE-TOOLS',
      title: 'More tools',
      subtitle: 'Extra tools you can reach',
      steps: extraSteps,
    });
  }

  return {
    roleLabel: config.label,
    defaultDashboard,
    sections,
  };
}

/** Flatten all step IDs in a plan — handy for totals/percent. */
export function allStepIds(plan: OnboardingPlan): string[] {
  return plan.sections.flatMap(s => s.steps.map(st => st.id));
}
