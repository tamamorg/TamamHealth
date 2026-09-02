/**
 * Discharge dispositions + the imaging-aware order anchor + the warn-only
 * capability check. Before these, `dischargeEncounter` could only produce
 * two of the four documented Stage-10 dispositions (every referral hand-off
 * and walk-out reported as a routine discharge), imaging orders parked the
 * visit at `awaiting_labs`, and no transition recorded capability violations.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { putDoc, teardownTestDBs } from '../helpers/test-db';
import { patientsDB } from '@/lib/db';
import { getPatientById } from '@/lib/services/patient-service';
import {
  createEncounter,
  dischargeEncounter,
  ensureLabOrderEncounter,
  transitionEncounter,
  getEncounter,
} from '@/lib/services/encounter-service';

afterEach(async () => {
  await teardownTestDBs();
});

async function encounterAt(status: string) {
  return createEncounter({
    patientId: 'pat-00001', patientName: 'Nyakuma Deng',
    clinicianId: 'user-dr-wani', clinicianName: 'Dr. Wani',
    hospitalId: 'hosp-001', orgId: 'org-moh-ss',
    status, snapshot: {}, labOrderIds: [],
    startedAt: new Date().toISOString(),
  } as never);
}

describe('dischargeEncounter dispositions', () => {
  it('walks to discharged_with_referral when asked', async () => {
    const enc = await encounterAt('ready_for_clinic_checkout');
    const done = await dischargeEncounter(enc._id, { disposition: 'discharged_with_referral' });
    expect(done?.status).toBe('discharged_with_referral');
    expect(done?.closedAt).toBeTruthy();
  });

  it('records a walk-out as dismissed_without_formal_checkout, stopping before facility checkout', async () => {
    const enc = await encounterAt('ready_for_clinic_checkout');
    const done = await dischargeEncounter(enc._id, { disposition: 'dismissed_without_formal_checkout' });
    expect(done?.status).toBe('dismissed_without_formal_checkout');
    // The trail must show the dismissal came FROM awaiting_facility_checkout —
    // the only status it is legal from.
    const trail = done?.statusHistory ?? [];
    expect(trail[trail.length - 1]).toMatchObject({
      from: 'awaiting_facility_checkout',
      to: 'dismissed_without_formal_checkout',
    });
  });

  it('keeps the legacy pendingItems flag working', async () => {
    const enc = await encounterAt('ready_for_clinic_checkout');
    const done = await dischargeEncounter(enc._id, { pendingItems: true });
    expect(done?.status).toBe('discharged_with_pending_items');
  });

  it('clears the matching patient assignment when the visit is discharged', async () => {
    await putDoc(patientsDB(), {
      _id: 'pat-00001', type: 'patient', orgId: 'org-moh-ss',
      firstName: 'Nyakuma', surname: 'Deng',
      assignedDoctor: 'user-dr-wani', assignedDoctorName: 'Dr. Wani',
      assignedNurse: 'nurse-1', assignedNurseName: 'Nurse One',
      assignmentStatus: 'assigned', registrationHospital: 'hosp-001',
    } as never);
    const enc = await createEncounter({
      patientId: 'pat-00001', patientName: 'Nyakuma Deng',
      clinicianId: 'user-dr-wani', clinicianName: 'Dr. Wani',
      assignedClinicianId: 'user-dr-wani', assignedNurseId: 'nurse-1',
      hospitalId: 'hosp-001', orgId: 'org-moh-ss',
      status: 'ready_for_clinic_checkout', snapshot: {}, labOrderIds: [],
      startedAt: new Date().toISOString(),
    } as never);

    await dischargeEncounter(enc._id, { actorId: 'user-frontdesk-1' });
    expect(await getPatientById('pat-00001')).toMatchObject({ assignmentStatus: 'completed' });
    expect((await getPatientById('pat-00001'))?.assignedDoctor).toBeUndefined();
    expect((await getPatientById('pat-00001'))?.assignedNurse).toBeUndefined();
  });
});

describe('ensureLabOrderEncounter imaging modality', () => {
  it('parks an imaging order at awaiting_imaging', async () => {
    const open = await encounterAt('with_clinician');
    const anchored = await ensureLabOrderEncounter({
      patientId: 'pat-00001', patientName: 'Nyakuma Deng',
      hospitalId: 'hosp-001', orgId: 'org-moh-ss',
      clinicianId: 'user-dr-wani', to: 'awaiting_imaging',
    });
    expect(anchored._id).toBe(open._id);
    expect(anchored.status).toBe('awaiting_imaging');
  });

  it('creates an imaging desk encounter for a walk-in study', async () => {
    const anchored = await ensureLabOrderEncounter({
      patientId: 'pat-00002', patientName: 'Deng Mabior',
      hospitalId: 'hosp-001', orgId: 'org-moh-ss', to: 'awaiting_imaging',
    });
    expect(anchored.status).toBe('awaiting_imaging');
  });
});

describe('warn-only capability check', () => {
  it('does not block a transition the role lacks capability for (records, not refuses)', async () => {
    const enc = await encounterAt('awaiting_triage');
    // A doctor holds no `triage` capability — the engine would refuse this;
    // the service records the violation and proceeds (migration step 1).
    const moved = await transitionEncounter(enc._id, 'in_triage', {
      actorId: 'user-dr-wani', actorRole: 'doctor',
    });
    expect(moved.status).toBe('in_triage');
    expect((await getEncounter(enc._id))?.status).toBe('in_triage');
  });
});
