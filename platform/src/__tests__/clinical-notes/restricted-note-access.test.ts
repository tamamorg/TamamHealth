/**
 * Restricted clinical-note read gate (security audit 2026-11-05, H4).
 *
 * A mental-health note is an ordinary clinical_note today, visible to every
 * canViewClinical role. It must now read like a missing doc for a viewer
 * without routine access — super_admin / medical_superintendent / a psychiatry
 * clinician / the note's own author — while ordinary notes are unaffected.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-rn` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs } from '../helpers/test-db';
import { createClinicalNote, getClinicalNoteById, listClinicalNotes } from '@/lib/clinical-notes/note-service';
import { mayViewRestrictedClinicalNote, isRestrictedNoteType } from '@/lib/clinical-notes/restricted-note-access';
import type { DataScope } from '@/lib/services/data-scope';

afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

const PSY_AUTHOR = 'psy-doc-1';
async function seed() {
  const mh = await createClinicalNote({
    patientId: 'pat-1', patientName: 'A B', noteType: 'mental_health',
    serviceDate: '2026-11-06', authorId: PSY_AUTHOR, authorName: 'Dr Psy', orgId: 'org-a',
  } as never);
  const soap = await createClinicalNote({
    patientId: 'pat-1', patientName: 'A B', noteType: 'soap',
    serviceDate: '2026-11-06', authorId: 'gp-1', authorName: 'Dr GP', orgId: 'org-a',
  } as never);
  return { mhId: mh._id, soapId: soap._id };
}

const nurse: DataScope = { role: 'nurse', orgId: 'org-a', userId: 'n-1' };
const psychiatrist: DataScope = { role: 'doctor', orgId: 'org-a', userId: 'x', specialtyCode: 'psychiatry' as never };
const medSupt: DataScope = { role: 'medical_superintendent', orgId: 'org-a', userId: 'm-1' };
const author: DataScope = { role: 'doctor', orgId: 'org-a', userId: PSY_AUTHOR };

describe('restricted note read gate — service', () => {
  it('hides a mental-health note from a nurse but shows the soap note', async () => {
    const { mhId, soapId } = await seed();
    expect(await getClinicalNoteById(mhId, nurse)).toBeNull();
    expect(await getClinicalNoteById(soapId, nurse)).not.toBeNull();
    const list = await listClinicalNotes({ patientId: 'pat-1' }, nurse);
    expect(list.map(n => n.noteType)).not.toContain('mental_health');
    expect(list.map(n => n.noteType)).toContain('soap');
  });

  it('shows the mental-health note to a psychiatrist, the med superintendent, and the author', async () => {
    const { mhId } = await seed();
    expect(await getClinicalNoteById(mhId, psychiatrist)).not.toBeNull();
    expect(await getClinicalNoteById(mhId, medSupt)).not.toBeNull();
    expect(await getClinicalNoteById(mhId, author)).not.toBeNull();
  });
});

describe('mayViewRestrictedClinicalNote — policy matrix', () => {
  const mh = { noteType: 'mental_health', authorId: 'author-x' };
  it('allows routine roles, psychiatry, and the author; denies others', () => {
    expect(mayViewRestrictedClinicalNote({ role: 'super_admin' } as DataScope, mh)).toBe(true);
    expect(mayViewRestrictedClinicalNote({ role: 'medical_superintendent' } as DataScope, mh)).toBe(true);
    expect(mayViewRestrictedClinicalNote({ role: 'doctor', specialtyCode: 'psychiatry' } as never, mh)).toBe(true);
    expect(mayViewRestrictedClinicalNote({ role: 'nurse', userId: 'author-x' } as DataScope, mh)).toBe(true);
    expect(mayViewRestrictedClinicalNote({ role: 'nurse', userId: 'someone' } as DataScope, mh)).toBe(false);
    expect(mayViewRestrictedClinicalNote({ role: 'cashier' } as DataScope, mh)).toBe(false);
  });
  it('never restricts an ordinary note type', () => {
    expect(isRestrictedNoteType('soap')).toBe(false);
    expect(mayViewRestrictedClinicalNote({ role: 'cashier' } as DataScope, { noteType: 'soap' })).toBe(true);
  });
  it('a missing scope (server/internal) is not narrowed', () => {
    expect(mayViewRestrictedClinicalNote(undefined, mh)).toBe(true);
  });
});
