/**
 * "Record Vitals" on a clinical note opens the chart's own vitals form OVER the
 * note and, once saved, pulls the reading into the note's Vitals section.
 *
 * It used to `router.push` to the chart's Vitals tab — the clinician left a
 * half-written note to take a reading, then had to find their way back and
 * press Refresh. Real note-service + chart-snapshot against the in-memory DB;
 * only the form itself is stubbed, so the test owns when "saved" happens.
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
  useUnsavedChangesWarning: () => ({ confirmNavigation: async () => true }),
}));

type VitalsModalProps = {
  patientId: string; patientName: string; hospitalId: string; encounterId?: string;
  currentUser: { _id: string; name: string }; onClose: () => void; onSaved?: () => void;
};
let vitalsModalProps: VitalsModalProps | null = null;
jest.mock('@/components/nurse/NurseVitalsModal', () => ({
  __esModule: true,
  default: (props: VitalsModalProps) => {
    vitalsModalProps = props;
    return <div data-testid="vitals-form" />;
  },
}));

import { act } from 'react';
import { teardownTestDBs } from '../helpers/test-db';
import { click, flush, mountAndFlush, type Mounted } from '../components/clinical-notes/test-utils';
import ClinicalNoteEditor from '@/components/clinical-notes/ClinicalNoteEditor';
import { createClinicalNote, getClinicalNoteById } from '@/lib/clinical-notes/note-service';
import { recordNursingVitals } from '@/lib/services/medical-record-service';

const DOCTOR = { _id: 'user-dr-wani', name: 'Dr. Wani', role: 'doctor', orgId: 'org-moh-ss' };

let mounted: Mounted | null = null;

async function openNote(overrides: Record<string, unknown> = {}) {
  const note = await createClinicalNote({
    patientId: 'pat-00001', patientName: 'Test User', noteType: 'soap',
    serviceDate: '2026-09-19', authorId: DOCTOR._id, authorName: DOCTOR.name,
    assignedToId: DOCTOR._id, assignedToName: DOCTOR.name,
    hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: 'org-moh-ss',
    encounterId: 'enc-visit-1',
    ...overrides,
  } as never);
  mounted = await mountAndFlush(<ClinicalNoteEditor noteId={note._id} currentUser={DOCTOR} showContextSidebar={false} />);
  await act(async () => { await flush(); });
  // The editor loads the note and builds its sections through a chain of
  // in-memory DB reads; one flush is usually enough, but under CI load the
  // vitals section was still missing when the first click landed. Wait on
  // the outcome, not on a guessed number of ticks.
  for (let attempt = 0; attempt < 40 && !mounted.container.querySelector('#cn-section-vitals'); attempt++) {
    await act(async () => { await flush(); });
  }
  return note;
}

const vitalsSection = () => mounted!.container.querySelector<HTMLElement>('#cn-section-vitals')!;
const recordButton = () => Array.from(vitalsSection().querySelectorAll<HTMLButtonElement>('button'))
  .find(button => button.textContent?.includes('Record Vitals'))!;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vitalsModalProps = null;
  push.mockClear();
  document.body.innerHTML = '';
});

// Once for the file, not per test: prescription-service keeps a module-level
// index promise, and destroying the in-memory DB under it leaves every later
// `loadChartSnapshot` in this process waiting forever. Each test opens its own
// note, so nothing leaks between them that matters.
afterAll(async () => {
  await teardownTestDBs();
});

describe('clinical note — record vitals without leaving the note', () => {
  it('opens the vitals form over the note instead of navigating to the chart', async () => {
    await openNote();

    click(recordButton());

    expect(mounted!.container.querySelector('[data-testid="vitals-form"]')).not.toBeNull();
    expect(push).not.toHaveBeenCalled();
    // Filed against the same patient and the visit this note documents.
    expect(vitalsModalProps).toMatchObject({
      patientId: 'pat-00001', patientName: 'Test User', hospitalId: 'hosp-001',
      encounterId: 'enc-visit-1', currentUser: { _id: DOCTOR._id, name: DOCTOR.name },
    });
  });

  it('also opens from the Vitals snapshot itself, like Medications and Allergies do', async () => {
    await openNote();

    click(vitalsSection().querySelector('.cn-derived-clickable')!);

    expect(mounted!.container.querySelector('[data-testid="vitals-form"]')).not.toBeNull();
  });

  it('pulls the reading just taken into the note when the form saves', async () => {
    const note = await openNote();
    click(recordButton());

    // What the real form does on Save: write the reading to the CHART…
    await recordNursingVitals({
      patientId: 'pat-00001', patientName: 'Test User', hospitalId: 'hosp-001', orgId: 'org-moh-ss',
      encounterId: 'enc-visit-1', recordedById: DOCTOR._id, recordedByName: DOCTOR.name,
      vitals: { temperature: '40', pulse: '73', systolic: '130', diastolic: '90' },
    } as never);
    // …then tell the host, and close.
    await act(async () => { vitalsModalProps!.onSaved?.(); vitalsModalProps!.onClose(); await flush(); });

    expect(mounted!.container.querySelector('[data-testid="vitals-form"]')).toBeNull();
    // The refresh is a chain of in-memory DB reads and a write — wait on the
    // outcome, not on a guessed number of ticks.
    let snapshot = '';
    for (let attempt = 0; attempt < 40 && !snapshot; attempt++) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
      const saved = await getClinicalNoteById(note._id);
      snapshot = saved?.sections.find(section => section.sectionId === 'vitals')?.snapshot || '';
    }
    expect(snapshot).toContain('40');
    expect(snapshot).toContain('130/90');
    expect(vitalsSection().textContent).toContain('130/90');
  });
});
