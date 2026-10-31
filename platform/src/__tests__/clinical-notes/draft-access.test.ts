/** Who may change a saved draft. */
import { canEditDraft, canEditRecordDraft } from '@/lib/clinical-notes/draft-access';
import { findReusableDraft } from '@/lib/clinical-notes/useCreateNote';
import type { ClinicalNoteDoc } from '@/lib/clinical-notes/types';

const note = { authorId: 'a', assignedToId: 'b' };

describe('canEditDraft', () => {
  it('lets the author and the assigned clinician edit', () => {
    expect(canEditDraft(note, { _id: 'a', role: 'doctor' })).toBe(true);
    expect(canEditDraft(note, { _id: 'b', role: 'doctor' })).toBe(true);
  });

  it('keeps a colleague out', () => {
    expect(canEditDraft(note, { _id: 'c', role: 'doctor' })).toBe(false);
    expect(canEditDraft(note, null)).toBe(false);
  });

  it('lets oversight roles edit', () => {
    expect(canEditDraft(note, { _id: 'c', role: 'medical_superintendent' })).toBe(true);
    expect(canEditDraft(note, { _id: 'c', role: 'super_admin' })).toBe(true);
  });
});

describe('canEditRecordDraft', () => {
  it('holds a record to its author', () => {
    expect(canEditRecordDraft({ consultedBy: 'a' }, { _id: 'a', role: 'doctor' })).toBe(true);
    expect(canEditRecordDraft({ consultedBy: 'a' }, { _id: 'c', role: 'doctor' })).toBe(false);
    expect(canEditRecordDraft({ consultedBy: 'a' }, { _id: 'c', role: 'medical_superintendent' })).toBe(true);
  });

  it('leaves a record that names no author with any clinician', () => {
    expect(canEditRecordDraft({}, { _id: 'c', role: 'doctor' })).toBe(true);
  });
});

describe('reopening a draft', () => {
  const draft = { _id: 'n', status: 'draft', noteType: 'soap', encounterId: 'e1', authorId: 'a', updatedAt: 'x' } as unknown as ClinicalNoteDoc;

  it('does not hand a colleague someone else\'s draft for the same visit', () => {
    expect(findReusableDraft([draft], { encounterId: 'e1', authorId: 'c' })).toBeUndefined();
    expect(findReusableDraft([draft], { encounterId: 'e1', authorId: 'a' })?._id).toBe('n');
  });
});
