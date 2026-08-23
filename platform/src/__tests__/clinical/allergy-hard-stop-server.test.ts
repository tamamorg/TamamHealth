/**
 * The allergy hard stop is a facility policy, so both write paths must honour
 * it.
 *
 * It used to be read from the browser's hydrated settings singleton alone.
 * Server-side that singleton holds the defaults, so `/api/prescriptions` — the
 * path mobile clients, integrations and cron jobs use — sailed straight past a
 * hard stop the facility had deliberately switched on. The policy is now read
 * from the facility's own `facility_settings` document, which both paths can
 * see.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-huid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { hospitalsDB, patientsDB } from '@/lib/db';
import { createPrescription } from '@/lib/services/prescription-service';

afterEach(async () => {
  await teardownTestDBs();
});

const SEVERE_PENICILLIN_ALLERGY = {
  id: 'alg-1',
  substance: 'Penicillin',
  criticality: 'severe',
  status: 'active',
  reaction: 'Anaphylaxis',
  recordedAt: '2026-01-01T00:00:00.000Z',
};

async function seedWorld(allergyHardStop: boolean) {
  await putDoc(hospitalsDB(), {
    _id: 'hosp-001', type: 'hospital', name: 'Juba Teaching Hospital', orgId: 'org-moh-ss',
  } as never);
  await putDoc(hospitalsDB(), {
    _id: 'facility_settings:hosp-001',
    type: 'facility_settings',
    hospitalId: 'hosp-001',
    orgId: 'org-moh-ss',
    // FacilitySettingsDoc spreads the settings at the top level.
    clinicalPolicy: { allergyHardStop },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as never);
  await putDoc(patientsDB(), {
    _id: 'pat-00001', type: 'patient', firstName: 'Nyakuma', surname: 'Deng',
    structuredAllergies: [SEVERE_PENICILLIN_ALLERGY], allergies: ['Penicillin'],
    registrationHospital: 'hosp-001', orgId: 'org-moh-ss',
  } as never);
}

const rx = {
  patientId: 'pat-00001', patientName: 'Nyakuma Deng',
  medication: 'Amoxicillin 500mg', dose: '500mg', route: 'oral',
  frequency: 'TDS', duration: '5 days', prescribedBy: 'Dr. Wani',
  status: 'pending' as const, hospitalId: 'hosp-001',
};

describe('allergy hard stop, resolved from the facility', () => {
  it('refuses the order when the facility has the policy on', async () => {
    await seedWorld(true);
    await expect(createPrescription(rx)).rejects.toMatchObject({
      name: 'AllergyHardStopError',
    });
  });

  it('keeps the advisory behaviour when the facility has it off', async () => {
    await seedWorld(false);
    const result = await createPrescription(rx);
    expect(result.allergyWarnings).toHaveLength(1);
    expect(result.prescription._id).toBeTruthy();
  });

  it('defaults to advisory when the facility has no settings document', async () => {
    await putDoc(hospitalsDB(), {
      _id: 'hosp-001', type: 'hospital', name: 'Juba Teaching Hospital', orgId: 'org-moh-ss',
    } as never);
    await putDoc(patientsDB(), {
      _id: 'pat-00001', type: 'patient', firstName: 'Nyakuma', surname: 'Deng',
      structuredAllergies: [SEVERE_PENICILLIN_ALLERGY], allergies: ['Penicillin'],
      registrationHospital: 'hosp-001', orgId: 'org-moh-ss',
    } as never);
    const result = await createPrescription(rx);
    expect(result.prescription._id).toBeTruthy();
    expect(result.allergyWarnings).toHaveLength(1);
  });
});
