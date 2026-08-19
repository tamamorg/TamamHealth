/**
 * Tenancy audit (2026-08): three patient-service reads that bypassed
 * `filterByScope` entirely.
 *
 *   1. `createPatient` ran its duplicate check (`checkDuplicates`) and its
 *      geocode assignment (`assignGeocodeId`) with no scope, so both scanned
 *      EVERY patient this device knows about — every org, every facility.
 *      `checkDuplicates`'s returned message then named the matched patient
 *      (full name + hospital number), so a phone number typed into a
 *      registration form could disclose another facility's patient identity
 *      to a user who could never otherwise see that chart.
 *   2. `getPatientById(id)` took no scope parameter at all, so any caller
 *      holding an id (a URL, a stale local replica) got the full document
 *      back regardless of whether the caller's org/facility could see it.
 *
 * This file pins the fix: duplicate detection still searches globally (a
 * genuine cross-facility duplicate must still block registration — it is not
 * something to drop silently), but the message it returns is scoped — named
 * in full only when the match is inside the caller's own `filterByScope`
 * view, and disclosing nothing about the record otherwise. `getPatientById`
 * now accepts an optional scope and returns `null` for a document the scope
 * excludes, exactly like `filterByScope` would.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { createPatient, getPatientById } from '@/lib/services/patient-service';
import { hospitalsDB, patientsDB } from '@/lib/db';
import type { PatientDoc } from '@/lib/db-types';
import type { DataScope } from '@/lib/services/data-scope';

// Org A has two facilities; Org B is an entirely different tenant.
const ORG_A = 'org-moh-ss';
const HOSP_A1 = 'hosp-001'; // Juba Teaching Hospital
const HOSP_A2 = 'hosp-002'; // Bor County Hospital — same org, different facility
const ORG_B = 'org-mercy-hospital';
const HOSP_B1 = 'hosp-b1'; // Mercy Hospital — different org entirely

// The scope a front-desk clerk at HOSP_A1 carries. Non-admin + has a
// hospitalId, so `filterByScope` narrows by facility as well as org.
const DESK_A1_SCOPE: DataScope = { orgId: ORG_A, hospitalId: HOSP_A1, role: 'front_desk' };

beforeEach(async () => {
  await putDoc(hospitalsDB(), {
    _id: HOSP_A1, type: 'hospital', name: 'Juba Teaching Hospital', code: 'JTH', orgId: ORG_A,
  } as unknown as { _id: string });
  await putDoc(hospitalsDB(), {
    _id: HOSP_A2, type: 'hospital', name: 'Bor County Hospital', code: 'BCH', orgId: ORG_A,
  } as unknown as { _id: string });
  await putDoc(hospitalsDB(), {
    _id: HOSP_B1, type: 'hospital', name: 'Mercy Hospital', code: 'MCY', orgId: ORG_B,
  } as unknown as { _id: string });
});
afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

/** A minimal, already-saved patient doc, written straight to the DB (no
 * validation, no claims) so tests can set up "existing" records precisely. */
async function seedPatient(overrides: Partial<PatientDoc> & { _id: string }): Promise<PatientDoc> {
  const doc = {
    type: 'patient',
    firstName: 'Existing', surname: 'Patient', gender: 'Female', dateOfBirth: '1980-01-01',
    hospitalNumber: 'JTH-000199AA',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...overrides,
  } as unknown as PatientDoc & { _id: string };
  return putDoc(patientsDB(), doc);
}

/** A fresh registration payload, minus whatever the caller wants to vary. */
function registration(overrides: Record<string, unknown> = {}) {
  return {
    firstName: 'Nyalel', surname: 'Chuol', gender: 'Female', dateOfBirth: '1991-06-02',
    state: 'Central Equatoria', county: 'Juba', primaryLanguage: 'Dinka',
    nokName: 'Chuol Deng', nokRelationship: 'Father', nokPhone: '+211925004001',
    hospitalNumber: '', registrationHospital: HOSP_A1, orgId: ORG_A,
    ...overrides,
  } as unknown as Parameters<typeof createPatient>[0];
}

describe('checkDuplicates via createPatient: scoped disclosure', () => {
  test('a duplicate INSIDE the caller\'s scope is still named in full (phone match)', async () => {
    const existing = await seedPatient({
      _id: 'pat-inscope-phone', orgId: ORG_A, registrationHospital: HOSP_A1,
      firstName: 'Abuk', surname: 'Deng', dateOfBirth: '1975-03-03',
      phone: '+211912345678', hospitalNumber: 'JTH-000155AA',
    });
    await expect(createPatient(
      registration({ phone: '+211912345678', firstName: 'Someone', surname: 'Else', dateOfBirth: '2000-01-01' }),
      DESK_A1_SCOPE,
    )).rejects.toMatchObject({
      name: 'ValidationError',
      fields: {
        duplicate: expect.stringContaining(`${existing.firstName} ${existing.surname}`),
      },
    });
    // The hospital number is disclosed too, not just the name.
    await expect(createPatient(
      registration({ phone: '+211912345678', firstName: 'Someone', surname: 'Else', dateOfBirth: '2000-01-01' }),
      DESK_A1_SCOPE,
    )).rejects.toMatchObject({
      fields: { duplicate: expect.stringContaining(existing.hospitalNumber!) },
    });
  });

  test('a duplicate at ANOTHER FACILITY in the same org blocks registration but names nothing', async () => {
    const existing = await seedPatient({
      _id: 'pat-outscope-facility', orgId: ORG_A, registrationHospital: HOSP_A2,
      firstName: 'Nyandeng', surname: 'Malual', dateOfBirth: '1988-08-08',
      phone: '+211977777777', hospitalNumber: 'BCH-000042AA',
    });
    const result = createPatient(
      registration({ phone: '+211977777777', firstName: 'Someone', surname: 'Else', dateOfBirth: '2000-01-01' }),
      DESK_A1_SCOPE,
    );
    await expect(result).rejects.toMatchObject({ name: 'ValidationError' });
    const err = await result.catch((e) => e);
    const msg: string = err.fields.duplicate;
    // Still blocks (registration must not proceed)...
    expect(msg).toBeTruthy();
    // ...but discloses nothing the caller isn't already authorized to see.
    expect(msg).not.toContain(existing.firstName);
    expect(msg).not.toContain(existing.surname);
    expect(msg).not.toContain(existing.hospitalNumber);
    expect(msg).not.toContain(HOSP_A2);
    expect(msg).not.toContain('Bor County');
    expect(msg).toMatch(/another facility/i);
  });

  test('a duplicate in a DIFFERENT ORG blocks registration but names nothing', async () => {
    const existing = await seedPatient({
      _id: 'pat-outscope-org', orgId: ORG_B, registrationHospital: HOSP_B1,
      firstName: 'Akol', surname: 'Garang', dateOfBirth: '1992-02-02',
      nationalId: 'SSD123456',
    });
    const result = createPatient(
      registration({ nationalId: 'SSD123456', firstName: 'Someone', surname: 'Else', dateOfBirth: '2000-01-01' }),
      DESK_A1_SCOPE,
    );
    await expect(result).rejects.toMatchObject({ name: 'ValidationError' });
    const err = await result.catch((e) => e);
    const msg: string = err.fields.duplicate;
    expect(msg).toBeTruthy();
    expect(msg).not.toContain(existing.firstName);
    expect(msg).not.toContain(existing.surname);
    expect(msg).not.toContain('Mercy');
  });

  test('name+DOB and geocodeId matches follow the same in/out-of-scope split', async () => {
    // Out-of-scope name+DOB match.
    const nameMatch = await seedPatient({
      _id: 'pat-outscope-namedob', orgId: ORG_B, registrationHospital: HOSP_B1,
      firstName: 'Rebecca', surname: 'Nyibol', dateOfBirth: '1999-09-09',
    });
    let err = await createPatient(
      registration({ firstName: 'Rebecca', surname: 'Nyibol', dateOfBirth: '1999-09-09' }),
      DESK_A1_SCOPE,
    ).catch((e) => e);
    expect(err.fields.duplicate).not.toContain(nameMatch.firstName);
    expect(err.fields.duplicate).toMatch(/another facility/i);

    // Out-of-scope geocodeId match.
    await seedPatient({
      _id: 'pat-outscope-geo', orgId: ORG_B, registrationHospital: HOSP_B1,
      firstName: 'Peter', surname: 'Kuol', dateOfBirth: '1970-01-01',
      geocodeId: 'BOMA-XYZ-HH9-A',
    });
    err = await createPatient(
      registration({ geocodeId: 'BOMA-XYZ-HH9-A', firstName: 'Someone', surname: 'Else', dateOfBirth: '2001-01-01' }),
      DESK_A1_SCOPE,
    ).catch((e) => e);
    expect(err.fields.duplicate).not.toContain('Peter');
    expect(err.fields.duplicate).not.toContain('Kuol');
    expect(err.fields.duplicate).toMatch(/another facility/i);
  });

  test('no scope passed preserves the original fully-disclosed message (backward compatible)', async () => {
    const existing = await seedPatient({
      _id: 'pat-noscope', orgId: ORG_B, registrationHospital: HOSP_B1,
      firstName: 'Malith', surname: 'Ayen', dateOfBirth: '1985-05-05',
      phone: '+211900000001', hospitalNumber: 'MCY-000011AA',
    });
    const err = await createPatient(
      registration({ phone: '+211900000001', firstName: 'Someone', surname: 'Else', dateOfBirth: '2000-01-01' }),
      // no scope argument at all
    ).catch((e) => e);
    expect(err.fields.duplicate).toContain(existing.firstName);
    expect(err.fields.duplicate).toContain(existing.surname);
  });

  test('createPatient forwards its scope argument through to the duplicate check', async () => {
    // Same fact pattern as the in-scope test, but this time proves the wiring:
    // calling createPatient WITHOUT a scope on data that collides with an
    // in-scope-shaped record still discloses in full (no scope = unfiltered),
    // while passing DESK_A1_SCOPE on an out-of-org collision is what
    // triggers the redacted branch. Together these show `scope` actually
    // reaches `checkDuplicates` rather than being silently dropped.
    await seedPatient({
      _id: 'pat-wiring-check', orgId: ORG_B, registrationHospital: HOSP_B1,
      firstName: 'Wiring', surname: 'Check', dateOfBirth: '1960-06-06',
      phone: '+211900000099',
    });
    const withoutScope = await createPatient(
      registration({ phone: '+211900000099', firstName: 'A', surname: 'B', dateOfBirth: '2000-01-01' }),
    ).catch((e) => e);
    const withScope = await createPatient(
      registration({ phone: '+211900000099', firstName: 'A', surname: 'B', dateOfBirth: '2000-01-01' }),
      DESK_A1_SCOPE,
    ).catch((e) => e);
    expect(withoutScope.fields.duplicate).toContain('Wiring');
    expect(withScope.fields.duplicate).not.toContain('Wiring');
  });
});

describe('getPatientById: scoped reads', () => {
  test('returns the document when no scope is given (unchanged default behaviour)', async () => {
    const p = await seedPatient({ _id: 'pat-a1', orgId: ORG_A, registrationHospital: HOSP_A1 });
    const doc = await getPatientById(p._id);
    expect(doc?._id).toBe('pat-a1');
  });

  test('returns the document when the scope includes it', async () => {
    await seedPatient({ _id: 'pat-a1b', orgId: ORG_A, registrationHospital: HOSP_A1 });
    const doc = await getPatientById('pat-a1b', DESK_A1_SCOPE);
    expect(doc?._id).toBe('pat-a1b');
  });

  test('returns null for a document outside the scope\'s facility', async () => {
    await seedPatient({ _id: 'pat-a2', orgId: ORG_A, registrationHospital: HOSP_A2 });
    const doc = await getPatientById('pat-a2', DESK_A1_SCOPE);
    expect(doc).toBeNull();
  });

  test('returns null for a document outside the scope\'s organisation', async () => {
    await seedPatient({ _id: 'pat-b1', orgId: ORG_B, registrationHospital: HOSP_B1 });
    const doc = await getPatientById('pat-b1', DESK_A1_SCOPE);
    expect(doc).toBeNull();
  });

  test('an org_admin scope sees every facility in the org but not another org', async () => {
    await seedPatient({ _id: 'pat-a2-admin', orgId: ORG_A, registrationHospital: HOSP_A2 });
    await seedPatient({ _id: 'pat-b1-admin', orgId: ORG_B, registrationHospital: HOSP_B1 });
    const adminScope: DataScope = { orgId: ORG_A, role: 'org_admin' };
    expect((await getPatientById('pat-a2-admin', adminScope))?._id).toBe('pat-a2-admin');
    expect(await getPatientById('pat-b1-admin', adminScope)).toBeNull();
  });

  test('a super_admin scope bypasses org/facility narrowing entirely', async () => {
    await seedPatient({ _id: 'pat-b1-super', orgId: ORG_B, registrationHospital: HOSP_B1 });
    const doc = await getPatientById('pat-b1-super', { role: 'super_admin' });
    expect(doc?._id).toBe('pat-b1-super');
  });

  test('a non-existent id returns null with or without a scope', async () => {
    expect(await getPatientById('pat-does-not-exist')).toBeNull();
    expect(await getPatientById('pat-does-not-exist', DESK_A1_SCOPE)).toBeNull();
  });
});
