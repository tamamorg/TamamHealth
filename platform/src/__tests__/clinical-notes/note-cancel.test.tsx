/**
 * Cancel on an unsigned note: nothing typed beyond the triage prefill is
 * discarded without a question; anything the clinician wrote asks first
 * (Keep draft / Discard draft / Back to note). Real note-service against the
 * in-memory DB; only the confirm answer is scripted.
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
const mockConfirm = jest.fn();
jest.mock('@/components/ConfirmDialog', () => ({ useConfirm: () => mockConfirm }));
jest.mock('@/lib/hooks/useDataScope', () => {
  const scope = { role: 'doctor', orgId: 'org-moh-ss', hospitalId: 'hosp-001' };
  return { useDataScope: () => scope };
});
jest.mock('@/lib/hooks/useUnsavedChangesWarning', () => ({
  useUnsavedChangesWarning: () => ({ confirmNavigation: () => true }),
}));

import { act } from 'react';
import { teardownTestDBs } from '../helpers/test-db';
import { flush, mountAndFlush, setValue, type Mounted } from '../components/clinical-notes/test-utils';
import ClinicalNoteEditor from '@/components/clinical-notes/ClinicalNoteEditor';
import {
  createClinicalNote, getClinicalNoteById, hasTypedContentBeyondPrefill,
} from '@/lib/clinical-notes/note-service';

const DOCTOR = { _id: 'user-dr-wani', name: 'Dr. Wani', role: 'doctor', orgId: 'org-moh-ss' };
let mounted: Mounted | null = null;
const onClose = jest.fn();
const subjective = () => mounted!.container.querySelector<HTMLTextAreaElement>('#cn-section-subjective textarea');
const cancelButton = () => mounted!.container.querySelector<HTMLButtonElement>('.omf-bar-btn--secondary');

async function settle(until: () => boolean) {
  for (let attempt = 0; attempt < 60 && !until(); attempt++) await act(async () => { await flush(); });
}

async function openNote() {
  const note = await createClinicalNote({
    patientId: 'pat-00001', patientName: 'Test User', noteType: 'soap',
    serviceDate: '2026-10-08', authorId: DOCTOR._id, authorName: DOCTOR.name,
    assignedToId: DOCTOR._id, assignedToName: DOCTOR.name,
    hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: 'org-moh-ss',
  } as never);
  mounted = await mountAndFlush(
    <ClinicalNoteEditor noteId={note._id} currentUser={DOCTOR} layout="workspace" showContextSidebar={false} onClose={onClose} />,
  );
  await settle(() => !!subjective());
  return note;
}

async function pressCancel() {
  await act(async () => { cancelButton()!.click(); await flush(); });
  await settle(() => onClose.mock.calls.length > 0 || mockConfirm.mock.calls.length > 0);
}

beforeEach(() => { mockShowToast.mockClear(); mockConfirm.mockReset(); onClose.mockClear(); });
afterEach(() => { mounted?.unmount(); mounted = null; document.body.innerHTML = ''; });
afterAll(async () => { await teardownTestDBs(); });

describe('hasTypedContentBeyondPrefill', () => {
  const note = (text: string, diagnoses: unknown[] = []) => ({
    sections: [{ sectionId: 'cc', text, diagnoses }],
  }) as never;
  it('treats empty and prefill-only text as nothing typed', () => {
    expect(hasTypedContentBeyondPrefill(note(''))).toBe(false);
    expect(hasTypedContentBeyondPrefill(note('Cough'), { cc: 'Cough' })).toBe(false);
  });
  it('counts added wording, a diagnosis or a different text as typed', () => {
    expect(hasTypedContentBeyondPrefill(note('Cough for 3 days'), { cc: 'Cough' })).toBe(true);
    expect(hasTypedContentBeyondPrefill(note('Fever'))).toBe(true);
    expect(hasTypedContentBeyondPrefill(note('', [{ code: 'X' }]))).toBe(true);
  });
});

describe('note editor — Cancel', () => {
  it('discards an untouched note without asking', async () => {
    const note = await openNote();
    await pressCancel();
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(await getClinicalNoteById(note._id)).toBeNull();
  });

  it('asks when the clinician typed something, and Discard removes the note', async () => {
    const note = await openNote();
    setValue(subjective()!, 'Fever for three days.');
    mockConfirm.mockImplementation(async (opts: { onAlternate?: () => void }) => { opts.onAlternate?.(); return false; });
    await pressCancel();
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
      confirmLabel: 'Keep draft', alternateLabel: 'Discard draft', cancelLabel: 'Back to note',
    }));
    await settle(() => onClose.mock.calls.length > 0);
    expect(await getClinicalNoteById(note._id)).toBeNull();
  });

  it('Keep draft saves it, and Back to note leaves everything as it is', async () => {
    const note = await openNote();
    setValue(subjective()!, 'Fever for three days.');
    mockConfirm.mockResolvedValueOnce(false); // Back to note
    await pressCancel();
    expect(onClose).not.toHaveBeenCalled();
    expect(await getClinicalNoteById(note._id)).not.toBeNull();

    mockConfirm.mockResolvedValueOnce(true); // Keep draft
    await pressCancel();
    await settle(() => onClose.mock.calls.length > 0);
    expect(onClose).toHaveBeenCalled();
    expect((await getClinicalNoteById(note._id))?.sections.find(s => s.sectionId === 'subjective')?.text)
      .toBe('Fever for three days.');
  });
});
