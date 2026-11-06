/**
 * isAggregateOnlyViewer gates the row-level PHI on coverage/analytics surfaces
 * (immunizations, ANC, MCH high-risk, data-quality duplicates) so a government
 * viewer sees aggregates only (security audit 2026-11-05, H3). Births, deaths
 * and surveillance keep row-level access and are deliberately NOT gated here;
 * super_admin is unrestricted; county_health_director is facility-scoped.
 */
import { isAggregateOnlyViewer } from '@/lib/services/data-scope';

describe('isAggregateOnlyViewer', () => {
  it('is true only for government', () => {
    expect(isAggregateOnlyViewer('government')).toBe(true);
  });
  it('is false for super_admin, county_health_director and clinical roles', () => {
    for (const role of ['super_admin', 'county_health_director', 'doctor', 'nurse', 'hrio', 'hospital_manager', 'medical_superintendent'] as const) {
      expect(isAggregateOnlyViewer(role)).toBe(false);
    }
  });
  it('is false when the role is undefined', () => {
    expect(isAggregateOnlyViewer(undefined)).toBe(false);
  });
});
