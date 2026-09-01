/**
 * @jest-environment node
 *
 * railCenterLabels — the top rail's two centre lines, one shape for every
 * role: the organization on the main line, the SITE the session is scoped to
 * on the line under it ("REPUBLIC OF SOUTH SUDAN / JUBA TEACHING HOSPITAL"),
 * matching the shape the platform operator always had ("… / COMMAND CENTER").
 * The workspace is the fallback for accounts with no facility, and the role is
 * named by each dashboard's own header instead.
 *
 * Pure function on purpose: the tenant-role header cannot be driven in a
 * browser without a tenant session (role-as sign-in is gated behind the
 * impersonation policy and, since 2026-08, super-admin MFA enrolment), so
 * this suite is where each role's header is pinned.
 */

import { railCenterLabels, resolveRailFacilityName } from '@/components/ehr/ehr-navigation';

describe('railCenterLabels', () => {
  it('gives the platform operator their name over Command Center', () => {
    expect(railCenterLabels({ role: 'super_admin', name: 'TamamHealth Platform Admin' }))
      .toEqual({ centerLabel: 'TamamHealth Platform Admin', centerSubLabel: 'Command Center' });
    // The seed name is the fallback until the operator renames themselves.
    expect(railCenterLabels({ role: 'super_admin' }).centerLabel).toBe('TamamHealth Platform Admin');
  });

  it('gives a facility role the organization over their site', () => {
    expect(railCenterLabels({
      role: 'front_desk',
      orgName: 'Mercy Hospital Group',
      facilityName: 'Juba Teaching Hospital',
      roleLabel: 'Medical Receptionist',
    })).toEqual({ centerLabel: 'Mercy Hospital Group', centerSubLabel: 'Juba Teaching Hospital' });

    // No posting yet: the workspace holds the line rather than leaving it blank.
    expect(railCenterLabels({
      role: 'lab_tech',
      orgName: 'Mercy Hospital Group',
      roleLabel: 'Lab Technician',
    })).toEqual({ centerLabel: 'Mercy Hospital Group', centerSubLabel: 'Lab Technician' });
  });

  it('names the facility console for an org_admin or manager with no site', () => {
    // Their dashboard prints no title of its own, so with no facility to name
    // the line is the console they are standing in, not the role label the org
    // name already implies.
    for (const role of ['org_admin', 'hospital_manager'] as const) {
      expect(railCenterLabels({ role, orgName: 'Mercy Hospital Group', roleLabel: 'ignored' }))
        .toEqual({ centerLabel: 'Mercy Hospital Group', centerSubLabel: 'Facility Management' });
      // Posted to a site, that site wins — the console is what they are in,
      // the facility is where they are.
      expect(railCenterLabels({
        role, orgName: 'Mercy Hospital Group', facilityName: 'Mercy General Hospital', roleLabel: 'ignored',
      })).toEqual({ centerLabel: 'Mercy Hospital Group', centerSubLabel: 'Mercy General Hospital' });
    }
  });

  it('falls back for a session with no organization name', () => {
    // Facility next, then the workspace alone — never a blank centre, and
    // never the same text twice: with the facility promoted to the main line
    // it must not also be the sub-line, so the workspace takes it.
    expect(railCenterLabels({ role: 'nurse', facilityName: 'Juba Teaching Hospital', roleLabel: 'Nurse' }))
      .toEqual({ centerLabel: 'Juba Teaching Hospital', centerSubLabel: 'Nurse' });
    expect(railCenterLabels({ role: 'nurse', roleLabel: 'Nurse' }))
      .toEqual({ centerLabel: 'Nurse', centerSubLabel: undefined });
  });

  it('keeps the Ministry line for national oversight', () => {
    expect(railCenterLabels({ role: 'government', roleLabel: 'Ministry of Health' }))
      .toEqual({ centerLabel: 'Ministry of Health', centerSubLabel: undefined });
    // A government account attached to an org document keeps the org as the
    // main line. It answers to no single site, so the workspace holds the line
    // under it, like everyone else without a posting.
    expect(railCenterLabels({ role: 'government', orgName: 'Republic of South Sudan', roleLabel: 'Ministry of Health' }))
      .toEqual({ centerLabel: 'Republic of South Sudan', centerSubLabel: 'Ministry of Health' });
  });

  it('renders nothing while the session is still hydrating', () => {
    expect(railCenterLabels({})).toEqual({});
  });
});

describe('resolveRailFacilityName', () => {
  it('uses the session claim on first paint and a live facility rename as soon as it arrives', () => {
    expect(resolveRailFacilityName({ sessionName: 'Old Facility' })).toBe('Old Facility');
    expect(resolveRailFacilityName({
      liveName: 'Renamed Facility',
      hydratedName: 'Old Facility',
      sessionName: 'Older Facility',
    })).toBe('Renamed Facility');
  });
});
