/**
 * Registration decisions: the facility's hospital-number prefix is honoured,
 * and allergies the patient reports at the desk are saved unverified, feed Rx
 * safety, and are confirmed or removed by triage's allergy review.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

jest.setTimeout(30000);

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { hospitalsDB, patientsDB } from '@/lib/db';
import { createPatient, searchPatients } from '@/lib/services/patient-service';
import { assessPrescriptionSafety } from '@/lib/services/prescription-service';
import { updateAllergy, removeAllergy } from '@/lib/services/allergy-service';
import { setSettings } from '@/lib/settings/settings-store';
import {
  DEFAULT_FACILITY_SETTINGS, mergeFacilitySettings, normalizeHospitalPrefix,
} from '@/lib/settings/facility-settings';
import { buildPatientDoc, buildReportedAllergyEntries } from '@/components/patients/registration/build-patient-doc';
import { EMPTY_REGISTRATION_FORM } from '@/components/patients/registration/registration-form';
import { DOC_WRITE_ROLES } from '@/lib/sync/write-permissions';
import type { PatientDoc } from '@/lib/db-types';

const SCOPE = { role: 'super_admin' } as import('@/lib/services/data-scope').DataScope;
const HOSP = 'hosp-001';
const ORG = 'org-moh-ss';

beforeEach(async () => {
  await putDoc(hospitalsDB(), { _id: HOSP, type: 'hospital', name: 'Juba Teaching Hospital', code: 'JTH', orgId: ORG } as never);
});
afterEach(async () => {
  setSettings(mergeFacilitySettings(null));
  await teardownTestDBs();
  uuidCounter = 0;
});

const FORM = { ...EMPTY_REGISTRATION_FORM, firstName: 'Nyalel', surname: 'Chuol', gender: 'Female', dateOfBirth: '1991-06-02', primaryLanguage: 'Dinka' };

async function register(first: string, reported: { substance: string; reaction: string }[] = []) {
  const doc = buildPatientDoc({
    form: { ...FORM, firstName: first, phone: '+211925003001', nokName: 'Mary', nokRelationship: 'Parent', nokPhone: '+211925003002', state: 'Central Equatoria', county: 'Juba' },
    additionalNok: [], reportedAllergies: reported, photoUrl: null,
    hospitalId: HOSP, registeredBy: 'Amira', nowIso: '2026-11-08T09:00:00.000Z',
  });
  return createPatient({ ...doc, orgId: ORG } as unknown as Parameters<typeof createPatient>[0], SCOPE);
}

describe('hospital number prefix', () => {
  it('normalizes: uppercase letters/digits, 2 to 6 long, else empty', () => {
    expect(normalizeHospitalPrefix(' jth-1 ')).toBe('JTH1');
    expect(normalizeHospitalPrefix('A')).toBe('');
    expect(normalizeHospitalPrefix('TOOLONGPREFIX')).toBe('');
    expect(normalizeHospitalPrefix(undefined)).toBe('');
    expect(mergeFacilitySettings({ hospitalNumberPrefix: '!' } as never).hospitalNumberPrefix).toBe(DEFAULT_FACILITY_SETTINGS.hospitalNumberPrefix);
  });

  it('a configured prefix is used for new numbers; existing numbers never change', async () => {
    const before = await register('Akot');
    expect(before.hospitalNumber).toMatch(/^JTH-0001-/);

    setSettings(mergeFacilitySettings({ hospitalNumberPrefix: 'iteru' } as never));
    const after = await register('Bol');
    expect(after.hospitalNumber).toMatch(/^ITERU-0001-/);

    const reread = await patientsDB().get(before._id) as PatientDoc;
    expect(reread.hospitalNumber).toBe(before.hospitalNumber);
  });

  it('unset prefix keeps the hospital record code; search by number still finds both', async () => {
    const a = await register('Akot');
    setSettings(mergeFacilitySettings({ hospitalNumberPrefix: 'ITERU' } as never));
    const b = await register('Bol');
    const foundOld = await searchPatients(a.hospitalNumber, SCOPE);
    const foundNew = await searchPatients(b.hospitalNumber, SCOPE);
    expect(foundOld.map(p => p._id)).toContain(a._id);
    expect(foundNew.map(p => p._id)).toContain(b._id);
  });
});

describe('allergies reported at registration', () => {
  it('empty field keeps "Not recorded": no structured list, never an NKDA claim', () => {
    const doc = buildPatientDoc({ form: FORM, additionalNok: [], photoUrl: null, hospitalId: HOSP, registeredBy: 'Amira', nowIso: '2026-11-08T09:00:00.000Z' });
    expect(doc.allergies).toEqual([]);
    expect('structuredAllergies' in doc).toBe(false);
    expect('noKnownDrugAllergies' in doc).toBe(false);
  });

  it('entries are unverified patient-reported; blanks, repeats and "none" are dropped', () => {
    const entries = buildReportedAllergyEntries([
      { substance: ' Penicillin ', reaction: 'Rash' },
      { substance: 'penicillin', reaction: '' },
      { substance: 'None', reaction: '' },
      { substance: '', reaction: 'x' },
    ], '2026-11-08T09:00:00.000Z', 'Amira', () => 'id-1');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      substance: 'Penicillin', reaction: 'Rash', status: 'active',
      source: 'patient_reported_at_registration', verified: false,
    });
  });

  it('the receptionist roles can write the patient doc carrying them', () => {
    expect(DOC_WRITE_ROLES.patient).toEqual(expect.arrayContaining(['front_desk', 'triage_nurse', 'nurse']));
  });

  it('a reported allergy triggers Rx safety warnings; triage confirm or remove updates it', async () => {
    const p = await register('Akot', [{ substance: 'Penicillin', reaction: 'Rash' }]);
    const saved = await patientsDB().get(p._id) as PatientDoc;
    expect(saved.allergies).toEqual(['Penicillin']);
    expect(saved.structuredAllergies?.[0]).toMatchObject({ verified: false, source: 'patient_reported_at_registration' });

    const rx = await assessPrescriptionSafety(p._id, 'Amoxicillin 500mg', SCOPE);
    expect(rx.allergyWarnings?.[0]).toMatchObject({ allergy: 'Penicillin' });

    const id = saved.structuredAllergies![0].id;
    await updateAllergy(p._id, SCOPE, id, { verified: true });
    const confirmed = await patientsDB().get(p._id) as PatientDoc;
    expect(confirmed.structuredAllergies![0].verified).toBe(true);
    expect(confirmed.allergies).toEqual(['Penicillin']);

    await removeAllergy(p._id, SCOPE, id, 'Not an allergy', 'entered_in_error');
    const removed = await patientsDB().get(p._id) as PatientDoc;
    expect(removed.allergies).toEqual([]);
    const rx2 = await assessPrescriptionSafety(p._id, 'Amoxicillin 500mg', SCOPE);
    expect(rx2.allergyWarnings ?? []).toHaveLength(0);
  });
});

describe('registration draft carries reported allergies', () => {
  it('keeps valid rows and drops malformed ones', () => {
    const { normalizePatientRegistrationDraft } = require('@/lib/patient-registration-draft');
    const draft = normalizePatientRegistrationDraft({
      version: 1, form: {}, additionalNok: [], fingerprints: [], patientPhotoUrl: null, reviewMode: false,
      reportedAllergies: [{ substance: 'Penicillin', reaction: 'Rash' }, { substance: 5 }, 'x'],
    });
    expect(draft.reportedAllergies).toEqual([{ substance: 'Penicillin', reaction: 'Rash' }]);
  });
});
