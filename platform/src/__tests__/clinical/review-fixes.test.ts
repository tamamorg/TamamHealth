/**
 * Regressions for defects the post-implementation review found in the
 * gap-fix batch itself.
 *
 * 1. Dismissal from `in_facility_checkout` threw an illegal transition; the
 *    throw was swallowed by the desk's best-effort wrapper and the appointment
 *    bridge then re-closed the visit as a routine `discharged` — the opposite
 *    of the disposition the clerk selected and audited.
 * 2. Escalation on a patient still `awaiting_triage` always threw: the machine
 *    has no such edge by design (escalation asserts an assessment), but the
 *    button was offered from clerical check-in onward — exactly the window a
 *    deteriorating patient needs it.
 * 3. The critical-result task's name→id resolver scanned the whole directory,
 *    so a unique same-named clinician in ANOTHER org could receive a task
 *    naming a patient they have no relationship with.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { usersDB } from '@/lib/db';
import {
  createEncounter, dischargeEncounter, transitionEncounter,
  escalateEncounterToEmergency, getEncounter,
} from '@/lib/services/encounter-service';
import { createLabResult, updateLabResult } from '@/lib/services/lab-service';
import { getTasks } from '@/lib/services/clinician-task-service';

afterEach(async () => {
  await teardownTestDBs();
});

async function encounterAt(status: string, orgId = 'org-moh-ss') {
  return createEncounter({
    patientId: 'pat-00001', patientName: 'Nyakuma Deng',
    clinicianId: 'user-dr-wani', clinicianName: 'Dr. Wani',
    hospitalId: 'hosp-001', orgId,
    status, snapshot: {}, labOrderIds: [],
    startedAt: new Date().toISOString(),
  } as never);
}

describe('walk-out from inside facility checkout', () => {
  it('records a terminal disposition instead of throwing and falling back to routine discharge', async () => {
    const enc = await encounterAt('in_facility_checkout');

    const done = await dischargeEncounter(enc._id, {
      disposition: 'dismissed_without_formal_checkout',
      actorId: 'doctor', actorRole: 'doctor', reason: 'Patient left before checkout',
    });

    // `dismissed_without_formal_checkout` is illegal from here (the patient is
    // already IN checkout), so the closest honest terminal is used — and
    // critically it is NOT a plain `discharged`, which would erase the fact
    // that the visit ended with items outstanding.
    expect(done?.status).toBe('discharged_with_pending_items');
    expect(done?.closedAt).toBeTruthy();
  });

  it('still walks a pre-checkout visit all the way to a true dismissal', async () => {
    const enc = await encounterAt('awaiting_facility_checkout');
    const done = await dischargeEncounter(enc._id, {
      disposition: 'dismissed_without_formal_checkout',
      actorId: 'doctor', actorRole: 'doctor', reason: 'Patient left before checkout',
    });
    expect(done?.status).toBe('dismissed_without_formal_checkout');
  });
});

describe('escalating a patient who has not been triaged yet', () => {
  it('is reachable by taking the visit into triage first (the one legal hop)', async () => {
    const enc = await encounterAt('awaiting_triage');

    // What the UI now does: assess, then escalate.
    await transitionEncounter(enc._id, 'in_triage', { actorId: 'user-dr-wani', actorRole: 'doctor' });
    const escalated = await escalateEncounterToEmergency(enc._id, { actorId: 'user-dr-wani' });

    expect(escalated.status).toBe('escalated_to_emergency');
    // The trail records the assessment hop rather than inventing an escalation
    // out of a queue state.
    const trail = (await getEncounter(enc._id))?.statusHistory ?? [];
    expect(trail.map(h => h.to)).toEqual(
      expect.arrayContaining(['in_triage', 'escalated_to_emergency']),
    );
  });

  it('still refuses a bare escalation straight from the queue', async () => {
    const enc = await encounterAt('awaiting_triage');
    await expect(escalateEncounterToEmergency(enc._id, { actorId: 'user-dr-wani' }))
      .rejects.toThrow(/Illegal encounter transition/);
  });
});

describe('critical-result task delivery is org-constrained', () => {
  async function seedUser(id: string, name: string, orgId: string) {
    await putDoc(usersDB(), {
      _id: id, type: 'user', username: id, name, role: 'doctor',
      hospitalId: 'hosp-001', orgId, isActive: true,
    } as never);
  }

  it('does not deliver a patient-naming task to a same-named clinician in another org', async () => {
    await seedUser('user-other-org', 'Dr. John Deng', 'org-private');

    const order = await createLabResult({
      patientId: 'pat-00001', patientName: 'Nyakuma Deng',
      testName: 'Potassium', status: 'pending', result: '', unit: '',
      referenceRange: '3.5-5.0', abnormal: false, critical: false,
      orderedBy: 'Dr. John Deng',
      orderedAt: new Date().toISOString(), completedAt: '',
      hospitalId: 'hosp-001', orgId: 'org-moh-ss',
    } as never);

    await updateLabResult(order._id, {
      critical: true, abnormal: true, orderStatus: 'resulted',
      status: 'completed', result: '7.2', unit: 'mmol/L',
    });

    expect(await getTasks('user-other-org')).toHaveLength(0);
    // Falls back to the name key — visible to the name-matching notification
    // feed, delivered to no other org's worklist.
    expect(await getTasks('Dr. John Deng')).toHaveLength(1);
  });

  it('still delivers to a unique same-org match', async () => {
    await seedUser('user-same-org', 'Dr. John Deng', 'org-moh-ss');

    const order = await createLabResult({
      patientId: 'pat-00001', patientName: 'Nyakuma Deng',
      testName: 'Potassium', status: 'pending', result: '', unit: '',
      referenceRange: '3.5-5.0', abnormal: false, critical: false,
      orderedBy: 'Dr. John Deng',
      orderedAt: new Date().toISOString(), completedAt: '',
      hospitalId: 'hosp-001', orgId: 'org-moh-ss',
    } as never);

    await updateLabResult(order._id, {
      critical: true, abnormal: true, orderStatus: 'resulted',
      status: 'completed', result: '7.2', unit: 'mmol/L',
    });

    expect(await getTasks('user-same-org')).toHaveLength(1);
  });
});
