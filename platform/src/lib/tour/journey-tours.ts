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

function isRouteAllowed(route: string, allowedRoutes: readonly string[]): boolean {
  return allowedRoutes.some(r => route === r || route.startsWith(r + '/'));
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
  const filtered = steps.filter(s => isRouteAllowed(s.route, allowed));
  if (filtered.length < 3) return undefined;
  return { key: `journey-${role}`, steps: filtered };
}
