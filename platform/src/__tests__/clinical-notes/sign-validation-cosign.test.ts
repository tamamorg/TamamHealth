/**
 * Sign validation (required sections per note type), the co-sign request path,
 * and copy-forward into a draft.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs } from '../helpers/test-db';
import type { DataScope } from '@/lib/services/data-scope';

const SUPER_SCOPE = { role: 'super_admin' } as DataScope;
import {
  createClinicalNote, saveNoteSection, signClinicalNote, cosignClinicalNote,
  getClinicalNoteById, copyForwardIntoDraft, findLastSignedNote,
  missingRequiredSections, hasContent, NoteIncompleteError, NoteSigningAuthorizationError,
} from '@/lib/clinical-notes/note-service';
import { ValidationError } from '@/lib/validation';
import { NOTE_TYPE_ORDER, requiredSectionsFor } from '@/lib/clinical-notes/note-catalog';

afterEach(async () => { await teardownTestDBs(); });

const doctor = { signedBy: 'user-dr-wani', signedByName: 'Dr. Wani', signerRole: 'doctor' };

async function draft(noteType: 'soap' | 'hp' | 'memo_to_record' = 'soap', serviceDate = '2026-08-08') {
  return createClinicalNote({
    patientId: 'pat-00001', patientName: 'Nyakuma Deng', noteType, serviceDate,
    authorId: 'user-dr-wani', authorName: 'Dr. Wani',
    assignedToId: 'user-dr-wani', assignedToName: 'Dr. Wani',
    hospitalId: 'hosp-001', orgId: 'org-moh-ss',
  });
}

describe('required sections on sign', () => {
  it('catalog: every pickable type has required sections, and amendment is not pickable', () => {
    for (const id of NOTE_TYPE_ORDER) expect(requiredSectionsFor(id).length).toBeGreaterThan(0);
    expect(NOTE_TYPE_ORDER).not.toContain('amendment');
  });

  it('refuses a consultation with only Subjective filled and names Assessment and Plan', async () => {
    const note = await draft();
    await saveNoteSection(note._id, 'subjective', { text: 'Fever for three days.' });
    const err = await signClinicalNote(note._id, doctor).catch(e => e);
    expect(err).toBeInstanceOf(NoteIncompleteError);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as NoteIncompleteError).missing).toEqual(['assessment', 'plan']);
    expect((err as Error).message).toMatch(/Assessment, Plan/);
    expect((await getClinicalNoteById(note._id))?.status).toBe('draft');
  });

  it('counts coded diagnoses as Assessment content', async () => {
    const note = await draft();
    await saveNoteSection(note._id, 'assessment', {
      diagnoses: [{ id: 'd1', name: 'Malaria', icd11Code: '1F40', addedAt: '2026-08-08T08:00:00Z' }],
    });
    await saveNoteSection(note._id, 'plan', { text: 'Artesunate, review in 48h.' });
    expect(hasContent((await getClinicalNoteById(note._id))!)).toBe(true);
    const signed = await signClinicalNote(note._id, doctor);
    expect(signed?.status).toBe('signed');
  });

  it('an assessment holding only diagnosis cards is not "empty" for hasContent', () => {
    expect(hasContent({ sections: [{ sectionId: 'assessment', diagnoses: [{ id: 'x', name: 'Cough', addedAt: '' }] }] })).toBe(true);
    expect(missingRequiredSections({ noteType: 'soap', sections: [
      { sectionId: 'assessment', text: '  ' }, { sectionId: 'plan', text: 'Rest' },
    ] })).toEqual(['assessment']);
  });

  it('a memo needs only its memo body', async () => {
    const note = await draft('memo_to_record');
    await saveNoteSection(note._id, 'memo', { text: 'Called family.' });
    expect((await signClinicalNote(note._id, doctor))?.status).toBe('signed');
  });
});

describe('co-sign', () => {
  async function ready() {
    const note = await draft();
    await saveNoteSection(note._id, 'assessment', { text: 'Malaria.' });
    await saveNoteSection(note._id, 'plan', { text: 'Treat.' });
    return note;
  }

  it('signs as awaiting_cosign and records the requested cosigner', async () => {
    const note = await ready();
    const parked = await signClinicalNote(note._id, {
      signedBy: 'user-dr-wani', signedByName: 'Dr. Wani', signerRole: 'doctor',
      requestCosignFrom: { id: 'user-dr-achol', name: 'Dr. Achol' },
    });
    expect(parked?.status).toBe('awaiting_cosign');
    expect(parked?.cosignRequestedId).toBe('user-dr-achol');
    expect(parked?.cosignRequestedName).toBe('Dr. Achol');
    expect(parked?.signedBy).toBe('user-dr-wani');
  });

  it('a different provider can co-sign; the signer and non-providers cannot', async () => {
    const note = await ready();
    await signClinicalNote(note._id, {
      ...doctor, requestCosignFrom: { id: 'user-dr-achol', name: 'Dr. Achol' },
    });
    await expect(cosignClinicalNote(note._id, 'user-dr-wani', 'Dr. Wani', 'doctor'))
      .rejects.toThrow(NoteSigningAuthorizationError);
    await expect(cosignClinicalNote(note._id, 'user-nurse-1', 'Nurse A', 'rooming_nurse'))
      .rejects.toThrow(NoteSigningAuthorizationError);
    const done = await cosignClinicalNote(note._id, 'user-dr-achol', 'Dr. Achol', 'doctor');
    expect(done?.status).toBe('signed');
    expect(done?.cosignedBy).toBe('user-dr-achol');
  });
});

describe('copy forward into a draft', () => {
  it('copies narrative from the last signed note of the type; never derived text, diagnoses or signature', async () => {
    const old = await draft('soap', '2026-07-01');
    await saveNoteSection(old._id, 'subjective', { text: 'Old complaint.' });
    await saveNoteSection(old._id, 'vitals', { snapshot: 'Temp: 39 C', text: 'derived text' });
    await saveNoteSection(old._id, 'assessment', {
      text: 'Old assessment.',
      diagnoses: [{ id: 'd1', name: 'Malaria', addedAt: '2026-07-01T08:00:00Z' }],
    });
    await saveNoteSection(old._id, 'plan', { text: 'Old plan.' });
    await signClinicalNote(old._id, doctor);

    const fresh = await draft('soap', '2026-08-08');
    const source = await findLastSignedNote('pat-00001', 'soap', SUPER_SCOPE, fresh._id);
    expect(source?._id).toBe(old._id);

    const copied = await copyForwardIntoDraft(fresh._id, SUPER_SCOPE);
    const by = (id: string) => copied!.sections.find(s => s.sectionId === id)!;
    expect(by('subjective').text).toBe('Old complaint.');
    expect(by('plan').text).toBe('Old plan.');
    expect(by('assessment').diagnoses ?? []).toHaveLength(0);
    expect(by('vitals').snapshot).toBeUndefined();
    expect(by('vitals').text || '').toBe('');
    expect(copied?.status).toBe('draft');
    expect(copied?.signedBy).toBeUndefined();
    expect(copied?.copiedFromId).toBe(old._id);
  });

  it('returns null when there is nothing signed to copy from', async () => {
    const fresh = await draft();
    expect(await copyForwardIntoDraft(fresh._id, SUPER_SCOPE)).toBeNull();
  });
});

describe('a note awaiting co-signature is not editable', () => {
  it('refuses section writes once signed for co-signature', async () => {
    const svc = await import('@/lib/clinical-notes/note-service');
    const note = await svc.createClinicalNote({
      patientId: 'pat-cosign-lock', patientName: 'Lock Test', patientMrn: 'M-1', patientDob: '1990-01-01',
      noteType: 'soap', authorId: 'user-co', authorName: 'CO Deng', serviceDate: '2026-10-17',
    } as never);
    await svc.saveNoteSection(note._id, 'subjective', { text: 'Fever for two days.' });
    await svc.saveNoteSection(note._id, 'assessment', { text: 'Malaria, uncomplicated.' });
    await svc.saveNoteSection(note._id, 'plan', { text: 'Artemether-lumefantrine.' });
    await svc.signClinicalNote(note._id, { signedBy: 'user-co', signedByName: 'CO Deng', signerRole: 'clinical_officer', awaitingCosign: true } as never);
    await expect(svc.saveNoteSection(note._id, 'plan', { text: 'Changed after signing.' })).rejects.toThrow();
  });
});
