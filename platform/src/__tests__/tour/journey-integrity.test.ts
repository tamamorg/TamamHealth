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
  return getRoleConfig(role).allowedRoutes.some(
    allowed => route === allowed || route.startsWith(`${allowed}/`),
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

  it('reveals every epidemic-intelligence panel with its matching tab', () => {
    const epidemicSteps = tour?.steps.filter(step => step.route === '/epidemic-intelligence');
    expect(epidemicSteps?.map(step => [step.id, step.preClickSelector, step.target])).toEqual([
      ['epi-curves', '[data-tour="epi-tab-curves"]', '[data-tour="epi-curve-panel"]'],
      ['epi-syndromic', '[data-tour="epi-tab-syndromic"]', '[data-tour="epi-syndromic-panel"]'],
      ['epi-idsr', '[data-tour="epi-tab-idsr"]', '[data-tour="epi-idsr-panel"]'],
      ['epi-geographic', '[data-tour="epi-tab-geographic"]', '[data-tour="epi-geo-panel"]'],
    ]);
  });
});
