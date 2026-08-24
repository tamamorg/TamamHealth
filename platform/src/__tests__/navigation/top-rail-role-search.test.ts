import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/components/ehr/EhrTopRail.tsx'),
  'utf8',
);

describe('role-aware top-rail search', () => {
  it('does not load patients for the platform operator', () => {
    expect(source).toContain('usePatients(!isPlatformAdmin)');
    expect(source).toContain('useOrganizations(isPlatformAdmin)');
    expect(source).toContain('useUsers(isPlatformAdmin)');
  });

  it('opens platform results in the pages that own them', () => {
    expect(source).toContain('/admin/organizations/${encodeURIComponent(org._id)}');
    expect(source).toContain('/admin/facilities/${encodeURIComponent(hospital._id)}');
    expect(source).toContain('/admin/users/${encodeURIComponent(user._id)}');
  });

  it('keeps patient search for non-platform roles', () => {
    expect(source).toContain('/patients/${encodeURIComponent(patient._id)}');
    expect(source).toContain("t('topbar.searchPatientPlaceholder')");
  });
});
