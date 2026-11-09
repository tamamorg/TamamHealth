/**
 * Clinical-flow — the facility-checkout gate definition
 * (src/lib/clinical-flow/encounter-journey.ts).
 *
 * The gate is fail-closed: a patient may not be discharged from the facility
 * until the critical items clear. These tests pin the critical set so a future
 * edit can't silently demote one of them to non-critical.
 */
import { FACILITY_CHECKOUT_GATE, TIER1_CHECKOUT_SAFETY_RULE } from '@/lib/clinical-flow/encounter-journey';

describe('facility checkout gate', () => {
  const byKey = Object.fromEntries(FACILITY_CHECKOUT_GATE.map((g) => [g.key, g]));

  test('the five clinical-safety items are critical', () => {
    for (const key of [
      'all_clinic_visits_closed',
      'prescriptions_dispensed',
      'critical_labs_reviewed',
      'in_clinic_procedures_complete',
      'required_documentation_generated',
    ]) {
      expect(byKey[key]).toBeDefined();
      expect(byKey[key].critical).toBe(true);
    }
  });

  test('a balance holds the visit open (critical) but never the care itself', () => {
    // Closing a visit with money owed needs it paid, waived or carried as a
    // debt with a reason (payment-debt-checkout.test.ts). Treatment, orders
    // and dispensing of emergency medicines are not behind this gate.
    expect(byKey['payment_status_determined'].critical).toBe(true);
    expect(byKey['pending_items_flagged'].critical).toBe(false);
  });

  test('every gate item has a human-readable label', () => {
    for (const g of FACILITY_CHECKOUT_GATE) {
      expect(typeof g.label).toBe('string');
      expect(g.label.length).toBeGreaterThan(0);
    }
  });

  test('the Tier-1 medication safety rule is stated independently of payment', () => {
    expect(TIER1_CHECKOUT_SAFETY_RULE).toMatch(/Tier-1/);
    expect(TIER1_CHECKOUT_SAFETY_RULE).toMatch(/regardless of payment/i);
  });
});
