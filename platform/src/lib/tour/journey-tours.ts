import type { UserRole } from '@/lib/db-types';
import { getRoleConfig } from '@/lib/permissions';
import { clinicalOfficerTourSteps } from './clinical-officer-steps';
import type { TourDefinition, TourStep } from './types';

/**
 * Journey-based "Take a tour" definitions — one per workspace, derived from
 * docs/USER-JOURNEYS.md so the tour walks each user through THEIR documented
 * day, step by step (not just the shared shell).
 *
 * Authoring rules:
 * - Page-level stops use an empty `target` → the engine renders a centred
 *   narrative card over that page (robust; no per-page selector to break).
 * - Anchored stops only use the shell selectors that exist for every role
 *   (.ehr-top-search / .ehr-top-modules / .ehr-top-actions).
 * - Steps are FILTERED against the role's route allow-list before use, so a
 *   tour can never navigate a user onto an "Access Restricted" screen — e.g.
 *   a triage nurse simply skips the ANC/immunizations stops of the nurse
 *   journey.
 */
import { NURSE_STEPS } from './journeys/nurse';
import { LAB_STEPS } from './journeys/lab';
import { PHARMACY_STEPS } from './journeys/pharmacy';
import { RADIOLOGY_STEPS } from './journeys/radiology';
import { NUTRITION_STEPS } from './journeys/nutrition';
import { FRONT_DESK_STEPS } from './journeys/front-desk';
import { CASHIER_STEPS } from './journeys/cashier';
import { BILLER_STEPS } from './journeys/biller';
import { RECORDS_STEPS } from './journeys/records';
import { MANAGER_STEPS } from './journeys/manager';
import { ORG_ADMIN_STEPS } from './journeys/org-admin';
import { COUNTY_STEPS } from './journeys/county';
import { GOVERNMENT_STEPS } from './journeys/government';
import { SUPER_ADMIN_STEPS } from './journeys/super-admin';
import { SUPERINTENDENT_STEPS } from './journeys/superintendent';

const JOURNEY_STEPS: Partial<Record<UserRole, TourStep[]>> = {
  // Clinical
  clinical_officer: clinicalOfficerTourSteps,
  doctor: clinicalOfficerTourSteps,
  clinician: clinicalOfficerTourSteps,
  medical_superintendent: SUPERINTENDENT_STEPS,
  // Nursing
  nurse: NURSE_STEPS,
  midwife: NURSE_STEPS,
  triage_nurse: NURSE_STEPS,
  rooming_nurse: NURSE_STEPS,
  // Diagnostics & pharmacy
  lab_tech: LAB_STEPS,
  pharmacist: PHARMACY_STEPS,
  radiologist: RADIOLOGY_STEPS,
  nutritionist: NUTRITION_STEPS,
  // Front of house
  front_desk: FRONT_DESK_STEPS,
  central_registration_clerk: FRONT_DESK_STEPS,
  clinic_clerk: FRONT_DESK_STEPS,
  // Money
  cashier: CASHIER_STEPS,
  medical_biller: BILLER_STEPS,
  // Records
  hrio: RECORDS_STEPS,
  records_hmis_officer: RECORDS_STEPS,
  data_entry_clerk: RECORDS_STEPS,
  // Management & admin
  hospital_manager: MANAGER_STEPS,
  org_admin: ORG_ADMIN_STEPS,
  county_health_director: COUNTY_STEPS,
  government: GOVERNMENT_STEPS,
  super_admin: SUPER_ADMIN_STEPS,
};

/**
 * The stops each tour actually makes: the main panels of the role's home,
 * the top bar, and one stop on each main page the role works in.
 *
 * 2026-11-05, the user: "the tour should not go through all the details it
 * should just point to the main features and panels". The journey files
 * still describe the whole day; this list is what the tour shows of it. No
 * stop opens a record, a row, a form or a dialog; getting from page to page
 * is shown by the engine itself (the ☰ menu or the shortcut it clicks).
 */
// The chart is shown as the user asked (2026-11-05, "like in the patient
// chart just show the panels and the sliders and the navigations for the main
// actions"): its header and actions, vitals band, summary, the section rail
// and the workspace panels (sliders), and nothing inside a tab.
const CHART_CORE = ['patients-open-chart', 'chart-header', 'chart-vitals-band', 'chart-summary', 'chart-rail', 'chart-workspace', 'chart-slider'];
const CLINICIAN_CORE = ['welcome', 'dash-schedule', 'dash-calendar', 'dash-outstanding', 'top-search', 'top-modules', 'patients-registry', ...CHART_CORE, 'alerts-feed', 'finish'];
const NURSE_CORE = ['welcome', 'worklist', 'dash-outstanding', 'ward-board', 'handoff', 'anc', 'immunizations', 'search', 'messaging', 'finish'];
const FRONT_DESK_CORE = ['welcome', 'queue', 'lanes', 'register', 'views', 'referrals', 'search', 'messaging', 'finish'];
const RECORDS_CORE = ['welcome', 'census-queue', 'module-shortcuts', 'births-list', 'deaths-list', 'vitals-stats', 'quality-national', 'dhis2-status', 'reports', 'messaging', 'finish'];
const CORE_STEP_IDS: Partial<Record<UserRole, readonly string[]>> = {
  clinical_officer: CLINICIAN_CORE,
  doctor: CLINICIAN_CORE,
  clinician: CLINICIAN_CORE,
  medical_superintendent: ['supt-welcome', 'supt-signal', 'top-search', 'top-modules', 'patients-registry', ...CHART_CORE, 'data-quality-oversight', 'hr-dashboard-oversight', 'facility-overview-oversight', 'payments-oversight', 'messaging', 'finish'],
  nurse: NURSE_CORE,
  midwife: NURSE_CORE,
  triage_nurse: NURSE_CORE,
  rooming_nurse: NURSE_CORE,
  lab_tech: ['welcome', 'specimen-intake', 'critical', 'registry-worklists', 'blood-bank', 'search', 'messaging', 'finish'],
  pharmacist: ['welcome', 'queue', 'stock-alerts', 'analytics', 'inventory', 'controlled', 'search', 'messaging', 'finish'],
  radiologist: ['welcome', 'worklist', 'outstanding', 'search', 'messaging', 'finish'],
  nutritionist: ['welcome', 'worklist', 'outstanding', 'supplies', 'mch-analytics', 'search', 'messaging', 'finish'],
  front_desk: FRONT_DESK_CORE,
  central_registration_clerk: FRONT_DESK_CORE,
  clinic_clerk: FRONT_DESK_CORE,
  cashier: ['welcome', 'collect', 'pending', 'bill-list', 'portal', 'search', 'messaging', 'finish'],
  medical_biller: ['welcome', 'pending', 'bill-list', 'submit', 'refunds', 'search', 'messaging', 'finish'],
  hrio: RECORDS_CORE,
  records_hmis_officer: RECORDS_CORE,
  data_entry_clerk: RECORDS_CORE,
  hospital_manager: ['welcome', 'facility-overview', 'my-facility', 'hr-leave', 'payments', 'reports', 'patients', 'wards', 'messaging', 'finish'],
  org_admin: ['welcome', 'today-ops', 'org-overview', 'users-create', 'hospitals', 'pricing', 'branding', 'analytics', 'org-settings', 'messaging', 'finish'],
  county_health_director: ['welcome', 'counties', 'surveillance', 'epidemic-intelligence', 'assessments', 'data-quality', 'dhis2', 'public-stats', 'messaging', 'finish'],
  government: ['welcome', 'alerts', 'epi-curves', 'facility-assessments', 'equity', 'programs', 'briefing', 'public-stats', 'dhis2', 'finish'],
  super_admin: ['welcome', 'command-deck', 'orgs', 'users', 'config', 'sync', 'security', 'audit', 'system', 'announcements', 'analytics', 'finish'],
};

/**
 * A row click that bridged into a record the tour no longer visits is
 * dropped with it: the step keeps its pointer and loses the click. The one
 * bridge kept is the patient row into the chart, since the chart is a stop.
 */
function withoutDeadBridges(steps: TourStep[]): TourStep[] {
  return steps.map((step, i) => {
    const bridge = step.preClickSelector && step.preClickSelector === step.target;
    const next = steps[i + 1];
    if (!bridge || (next && next.route.includes('['))) return step;
    const { preClickSelector: _drop, ...rest } = step;
    void _drop;
    return rest;
  });
}

function isRouteAllowed(route: string, allowedRoutes: readonly string[]): boolean {
  // A view of a page (`/epidemic-intelligence?tab=curves`) is allowed when the page is.
  const path = route.split('?')[0];
  return allowedRoutes.some(r => path === r || path.startsWith(r + '/'));
}

/**
 * Roles that have a bespoke journey tour.
 *
 * Exported so a test can assert every one of them actually SURVIVES route
 * filtering. A role can be listed here and still fall through to the generic
 * shell tour if `journeyTourForRole` filters it below the minimum — a silent
 * regression that is invisible from reading the table above.
 */
export const JOURNEY_TOUR_ROLES = Object.keys(JOURNEY_STEPS) as UserRole[];

/**
 * The journey tour for a role, with any steps whose route falls outside the
 * role's allow-list removed (so the tour never strands a user on an
 * "Access Restricted" screen). Returns undefined when the role has no
 * journey or filtering leaves too little to be worth touring — callers fall
 * back to the generic shell tour.
 */
export function journeyTourForRole(role: UserRole): TourDefinition | undefined {
  const steps = JOURNEY_STEPS[role];
  if (!steps) return undefined;
  const allowed = getRoleConfig(role)?.allowedRoutes || [];
  const core = CORE_STEP_IDS[role];
  const filtered = withoutDeadBridges(steps
    .filter(s => !core || core.includes(s.id))
    .filter(s => isRouteAllowed(s.route, allowed)));
  if (filtered.length < 3) return undefined;
  return { key: `journey-${role}`, steps: filtered };
}
