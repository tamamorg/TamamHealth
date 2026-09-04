import type { ANCVisitDoc } from '@/lib/db-types';
import {
  createAncRegistrationForm,
  deriveAncPatientPrefill,
  missingAncRequiredFields,
} from '@/lib/forms/anc-form-policy';

const previousVisit = (overrides: Partial<ANCVisitDoc> = {}): ANCVisitDoc => ({
  _id: 'anc-1', type: 'anc_visit', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
  motherId: 'patient-1', patientId: 'patient-1', motherName: 'Mary Doe', motherAge: 28,
  gravida: 2, parity: 1, visitNumber: 2, visitDate: '2026-08-01', gestationalAge: 20,
  facilityId: 'facility-1', facilityName: 'Clinic', state: 'Central Equatoria',
  bloodPressure: '110/70', weight: 60, fundalHeight: 20, fetalHeartRate: 140,
  hemoglobin: 12, urineProtein: 'Negative', bloodGroup: 'A', rhFactor: '+',
  hivStatus: 'Negative', malariaTest: 'Not tested', syphilisTest: 'Not tested',
  ironFolateGiven: true, tetanusVaccine: false, iptpDose: 1,
  riskFactors: [], riskLevel: 'low', birthPlan: { facility: '', transport: '', bloodDonor: '' },
  nextVisitDate: '', notes: '', attendedBy: 'Clinician', attendedByRole: 'doctor',
  ...overrides,
});

describe('ANC registration form policy', () => {
  test('starts with workflow context but no invented clinical observations', () => {
    const form = createAncRegistrationForm('2026-09-04');
    expect(form.visitDate).toBe('2026-09-04');
    expect(form.visitNumber).toBe(1);
    expect(form.motherAge).toBe('');
    expect(form.gestationalAge).toBe('');
    expect(form.urineProtein).toBe('');
    expect(form.bloodGroup).toBe('');
    expect(form.riskLevel).toBe('');
    expect(form.ironFolateGiven).toBeNull();
    expect(form.hivStatus).toBe('Not tested');
  });

  test('derives reviewable values from a linked active pregnancy', () => {
    const form = deriveAncPatientPrefill(
      createAncRegistrationForm('2026-08-15'),
      { patientId: 'patient-1', patientName: 'Mary Doe', age: 29 },
      [previousVisit()],
    );
    expect(form).toMatchObject({
      motherId: 'patient-1', motherName: 'Mary Doe', motherAge: 29,
      gravida: 2, parity: 1, visitNumber: 3, gestationalAge: 22,
      bloodGroup: 'A', rhFactor: '+',
    });
    expect(form.urineProtein).toBe('');
    expect(form.riskLevel).toBe('');
  });

  test('does not carry a completed or stale pregnancy into a new episode', () => {
    const base = createAncRegistrationForm('2026-09-04');
    const patient = { patientId: 'patient-1', patientName: 'Mary Doe', age: 29 };
    expect(deriveAncPatientPrefill(base, patient, [previousVisit({ linkedBirthId: 'birth-1' })]).visitNumber).toBe(1);
    expect(deriveAncPatientPrefill(base, patient, [previousVisit({ visitDate: '2025-01-01' })]).visitNumber).toBe(1);
  });

  test('continues numbering after the eighth WHO-recommended contact', () => {
    const form = deriveAncPatientPrefill(
      createAncRegistrationForm('2026-08-15'),
      { patientId: 'patient-1', patientName: 'Mary Doe' },
      [previousVisit({ visitNumber: 8 })],
    );
    expect(form.visitNumber).toBe(9);
  });

  test('does not treat an earlier unknown blood type as a confirmed fact', () => {
    const form = deriveAncPatientPrefill(
      createAncRegistrationForm('2026-08-15'),
      { patientId: 'patient-1', patientName: 'Mary Doe' },
      [previousVisit({ bloodGroup: 'Unknown', rhFactor: 'Unknown' })],
    );
    expect(form.bloodGroup).toBe('');
    expect(form.rhFactor).toBe('');
  });

  test('requires explicit assessment and intervention choices', () => {
    expect(missingAncRequiredFields(createAncRegistrationForm('2026-09-04'))).toEqual(expect.arrayContaining([
      'motherAge', 'gravida', 'parity', 'gestationalAge', 'urineProtein',
      'bloodGroup', 'rhFactor', 'ironFolateGiven', 'tetanusVaccine', 'iptpDose', 'riskLevel',
    ]));
  });
});
