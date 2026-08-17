/**
 * Fixture builders for the nurse-worklist test (assembleNurseWorklist).
 * Reuses the patient/triage builders and the shared id sequence from the
 * doctor module's fixtures so the two suites stay consistent, and adds
 * builders for the nurse-specific docs (admission, rooming entry, MAR entry,
 * shift handoff).
 */
import type { EncounterDoc, FollowUpDoc, ShiftHandoffDoc } from '@/lib/db-types';
import type { AdmissionDoc } from '@/lib/db-types-ward';
import type { RoomingWorklistEntry } from '@/lib/services/rooming-service';
import type { MAREntry } from '@/components/nurse/shared';
import { makePatient, makeTriage, nextId, resetFixtureSeq } from '../doctor/fixtures';

export { makePatient, makeTriage, nextId, resetFixtureSeq };

export function makeAdmission(overrides: Partial<AdmissionDoc> = {}): AdmissionDoc {
  const _id = overrides._id || nextId('admission');
  return {
    _id,
    type: 'admission',
    createdAt: '2026-08-04T08:00:00.000Z',
    updatedAt: '2026-08-04T08:00:00.000Z',
    patientId: overrides.patientId || 'patient-1',
    patientName: 'Test Patient',
    admissionDate: '2026-08-04',
    admittingDiagnosis: 'Malaria',
    severity: 'moderate',
    admittedBy: 'nurse-1',
    admittedByName: 'Nurse Stella',
    wardId: 'ward-1',
    wardName: 'General Ward',
    bedNumber: 'B-01',
    facilityId: 'hosp-001',
    facilityName: 'Juba Teaching Hospital',
    facilityLevel: 'county',
    attendingPhysician: 'doctor-1',
    attendingPhysicianName: 'Dr. Test',
    isolationRequired: false,
    status: 'admitted',
    followUpRequired: false,
    state: 'Central Equatoria',
    ...overrides,
  } as AdmissionDoc;
}

export function makeRoomingEntry(overrides: {
  step?: RoomingWorklistEntry['step'];
  waitingMinutes?: number;
  encounter?: Partial<EncounterDoc>;
} = {}): RoomingWorklistEntry {
  const encounterOverrides: Partial<EncounterDoc> = overrides.encounter || {};
  const _id = encounterOverrides._id || nextId('encounter');
  return {
    step: 'awaiting_rooming',
    waitingMinutes: 10,
    ...overrides,
    encounter: {
      _id,
      type: 'clinical_encounter',
      createdAt: '2026-08-04T08:00:00.000Z',
      updatedAt: '2026-08-04T08:00:00.000Z',
      patientId: 'patient-1',
      patientName: 'Test Patient',
      clinicianId: '',
      clinicianName: '',
      hospitalId: 'hosp-001',
      status: 'arrived_at_clinic_awaiting_rooming',
      stageKey: 'clinic_intake_rooming',
      snapshot: {},
      labOrderIds: [],
      startedAt: '2026-08-04T08:00:00.000Z',
      ...encounterOverrides,
    },
  } as RoomingWorklistEntry;
}

export function makeMarEntry(overrides: Partial<MAREntry> = {}): MAREntry {
  const id = overrides.id || nextId('mar');
  return {
    id,
    time: '08:00',
    patientId: 'patient-1',
    patientName: 'Test Patient',
    medication: 'Amoxicillin',
    dose: '500mg',
    route: 'PO',
    status: 'due',
    prescriptionId: 'rx-1',
    frequency: 'BD',
    scheduledFor: '2026-08-04T08:00:00.000Z',
    ...overrides,
  } as MAREntry;
}

export function makeHandoff(overrides: Partial<ShiftHandoffDoc> = {}): ShiftHandoffDoc {
  const _id = overrides._id || nextId('handoff');
  return {
    _id,
    type: 'shift_handoff',
    createdAt: '2026-08-04T07:00:00.000Z',
    updatedAt: '2026-08-04T07:00:00.000Z',
    shiftDate: '2026-08-04',
    shift: 'day',
    outgoingNurseId: 'nurse-outgoing',
    outgoingNurseName: 'Nurse Outgoing',
    patients: [],
    signedAt: '2026-08-04T07:00:00.000Z',
    status: 'signed',
    ...overrides,
  } as ShiftHandoffDoc;
}

// Local to this suite (not shared with the doctor module): a follow-up
// fixture for the "Follow-ups due" outstanding-items rail. Mirrors the
// doctor worklist test's own local `makeFollowUp`.
export function makeFollowUp(overrides: Partial<FollowUpDoc> = {}): FollowUpDoc {
  const _id = overrides._id || nextId('followup');
  return {
    _id,
    type: 'follow_up',
    createdAt: '2026-08-04T08:00:00.000Z',
    updatedAt: '2026-08-04T08:00:00.000Z',
    patientId: 'patient-1',
    patientName: 'Test Patient',
    assignedWorker: 'worker-1',
    assignedWorkerName: 'CHV Test',
    status: 'active',
    condition: 'Malaria follow-up',
    facilityLevel: 'county',
    scheduledDate: '2026-08-04',
    state: 'Central Equatoria',
    county: 'Juba',
    ...overrides,
  } as FollowUpDoc;
}
