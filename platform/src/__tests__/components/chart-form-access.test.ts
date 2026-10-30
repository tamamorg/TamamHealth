/**
 * Every role, every chart workspace form: who may open it.
 *
 * Triage, ANC visit and ward admission used to leave the chart for their
 * module's page, where the route table and the page's own buttons decided.
 * Opened in the chart, `roleFormAllowed` decides alone — so this pins, for all
 * roles, that it grants exactly what those pages granted and nothing more:
 * nobody gets a form they could not have reached, and nobody who could
 * record the record loses it.
 */
import { ROLE_ROUTE_TABLE, isPathAllowed } from '@/lib/role-routes';
import { ANC_RECORD_ROLES, ROLE_FORM_RULES, roleFormAllowed } from '@/components/ehr/chart/panels/role-form-access';
import { appointmentCalendarClinicalAction } from '@/lib/appointment-calendar-role';
import { roleCan, WARD_ADMIT_ROLES } from '@/lib/clinical-flow/ward-permissions';
import type { UserRole } from '@/lib/db-types';

const ROLES = Object.keys(ROLE_ROUTE_TABLE) as UserRole[];
// usePermissions().canViewClinical, by role.
const CLINICAL_VIEWERS = new Set<UserRole>([
  'doctor', 'clinical_officer', 'nurse', 'midwife', 'clinician', 'triage_nurse', 'rooming_nurse',
  'medical_superintendent', 'super_admin',
]);
const allowed = (id: string, role: UserRole) => roleFormAllowed(id, role, CLINICAL_VIEWERS.has(role));

describe.each(ROLES)('%s', role => {
  it('opens triage only with the triage route', () => {
    expect(allowed('triage-form', role)).toBe(isPathAllowed(role, '/triage'));
  });

  it('records an ANC visit only with the register and the right to write to it', () => {
    expect(allowed('anc-visit', role)).toBe(isPathAllowed(role, '/anc') && roleCan(role, ANC_RECORD_ROLES));
  });

  it('admits only with the wards route and an admitting role', () => {
    expect(allowed('ward-admission', role)).toBe(isPathAllowed(role, '/wards') && roleCan(role, WARD_ADMIT_ROLES));
  });

  it('can triage wherever its calendar or worklists offer Triage', () => {
    // The calendar's Start triage, the rooming queue's Triage and the
    // worklist's Start triage all open the triage form in a slider now.
    if (appointmentCalendarClinicalAction(role) === 'triage') expect(isPathAllowed(role, '/triage')).toBe(true);
    if (isPathAllowed(role, '/rooming')) expect(isPathAllowed(role, '/triage')).toBe(true);
  });
});

describe('chart form access, by name', () => {
  it('gives the bedside roles all three forms', () => {
    for (const role of ['doctor', 'clinical_officer', 'clinician', 'nurse', 'midwife', 'triage_nurse', 'rooming_nurse'] as UserRole[]) {
      expect(['triage-form', 'anc-visit', 'ward-admission'].filter(id => allowed(id, role))).toEqual(['triage-form', 'anc-visit', 'ward-admission']);
    }
  });

  it('keeps programme viewers on read: government and the county director record no ANC visit', () => {
    expect(allowed('anc-visit', 'government')).toBe(false);
    expect(allowed('anc-visit', 'county_health_director')).toBe(false);
  });

  it('lets the vital-events registrars record ANC visits, and nothing clinical besides', () => {
    for (const role of ['records_hmis_officer', 'hrio', 'data_entry_clerk'] as UserRole[]) {
      expect(allowed('anc-visit', role)).toBe(true);
      expect(allowed('triage-form', role)).toBe(false);
      expect(allowed('ward-admission', role)).toBe(false);
    }
  });

  it('keeps bed managers off admission and desk, billing and station roles off all three', () => {
    for (const role of ['org_admin', 'hospital_manager'] as UserRole[]) expect(allowed('ward-admission', role)).toBe(false);
    for (const role of ['front_desk', 'cashier', 'medical_biller', 'central_registration_clerk', 'clinic_clerk', 'lab_tech', 'pharmacist', 'nutritionist', 'radiologist'] as UserRole[]) {
      expect(['triage-form', 'anc-visit', 'ward-admission'].filter(id => allowed(id, role))).toEqual([]);
    }
  });

  it('refuses a form it does not know', () => {
    expect(ROLE_FORM_RULES['no-such-form']).toBeUndefined();
    expect(roleFormAllowed('no-such-form', 'super_admin', true)).toBe(false);
  });
});
