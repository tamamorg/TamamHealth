import { validatePortalAppointment, validatePortalPayment } from '@/lib/patient-portal-write-validation';

describe('patient portal payment validation', () => {
  it.each([undefined, 'nope', 0, -1, Number.POSITIVE_INFINITY])('rejects invalid amount %p', amount => {
    expect(validatePortalPayment({ amount }).ok).toBe(false);
  });

  it('normalizes accepted payment input', () => {
    expect(validatePortalPayment({ amount: '125.5', method: 'mpesa', currency: 'ssp' })).toEqual({
      ok: true,
      value: { amount: 125.5, method: 'mpesa', currency: 'SSP' },
    });
  });

  it('rejects arbitrary enum values and oversized notes', () => {
    const result = validatePortalPayment({ amount: 1, method: 'crypto', currency: 'BTC', notes: 'x'.repeat(2_001) });
    expect(result).toEqual({ ok: false, fields: expect.objectContaining({ method: expect.any(String), currency: expect.any(String), notes: expect.any(String) }) });
  });
});

describe('patient portal appointment validation', () => {
  const valid = { facilityId: 'facility-1', appointmentDate: '2026-09-01', appointmentTime: '', duration: 30 };

  it('preserves the supported any-time request', () => {
    expect(validatePortalAppointment(valid, '2026-08-30')).toEqual({
      ok: true,
      value: expect.objectContaining({ appointmentTime: '', facilityLevel: 'county', appointmentType: 'general', priority: 'routine' }),
    });
  });

  it.each([
    [{ ...valid, facilityId: '' }, 'facilityId'],
    [{ ...valid, appointmentDate: '2026-02-30' }, 'appointmentDate'],
    [{ ...valid, appointmentDate: '2026-08-29' }, 'appointmentDate'],
    [{ ...valid, appointmentTime: '25:00' }, 'appointmentTime'],
    [{ ...valid, duration: 0 }, 'duration'],
    [{ ...valid, priority: 'stat' }, 'priority'],
  ] as const)('rejects malformed request field %s', (input, field) => {
    const result = validatePortalAppointment(input, '2026-08-30');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fields[field]).toBeDefined();
  });
});
