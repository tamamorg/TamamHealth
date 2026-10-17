/**
 * The "still syncing" hint in the checkout dialog must only appear when the
 * block is records in transit, never when a person still has work to do.
 */
import { isAwaitingClinicianRecords } from '@/components/front-desk/CheckoutModal';

const doc = { key: 'required_documentation_generated' };
const handoff = { key: 'post_consult_handoff' };
const rx = { key: 'prescriptions_dispensed' };

describe('isAwaitingClinicianRecords', () => {
  it('signed note missing on this device after the clinician closed the visit', () => {
    expect(isAwaitingClinicianRecords([doc], 'ready_for_clinic_checkout', false)).toBe(true);
  });

  it('handoff tasks done here, only the care plan has not arrived', () => {
    expect(isAwaitingClinicianRecords([handoff], 'ready_for_clinic_checkout', true)).toBe(true);
    expect(isAwaitingClinicianRecords([doc, handoff], 'ready_for_clinic_checkout', true)).toBe(true);
  });

  it('not when the post-consult tasks are simply not done yet', () => {
    expect(isAwaitingClinicianRecords([handoff], 'ready_for_clinic_checkout', false)).toBe(false);
    expect(isAwaitingClinicianRecords([doc, handoff], 'ready_for_clinic_checkout', false)).toBe(false);
  });

  it('not when anything else blocks, or the clinician has not closed the visit', () => {
    expect(isAwaitingClinicianRecords([doc, rx], 'ready_for_clinic_checkout', true)).toBe(false);
    expect(isAwaitingClinicianRecords([doc], 'with_clinician', true)).toBe(false);
    expect(isAwaitingClinicianRecords([], 'ready_for_clinic_checkout', true)).toBe(false);
  });
});
