import type { UserRole } from '@/lib/db-types';
import { getRoleConfig } from '@/lib/permissions';
import { JOURNEY_TOUR_ROLES, journeyTourForRole } from '@/lib/tour/journey-tours';

const ALL_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'nurse', 'midwife',
  'lab_tech', 'pharmacist', 'front_desk', 'cashier', 'government',
  'county_health_director', 'data_entry_clerk', 'medical_superintendent', 'hrio',
  'nutritionist', 'radiologist', 'hospital_manager', 'medical_biller',
  'central_registration_clerk', 'clinic_clerk', 'triage_nurse', 'rooming_nurse',
  'clinician', 'records_hmis_officer',
];

function routeIsAllowed(route: string, role: UserRole): boolean {
  // A view of a page (`/epidemic-intelligence?tab=curves`) needs the page.
  const path = route.split('?')[0];
  return getRoleConfig(role).allowedRoutes.some(
    allowed => path === allowed || path.startsWith(`${allowed}/`),
  );
}

describe.each(JOURNEY_TOUR_ROLES)('%s guided journey integrity', role => {
  const tour = journeyTourForRole(role);

  it('survives role filtering with unique, accessible steps', () => {
    expect(tour).toBeDefined();
    expect(tour!.steps.length).toBeGreaterThanOrEqual(3);
    expect(new Set(tour!.steps.map(step => step.id)).size).toBe(tour!.steps.length);

    for (const step of tour!.steps) {
      expect(routeIsAllowed(step.route, role)).toBe(true);
    }
  });

  it('only enters dynamic routes through a clickable preceding step', () => {
    for (const [index, step] of tour!.steps.entries()) {
      if (!step.route.includes('[')) continue;
      const previous = tour!.steps[index - 1];
      expect(previous).toBeDefined();
      if (previous.route === step.route) continue;
      expect(previous.preClickSelector).toBe(previous.target);
    }
  });
});

describe('guided journey role coverage', () => {
  it('keeps the role inventory synchronized with UserRole', () => {
    expect(new Set(ALL_ROLES).size).toBe(ALL_ROLES.length);
    expect(ALL_ROLES.sort()).toEqual([...JOURNEY_TOUR_ROLES].sort());
  });
});

describe('Ministry of Health guided journey', () => {
  const tour = journeyTourForRole('government');

  it('starts and finishes on the national dashboard', () => {
    expect(tour?.steps[0].route).toBe('/government');
    expect(tour?.steps.at(-1)?.route).toBe('/government');
  });

  it('opens the epidemic-intelligence view by its address, not a dead tab click', () => {
    // The page's views are a dropdown now (no tab buttons to pre-click), and
    // its view lives in ?tab=, so the step names the view it shows. The tour
    // stops at the main view only (2026-11-05: main panels, not every detail).
    const epidemicSteps = tour?.steps.filter(step => step.route.startsWith('/epidemic-intelligence'));
    expect(epidemicSteps?.map(step => [step.id, step.route, step.target, step.preClickSelector])).toEqual([
      ['epi-curves', '/epidemic-intelligence?tab=curves', '[data-tour="epi-curve-panel"]', undefined],
    ]);
  });
});
