/**
 * "No known allergies" is a finding, not a default. Registration used to write
 * allergies: ['None known'] as its "not asked yet" placeholder, and the chart
 * header and the order form read it as an answer (2026-11-05 walkthrough). Now:
 * nothing recorded → "Not recorded" / Unknown; an NKDA attestation → none known.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import type { PatientDoc } from '@/lib/db-types';
import { AllergyLine } from '@/components/ehr/chart/panels/order-basket/PatientBanner';
import { buildPatientDoc } from '@/components/patients/registration/build-patient-doc';
import { EMPTY_REGISTRATION_FORM } from '@/components/patients/registration/registration-form';

jest.mock('@/lib/i18n/useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const base = { _id: 'p1', type: 'patient', firstName: 'A', surname: 'B' } as unknown as PatientDoc;

describe('order form allergy line', () => {
  it('says Unknown when nobody has asked (empty or "None known" placeholder)', () => {
    expect(renderToStaticMarkup(<AllergyLine patient={{ ...base, allergies: [] }} />)).toContain('basket.allergiesUnknown');
  });
  it('treats a legacy "None known" placeholder as not asked', () => {
    expect(renderToStaticMarkup(<AllergyLine patient={{ ...base, allergies: ['None known'] }} />)).toContain('basket.allergiesUnknown');
  });
  it('says none only after an NKDA attestation', () => {
    expect(renderToStaticMarkup(<AllergyLine patient={{ ...base, allergies: [], noKnownDrugAllergies: true }} />)).toContain('basket.allergiesNone');
  });
  it('lists legacy allergens too, not only structured ones', () => {
    expect(renderToStaticMarkup(<AllergyLine patient={{ ...base, allergies: ['Penicillin'] }} />)).toContain('Penicillin');
  });
});

describe('registration', () => {
  it('starts a new patient with no allergy entry, not a "None known" placeholder', () => {
    const doc = buildPatientDoc({
      form: { ...EMPTY_REGISTRATION_FORM, firstName: 'Nyalel', surname: 'Chuol', gender: 'Female', dateOfBirth: '1991-06-02' },
      additionalNok: [], photoUrl: null, hospitalId: 'hosp-001',
      registeredBy: 'test', nowIso: '2026-11-05T09:00:00.000Z',
    });
    expect(doc.allergies).toEqual([]);
  });
});
