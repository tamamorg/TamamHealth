/**
 * A note shows the assessments of its visit: filled in on the Care plan, they
 * were invisible in the unsigned note written the same day.
 */
import { formatOutcomeMeasures, measuresForNote, withOutcomeMeasures } from '@/lib/clinical-notes/note-outcome-measures';
import { missingRequiredSections } from '@/lib/clinical-notes/note-service';
import type { AssessmentDoc } from '@/lib/db-types';
import type { ClinicalNoteDoc } from '@/lib/clinical-notes/types';

jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

const measure = (o: Partial<AssessmentDoc>) => ({
  _id: 'a1', instrumentName: 'GAD-7 (Anxiety)', totalScore: 12, interpretation: 'Moderate anxiety',
  answeredCount: 7, questionCount: 7, documentStatus: 'held', createdAt: '2026-10-30T10:00:00', ...o,
}) as AssessmentDoc;
const note = { serviceDate: '2026-10-30', sections: [] } as unknown as ClinicalNoteDoc;

describe('note outcome measures', () => {
  it('takes the assessments of the note\'s day or encounter, not another visit\'s', () => {
    const today = measure({});
    const old = measure({ _id: 'a2', createdAt: '2026-09-01T10:00:00' });
    const linked = measure({ _id: 'a3', createdAt: '2026-09-02T10:00:00', encounterId: 'e1' });
    expect(measuresForNote(note, [today, old]).map(a => a._id)).toEqual(['a1']);
    expect(measuresForNote({ ...note, encounterId: 'e1' }, [old, linked, today]).map(a => a._id)).toEqual(['a3', 'a1']);
  });

  it('says what was scored and whether it is signed', () => {
    expect(formatOutcomeMeasures([measure({})])).toBe('GAD-7 (Anxiety): 12 · Moderate anxiety (7/7 answered, awaiting signature)');
    expect(formatOutcomeMeasures([measure({ documentStatus: 'signed', signedByName: 'Dr. Igga' })])).toContain('signed by Dr. Igga');
  });

  it('shows them without changing the stored note, and never blocks signing', () => {
    const read = withOutcomeMeasures(note, [measure({})]);
    expect(read.sections.map(s => s.sectionId)).toEqual(['outcome_measures']);
    expect(note.sections).toHaveLength(0);
    expect(withOutcomeMeasures(note, [])).toBe(note);
    expect(missingRequiredSections({ noteType: 'soap', sections: [{ sectionId: 'outcome_measures', snapshot: 'x' }, { sectionId: 'assessment', text: 'a' }, { sectionId: 'plan', text: 'p' }] })).toEqual([]);
  });
});
