/**
 * A doctor signing the consultation note for a visit the front desk checked in
 * (encounter still at `awaiting_triage`) must carry the visit all the way to
 * `ready_for_clinic_checkout`, so the desk can check the patient out.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs } from '../helpers/test-db';
import { createClinicalNote, saveNoteSection, signClinicalNote } from '@/lib/clinical-notes/note-service';
import { createEncounter, getEncounter } from '@/lib/services/encounter-service';

afterEach(async () => { await teardownTestDBs(); });

const PATIENT_ID = 'pat-00001';
const DOCTOR_ID = 'user-dr-wani';
const HOSP = 'hosp-001';
const ORG = 'org-moh-ss';

describe('signClinicalNote from a desk check-in', () => {
  it.each(['awaiting_triage', 'routed_to_clinic'] as const)('moves a %s visit to ready_for_clinic_checkout', async (status) => {
    const enc = await createEncounter({
      patientId: PATIENT_ID, patientName: 'Deng Garang',
      clinicianId: '', clinicianName: '', hospitalId: HOSP, orgId: ORG,
      status, snapshot: {}, labOrderIds: [], startedAt: new Date().toISOString(),
    } as never);
    const note = await createClinicalNote({
      patientId: PATIENT_ID, patientName: 'Deng Garang', noteType: 'soap',
      serviceDate: '2026-10-17', encounterId: enc._id,
      authorId: DOCTOR_ID, authorName: 'Dr. Wani', assignedToId: DOCTOR_ID, assignedToName: 'Dr. Wani',
      hospitalId: HOSP, orgId: ORG,
    } as never);
    await saveNoteSection(note._id, 'subjective', { text: 'Fever for three days.' });
    await saveNoteSection(note._id, 'assessment', { text: 'Clinical malaria.' });
    await saveNoteSection(note._id, 'plan', { text: 'Treat and review.' });

    await signClinicalNote(note._id, { signedBy: DOCTOR_ID, signedByName: 'Dr. Wani', signerRole: 'doctor' });

    expect((await getEncounter(enc._id))?.status).toBe('ready_for_clinic_checkout');
  });
});
