/**
 * A patient's portal write must be filed under an organisation, or no clinic
 * can see it. Ownership comes from records the server holds — the facility the
 * write is about, else the patient's registration — never from the request.
 */
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs } from '../helpers/test-db';
import { patientsDB, hospitalsDB } from '@/lib/db';
import { resolvePortalOwnership, missingOwnership } from '@/lib/patient-portal-ownership';
import { portalDocId, validatePortalMessage } from '@/lib/patient-portal-write-validation';

const now = '2026-10-08T00:00:00.000Z';

beforeEach(async () => {
  await patientsDB().put({
    _id: 'pat-1', type: 'patient', orgId: 'org-moh-ss', registrationHospital: 'hosp-001',
    firstName: 'Deng', surname: 'Garang', createdAt: now, updatedAt: now,
  } as never);
  await hospitalsDB().put({ _id: 'hosp-001', type: 'hospital', name: 'Juba Teaching', orgId: 'org-moh-ss', createdAt: now, updatedAt: now } as never);
  await hospitalsDB().put({ _id: 'hosp-mercy', type: 'hospital', name: 'Mercy Clinic', orgId: 'org-mercy', createdAt: now, updatedAt: now } as never);
  // Shares the hospitals database, and is not a facility.
  await hospitalsDB().put({ _id: 'system-config', type: 'system_config', orgId: 'org-other', createdAt: now, updatedAt: now } as never);
});
afterEach(async () => { await teardownTestDBs(); });

it('files a write with no facility under the patient’s own organisation and facility', async () => {
  expect(await resolvePortalOwnership('pat-1')).toMatchObject({ orgId: 'org-moh-ss', facilityId: 'hosp-001' });
});

it('honours a named facility only inside the patient’s own organisation', async () => {
  await hospitalsDB().put({ _id: 'hosp-002', type: 'hospital', name: 'Wau Teaching', orgId: 'org-moh-ss', createdAt: now, updatedAt: now } as never);
  const owner = await resolvePortalOwnership('pat-1', 'hosp-002');
  expect(owner).toMatchObject({ orgId: 'org-moh-ss', facilityId: 'hosp-002' });
  expect(owner.foreignFacility).toBeUndefined();
});

it('never files into another organisation because its facility was named', async () => {
  // Stamping org-mercy here would replicate a patient's unverified payment or
  // appointment straight into another tenant's queue.
  const owner = await resolvePortalOwnership('pat-1', 'hosp-mercy');
  expect(owner).toMatchObject({ orgId: 'org-moh-ss', facilityId: 'hosp-001', foreignFacility: true });
});

it('ignores a facility id the server does not know, rather than trusting it', async () => {
  expect(await resolvePortalOwnership('pat-1', 'hosp-made-up')).toMatchObject({ orgId: 'org-moh-ss', facilityId: 'hosp-001' });
});

it('does not take an organisation from a non-facility document in the same database', async () => {
  expect(await resolvePortalOwnership('pat-1', 'system-config')).toMatchObject({ orgId: 'org-moh-ss', facilityId: 'hosp-001' });
});

it('returns no owner for a patient it cannot find, instead of inventing one', async () => {
  const owner = await resolvePortalOwnership('pat-missing');
  expect(owner.orgId).toBeUndefined();
  expect(owner.facilityId).toBeUndefined();
  expect(missingOwnership(owner)).toBe(true);
});

describe('what a portal request may supply', () => {
  const uuid = () => '11111111-2222-3333-4444-555555555555';

  it('accepts a proposed id only in the shape the server would have generated', () => {
    expect(portalDocId('apt-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'apt', uuid)).toBe('apt-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    for (const hostile of ['_design/steal', '_local/x', 'pat-00001', 'pmt-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', '', 42, undefined]) {
      expect(portalDocId(hostile, 'apt', uuid)).toBe(`apt-${uuid()}`);
    }
  });

  it('requires a message to say something, and bounds how much', () => {
    expect(validatePortalMessage({ body: '   ' }).ok).toBe(false);
    expect(validatePortalMessage({ body: 'x'.repeat(4001) }).ok).toBe(false);
    expect(validatePortalMessage({ body: 'Hello', subject: 's'.repeat(201) }).ok).toBe(false);
    expect(validatePortalMessage({ body: '  Is my result back?  ' })).toEqual({
      ok: true, value: { body: 'Is my result back?', subject: '(no subject)', department: undefined, patientPhone: '' },
    });
  });
});
