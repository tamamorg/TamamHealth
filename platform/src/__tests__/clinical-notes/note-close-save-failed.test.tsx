/**
 * Closing a note writes what was still waiting on its autosave timer. When
 * that last write fails nothing on screen is left to carry the error, so the
 * clinician has to be told: the words they typed did not reach the record.
 * Real note-service against the in-memory DB; only the final write is failed.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/notes/x',
  useSearchParams: () => new URLSearchParams(),
}));
const mockShowToast = jest.fn();
jest.mock('@/components/Toast', () => ({ useToast: () => ({ showToast: mockShowToast }) }));
jest.mock('@/components/ConfirmDialog', () => ({ useConfirm: () => jest.fn(async () => true) }));
// One stable object, as the real hook returns (see note-sign-and-close.test).
jest.mock('@/lib/hooks/useDataScope', () => {
  const scope = { role: 'doctor', orgId: 'org-moh-ss', hospitalId: 'hosp-001' };
  return { useDataScope: () => scope };
});
jest.mock('@/lib/hooks/useUnsavedChangesWarning', () => ({
  useUnsavedChangesWarning: () => ({ confirmNavigation: () => true }),
}));

let mockFailSaves = false;
jest.mock('@/lib/clinical-notes/note-service', () => {
  const actual = jest.requireActual('@/lib/clinical-notes/note-service');
  return {
    ...actual,
    saveNoteSection: (...args: unknown[]) => (mockFailSaves
      ? Promise.reject(new Error('disk full'))
      : actual.saveNoteSection(...args)),
  };
});

import { act } from 'react';
import { teardownTestDBs } from '../helpers/test-db';
import { flush, mountAndFlush, setValue, type Mounted } from '../components/clinical-notes/test-utils';
import ClinicalNoteEditor from '@/components/clinical-notes/ClinicalNoteEditor';
import { createClinicalNote, getClinicalNoteById } from '@/lib/clinical-notes/note-service';

const DOCTOR = { _id: 'user-dr-wani', name: 'Dr. Wani', role: 'doctor', orgId: 'org-moh-ss' };
const FAILED = 'Note not saved. Try again.';

let mounted: Mounted | null = null;
const subjective = () => mounted!.container.querySelector<HTMLTextAreaElement>('#cn-section-subjective textarea');

async function settle(until: () => boolean) {
  for (let attempt = 0; attempt < 60 && !until(); attempt++) {
    await act(async () => { await flush(); });
  }
}

async function openNote() {
  const note = await createClinicalNote({
    patientId: 'pat-00001', patientName: 'Test User', noteType: 'soap',
    serviceDate: '2026-10-08', authorId: DOCTOR._id, authorName: DOCTOR.name,
    assignedToId: DOCTOR._id, assignedToName: DOCTOR.name,
    hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: 'org-moh-ss',
  } as never);
  mounted = await mountAndFlush(<ClinicalNoteEditor noteId={note._id} currentUser={DOCTOR} showContextSidebar={false} />);
  await settle(() => !!subjective());
  return note;
}

async function typeThenClose(text: string) {
  setValue(subjective()!, text);
  mounted!.unmount();
  mounted = null;
  await act(async () => { await flush(); });
}

beforeEach(() => {
  mockFailSaves = false;
  mockShowToast.mockClear();
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
});

afterAll(async () => {
  await teardownTestDBs();
});

describe('clinical note — closing with an edit still unsaved', () => {
  it('saves the waiting edit and says nothing when the write succeeds', async () => {
    const note = await openNote();

    await typeThenClose('Fever for three days.');

    await settle(() => false);
    expect(mockShowToast).not.toHaveBeenCalled();
    expect((await getClinicalNoteById(note._id))?.sections.find(s => s.sectionId === 'subjective')?.text)
      .toBe('Fever for three days.');
  });

  it('tells the clinician when the last write fails', async () => {
    await openNote();
    mockFailSaves = true;

    await typeThenClose('Fever for three days.');

    await settle(() => mockShowToast.mock.calls.length > 0);
    expect(mockShowToast).toHaveBeenCalledWith(FAILED, 'error', { placement: 'corner' });
  });
});
