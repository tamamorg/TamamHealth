import fs from 'node:fs';
import path from 'node:path';

describe('patient PATCH care-team boundary', () => {
  it('checks protected assignment fields against the canonical front-desk policy', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/patients/[id]/route.ts'),
      'utf8',
    );
    expect(source).toContain('PATIENT_CARE_TEAM_FIELDS.some');
    expect(source).toContain('!canAssignCareTeamRole(auth.role)');
    expect(source).toContain('Only front desk staff can change patient care-team assignments');
  });
});
