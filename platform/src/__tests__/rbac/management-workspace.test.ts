import fs from 'node:fs';
import path from 'node:path';
import { managementViewsForRole } from '@/modules/tenancy';

const source = (relative: string) => fs.readFileSync(path.join(process.cwd(), 'src', relative), 'utf8');

describe('the consolidated management workspace', () => {
  test('only the platform operator owns the Organizations view', () => {
    expect(managementViewsForRole('super_admin')).toEqual(['organizations', 'facilities', 'people']);
    for (const role of ['org_admin', 'medical_superintendent', 'hospital_manager'] as const) {
      expect(managementViewsForRole(role)).toEqual(['facilities', 'people']);
    }
  });

  test('account requests live beside the staff roster', () => {
    const workspace = source('modules/tenancy/components/ManagementWorkspace.tsx');
    const notifications = source('modules/identity/services/account-request-notify.ts');
    expect(workspace).toContain('<AccountRequestQueue');
    expect(notifications).toContain('/manage?view=people&tab=requests');
    expect(notifications).not.toContain('/admin/users?tab=requests');
    expect(notifications).not.toContain('/org-admin/users?tab=requests');
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
