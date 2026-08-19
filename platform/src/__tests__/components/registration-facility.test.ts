/**
 * The registration form's "which facility?" question, tested through the pure
 * modules it is built from — the requirement arithmetic the left rail counts
 * with, the read-back the clerk confirms, and the document that gets saved.
 *
 * The question is only asked of a user who carries no facility of their own (a
 * platform super_admin, an org_admin between postings). For everyone else their
 * own posting answers it, and the form must look exactly as it did — the rail
 * counts the same five demographics requirements, and the read-back grows no
 * row restating the hospital they are standing in.
 */
import {
  sectionRequirementProgress, DEMOGRAPHICS_SECTION,
} from '@/components/patients/registration/registration-progress';
import { buildReviewGroups } from '@/components/patients/registration/review-groups';
import { buildPatientDoc } from '@/components/patients/registration/build-patient-doc';
import {
  EMPTY_REGISTRATION_FORM, type RegistrationForm,
} from '@/components/patients/registration/registration-form';

/** A form with every demographics requirement answered except the facility. */
const NAMED: RegistrationForm = {
  ...EMPTY_REGISTRATION_FORM,
  firstName: 'Nyalel', surname: 'Chuol', gender: 'Female',
  dateOfBirth: '1991-06-02', primaryLanguage: 'Dinka',
};

const t = (key: string) => key;
const STEPS = ['Demographics', 'Biometrics', 'Contact', 'Next of Kin', 'Coverage', 'Review'];

describe('registration requirement counting', () => {
  test('a clerk with their own posting is asked nothing extra', () => {
    const progress = sectionRequirementProgress(NAMED)[DEMOGRAPHICS_SECTION];
    expect(progress).toEqual({ done: 5, total: 5 });
  });

  test('a user with no facility of their own owes one more answer', () => {
    const progress = sectionRequirementProgress(NAMED, { facilityRequired: true })[DEMOGRAPHICS_SECTION];
    // Six required now, and the section is NOT finished — which is what stops
    // the rail from unlocking Review on a form Register would refuse.
    expect(progress).toEqual({ done: 5, total: 6 });
  });

  test('naming the facility completes the section', () => {
    const progress = sectionRequirementProgress(
      { ...NAMED, registrationFacility: 'hosp-001' },
      { facilityRequired: true },
    )[DEMOGRAPHICS_SECTION];
    expect(progress).toEqual({ done: 6, total: 6 });
  });
});

describe('registration read-back', () => {
  const source = { form: NAMED as unknown as Record<string, string>, additionalNok: [], fingerprintCount: 0 };

  test('omits the facility row when the clerk was never asked', () => {
    const rows = buildReviewGroups(STEPS, source, t)[0].rows;
    expect(rows.map(([label]) => label)).not.toContain('patientNew.registrationFacility');
  });

  test('reads the facility back by name, not by id', () => {
    const rows = buildReviewGroups(
      STEPS,
      { ...source, registrationFacilityName: 'Juba Teaching Hospital' },
      t,
    )[0].rows;
    // First row of the first group — the facility is settled before the name.
    expect(rows[0]).toEqual(['patientNew.registrationFacility', 'Juba Teaching Hospital']);
  });
});

describe('the saved document', () => {
  const base = {
    form: NAMED, additionalNok: [], photoUrl: null,
    registeredBy: 'TamamHealth Platform Admin', nowIso: '2026-08-18T09:00:00.000Z',
  };

  test("records the chosen facility as the patient's registering hospital", () => {
    // What the form now passes for a user with no posting: the facility they
    // picked. `createPatient` reads the organisation off it — an empty value
    // here is what used to produce an org-less, unsaveable patient.
    const doc = buildPatientDoc({ ...base, hospitalId: 'hosp-001' });
    expect(doc.registrationHospital).toBe('hosp-001');
    expect(doc.lastVisitHospital).toBe('hosp-001');
  });
});
