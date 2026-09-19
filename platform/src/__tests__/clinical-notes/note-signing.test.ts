/**
 * Signing a clinical note is the medico-legal attestation AND what moves the
 * visit on (with_clinician → ready_for_clinic_checkout). Covers the
 * attestation-authority matrix — in particular a provider signing an
 * unassigned draft, which the editor broke by never passing `signerRole` —
 * plus the lock/addendum semantics and the encounter close-out side effect.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs } from '../helpers/test-db';
import {
  createClinicalNote,
  saveNoteSection,
  signClinicalNote,
  cosignClinicalNote,
  updateClinicalNote,
  NoteLockedError,
  NoteSigningAuthorizationError,
} from '@/lib/clinical-notes/note-service';
import { createEncounter, getEncounter } from '@/lib/services/encounter-service';

afterEach(async () => {
  await teardownTestDBs();
});

async function draftNote(overrides: Record<string, unknown> = {}) {
  const note = await createClinicalNote({
    patientId: 'pat-00001',
    patientName: 'Nyakuma Deng',
    noteType: 'soap',
    serviceDate: '2026-08-08',
    authorId: 'user-dr-wani',
    authorName: 'Dr. Wani',
    assignedToId: 'user-dr-wani',
    assignedToName: 'Dr. Wani',
    hospitalId: 'hosp-001',
    orgId: 'org-moh-ss',
    ...overrides,
  } as never);
  // A signature needs content to attest to.
  await saveNoteSection(note._id, 'subjective', { text: 'Fever for three days.' });
  return note;
}

describe('signClinicalNote — attestation authority', () => {
  it('lets the author sign their own draft', async () => {
    const note = await draftNote();
    const signed = await signClinicalNote(note._id, {
      signedBy: 'user-dr-wani', signedByName: 'Dr. Wani', signerRole: 'doctor',
    });
    expect(signed?.status).toBe('signed');
    expect(signed?.signedBy).toBe('user-dr-wani');
  });

  it('lets a provider role sign an unassigned draft they did not author', async () => {
    const note = await draftNote({ authorId: 'user-dr-achol', authorName: 'Dr. Achol', assignedToId: undefined, assignedToName: undefined });
    const signed = await signClinicalNote(note._id, {
      signedBy: 'user-dr-wani', signedByName: 'Dr. Wani', signerRole: 'doctor',
    });
    expect(signed?.status).toBe('signed');
  });

  it("refuses a signer with no role who is neither author nor assignee — the editor must pass signerRole", async () => {
    const note = await draftNote({ authorId: 'user-dr-achol', assignedToId: undefined });
    await expect(signClinicalNote(note._id, {
      signedBy: 'user-dr-wani', signedByName: 'Dr. Wani',
    })).rejects.toThrow(NoteSigningAuthorizationError);
  });

  it('refuses a workflow-station role signing a colleague draft', async () => {
    const note = await draftNote({ authorId: 'user-dr-achol', assignedToId: undefined });
    await expect(signClinicalNote(note._id, {
      signedBy: 'user-nurse-1', signedByName: 'Nurse A', signerRole: 'rooming_nurse',
    })).rejects.toThrow(NoteSigningAuthorizationError);
  });

  it('refuses to sign an empty note', async () => {
    const note = await createClinicalNote({
      patientId: 'pat-00001', patientName: 'Nyakuma Deng', noteType: 'soap',
      serviceDate: '2026-08-08', authorId: 'user-dr-wani',
    } as never);
    await expect(signClinicalNote(note._id, {
      signedBy: 'user-dr-wani', signedByName: 'Dr. Wani', signerRole: 'doctor',
    })).rejects.toThrow(/empty note/);
  });
});

describe('signClinicalNote — lock and visit close-out', () => {
  it('catches up a chart-started consultation from clinic arrival and creates the nursing handoff', async () => {
    const enc = await createEncounter({
      patientId: 'pat-00001', patientName: 'Nyakuma Deng',
      clinicianId: 'user-dr-wani', clinicianName: 'Dr. Wani',
      hospitalId: 'hosp-001', orgId: 'org-moh-ss',
      status: 'routed_to_clinic', snapshot: {}, labOrderIds: [],
      startedAt: new Date().toISOString(),
    } as never);
    const note = await draftNote({ encounterId: enc._id });
    await signClinicalNote(note._id, { signedBy: 'user-dr-wani', signedByName: 'Dr. Wani', signerRole: 'doctor' });
    const after = await getEncounter(enc._id);
    expect(after?.status).toBe('ready_for_clinic_checkout');
    expect(after?.postConsult?.tasks).toHaveLength(4);
  });

  it('does not advance clinic arrival when a nurse signs a nursing note', async () => {
    const enc = await createEncounter({
      patientId: 'pat-00001', patientName: 'Nyakuma Deng',
      clinicianId: 'user-dr-wani', clinicianName: 'Dr. Wani',
      hospitalId: 'hosp-001', orgId: 'org-moh-ss',
      status: 'routed_to_clinic', snapshot: {}, labOrderIds: [],
      startedAt: new Date().toISOString(),
    } as never);
    const note = await draftNote({ encounterId: enc._id, noteType: 'nurse_visit', authorId: 'nurse-1', assignedToId: 'nurse-1' });
    await signClinicalNote(note._id, { signedBy: 'nurse-1', signedByName: 'Nurse', signerRole: 'nurse' });
    expect((await getEncounter(enc._id))?.status).toBe('routed_to_clinic');
  });
  it('locks the note: edits after signing must go through an addendum', async () => {
    const note = await draftNote();
    await signClinicalNote(note._id, { signedBy: 'user-dr-wani', signedByName: 'Dr. Wani', signerRole: 'doctor' });
    await expect(updateClinicalNote(note._id, { serviceTime: '10:00' })).rejects.toThrow(NoteLockedError);
  });

  it('advances the linked with_clinician encounter to ready_for_clinic_checkout', async () => {
    const enc = await createEncounter({
      patientId: 'pat-00001', patientName: 'Nyakuma Deng',
      clinicianId: 'user-dr-wani', clinicianName: 'Dr. Wani',
      hospitalId: 'hosp-001', orgId: 'org-moh-ss',
      status: 'with_clinician', snapshot: {}, labOrderIds: [],
      startedAt: new Date().toISOString(),
    } as never);
    const note = await draftNote({ encounterId: enc._id });

    await signClinicalNote(note._id, { signedBy: 'user-dr-wani', signedByName: 'Dr. Wani', signerRole: 'doctor' });

    const after = await getEncounter(enc._id);
    expect(after?.status).toBe('ready_for_clinic_checkout');
    expect(after?.closedAt).toBeTruthy();
  });

  it('does NOT close the visit on a trainee signature awaiting co-sign', async () => {
    const enc = await createEncounter({
      patientId: 'pat-00001', patientName: 'Nyakuma Deng',
      clinicianId: 'user-dr-wani', clinicianName: 'Dr. Wani',
      hospitalId: 'hosp-001', orgId: 'org-moh-ss',
      status: 'with_clinician', snapshot: {}, labOrderIds: [],
      startedAt: new Date().toISOString(),
    } as never);
    const note = await draftNote({ encounterId: enc._id });

    await signClinicalNote(note._id, {
      signedBy: 'user-dr-wani', signedByName: 'Dr. Wani', signerRole: 'doctor', awaitingCosign: true,
    });

    expect((await getEncounter(enc._id))?.status).toBe('with_clinician');
  });
});

describe('cosignClinicalNote', () => {
  it('requires a provider role and a different signer', async () => {
    const note = await draftNote();
    await signClinicalNote(note._id, {
      signedBy: 'user-nurse-1', signedByName: 'Nurse A', signerRole: 'doctor', awaitingCosign: true,
    });

    await expect(cosignClinicalNote(note._id, 'user-nurse-2', 'Nurse B', 'nurse'))
      .rejects.toThrow(NoteSigningAuthorizationError);
    await expect(cosignClinicalNote(note._id, 'user-nurse-1', 'Nurse A', 'doctor'))
      .rejects.toThrow(/different provider/);

    const cosigned = await cosignClinicalNote(note._id, 'user-dr-wani', 'Dr. Wani', 'doctor');
    expect(cosigned?.status).toBe('signed');
    expect(cosigned?.cosignedBy).toBe('user-dr-wani');
  });
});
