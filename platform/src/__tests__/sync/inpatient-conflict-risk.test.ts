import { HIGH_RISK_RESOURCES, MEDIUM_RISK_RESOURCES, riskFor } from '@/lib/services/conflict-service';

describe('inpatient conflict classification', () => {
  test.each(['bed', 'admission', 'prescription', 'shift_handoff'])(
    '%s conflicts require human reconciliation',
    resourceType => {
      expect(HIGH_RISK_RESOURCES.has(resourceType)).toBe(true);
      expect(riskFor(resourceType)).toBe('high');
    },
  );

  test('prescriptions are not left in the medium-risk auto-merge tier', () => {
    expect(MEDIUM_RISK_RESOURCES.has('prescription')).toBe(false);
  });
});
