import {
  CLINICAL_SPECIALTIES, isClinicalSpecialty, specialtyFromLegacy, specialtyLabel,
} from '@/modules/departments';

// Ported from the AmbuMed branch onto main's departments module. Main keeps
// nephrology under the `renal_medicine` code; the branch's own `nephrology`
// code is deliberately not reintroduced.
describe('clinical specialty catalog', () => {
  it('has unique stable codes', () => {
    const codes = CLINICAL_SPECIALTIES.map(item => item.value);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('normalizes known legacy labels without guessing unknown specialties', () => {
    expect(specialtyFromLegacy(' Cardiologist ')).toBe('cardiology');
    expect(specialtyFromLegacy('Orthopedic Surgeon')).toBe('orthopaedic_surgery');
    expect(specialtyFromLegacy('Pediatrician')).toBe('paediatrics');
    expect(specialtyFromLegacy('OB/GYN')).toBe('obstetrics_gynaecology');
    expect(specialtyFromLegacy('Obstetrics & Gynecology')).toBe('obstetrics_gynaecology');
    expect(specialtyFromLegacy('Gynecologist')).toBe('obstetrics_gynaecology');
    expect(specialtyFromLegacy('Physical therapist')).toBe('physiotherapy');
    expect(specialtyFromLegacy('Nephrologist')).toBe('renal_medicine');
    expect(specialtyFromLegacy('unverified specialty')).toBeUndefined();
  });

  it('validates codes and resolves their display labels', () => {
    expect(isClinicalSpecialty('renal_medicine')).toBe(true);
    expect(isClinicalSpecialty('Nephrologist')).toBe(false);
    expect(specialtyLabel('renal_medicine')).toBe('Renal medicine');
    expect(specialtyLabel('obstetrics_gynaecology')).toBe('Obstetrics & gynaecology');
  });
});
