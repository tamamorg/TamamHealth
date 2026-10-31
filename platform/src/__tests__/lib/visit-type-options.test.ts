/**
 * "Visit type" is one list on every form: the service the patient came for.
 * The OPD/home/outreach choice is the Visit setting, a separate field.
 */
import { APPOINTMENT_TYPE_OPTIONS, visitTypeForBooking } from '@/lib/visits/visit-details';

describe('visit type list', () => {
  it('offers the booking services, not how the patient arrived', () => {
    const values = APPOINTMENT_TYPE_OPTIONS.map(o => o.value);
    expect(values).toContain('lab');
    expect(values).not.toContain('walk_in');
  });

  it('prefills from the booking', () => {
    expect(visitTypeForBooking('lab')).toBe('lab');
  });

  it('falls back to a general consultation for a walk-in or no booking', () => {
    expect(visitTypeForBooking('walk_in')).toBe('general');
    expect(visitTypeForBooking(undefined)).toBe('general');
  });
});
