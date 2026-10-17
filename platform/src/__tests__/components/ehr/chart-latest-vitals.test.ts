import { buildChartLatestVitals, sortVitalsNewestFirst } from '@/lib/chart-latest-vitals';
import { orderBannerAllergies } from '@/components/ehr/chart/allergy-order';
import { resolveRouteContext } from '@/lib/navigation/route-context';
import type { MedicalRecordDoc, TriageDoc } from '@/lib/db-types';

const rec = (id: string, at: string, pulse: number, kind?: string) => ({
  _id: id, consultedAt: at, recordKind: kind,
  vitalSigns: { pulse, temperature: 0, systolic: 0, diastolic: 0, respiratoryRate: 0, oxygenSaturation: 0, weight: 0, height: 0, bmi: 0 },
}) as unknown as MedicalRecordDoc;
const tri = (id: string, at: string, pulse: string) => ({ _id: id, triagedAt: at, pulse }) as unknown as TriageDoc;

describe('chart latest vitals', () => {
  const records = [rec('r1', '2026-08-19T09:00:00Z', 70)];
  const triages = [tri('t1', '2026-10-14T08:00:00Z', '88')];

  it('is not ready (and shows nothing) until both sources resolve', () => {
    const a = buildChartLatestVitals({ records, triages: [], recordsReady: true, triageReady: false });
    expect(a.ready).toBe(false);
    expect(a.latest).toBeUndefined();
  });

  it('gives the same answer whichever source resolved first', () => {
    const full = buildChartLatestVitals({ records, triages, recordsReady: true, triageReady: true });
    expect(full.latest?.id).toBe('t1');
    // same inputs, different array order -> same latest
    const rev = buildChartLatestVitals({ records: [...records].reverse(), triages: [...triages].reverse(), recordsReady: true, triageReady: true });
    expect(rev.latest?.id).toBe('t1');
  });

  it('orders by instant, not by string: offsets and date-only', () => {
    const sorted = sortVitalsNewestFirst([
      { id: 'a', at: '2026-10-14T23:00:00-05:00', source: 'Consult' },
      { id: 'b', at: '2026-10-15T01:00:00Z', source: 'Triage' },
      { id: 'c', at: '2026-10-14', source: 'Consult' },
    ] as never);
    // a = 2026-10-15T04:00Z is newest
    expect(sorted.map(e => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps record ahead of triage on an exact tie', () => {
    const r = buildChartLatestVitals({
      records: [rec('r', '2026-10-14T08:00:00Z', 70)], triages: [tri('t', '2026-10-14T08:00:00Z', '90')],
      recordsReady: true, triageReady: true,
    });
    expect(r.latest?.id).toBe('r');
  });
});

describe('allergy banner order', () => {
  it('puts severe and ungraded first and never hides them', () => {
    const { ordered, visibleCount } = orderBannerAllergies([
      { substance: 'Latex', criticality: 'mild' },
      { substance: 'A', criticality: 'severe' },
      { substance: 'B' },
      { substance: 'C', criticality: 'severe' },
      { substance: 'D', criticality: 'severe' },
      { substance: 'Dust', criticality: 'moderate' },
    ]);
    expect(ordered.map(a => a.substance)).toEqual(['A', 'B', 'C', 'D', 'Latex', 'Dust']);
    expect(visibleCount).toBe(4);
  });
  it('shows three by default', () => {
    expect(orderBannerAllergies([{ substance: 'x', criticality: 'mild' }]).visibleCount).toBe(3);
  });
});

describe('chart breadcrumb origin', () => {
  it('uses a safe returnTo as the first crumb', () => {
    const c = resolveRouteContext('/patients/p1', '/dashboard', '/lab?tab=queue')!;
    expect(c.crumbs[0]).toEqual({ href: '/lab?tab=queue', labelKey: 'breadcrumb.lab' });
    expect(c.crumbs[1]).toEqual({ labelKey: 'routeContext.patientRecord' });
  });
  it('falls back to Patients for unsafe, self or /patients returnTo', () => {
    for (const r of ['//evil.com', 'https://x.y', '/patients', '/patients/p1', null]) {
      expect(resolveRouteContext('/patients/p1', '/dashboard', r)!.crumbs[0].labelKey).toBe('breadcrumb.patients');
    }
  });
  it('unknown origin gets the generic worklist label', () => {
    expect(resolveRouteContext('/patients/p1', '/dashboard', '/payments')!.crumbs[0].labelKey).toBe('chart.crumb.worklist');
  });
});
