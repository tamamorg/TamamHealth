import { validateMedicalRecord, validateVitalSigns } from '@/lib/validation';

describe('blood pressure pair', () => {
  it('rejects a diastolic pressure at or above the systolic', () => {
    expect(validateVitalSigns({ systolic: 60, diastolic: 90 }).systolicBP).toMatch(/higher than diastolic/);
    expect(validateVitalSigns({ systolic: 80, diastolic: 80 }).systolicBP).toMatch(/higher than diastolic/);
    expect(validateVitalSigns({ systolicBP: '90', diastolicBP: '120' }).systolicBP).toBeDefined();
  });

  it('accepts a normal pair and a lone reading', () => {
    expect(validateVitalSigns({ systolic: 120, diastolic: 80 })).toEqual({});
    expect(validateVitalSigns({ systolic: 120 })).toEqual({});
    expect(validateVitalSigns({ diastolic: 80 })).toEqual({});
  });

  it('is enforced on a saved medical record', () => {
    const errors = validateMedicalRecord({
      patientId: 'p1', hospitalId: 'h1', chiefComplaint: 'Nursing vitals observation',
      vitalSigns: { systolic: 60, diastolic: 90 },
    });
    expect(errors.systolicBP ?? errors['vitalSigns.systolicBP']).toBeDefined();
  });
});
