/**
 * The create actions on an admin dashboard's greeting are role-gated.
 *
 * The header offers "what can this person create?", so the risk is it offering
 * something the role cannot actually do — a Create organization button on an
 * org admin's dashboard is an invitation to a refusal. These assert the gate
 * from the role in, not from the button out.
 */

import { dashboardCreateActions } from '@/components/dashboard/DashboardCreateActions';

const keys = (role: string | undefined) => dashboardCreateActions(role).map(a => a.key);

describe('dashboardCreateActions', () => {
  it('gives the super admin the tenant action nobody else gets', () => {
    expect(keys('super_admin')).toEqual(['organization', 'facility', 'staff']);
  });

  it('withholds organization creation from an org admin', () => {
    // An org admin creating a tenant would be creating the thing that scopes
    // them — facilities and staff inside their own tenant are the limit.
    expect(keys('org_admin')).toEqual(['facility', 'staff']);
    expect(keys('org_admin')).not.toContain('organization');
  });

  it('offers nothing to roles that create neither facilities nor accounts', () => {
    for (const role of ['doctor', 'nurse', 'receptionist', 'lab_technician', 'pharmacist', 'hospital_manager']) {
      expect(keys(role)).toEqual([]);
    }
  });

  it('offers nothing when nobody is signed in', () => {
    expect(keys(undefined)).toEqual([]);
    expect(keys('')).toEqual([]);
  });

  it('points every action at a real management create deep-link', () => {
    for (const action of dashboardCreateActions('super_admin')) {
      // `new=1` is what ManagementWorkspace's deep-link effect opens on; a
      // link without it lands on the list and the operator has to find the
      // create button again.
      expect(action.href).toMatch(/^\/manage\?view=(organizations|facilities|people)&new=1$/);
    }
  });

  it('marks exactly one action primary, per role', () => {
    for (const role of ['super_admin', 'org_admin']) {
      expect(dashboardCreateActions(role).filter(a => a.primary)).toHaveLength(1);
    }
  });
});
