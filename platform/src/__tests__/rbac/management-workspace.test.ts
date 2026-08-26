import fs from 'node:fs';
import path from 'node:path';
import { managementRootForRole } from '@/modules/tenancy';

const source = (relative: string) => fs.readFileSync(path.join(process.cwd(), 'src', relative), 'utf8');

describe('the consolidated management workspace', () => {
  test('a role starts its drill-down at the highest rung it can actually see', () => {
    // The console is one chain now — organizations → one organization → one
    // facility → one person — not three sibling tabs. A role whose tenant
    // store is filtered to its own `orgId` has no list of one to choose from,
    // so its console IS its organization's page; only the two roles
    // `useOrganizations` hands the whole platform to start at the registry.
    for (const role of ['super_admin', 'government'] as const) {
      expect(managementRootForRole(role)).toBe('organizations');
    }
    for (const role of [
      'org_admin', 'medical_superintendent', 'hospital_manager',
      'county_health_director', 'hrio', 'records_hmis_officer',
    ] as const) {
      expect(managementRootForRole(role)).toBe('organization');
    }
    // A role outside the workspace gets no console at all.
    for (const role of ['doctor', 'nurse', 'front_desk'] as const) {
      expect(managementRootForRole(role)).toBeNull();
    }
  });

  test('the console root is a list of tenants, with no sibling tabs left', () => {
    // The three-tab workspace is what made the hierarchy unreadable: a
    // facility belongs to an organization and a person to a facility, and
    // listing all three side by side meant the way down was a dropdown.
    const workspace = source('modules/tenancy/components/ManagementWorkspace.tsx');
    for (const trace of ['managementViewsForRole', 'changeView', 'mgmt-tabs', "view=people"]) {
      expect(workspace).not.toContain(trace);
    }
    // Account requests were removed in Aug 2026: the public request form, its
    // four API routes, the approver queue and the two emails it sent are all
    // gone, and an account is created exactly one way — an administrator makes
    // it. This asserts the workspace kept no half of that.
    for (const trace of ['AccountRequestQueue', 'peopleMode', "'requests'", 'mgmt-mode-select']) {
      expect(workspace).not.toContain(trace);
    }
  });

  test('each rung lists the rung beneath it', () => {
    // The whole point of the redesign: an organization row opens that
    // organization, whose page lists ITS facilities, each of which opens a
    // facility page whose content is that facility's roster.
    const registry = source('modules/tenancy/components/ManagementWorkspace.tsx');
    const organization = source('modules/tenancy/components/OrganizationDetail.tsx');
    const facility = source('components/facilities/FacilityProfile.tsx');
    expect(registry).toContain('/admin/organizations/');
    expect(organization).toContain('/admin/facilities/');
    expect(facility).toContain('userWorksAtFacility(user, hospital._id)');
    // And the organization page is the FACILITIES list — not a roster with
    // facilities demoted to a filter, which is what it used to be.
    expect(organization).toContain("t('management.facilities')");
  });

  test('Settings does not keep shadow facility or people editors', () => {
    const settings = source('components/settings/RoleSettingsView.tsx');
    const organizationPanel = source('components/settings/OrganizationSettingsPanel.tsx');
    expect(settings).not.toContain("id: 'org-facilities'");
    expect(settings).not.toContain("id: 'org-people'");
    expect(organizationPanel).not.toContain("section === 'facilities'");
    expect(organizationPanel).not.toContain("section === 'people'");
  });
});
