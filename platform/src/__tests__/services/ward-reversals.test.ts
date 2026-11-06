/**
 * cancelAdmission (admission made in error) and undoDischarge (same-day).
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-wuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.mock('@/lib/services/audit-service', () => ({
  logAudit: jest.fn(async () => undefined),
  logAuditSafe: jest.fn(async () => undefined),
}));

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { getDB, medicationAdministrationsDB, prescriptionsDB } from '@/lib/db';
import { createEncounter, getEncounter } from '@/lib/services/encounter-service';
import {
  admitPatient, cancelAdmission, undoDischarge, dischargePatient, getAllAdmissions, WardWorkflowError,
} from '@/lib/services/ward-service';
import { findUndoDischargeBlocker } from '@/lib/ward-reversal-rules';
import { DOC_WRITE_ROLES } from '@/lib/sync/write-permissions';
import { WARD_DISCHARGE_ROLES } from '@/lib/clinical-flow/ward-permissions';

afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

const doctor = { id: 'user-dr', name: 'Dr. Wani', role: 'doctor' as const };
const nurse = { id: 'user-n', name: 'Nurse', role: 'nurse' as const };
const wards = () => getDB('tamamhealth_wards');

async function setup() {
  await putDoc(wards(), { _id: 'ward-1', type: 'ward', name: 'Ward 1', facilityId: 'hosp-1', totalBeds: 2, occupiedBeds: 0, availableBeds: 2, orgId: 'org-1', isActive: true } as never);
  for (const n of ['B1', 'B2']) {
    await putDoc(wards(), { _id: `bed-${n}`, type: 'bed', bedNumber: n, wardId: 'ward-1', wardName: 'Ward 1', facilityId: 'hosp-1', status: 'available', orgId: 'org-1' } as never);
  }
  const enc = await createEncounter({
    patientId: 'pat-1', patientName: 'Pat One', clinicianId: 'user-dr', clinicianName: 'Dr. Wani',
    hospitalId: 'hosp-1', orgId: 'org-1', status: 'with_clinician', snapshot: {}, labOrderIds: [],
    startedAt: new Date().toISOString(),
  } as never);
  const admission = await admitPatient({
    patientId: 'pat-1', patientName: 'Pat One', admittingDiagnosis: 'x', severity: 'moderate',
    admittedBy: 'user-dr', admittedByName: 'Dr. Wani', wardId: 'ward-1', wardName: 'Ward 1',
    bedId: 'bed-B1', bedNumber: 'B1', facilityId: 'hosp-1', facilityName: 'H', facilityLevel: 'county' as never,
    attendingPhysician: 'user-dr', attendingPhysicianName: 'Dr. Wani', state: 'CES', orgId: 'org-1',
    encounterId: enc._id,
  } as never, { id: 'user-dr', role: 'doctor' });
  return { enc, admission };
}

const discharge = (id: string) => dischargePatient(id, {
  dischargeType: 'normal', dischargeDiagnosis: 'Resolved', dischargeSummary: 'Well', dischargedBy: 'user-dr',
  dischargedByName: 'Dr. Wani', medicationReconciled: true,
});

describe('cancelAdmission', () => {
  test('frees the bed, fixes ward counts, returns the visit to its stage and stamps who/when/why', async () => {
    const { enc, admission } = await setup();
    expect((await getEncounter(enc._id))?.status).toBe('admitted');
    const cancelled = await cancelAdmission(admission._id, ' wrong patient ', doctor);
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelReason: 'wrong patient', cancelledBy: 'user-dr', cancelledByName: 'Dr. Wani' });
    expect(cancelled.cancelledAt).toBeTruthy();
    const bed = await wards().get('bed-B1') as { status: string; currentAdmissionId?: string };
    expect(bed.status).toBe('available');
    expect(bed.currentAdmissionId).toBeUndefined();
    expect((await wards().get('ward-1') as { occupiedBeds: number }).occupiedBeds).toBe(0);
    const visit = await getEncounter(enc._id);
    expect(visit?.status).toBe('with_clinician');
    expect(visit?.closedAt).toBeUndefined();
    expect(visit?.statusHistory?.at(-1)).toMatchObject({ from: 'admitted', to: 'with_clinician', reason: 'wrong patient' });
  });

  test('refuses without a reason and for roles that cannot discharge', async () => {
    const { admission } = await setup();
    await expect(cancelAdmission(admission._id, ' ', doctor)).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    await expect(cancelAdmission(admission._id, 'x', nurse)).rejects.toMatchObject({ code: 'ROLE_NOT_ALLOWED' });
    expect((await getAllAdmissions())[0].status).toBe('admitted');
  });

  test('refuses once medication has been recorded or the admission is a day old', async () => {
    const { admission } = await setup();
    await putDoc(prescriptionsDB(), { _id: 'rx-1', type: 'prescription', patientId: 'pat-1', admissionId: admission._id, status: 'pending', medication: 'X' } as never);
    await putDoc(medicationAdministrationsDB(), {
      _id: 'mar-1', type: 'medication_administration', eventKind: 'administration', prescriptionId: 'rx-1',
      patientId: 'pat-1', admissionId: admission._id, status: 'given', scheduledFor: new Date().toISOString(),
    } as never);
    await expect(cancelAdmission(admission._id, 'x', doctor)).rejects.toMatchObject({ code: 'NOT_REVERSIBLE' });

    const old = await wards().get(admission._id) as { admissionDate: string };
    await wards().put({ ...old, admissionDate: new Date(Date.now() - 30 * 3_600_000).toISOString() } as never);
    await medicationAdministrationsDB().remove(await medicationAdministrationsDB().get('mar-1'));
    await expect(cancelAdmission(admission._id, 'x', doctor)).rejects.toThrow(/more than a day old/);
  });

  test('stops open inpatient orders that were never given', async () => {
    const { admission } = await setup();
    await putDoc(prescriptionsDB(), { _id: 'rx-2', type: 'prescription', patientId: 'pat-1', admissionId: admission._id, status: 'pending', medication: 'X' } as never);
    await cancelAdmission(admission._id, 'wrong patient', doctor);
    expect((await prescriptionsDB().get('rx-2') as { status: string }).status).toBe('discontinued');
  });

  test('refuses when deposit money is held', async () => {
    const { admission } = await setup();
    const row = await wards().get(admission._id);
    await wards().put({ ...row, admissionDepositPaid: 50 } as never);
    await expect(cancelAdmission(admission._id, 'x', doctor)).rejects.toThrow(/deposit/);
  });
});

describe('undoDischarge', () => {
  test('reopens in the same bed, keeps what was reversed, and leaves the visit alone', async () => {
    const { enc, admission } = await setup();
    await discharge(admission._id);
    expect((await wards().get('bed-B1') as { status: string }).status).toBe('cleaning');
    const reopened = await undoDischarge(admission._id, 'discharged the wrong chart', doctor);
    expect(reopened).toMatchObject({ status: 'admitted', bedId: 'bed-B1' });
    expect(reopened.dischargeDate).toBeUndefined();
    expect(reopened.dischargeReversals).toHaveLength(1);
    expect(reopened.dischargeReversals![0]).toMatchObject({ by: 'user-dr', reason: 'discharged the wrong chart', reversed: { dischargeDiagnosis: 'Resolved' } });
    expect(await wards().get('bed-B1')).toMatchObject({ status: 'occupied', currentAdmissionId: admission._id });
    expect((await getEncounter(enc._id))?.status).toBe('admitted');
  });

  test('asks for a bed when the old one was taken, then reopens in the chosen bed', async () => {
    const { admission } = await setup();
    await discharge(admission._id);
    const bed = await wards().get('bed-B1');
    await wards().put({ ...bed, status: 'occupied', currentAdmissionId: 'adm-other' } as never);
    await expect(undoDischarge(admission._id, 'x', doctor)).rejects.toMatchObject({ code: 'BED_NOT_AVAILABLE' });
    const reopened = await undoDischarge(admission._id, 'x', doctor, { wardId: 'ward-1', wardName: 'Ward 1', bedId: 'bed-B2', bedNumber: 'B2' });
    expect(reopened.bedId).toBe('bed-B2');
    expect(await wards().get('bed-B2')).toMatchObject({ status: 'occupied', currentAdmissionId: admission._id });
  });

  test('refuses another day, other closures, no reason, wrong role and a second active admission', async () => {
    const { admission } = await setup();
    await discharge(admission._id);
    await expect(undoDischarge(admission._id, ' ', doctor)).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    await expect(undoDischarge(admission._id, 'x', nurse)).rejects.toMatchObject({ code: 'ROLE_NOT_ALLOWED' });

    const row = await wards().get(admission._id) as { dischargeDate: string };
    expect(findUndoDischargeBlocker({ ...row, status: 'discharged', dischargeDate: new Date(Date.now() - 48 * 3_600_000).toISOString() } as never)).toMatch(/day it was made/);
    expect(findUndoDischargeBlocker({ ...row, status: 'deceased' } as never)).toMatch(/Only a discharged/);

    await putDoc(wards(), { _id: 'adm-2', type: 'admission', patientId: 'pat-1', facilityId: 'hosp-1', status: 'admitted', wardName: 'W', admissionDate: new Date().toISOString() } as never);
    await expect(undoDischarge(admission._id, 'x', doctor)).rejects.toMatchObject({ code: 'DUPLICATE_ADMISSION' });
    expect((await getAllAdmissions()).find(a => a._id === admission._id)?.status).toBe('discharged');
  });

  test('an error is a WardWorkflowError', async () => {
    await expect(cancelAdmission('adm-missing', 'x', doctor)).rejects.toBeInstanceOf(WardWorkflowError);
  });
});

test('every role that may discharge writes admissions in full at sync', () => {
  const writers = DOC_WRITE_ROLES.admission as readonly string[];
  for (const role of WARD_DISCHARGE_ROLES) expect(writers).toContain(role);
});
