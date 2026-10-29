/**
 * Payment before dispensing. The pharmacy dashboard enforced this until the
 * station rewrite removed that page; the chart's dispense step now applies the
 * same rule through paymentHoldFor.
 */
import { paymentHoldFor } from '@/lib/pharmacy-workflow';

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
