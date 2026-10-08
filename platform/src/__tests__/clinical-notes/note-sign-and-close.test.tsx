/**
 * Signing a note from the editor: what was typed is in the signed record, and
 * the editor then closes onto the patient's Visits.
 *
 * Two things this pins. Sign used to lock the note while the last edit was
 * still waiting on its autosave timer — that save was then refused as
 * "locked", so the sentence the clinician had just typed was on their screen
 * but not in the record they attested to. And a signed note stayed open on a
 * page with nothing left to do. Real note-service against the in-memory DB.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: jest.fn(), back: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/notes/x',
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock('@/components/Toast', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('@/components/ConfirmDialog', () => ({ useConfirm: () => jest.fn(async () => true) }));
// One stable object, as the real hook returns: the editor's effects depend on
// the scope's identity, and a fresh literal per render spins them forever.
jest.mock('@/lib/hooks/useDataScope', () => {
  const scope = { role: 'doctor', orgId: 'org-moh-ss', hospitalId: 'hosp-001' };
  return { useDataScope: () => scope };
});
jest.mock('@/lib/hooks/useUnsavedChangesWarning', () => ({
  useUnsavedChangesWarning: () => ({ confirmNavigation: () => true }),
}));

import { act } from 'react';
import { teardownTestDBs } from '../helpers/test-db';
import { click, flush, mountAndFlush, setValue, type Mounted } from '../components/clinical-notes/test-utils';
import ClinicalNoteEditor from '@/components/clinical-notes/ClinicalNoteEditor';
import { createClinicalNote, getClinicalNoteById, saveNoteSection } from '@/lib/clinical-notes/note-service';

const DOCTOR = { _id: 'user-dr-wani', name: 'Dr. Wani', role: 'doctor', orgId: 'org-moh-ss' };

let mounted: Mounted | null = null;

async function settle(until: () => boolean) {
  for (let attempt = 0; attempt < 60 && !until(); attempt++) {
    await act(async () => { await flush(); });
  }
}

async function openNote(props: { onOpenChartTab?: (tabId: string) => void; saved?: string } = {}) {
  const note = await createClinicalNote({
    patientId: 'pat-00001', patientName: 'Test User', noteType: 'soap',
    serviceDate: '2026-10-08', authorId: DOCTOR._id, authorName: DOCTOR.name,
    assignedToId: DOCTOR._id, assignedToName: DOCTOR.name,
    hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: 'org-moh-ss',
  } as never);
  if (props.saved) await saveNoteSection(note._id, 'subjective', { text: props.saved });
  mounted = await mountAndFlush(
    <ClinicalNoteEditor
      noteId={note._id}
      currentUser={DOCTOR}
      showContextSidebar={false}
      onOpenChartTab={props.onOpenChartTab}
    />,
  );
  await settle(() => !!subjective());
  return note;
}

const subjective = () => mounted!.container.querySelector<HTMLTextAreaElement>('#cn-section-subjective textarea');
const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
  .find(b => b.textContent?.trim() === label)!;

async function sign() {
  click(button('Sign'));
  click(button('Sign note'));
}

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  push.mockClear();
  document.body.innerHTML = '';
});

afterAll(async () => {
  await teardownTestDBs();
});

describe('clinical note — sign and close', () => {
  it('signs what was typed a moment ago, not what the last autosave held', async () => {
    const note = await openNote({ saved: 'Fever for three days.' });

    // Typed and signed inside the autosave delay: nothing has been written yet.
    setValue(subjective()!, 'Fever for three days. Now vomiting.');
    await sign();
    await settle(() => push.mock.calls.length > 0);

    const stored = await getClinicalNoteById(note._id);
    expect(stored?.status).toBe('signed');
    expect(stored?.sections.find(s => s.sectionId === 'subjective')?.text)
      .toBe('Fever for three days. Now vomiting.');
  });

  it('closes onto the patient’s Visits once the note is signed', async () => {
    await openNote({ saved: 'Fever for three days.' });

    await sign();
    await settle(() => push.mock.calls.length > 0);

    expect(push).toHaveBeenCalledWith('/patients/pat-00001?tab=history');
  });

  it('hands the move to the chart when it is open in the chart’s drawer', async () => {
    const onOpenChartTab = jest.fn();
    await openNote({ saved: 'Fever for three days.', onOpenChartTab });

    await sign();
    await settle(() => onOpenChartTab.mock.calls.length > 0);

    expect(onOpenChartTab).toHaveBeenCalledWith('history');
    expect(push).not.toHaveBeenCalled();
  });

  it('stays on the note when the signature is refused', async () => {
    const note = await openNote();

    // Nothing documented: signing an empty note is refused.
    await sign();
    await settle(() => false);

    expect((await getClinicalNoteById(note._id))?.status).not.toBe('signed');
    expect(push).not.toHaveBeenCalled();
    expect(subjective()).not.toBeNull();
  });

  it('opens the chart’s Care plan from the Care Plan button, not the Patient summary', async () => {
    await openNote();

    click(button('Care Plan'));

    expect(push).toHaveBeenCalledWith('/patients/pat-00001?tab=careChecklist');
  });
});
