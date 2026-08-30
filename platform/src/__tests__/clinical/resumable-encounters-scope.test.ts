/**
 * `getResumableEncounters` used to accept an optional clinicianId and fell
 * through to "every clinician's paused encounters" when it was falsy, and
 * applied no tenant scope at all (KAN-100 audit item 8) — a hook mid-hydration
 * (no signed-in user yet) briefly listed every open encounter replicated to
 * the device, across every org. It is now required, returns [] when falsy,
 * and applies `filterByScope` like every sibling read in this module.
 *
 * Also covers item 5's discharge-side fix: dischargeEncounter marks the
 * patient's shared ConsultationProgressDoc 'completed' so a stale
 * "in progress" notification clears once the facility visit actually ends.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs } from '../helpers/test-db';
import {
  createEncounter, getResumableEncounters, dischargeEncounter, transitionEncounter,
} from '@/lib/services/encounter-service';
import { ensureConsultationProgress, getConsultationProgressByPatient } from '@/lib/services/consultation-progress-service';
import type { DataScope } from '@/lib/services/data-scope';

afterEach(async () => {
  await teardownTestDBs();
});

const DOCTOR_ID = 'user-dr-wani';

async function pausedEncounter(overrides: Record<string, unknown> = {}) {
  const enc = await createEncounter({
    patientId: 'pat-00001', patientName: 'Nyakuma Deng',
    clinicianId: DOCTOR_ID, clinicianName: 'Dr. Wani',
    hospitalId: 'hosp-001', orgId: 'org-moh-ss',
    status: 'with_clinician', snapshot: {}, labOrderIds: [],
    startedAt: new Date().toISOString(),
    ...overrides,
  } as never);
  return transitionEncounter(enc._id, 'consultation_paused_draft', { actorId: DOCTOR_ID });
}

describe('getResumableEncounters — required clinicianId + tenant scope', () => {
  it('returns [] for a falsy clinicianId instead of every clinician\'s paused encounters', async () => {
    await pausedEncounter();
    expect(await getResumableEncounters('')).toEqual([]);
  });

  it('excludes a paused encounter belonging to a different org when a scope is given', async () => {
    const enc = await pausedEncounter({ orgId: 'org-other' });
    const scope: DataScope = { role: 'doctor', orgId: 'org-moh-ss', hospitalId: 'hosp-001' };

    const withScope = await getResumableEncounters(DOCTOR_ID, scope);
    expect(withScope.map(e => e._id)).not.toContain(enc._id);
  });

  it('still returns the clinician\'s own paused encounter within their org scope', async () => {
    const enc = await pausedEncounter();
    const scope: DataScope = { role: 'doctor', orgId: 'org-moh-ss', hospitalId: 'hosp-001' };

    const withScope = await getResumableEncounters(DOCTOR_ID, scope);
    expect(withScope.map(e => e._id)).toContain(enc._id);
  });
});

describe('dischargeEncounter — clears the shared progress tracker', () => {
  it('marks the tracker completed once facility checkout reaches discharged', async () => {
    const enc = await createEncounter({
      patientId: 'pat-00001', patientName: 'Nyakuma Deng',
      clinicianId: DOCTOR_ID, clinicianName: 'Dr. Wani',
      hospitalId: 'hosp-001', orgId: 'org-moh-ss',
      status: 'ready_for_clinic_checkout', snapshot: {}, labOrderIds: [],
      startedAt: new Date().toISOString(),
    } as never);
    const tracker = await ensureConsultationProgress({
      patientId: 'pat-00001', patientName: 'Nyakuma Deng',
      hospitalId: 'hosp-001', orgId: 'org-moh-ss', encounterId: enc._id,
    });
    expect(tracker.currentStage).not.toBe('completed');

    const discharged = await dischargeEncounter(enc._id, { actorId: 'user-frontdesk-1' });
    expect(discharged?.status).toBe('discharged');

    const after = await getConsultationProgressByPatient('pat-00001');
    expect(after?.currentStage).toBe('completed');
  });
});
