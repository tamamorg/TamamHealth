/**
 * The seeded date-only fields, the dashboards' "today" and the desk's
 * check-in guard share one clock: the facility's day (jubaDate). A device west
 * of Juba in the evening has a different local day, which made "today's"
 * seeded booking read as "not today" in the check-in slider.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { jubaDate } from '@/lib/time-juba';

describe('facility day vs device-local day', () => {
  it('20:30 US Eastern on Nov 7 is already Nov 8 in Juba', () => {
    const instant = new Date('2026-11-08T01:30:00Z'); // 20:30 EST on Nov 7
    expect(jubaDate(instant)).toBe('2026-11-08');
  });

  it('Juba midnight rolls at 22:00 UTC', () => {
    expect(jubaDate(new Date('2026-11-07T21:59:00Z'))).toBe('2026-11-07');
    expect(jubaDate(new Date('2026-11-07T22:00:00Z'))).toBe('2026-11-08');
  });

  it.each([
    'src/lib/db-seed.ts',
    'src/components/ehr/EhrCareDashboard.tsx',
    'src/components/ehr/clinical-dashboard/EhrClinicalDashboard.tsx',
  ])('%s derives "today" from the facility clock, not the device', (file) => {
    const src = readFileSync(join(__dirname, '..', '..', file), 'utf8');
    expect(src).toContain("from '@/lib/time-juba'".replace('@/lib/', file === 'src/lib/db-seed.ts' ? './' : '@/lib/'));
    expect(src).not.toMatch(/const todayIso = useMemo\(\(\) => toIsoDate\(new Date\(\)\)/);
    expect(src).not.toMatch(/function localIsoDate[^}]*getFullYear/);
  });
});
