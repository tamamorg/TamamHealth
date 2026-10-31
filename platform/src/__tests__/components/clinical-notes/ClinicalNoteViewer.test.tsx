import React from 'react';
import { act } from 'react';
import { mountAndFlush, actFlush, setValue } from './test-utils';
import ClinicalNoteViewer, { clinicalViewerSections, keyValueLines } from '@/components/clinical-notes/ClinicalNoteViewer';
import type { ClinicalNoteDoc } from '@/lib/clinical-notes/types';

const getById = jest.fn();
const addAddendum = jest.fn();
jest.mock('@/lib/clinical-notes/note-service', () => ({
  ...jest.requireActual('@/lib/clinical-notes/note-service'),
  getClinicalNoteById: (...a: unknown[]) => getById(...a),
  addNoteAddendum: (...a: unknown[]) => addAddendum(...a),
}));
jest.mock('@/lib/hooks/useDataScope', () => {
  const scope = { userId: 'u1', orgId: 'o1', hospitalId: 'h1' };
  return { useDataScope: () => scope };
});
jest.mock('@/lib/context', () => {
  const auth = { currentUser: { _id: 'u1', name: 'Dr. Igga' } };
  return { useAuth: () => auth };
});
const printEl = jest.fn((_id: string) => true);
jest.mock('@/lib/safe-html', () => ({ printElementById: (id: string) => printEl(id) }));

const base = {
  _id: 'n1', type: 'clinical_note', patientId: 'p1', patientName: 'Mary Deng', noteType: 'soap',
  serviceDate: '2026-10-01', serviceTime: '09:30', assignedToName: 'Dr. Igga',
  sections: [
    { sectionId: 'subjective', text: 'Cough for three days' },
    { sectionId: 'assessment', text: 'Likely LRTI', diagnoses: [{ id: 'd1', name: 'Pneumonia', icd11Code: 'CA40', addedAt: 'x' }] },
    { sectionId: 'plan', text: '' },
  ],
} as unknown as ClinicalNoteDoc;

const btn = (c: HTMLElement, label: string) =>
  Array.from(c.querySelectorAll('button')).find(b => b.textContent === label) as HTMLButtonElement | undefined;

describe('ClinicalNoteViewer', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('keeps only sections with content and shows ICD-11 codes', () => {
    const s = clinicalViewerSections(base);
    expect(s.map(x => x.id)).toEqual(['subjective', 'assessment']);
    expect(s[1].diagnoses).toEqual([{ name: 'Pneumonia', code: 'CA40' }]);
  });

  it('renders a signed note with addenda, signature and print, but no Edit', async () => {
    getById.mockResolvedValue({
      ...base, status: 'amended', signedByName: 'Dr. Igga', signedAt: '2026-10-01T10:00:00Z',
      addenda: [{ id: 'a1', text: 'Correct the dose', authorId: 'u1', authorName: 'Dr. Igga', createdAt: '2026-10-02T08:00:00Z' }],
    });
    const m = await mountAndFlush(<ClinicalNoteViewer noteId="n1" kind="clinical" onClose={jest.fn()} onEdit={jest.fn()} />);
    const text = m.container.textContent || '';
    expect(text).toContain('Cough for three days');
    expect(text).toContain('Pneumonia');
    expect(text).toContain('CA40');
    expect(text).toContain('Correct the dose');
    expect(text).toContain('Signed by Dr. Igga');
    expect(text).toContain('Amended');
    expect(btn(m.container, 'Edit')).toBeUndefined();
    await actFlush(() => btn(m.container, 'Print')!.click());
    expect(printEl).toHaveBeenCalledWith('clinical-note-print-n1');
    m.unmount();
  });

  it('shows a draft locked, with no Edit for someone who may not write notes', async () => {
    getById.mockResolvedValue({ ...base, status: 'draft' });
    const m = await mountAndFlush(<ClinicalNoteViewer noteId="n1" kind="clinical" onClose={jest.fn()} />);
    expect(m.container.querySelector('.tm-banner')).not.toBeNull();
    expect(btn(m.container, 'Edit')).toBeUndefined();
    expect(m.container.querySelector('textarea, input')).toBeNull();
    m.unmount();
  });

  it('keeps a colleague\'s draft locked even with Edit wired up', async () => {
    getById.mockResolvedValue({ ...base, status: 'draft', authorId: 'someone-else' });
    const m = await mountAndFlush(<ClinicalNoteViewer noteId="n1" kind="clinical" onClose={jest.fn()} onEdit={jest.fn()} />);
    expect(btn(m.container, 'Edit')).toBeUndefined();
    m.unmount();
  });

  it('offers Edit only on drafts', async () => {
    const onEdit = jest.fn();
    getById.mockResolvedValue({ ...base, status: 'draft', authorId: 'u1' });
    const m = await mountAndFlush(<ClinicalNoteViewer noteId="n1" kind="clinical" onClose={jest.fn()} onEdit={onEdit} />);
    await actFlush(() => btn(m.container, 'Edit')!.click());
    expect(onEdit).toHaveBeenCalledWith('n1');
    expect(btn(m.container, 'Add addendum')).toBeUndefined();
    expect(btn(m.container, 'Print')).toBeUndefined();
    m.unmount();
  });

  it('requires addendum text before saving', async () => {
    getById.mockResolvedValue({ ...base, status: 'signed' });
    addAddendum.mockResolvedValue({});
    const m = await mountAndFlush(<ClinicalNoteViewer noteId="n1" kind="clinical" onClose={jest.fn()} />);
    await actFlush(() => btn(m.container, 'Add addendum')!.click());
    expect(btn(m.container, 'Save addendum')!.disabled).toBe(true);
    await act(async () => { setValue(m.container.querySelector('textarea')!, 'Late result'); });
    expect(btn(m.container, 'Save addendum')!.disabled).toBe(false);
    await actFlush(() => btn(m.container, 'Save addendum')!.click());
    expect(addAddendum).toHaveBeenCalledWith('n1', 'Late result', 'u1', 'Dr. Igga');
    m.unmount();
  });
});

describe('keyValueLines', () => {
  it('splits a vitals block into label/value pairs', () => {
    expect(keyValueLines('Temp: 39 °C\nBP: 120/80 mmHg\nSpO₂: 98%')).toEqual([
      { label: 'Temp', value: '39 °C' },
      { label: 'BP', value: '120/80 mmHg' },
      { label: 'SpO₂', value: '98%' },
    ]);
  });

  it('leaves prose, bullets and single lines as text', () => {
    expect(keyValueLines('Temp: 39 °C')).toBeNull();
    expect(keyValueLines('Plan: rest\nReview in 48 hours.')).toBeNull();
    expect(keyValueLines('• Coartem: twice daily\n• Paracetamol: as needed')).toBeNull();
  });
});
