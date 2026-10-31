jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/clinical-notes/note-service', () => ({
  createClinicalNote: jest.fn(), listClinicalNotes: jest.fn(), updateClinicalNote: jest.fn(),
  notePreview: () => '',
}));
jest.mock('@/lib/hooks/useDataScope', () => ({ useDataScope: () => null }));

import { findOpenDraft, findReusableDraft } from '@/lib/clinical-notes/useCreateNote';
import { clinicalNoteToRow } from '@/components/clinical-notes/notes-list-model';
import type { ClinicalNoteDoc } from '@/lib/clinical-notes/types';

const note = (o: Partial<ClinicalNoteDoc>): ClinicalNoteDoc => ({
  _id: 'n1', type: 'clinical_note', patientId: 'p1', patientName: 'A B', noteType: 'soap',
  sections: [], serviceDate: '2026-10-20', serviceTime: '19:00', status: 'draft',
  authorId: 'dr1', updatedAt: '2026-10-20T17:00:00.000Z',
  ...o,
}) as ClinicalNoteDoc;

describe('findReusableDraft', () => {
  it('reopens the visit draft when started without the appointment (chart Notes tab)', () => {
    const fromDashboard = note({ encounterId: 'e1', appointmentId: 'a1' });
    expect(findReusableDraft([fromDashboard], { encounterId: 'e1', noteType: 'soap' })).toBe(fromDashboard);
  });

  it('still matches on the appointment when the draft has no encounter yet', () => {
    const d = note({ appointmentId: 'a1' });
    expect(findReusableDraft([d], { appointmentId: 'a1', encounterId: 'e1' })).toBe(d);
  });

  it('never reopens another visit’s draft', () => {
    const other = note({ encounterId: 'e0', appointmentId: 'a0' });
    expect(findReusableDraft([other], { encounterId: 'e1', appointmentId: 'a1' })).toBeUndefined();
  });

  it('ignores signed notes and other note types', () => {
    const signed = note({ _id: 's', encounterId: 'e1', status: 'signed' });
    const procedure = note({ _id: 'p', encounterId: 'e1', noteType: 'procedure' as ClinicalNoteDoc['noteType'] });
    expect(findReusableDraft([signed, procedure], { encounterId: 'e1', noteType: 'soap' })).toBeUndefined();
  });

  it('adopts the same clinician’s unlinked draft from the same day only', () => {
    const today = note({ _id: 't' });
    const yesterday = note({ _id: 'y', serviceDate: '2026-10-19' });
    const colleague = note({ _id: 'c', authorId: 'dr2' });
    const keys = { encounterId: 'e1', serviceDate: '2026-10-20', authorId: 'dr1' };
    expect(findReusableDraft([yesterday, colleague, today], keys)?._id).toBe('t');
    expect(findReusableDraft([yesterday, colleague], keys)).toBeUndefined();
  });

  it('prefers the most recently edited duplicate', () => {
    const older = note({ _id: 'old', encounterId: 'e1', updatedAt: '2026-10-20T17:00:00Z' });
    const newer = note({ _id: 'new', encounterId: 'e1', updatedAt: '2026-10-20T18:00:00Z' });
    expect(findReusableDraft([older, newer], { encounterId: 'e1' })?._id).toBe('new');
  });
});

describe('clinicalNoteToRow timestamp', () => {
  it('dates a draft by its last edit', () => {
    const edit = new Date(2026, 9, 24, 9, 42);
    const row = clinicalNoteToRow(note({ updatedAt: edit.toISOString() }));
    expect(row).toMatchObject({ date: '2026-10-24', time: '09:42', edited: true });
  });

  it('keeps the date of service once signed', () => {
    const row = clinicalNoteToRow(note({ status: 'signed', updatedAt: '2026-10-24T09:42:00Z' }));
    expect(row).toMatchObject({ date: '2026-10-20', time: '19:00', edited: false });
  });
});

describe('findOpenDraft', () => {
  it('offers back the clinician\'s newest draft of this type, from any day', () => {
    const older = note({ _id: 'old', serviceDate: '2026-10-01', updatedAt: '2026-10-01T09:00:00.000Z' });
    const newer = note({ _id: 'new', serviceDate: '2026-10-15', updatedAt: '2026-10-15T09:00:00.000Z' });
    expect(findOpenDraft([older, newer], { noteType: 'soap', authorId: 'dr1' })?._id).toBe('new');
  });

  it('leaves out signed notes, other types and a colleague\'s draft', () => {
    const notes = [
      note({ _id: 'signed', status: 'signed' }),
      note({ _id: 'proc', noteType: 'procedure' }),
      note({ _id: 'theirs', authorId: 'dr2' }),
    ];
    expect(findOpenDraft(notes, { noteType: 'soap', authorId: 'dr1' })).toBeUndefined();
  });
});
