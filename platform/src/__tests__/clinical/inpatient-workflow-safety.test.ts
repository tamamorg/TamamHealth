/**
 * Safety properties for the offline inpatient workflow. These use the real
 * PouchDB service layer so revision races behave the way two browser tabs do.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-ward-test` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { followUpsDB, prescriptionsDB, wardDB } from '@/lib/db';
import { putDoc, teardownTestDBs } from '../helpers/test-db';
import {
  admitPatient,
  completeBedTurnover,
  dischargePatient,
  reassignAdmissionBed,
  WardWorkflowError,
} from '@/lib/services/ward-service';
import {
  createPrescription,
  getPrescriptionsByPatient,
  recordAdministration,
  voidAdministration,
  MedicationAdministrationError,
} from '@/lib/services/prescription-service';
import type { PrescriptionDoc } from '@/lib/db-types';
import type { AdmissionDoc, BedDoc, WardDoc } from '@/lib/db-types-ward';

const ORG = 'org-1';
const FACILITY = 'hosp-1';

afterEach(async () => {
  await teardownTestDBs();
  uuidCounter = 0;
});

async function seedWard(): Promise<void> {
  await putDoc(wardDB(), {
    _id: 'ward-1', type: 'ward', name: 'Medical Ward', wardType: 'general_male',
    facilityId: FACILITY, facilityName: 'Tamam Hospital', facilityLevel: 'county',
    totalBeds: 1, occupiedBeds: 0, availableBeds: 1, isActive: true, orgId: ORG,
  } as WardDoc);
  await putDoc(wardDB(), {
    _id: 'bed-1', type: 'bed', bedNumber: 'M-01', wardId: 'ward-1', wardName: 'Medical Ward',
    facilityId: FACILITY, status: 'available', orgId: ORG,
  } as BedDoc);
}

function admissionInput(patientId: string, patientName: string) {
  return {
    patientId, patientName, admittingDiagnosis: 'Severe malaria', severity: 'severe' as const,
    admittedBy: 'user-doctor', admittedByName: 'Dr. Akol',
    wardId: 'ward-1', wardName: 'Medical Ward', bedId: 'bed-1', bedNumber: 'M-01',
    facilityId: FACILITY, facilityName: 'Tamam Hospital', facilityLevel: 'county' as const,
    attendingPhysician: 'user-doctor', attendingPhysicianName: 'Dr. Akol',
    state: 'Central Equatoria', orgId: ORG,
  };
}

describe('admission and bed invariants', () => {
  it('allows only one of two concurrent admissions to claim the same bed', async () => {
    await seedWard();

    const results = await Promise.allSettled([
      admitPatient(admissionInput('patient-a', 'Patient A')),
      admitPatient(admissionInput('patient-b', 'Patient B')),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const bed = await wardDB().get('bed-1') as BedDoc;
    expect(bed.status).toBe('occupied');
    expect(['patient-a', 'patient-b']).toContain(bed.currentPatientId);

    const admissions = await wardDB().allDocs({ include_docs: true });
    const active = admissions.rows
      .map(row => row.doc as AdmissionDoc | undefined)
      .filter(doc => doc?.type === 'admission' && doc.status === 'admitted');
    expect(active).toHaveLength(1);
    expect(active[0]?.patientId).toBe(bed.currentPatientId);
  });

  it('blocks a second active admission for the same patient', async () => {
    await seedWard();
    await admitPatient(admissionInput('patient-a', 'Patient A'));

    await expect(admitPatient({
      ...admissionInput('patient-a', 'Patient A'),
      bedId: undefined,
      bedNumber: undefined,
    })).rejects.toMatchObject<Partial<WardWorkflowError>>({ code: 'DUPLICATE_ADMISSION' });
  });

  it('requires a complete discharge and moves the bed to cleaning', async () => {
    await seedWard();
    const admission = await admitPatient(admissionInput('patient-a', 'Patient A'));

    await expect(dischargePatient(admission._id, {
      dischargeType: 'normal', dischargedBy: 'user-doctor', dischargedByName: 'Dr. Akol',
    })).rejects.toMatchObject<Partial<WardWorkflowError>>({ code: 'DISCHARGE_INCOMPLETE' });

    const discharged = await dischargePatient(admission._id, {
      dischargeType: 'normal', dischargeDiagnosis: 'Malaria, clinically recovered',
      dischargeSummary: 'Completed treatment and remained stable for 24 hours.',
      dischargedBy: 'user-doctor', dischargedByName: 'Dr. Akol',
      followUpRequired: true, followUpDate: '2026-08-31',
      followUpInstructions: 'Return to OPD; come earlier for fever or confusion.',
      medicationReconciled: true,
    });

    expect(discharged.status).toBe('discharged');
    const bed = await wardDB().get('bed-1') as BedDoc;
    expect(bed.status).toBe('cleaning');
    expect(bed.currentAdmissionId).toBeUndefined();
    const followUps = await followUpsDB().allDocs({ include_docs: true });
    expect(followUps.rows.map(row => (row.doc as { sourceVisitId?: string }).sourceVisitId)).toContain(admission._id);

    const ready = await completeBedTurnover('bed-1', { id: 'nurse-1', name: 'Nurse Nyandeng' });
    expect(ready.status).toBe('available');
    expect(ready.lastCleanedAt).toBeTruthy();
  });

  it('claims a destination before releasing the old bed during a move', async () => {
    await seedWard();
    await putDoc(wardDB(), {
      _id: 'bed-2', type: 'bed', bedNumber: 'M-02', wardId: 'ward-1', wardName: 'Medical Ward',
      facilityId: FACILITY, status: 'available', orgId: ORG,
    } as BedDoc);
    const admission = await admitPatient(admissionInput('patient-a', 'Patient A'));

    const moved = await reassignAdmissionBed(admission._id, {
      wardId: 'ward-1', wardName: 'Medical Ward', bedId: 'bed-2', bedNumber: 'M-02',
    });

    expect(moved.bedId).toBe('bed-2');
    const [oldBed, newBed] = await Promise.all([
      wardDB().get('bed-1') as Promise<BedDoc>,
      wardDB().get('bed-2') as Promise<BedDoc>,
    ]);
    expect(oldBed.status).toBe('cleaning');
    expect(newBed.status).toBe('occupied');
    expect(newBed.currentAdmissionId).toBe(admission._id);
  });
});

describe('MAR revision safety', () => {
  async function seedPrescription(): Promise<PrescriptionDoc> {
    await putDoc(wardDB(), {
      _id: 'admission-1', type: 'admission', patientId: 'patient-a', patientName: 'Patient A',
      admissionDate: '2026-08-24T05:00:00.000Z', admittingDiagnosis: 'Severe malaria', severity: 'severe',
      admittedBy: 'doctor-1', admittedByName: 'Dr. Akol', wardId: 'ward-1', wardName: 'Medical Ward',
      facilityId: FACILITY, facilityName: 'Tamam Hospital', facilityLevel: 'county',
      attendingPhysician: 'doctor-1', attendingPhysicianName: 'Dr. Akol', isolationRequired: false,
      status: 'admitted', followUpRequired: false, state: 'Central Equatoria', orgId: ORG,
      createdAt: '2026-08-24T05:00:00.000Z', updatedAt: '2026-08-24T05:00:00.000Z',
    } as AdmissionDoc);
    return putDoc(prescriptionsDB(), {
      _id: 'rx-1', type: 'prescription', patientId: 'patient-a', patientName: 'Patient A',
      medication: 'Artesunate', dose: '120 mg', route: 'IV', frequency: 'q12h', duration: '3 days',
      prescribedBy: 'Dr. Akol', status: 'pending', admissionId: 'admission-1',
      hospitalId: FACILITY, orgId: ORG, createdAt: '2026-08-24T06:00:00.000Z',
      updatedAt: '2026-08-24T06:00:00.000Z',
    } as PrescriptionDoc) as Promise<PrescriptionDoc>;
  }

  it('merges two different scheduled administrations after a 409 race', async () => {
    await seedPrescription();
    const base = {
      prescriptionId: 'rx-1', status: 'given' as const,
      administeredBy: 'nurse-1', administeredByName: 'Nurse Nyandeng',
    };

    await Promise.all([
      recordAdministration({ ...base, scheduledFor: '2026-08-24T06:00:00.000Z' }),
      recordAdministration({ ...base, scheduledFor: '2026-08-24T18:00:00.000Z' }),
    ]);

    const prescription = (await getPrescriptionsByPatient('patient-a'))[0];
    expect(prescription.administrations).toHaveLength(2);
    expect(new Set(prescription.administrations?.map(row => row.scheduledFor))).toEqual(new Set([
      '2026-08-24T06:00:00.000Z', '2026-08-24T18:00:00.000Z',
    ]));
  });

  it('refuses a second active record for the same scheduled dose', async () => {
    await seedPrescription();
    const input = {
      prescriptionId: 'rx-1', scheduledFor: '2026-08-24T06:00:00.000Z', status: 'given' as const,
      administeredBy: 'nurse-1', administeredByName: 'Nurse Nyandeng',
    };
    await recordAdministration(input);

    await expect(recordAdministration(input))
      .rejects.toMatchObject<Partial<MedicationAdministrationError>>({ code: 'DUPLICATE_DOSE' });
  });

  it('requires a reason when a dose is not given', async () => {
    await seedPrescription();
    await expect(recordAdministration({
      prescriptionId: 'rx-1', scheduledFor: '2026-08-24T06:00:00.000Z', status: 'held',
      administeredBy: 'nurse-1', administeredByName: 'Nurse Nyandeng',
    })).rejects.toMatchObject<Partial<MedicationAdministrationError>>({ code: 'REASON_REQUIRED' });
  });

  it('allows a voided dose to be recorded again while preserving its history', async () => {
    await seedPrescription();
    const first = await recordAdministration({
      prescriptionId: 'rx-1', scheduledFor: '2026-08-24T06:00:00.000Z', status: 'given',
      administeredBy: 'nurse-1', administeredByName: 'Nurse Nyandeng',
    });
    const administrationId = first.administrations?.[0]?.id;
    expect(administrationId).toBeTruthy();

    await voidAdministration('rx-1', administrationId!, 'nurse-1', 'Nurse Nyandeng', 'Wrong time selected');
    const corrected = await recordAdministration({
      prescriptionId: 'rx-1', scheduledFor: '2026-08-24T06:00:00.000Z', status: 'given',
      administeredBy: 'nurse-1', administeredByName: 'Nurse Nyandeng',
    });

    expect(corrected.administrations).toHaveLength(2);
    expect(corrected.administrations?.[0]?.voided).toBe(true);
    expect(corrected.administrations?.[1]?.voided).not.toBe(true);
  });

  it('links a new chart prescription to the patient active admission', async () => {
    await seedWard();
    const admission = await admitPatient({
      ...admissionInput('patient-a', 'Patient A'), bedId: undefined, bedNumber: undefined,
    });

    const result = await createPrescription({
      patientId: 'patient-a', patientName: 'Patient A', medication: 'Artesunate',
      dose: '120 mg', route: 'IV', frequency: 'q12h', duration: '3 days',
      prescribedBy: 'Dr. Akol', status: 'pending', hospitalId: FACILITY, orgId: ORG,
    });

    expect(result.prescription.admissionId).toBe(admission._id);
  });
});
