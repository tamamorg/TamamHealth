import fs from 'node:fs';
import path from 'node:path';

const root = path.join(process.cwd(), 'src');
const source = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('facility assignment contract', () => {
  it('never offers offline fallback facilities to the account editor', () => {
    const hook = source('modules/tenancy/hooks/useAssignableFacilities.ts');
    expect(hook).toContain('/api/hospitals/assignment-options');
    expect(hook).not.toContain('getAllHospitals');
    expect(hook).not.toContain('hospitalsDB');
  });

  it('does not expose the legacy sync-wait error', () => {
    const route = source('app/api/users/route.ts');
    expect(route).toContain('FACILITY_NOT_ASSIGNABLE');
    expect(route).not.toContain('has not reached the server yet');
    expect(route).not.toContain('let sync finish');
  });

  it('cannot offer the local-only Mercy demo facility unless it exists centrally', () => {
    const route = source('app/api/hospitals/assignment-options/route.ts');
    expect(route).toContain('getAllHospitals');
    expect(route).toContain('isFacilityActive');
    expect(route).not.toContain('hosp-mercy-001');
  });
});
