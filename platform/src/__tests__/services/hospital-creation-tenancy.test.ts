/**
 * A facility must be created inside an organisation, or it is not created at
 * all.
 *
 * The bug this pins: Settings → Manage created hospitals from a form object
 * that had no `orgId` field at all (`/org-admin/hospitals` and `/api/hospitals`
 * both stamped one). The local write succeeded and the page toasted "Hospital
 * created successfully", but the record was inert:
 *
 *   • CouchDB's tenant validator refuses every document without an `orgId`, so
 *     the facility never left the device it was typed on.
 *   • `filterByScope` requires an `orgId` match for every role except
 *     super_admin and government, so even on that device it was invisible to
 *     the organization that had just created it.
 *
 * The visible symptom is an org admin reading "Active Facilities 0" on a
 * dashboard whose staff-account count is populated — staff come from
 * `/api/users` on the server, facilities from the scoped local replica, so the
 * two disagree.
 *
 * Nothing can infer a facility's org the way a patient's is inferred from
 * their registration facility, so the refusal lives in the writer and the
 * callers supply the tenant.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs } from '../helpers/test-db';
import { createHospital, getAllHospitals } from '@/lib/services/hospital-service';
import { hospitalsDB } from '@/lib/db';
import type { HospitalDoc } from '@/lib/db-types';

const ORG = 'org-moh-ss';

afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

/** The create payload, minus whatever the caller wants to vary. */
function facility(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Mercy General Hospital',
    state: 'Central Equatoria',
    town: 'Juba',
    facilityType: 'state_hospital',
    totalBeds: 120, icuBeds: 8, maternityBeds: 20, pediatricBeds: 10,
    doctors: 0, clinicalOfficers: 0, nurses: 0, labTechnicians: 0, pharmacists: 0,
    hasElectricity: true, electricityHours: 24, hasGenerator: true, hasSolar: false,
    hasInternet: true, internetType: 'fibre', hasAmbulance: true, emergency24hr: true,
    services: [], lat: 0, lng: 0,
    orgId: ORG,
    ...overrides,
  } as unknown as Parameters<typeof createHospital>[0];
}

describe('facility creation resolves the organisation', () => {
  test('the supplied organisation is what gets stored', async () => {
    const hospital = await createHospital(facility());
    expect(hospital.orgId).toBe(ORG);
  });

  test('no orgId is refused, naming the field to fix', async () => {
    await expect(createHospital(facility({ orgId: undefined })))
      .rejects.toMatchObject({
        name: 'ValidationError',
        fields: { orgId: expect.stringContaining('organization') },
      });
  });

  test('a refused creation writes nothing', async () => {
    await expect(createHospital(facility({ orgId: undefined }))).rejects.toThrow();
    const saved = await createHospital(facility());
    const all = await hospitalsDB().allDocs({ include_docs: true });
    const hospitals = all.rows
      .map(r => r.doc as unknown as HospitalDoc)
      .filter(d => d?.type === 'hospital');
    expect(hospitals).toHaveLength(1);
    expect(hospitals[0]._id).toBe(saved._id);
  });

  test('the organisation is what makes the facility visible to its own org admin', async () => {
    const saved = await createHospital(facility());
    const scope = { orgId: ORG, role: 'org_admin' as const };
    await expect(getAllHospitals(scope)).resolves.toEqual([
      expect.objectContaining({ _id: saved._id }),
    ]);

    // The pre-fix shape, written straight past the writer: present in the
    // database, invisible to the organization looking at it. This is the
    // "Active Facilities 0" reading.
    await hospitalsDB().put({
      _id: 'hosp-orphan', type: 'hospital', name: 'Orphaned Clinic',
    } as unknown as { _id: string });
    const visible = await getAllHospitals(scope);
    expect(visible.map(h => h._id)).not.toContain('hosp-orphan');
    expect(visible).toHaveLength(1);
  });

  test('another organisation cannot see it', async () => {
    await createHospital(facility());
    await expect(getAllHospitals({ orgId: 'org-other', role: 'org_admin' }))
      .resolves.toEqual([]);
  });
});
