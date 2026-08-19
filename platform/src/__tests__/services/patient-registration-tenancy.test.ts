/**
 * A patient must be created inside an organisation, or they are not created at
 * all.
 *
 * The bug this pins: a user with no facility of their own — a platform
 * super_admin, an org_admin between postings — registered a patient, saw a
 * "Registered" toast, and produced a record with no `orgId`. Nothing rejected
 * it, and two things then went wrong quietly:
 *
 *   • CouchDB's tenant validator refuses every document without an `orgId`
 *     ('orgId is required on this database'), so the write never left the
 *     device it was typed on.
 *   • `filterByScope` matches on `orgId` for every role except super_admin and
 *     government, so even on that device the front desk, the clinician and the
 *     pharmacy could not see the patient.
 *
 * Registration is the only writer that can still resolve the organisation (from
 * the facility), so it is where the refusal belongs.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { createPatient } from '@/lib/services/patient-service';
import { filterByScope } from '@/lib/services/data-scope';
import { hospitalsDB, patientsDB } from '@/lib/db';
import type { PatientDoc } from '@/lib/db-types';

const HOSP = 'hosp-001';
const ORG = 'org-moh-ss';

beforeEach(async () => {
  await putDoc(hospitalsDB(), {
    _id: HOSP, type: 'hospital', name: 'Juba Teaching Hospital', code: 'JTH', orgId: ORG,
  } as unknown as { _id: string });
});
afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

/** The registration payload, minus whatever the caller wants to vary. */
function registration(overrides: Record<string, unknown> = {}) {
  return {
    firstName: 'Nyalel', surname: 'Chuol', gender: 'Female', dateOfBirth: '1991-06-02',
    state: 'Central Equatoria', county: 'Juba', primaryLanguage: 'Dinka',
    nokName: 'Chuol Deng', nokRelationship: 'Father', nokPhone: '+211925004001',
    hospitalNumber: '', registrationHospital: HOSP,
    ...overrides,
  } as unknown as Parameters<typeof createPatient>[0];
}

describe('registration resolves the patient organisation', () => {
  test('a facility on the registration infers the organisation that owns the record', async () => {
    const patient = await createPatient(registration());
    expect(patient.orgId).toBe(ORG);
  });

  test('an explicit orgId is honoured even when the facility is unknown', async () => {
    const patient = await createPatient(registration({
      registrationHospital: 'hosp-not-in-directory', orgId: ORG,
    }));
    expect(patient.orgId).toBe(ORG);
  });

  test('no facility and no orgId is refused, naming the field to fix', async () => {
    await expect(createPatient(registration({ registrationHospital: '' })))
      .rejects.toMatchObject({
        name: 'ValidationError',
        fields: { registrationHospital: expect.stringContaining('facility') },
      });
  });

  test('a refused registration writes nothing and burns no hospital number', async () => {
    // Same person, first refused for having no facility, then accepted with
    // one. The accepted record must be the first patient in the database and
    // must hold the first MRN — a rejected attempt that had already consumed
    // either would leave a gap in the register.
    await expect(createPatient(registration({ registrationHospital: '' }))).rejects.toThrow();
    const saved = await createPatient(registration());
    const all = await patientsDB().allDocs({ include_docs: true });
    const patients = all.rows
      .map(r => r.doc as unknown as PatientDoc)
      .filter(d => d?.type === 'patient');
    expect(patients).toHaveLength(1);
    expect(patients[0]._id).toBe(saved._id);
    // JTH-<4-digit sequence><2 random chars>. The sequence is 0001: the
    // refused attempt never reached the counter.
    expect(saved.hospitalNumber).toMatch(/^JTH-0001..$/);
  });

  test('the organisation is what makes the patient visible to their own facility', async () => {
    const patient = await createPatient(registration());
    // The scope a front-desk clerk at the registering facility carries.
    const deskScope = { orgId: ORG, hospitalId: HOSP, role: 'front_desk' as const };
    expect(filterByScope([patient], deskScope)).toHaveLength(1);
    // The same record without an organisation — what registration used to
    // produce for a user with no facility — is invisible to that same clerk.
    const orgless = { ...patient, orgId: undefined };
    expect(filterByScope([orgless], deskScope)).toHaveLength(0);
  });
});
