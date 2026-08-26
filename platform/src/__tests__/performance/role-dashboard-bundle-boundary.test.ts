import fs from 'node:fs';
import path from 'node:path';

const source = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), 'src', relativePath), 'utf8');

describe('role dashboard bundle boundary', () => {
  it('loads mutually exclusive role workspaces through dynamic imports', () => {
    const route = source('app/(dashboard)/dashboard/page.tsx');

    for (const workspace of [
      'DoctorDashboardPage',
      'NurseHomeView',
      'SuperintendentDashboard',
    ]) {
      expect(route).toContain(`dynamic(() => import('@/components/dashboards/${workspace}'))`);
      expect(route).not.toContain(`import ${workspace} from '@/components/dashboards/${workspace}'`);
    }
  });

  it('keeps the clinician workspace free of other role workspaces', () => {
    const clinician = source('components/dashboards/DoctorDashboardPage.tsx');
    expect(clinician).not.toContain("from './NurseHomeView'");
    expect(clinician).not.toContain("from './SuperintendentDashboard'");
  });
});
