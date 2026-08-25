import fs from 'node:fs';
import path from 'node:path';
import { managementViewsForRole } from '@/modules/tenancy';

const source = (relative: string) => fs.readFileSync(path.join(process.cwd(), 'src', relative), 'utf8');

describe('the consolidated management workspace', () => {
  test('keeps edits narrow while oversight roles share the read-only network view', () => {
    // Order is meaningful, not incidental: people lead (2026-08-25) because the
    // console is opened to find a person far more often than to audit the
    // tenant tree. Membership is the entitlement; the first entry is the
    // landing tab, which is why this asserts sequence rather than a set.
    expect(managementViewsForRole('super_admin')).toEqual(['people', 'facilities', 'organizations']);
    for (const role of ['org_admin', 'medical_superintendent', 'hospital_manager'] as const) {
      expect(managementViewsForRole(role)).toEqual(['people', 'facilities']);
    }
    // Oversight roles still get no people view at all — reordering must not
    // hand them one.
    for (const role of ['government', 'county_health_director', 'hrio', 'records_hmis_officer'] as const) {
      expect(managementViewsForRole(role)).toEqual(['facilities', 'organizations']);
      expect(managementViewsForRole(role)).not.toContain('people');
    }
  });

  test('the people view is the staff roster and nothing else', () => {
    // Account requests were removed in Aug 2026: the public request form, its
    // four API routes, the approver queue and the two emails it sent are all
    // gone, and an account is created exactly one way — an administrator makes
    // it. This asserts the workspace kept no half of that: no queue, and no
    // roster/requests mode toggle whose only other option no longer exists.
    const workspace = source('modules/tenancy/components/ManagementWorkspace.tsx');
    for (const trace of ['AccountRequestQueue', 'peopleMode', "'requests'", 'mgmt-mode-select']) {
      expect(workspace).not.toContain(trace);
    }
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
