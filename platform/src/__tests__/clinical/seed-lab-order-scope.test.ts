/**
 * GitHub #85 — the demo seed's lab bench must never dead-end.
 *
 * QA on the standalone demo found that most of `lab.gatluak`'s "Collect"-stage
 * bench rows led nowhere: some referenced a patient with no seeded document at
 * all ("Patient not found"), others referenced a real patient registered at a
 * DIFFERENT facility than the order claimed — which `filterByScope` (scoped by
 * the patient's own `registrationHospital`) silently drops from a
 * single-facility viewer's patient list, so the chart's fallback lookup also
 * comes up empty. Root cause: `generatePatient` (src/data/mock.ts) round-robins
 * the roster across all four staffed hospitals, but two places in db-seed.ts
 * didn't account for that —
 *   1. the hand-authored `labOrders` (lab-001..010) assumed every core-roster
 *      "showcase" patient (pat-00001..50) lives at hosp-001, when several of
 *      them generate to a different hospital;
 *   2. the "Generated clinical activity for the extended roster" block
 *      (pat-00087+) hardcoded hospitalId 'hosp-001' on every lab/rx/
 *      appointment/triage record regardless of where that patient actually
 *      registered.
 *
 * These tests run the REAL seedDatabase() against in-memory PouchDB and
 * inspect what it actually wrote — not a re-derivation of the generator's own
 * logic — so a regression here means an actual demo browser would reproduce
 * the bug.
 */
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.mock('@/modules/identity/client', () => ({
  generateTempPassword: () => 'x',
  hashPassword: async () => 'hash',
}));

import { teardownTestDBs, createDBMock } from '../helpers/test-db';

type Doc = Record<string, unknown>;

afterEach(async () => {
  await teardownTestDBs();
});

async function runSeedAndLoad() {
  process.env.NEXT_PUBLIC_DEMO_MODE = 'true';
  const { seedDatabase } = await import('@/lib/db-seed');
  await seedDatabase();

  const mockDb = createDBMock() as unknown as {
    patientsDB: () => PouchDB.Database;
    labResultsDB: () => PouchDB.Database;
  };
  const patientRows = (await mockDb.patientsDB().allDocs({ include_docs: true })).rows;
  const patientsById = new Map(patientRows.map(r => [r.id, r.doc as unknown as Doc]));
  const labRows = (await mockDb.labResultsDB().allDocs({ include_docs: true })).rows;
  const labDocs = labRows.map(r => r.doc as unknown as Doc);

  return { patientsById, labDocs };
}

describe('demo seed: lab order / patient scope consistency (GitHub #85)', () => {
  it('seeds a non-trivial lab bench', async () => {
    const { labDocs } = await runSeedAndLoad();
    expect(labDocs.length).toBeGreaterThan(50);
  }, 60000);

  it('every seeded lab_result references a patient that actually exists', async () => {
    const { patientsById, labDocs } = await runSeedAndLoad();

    const missing = labDocs
      .filter(l => !patientsById.has(l.patientId as string))
      .map(l => ({ labId: l._id, patientId: l.patientId }));

    expect(missing).toEqual([]);
  }, 60000);

  it('every seeded lab_result\'s hospital matches its own patient\'s registered hospital', async () => {
    const { patientsById, labDocs } = await runSeedAndLoad();

    const mismatches = labDocs
      .map(l => {
        const patient = patientsById.get(l.patientId as string);
        return { l, patient };
      })
      .filter(({ l, patient }) => {
        if (!patient) return false; // covered by the "patient exists" test above
        const patientHospital = patient.registrationHospital as string | undefined;
        const labHospital = l.hospitalId as string | undefined;
        return !!patientHospital && !!labHospital && patientHospital !== labHospital;
      })
      .map(({ l, patient }) => ({
        labId: l._id,
        patientId: l.patientId,
        labHospitalId: l.hospitalId,
        patientRegistrationHospital: patient!.registrationHospital,
      }));

    expect(mismatches).toEqual([]);
  }, 60000);

  it('every seeded lab_result\'s org matches its patient\'s org', async () => {
    const { patientsById, labDocs } = await runSeedAndLoad();

    const mismatches = labDocs
      .map(l => ({ l, patient: patientsById.get(l.patientId as string) }))
      .filter(({ l, patient }) => !!patient && !!l.orgId && !!patient.orgId && l.orgId !== patient.orgId)
      .map(({ l, patient }) => ({ labId: l._id, labOrgId: l.orgId, patientOrgId: patient!.orgId }));

    expect(mismatches).toEqual([]);
  }, 60000);

  it('the hand-authored showcase orders lab-001..010 are seeded with their documented patient and critical flag', async () => {
    const { patientsById, labDocs } = await runSeedAndLoad();
    const byId = new Map(labDocs.map(l => [l._id as string, l]));

    // Patient + critical flag as described in db-seed.ts's own labOrders array
    // (lab-005 — Kuol Akot Ajith's Hb 4.2 g/dL — is the one "already resulted,
    // critical" order QA specifically flagged as unreachable).
    const expected: Record<string, { patientId: string; critical: boolean }> = {
      'lab-001': { patientId: 'pat-00001', critical: false },
      'lab-002': { patientId: 'pat-00005', critical: false },
      'lab-003': { patientId: 'pat-00012', critical: false },
      'lab-004': { patientId: 'pat-00018', critical: false },
      'lab-005': { patientId: 'pat-00022', critical: true },
      'lab-006': { patientId: 'pat-00030', critical: false },
      'lab-007': { patientId: 'pat-00035', critical: false },
      'lab-008': { patientId: 'pat-00040', critical: false },
      'lab-009': { patientId: 'pat-00008', critical: false },
      'lab-010': { patientId: 'pat-00015', critical: false },
    };

    for (const [id, exp] of Object.entries(expected)) {
      const doc = byId.get(id);
      expect(doc).toBeDefined();
      expect(doc?.patientId).toBe(exp.patientId);
      expect(doc?.critical).toBe(exp.critical);

      // And the patient behind it must be visible from the SAME facility the
      // order claims — the exact chain that 404'd before this fix.
      const patient = patientsById.get(exp.patientId);
      expect(patient).toBeDefined();
      expect(patient?.registrationHospital).toBe(doc?.hospitalId);
    }
  }, 60000);
});
