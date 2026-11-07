/**
 * Characterisation of the Encounter Note screen's two layouts and its popup
 * slot, pinned while ClinicalNoteEditor was split into note-editor/*. These
 * assert the structure and open/close behaviour that existed before the split.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/notes/x',
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock('@/components/Toast', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('@/components/ConfirmDialog', () => ({ useConfirm: () => jest.fn(async () => true) }));
jest.mock('@/lib/hooks/useDataScope', () => {
  const scope = { role: 'doctor', orgId: 'org-moh-ss', hospitalId: 'hosp-001' };
  return { useDataScope: () => scope };
});
jest.mock('@/lib/hooks/useUnsavedChangesWarning', () => ({
  useUnsavedChangesWarning: () => ({ confirmNavigation: () => true }),
}));

import { act } from 'react';
import { teardownTestDBs } from '../helpers/test-db';
import { click, flush, mountAndFlush, type Mounted } from '../components/clinical-notes/test-utils';
import ClinicalNoteEditor from '@/components/clinical-notes/ClinicalNoteEditor';
import { createClinicalNote } from '@/lib/clinical-notes/note-service';
import { dobWithAge, nameInitials, docCategoryLabel } from '@/components/clinical-notes/note-editor/helpers';

const DOCTOR = { _id: 'user-dr-wani', name: 'Dr. Wani', role: 'doctor', orgId: 'org-moh-ss' };
let mounted: Mounted | null = null;

async function settle(until: () => boolean) {
  for (let attempt = 0; attempt < 60 && !until(); attempt++) {
    await act(async () => { await flush(); });
  }
}

async function open(layout: 'standard' | 'workspace', showContextSidebar = true) {
  const note = await createClinicalNote({
    patientId: 'pat-00001', patientName: 'Test User', noteType: 'soap',
    serviceDate: '2026-10-08', authorId: DOCTOR._id, authorName: DOCTOR.name,
    assignedToId: DOCTOR._id, assignedToName: DOCTOR.name,
    hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: 'org-moh-ss',
  } as never);
  mounted = await mountAndFlush(
    <ClinicalNoteEditor noteId={note._id} currentUser={DOCTOR} layout={layout} showContextSidebar={showContextSidebar} />,
  );
  await settle(() => !!mounted!.container.querySelector('#cn-section-subjective'));
}

const q = (sel: string) => mounted!.container.querySelector(sel);
const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
  .find(b => b.textContent?.trim() === label)!;

afterEach(() => { mounted?.unmount(); mounted = null; document.body.innerHTML = ''; });
afterAll(async () => { await teardownTestDBs(); });

describe('note editor — layouts', () => {
  it('standard layout renders the left rail with its cards and the footer', async () => {
    await open('standard');
    expect(q('.cn-sidebar')).not.toBeNull();
    expect(q('.cn-sidebar .cn-ident')).not.toBeNull();
    expect(q('.cn-section-nav .cn-section-nav-item')).not.toBeNull();
    expect(q('.cn-footer')).not.toBeNull();
    expect(q('.omf-root')).toBeNull();
  });

  it('standard layout without the sidebar drops the rail only', async () => {
    await open('standard', false);
    expect(q('.cn-sidebar')).toBeNull();
    expect(q('.cn-body--without-sidebar')).not.toBeNull();
  });

  it('workspace layout renders the section list, banner and action bar', async () => {
    await open('workspace');
    expect(q('.omf-root')).not.toBeNull();
    expect(q('.omf-nav .omf-nav-item')).not.toBeNull();
    expect(q('.omf-banner')).not.toBeNull();
    expect(q('.omf-actionbar')).not.toBeNull();
    expect(q('.cn-sidebar')).toBeNull();
  });
});

describe('note editor — popup slot', () => {
  it('opens the sign confirmation and closes it on Cancel', async () => {
    await open('standard', false);
    click(button('Sign'));
    expect(document.body.textContent).toContain('Sign note');
    await act(async () => { click(Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter(b => b.textContent?.trim() === 'Cancel').pop()!); });
    expect(Array.from(document.querySelectorAll('button')).some(b => b.textContent?.trim() === 'Sign note')).toBe(false);
  });
});

describe('note editor — local helpers keep their behaviour', () => {
  it('nameInitials keeps title tokens (unlike lib/patient-utils initials)', () => {
    expect(nameInitials('Dr. James Igga')).toBe('DJ');
    expect(nameInitials('')).toBe('');
  });
  it('dobWithAge passes through an unparseable date and blanks a missing one', () => {
    expect(dobWithAge(undefined)).toBeNull();
    expect(dobWithAge('not-a-date')).toBe('not-a-date');
    expect(dobWithAge('1990-01-15')).toMatch(/^15 Jan 1990 \(\d+ yo\)$/);
  });
  it('docCategoryLabel title-cases a snake_case category', () => {
    expect(docCategoryLabel('id_document')).toBe('Id Document');
  });
});
