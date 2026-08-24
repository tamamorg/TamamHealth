import { canPerformTenancyAction, TENANCY_ACTIONS_BY_ROLE, userWorksAtFacility } from '@/modules/tenancy';
import type { UserRole } from '@/lib/db-types';

const ALL_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'nurse', 'midwife',
  'lab_tech', 'pharmacist', 'front_desk', 'cashier', 'government',
  'county_health_director', 'data_entry_clerk', 'medical_superintendent', 'hrio',
  'nutritionist', 'radiologist', 'hospital_manager', 'medical_biller',
  'central_registration_clerk', 'clinic_clerk', 'triage_nurse', 'rooming_nurse',
  'clinician', 'records_hmis_officer',
];

describe('management policy', () => {
  it('states tenancy actions explicitly for every role', () => {
    expect(Object.keys(TENANCY_ACTIONS_BY_ROLE).sort()).toEqual([...ALL_ROLES].sort());
  });

  it('keeps tenant administrators inside their organization', () => {
    expect(canPerformTenancyAction('org_admin', 'organization:view')).toBe(true);
    expect(canPerformTenancyAction('org_admin', 'organization:create')).toBe(false);
    expect(canPerformTenancyAction('org_admin', 'person:create')).toBe(true);
  });

  it('gives facility leaders read-only roster oversight', () => {
    expect(canPerformTenancyAction('hospital_manager', 'person:view')).toBe(true);
    expect(canPerformTenancyAction('hospital_manager', 'person:create')).toBe(false);
    expect(canPerformTenancyAction('medical_superintendent', 'access:disable')).toBe(false);
  });

  it('includes home and additional facilities in the same roster rule', () => {
    expect(userWorksAtFacility({ hospitalId: 'home', facilityIds: ['cover'] }, 'home')).toBe(true);
    expect(userWorksAtFacility({ hospitalId: 'home', facilityIds: ['cover'] }, 'cover')).toBe(true);
    expect(userWorksAtFacility({ hospitalId: 'home', facilityIds: ['cover'] }, 'other')).toBe(false);
  });
});

