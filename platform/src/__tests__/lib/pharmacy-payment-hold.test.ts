/**
 * Payment before dispensing. The pharmacy dashboard enforced this until the
 * station rewrite removed that page; the chart's dispense step now applies the
 * same rule through paymentHoldFor.
 */
import { paymentHoldFor, paymentReleaseFor } from '@/lib/pharmacy-workflow';

describe('paymentHoldFor', () => {
  const routine = { medication: 'Paracetamol' };

  it('holds a routine medicine while money is owed', () => {
    expect(paymentHoldFor(routine, 1500)).toBe('due');
  });

  it('lets a routine medicine go once the balance is cleared', () => {
    expect(paymentHoldFor(routine, 0)).toBeNull();
    expect(paymentHoldFor(routine, -200)).toBeNull();
  });

  it('fails closed when the balance could not be read', () => {
    expect(paymentHoldFor(routine, null)).toBe('unknown');
  });

  it('never holds a life-sustaining (Tier 1) medicine, owed or unread', () => {
    const insulin = { medication: 'Insulin regular' };
    expect(paymentHoldFor(insulin, 5000)).toBeNull();
    expect(paymentHoldFor(insulin, null)).toBeNull();
  });

  it('honours a prescriber-set Tier 1 on a free-text order', () => {
    expect(paymentHoldFor({ medication: 'Compounded syrup', criticalityTier: 1 }, 800)).toBeNull();
  });
});

describe('pay-before-dispense never blocks emergency care', () => {
  const routine = { medication: 'Paracetamol', frequency: 'Three times daily' };

  it('keeps pay-before-dispense as the default for a routine order', () => {
    expect(paymentReleaseFor(routine)).toBeNull();
    expect(paymentHoldFor(routine, 1500, paymentReleaseFor(routine))).toBe('due');
  });

  it('releases a STAT order, owed or unread', () => {
    const stat = { medication: 'Ceftriaxone', frequency: 'STAT (Immediately)' };
    expect(paymentReleaseFor(stat)).toBe('stat');
    expect(paymentHoldFor(stat, 1500, 'stat')).toBeNull();
    expect(paymentHoldFor(stat, null, 'stat')).toBeNull();
  });

  it('releases an emergency visit (red triage or an emergency exemption)', () => {
    expect(paymentReleaseFor(routine, { triagePriority: 'RED' })).toBe('emergency');
    expect(paymentReleaseFor(routine, { visitBilling: { payment: 'non_paying', exemption: 'emergency' } })).toBe('emergency');
    expect(paymentReleaseFor(routine, { triagePriority: 'YELLOW' })).toBeNull();
  });

  it('releases a patient exempt from payment and an insured patient', () => {
    expect(paymentReleaseFor(routine, { visitBilling: { payment: 'non_paying', exemption: 'under_five' } })).toBe('exempt');
    expect(paymentReleaseFor(routine, { visitBilling: { payment: 'paying', method: 'insurance' } })).toBe('insured');
    expect(paymentReleaseFor(routine, { visitBilling: { payment: 'paying', method: 'cash' } })).toBeNull();
  });

  it('marks a life-sustaining medicine as released too', () => {
    expect(paymentReleaseFor({ medication: 'Insulin regular', frequency: 'Twice daily' })).toBe('life_sustaining');
  });
});
