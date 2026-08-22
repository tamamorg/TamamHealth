/** @jest-environment node */
/**
 * Social History on a care-coordination summary.
 *
 * The editor held `const [socialHistory] = useState([])` and nothing ever set
 * it. `CareCoordinationModal` guards its Social History block with
 * `socialHistory.length > 0`, so the block never rendered: a referral sent
 * from this platform could not carry social history, and nothing on the screen
 * said the section was missing rather than empty.
 *
 * The content was already on the note. These tests pin the split from one
 * narrative section into the modal's two-column rows, and — more importantly —
 * pin what must NOT become a row: the template scaffolding and the empty
 * headings a clinician leaves behind when they fill in some prompts and not
 * others. A referral that carries "Tobacco:" with nothing after it wastes a
 * line and tells the receiving clinician nothing.
 */
import { socialHistoryRows } from '@/lib/clinical-notes/social-history-summary';
import type { ClinicalNoteDoc } from '@/lib/clinical-notes/types';

const note = (text: string) =>
  ({ sections: [{ sectionId: 'social_history', text }] } as unknown as ClinicalNoteDoc);

describe('labelled facts become rows', () => {
  it('splits a labelled line into comment and description', () => {
    expect(socialHistoryRows(note('Tobacco: never smoker'))).toEqual([
      { comment: 'Tobacco', description: 'never smoker' },
    ]);
  });

  it('keeps one fact per row so the clinician can tick them individually', () => {
    const rows = socialHistoryRows(note(
      'Tobacco: never smoker\nAlcohol: occasional\nOccupation: cattle herder',
    ));
    expect(rows).toHaveLength(3);
    expect(rows.map(r => r.comment)).toEqual(['Tobacco', 'Alcohol', 'Occupation']);
  });

  it('strips list bullets, which are formatting rather than content', () => {
    expect(socialHistoryRows(note('- Tobacco: never smoker\n• Alcohol: none'))).toEqual([
      { comment: 'Tobacco', description: 'never smoker' },
      { comment: 'Alcohol', description: 'none' },
    ]);
  });

  it('keeps a free-text sentence whole', () => {
    // No colon, so there is no label — splitting it somewhere would invent a
    // distinction the clinician did not write.
    const rows = socialHistoryRows(note('Lives with extended family in Gudele'));
    expect(rows).toEqual([{ comment: '', description: 'Lives with extended family in Gudele' }]);
  });

  it('does not treat a mid-sentence colon as a label', () => {
    // A colon 40+ characters in is punctuation inside prose.
    const line = 'Patient reports the following about the household: three adults and six children';
    expect(socialHistoryRows(note(line))).toEqual([{ comment: '', description: line }]);
  });
});

describe('what must not reach a referral', () => {
  it('drops a heading the clinician left blank', () => {
    // "Tobacco:" with nothing after it is an unanswered prompt.
    expect(socialHistoryRows(note('Tobacco:\nAlcohol: occasional'))).toEqual([
      { comment: 'Alcohol', description: 'occasional' },
    ]);
  });

  it('drops template delimiter lines', () => {
    expect(socialHistoryRows(note('---\nTobacco: never smoker\n===' ))).toEqual([
      { comment: 'Tobacco', description: 'never smoker' },
    ]);
  });

  it('ignores blank lines and stray whitespace', () => {
    expect(socialHistoryRows(note('\n\n   Tobacco: never smoker   \n\n'))).toEqual([
      { comment: 'Tobacco', description: 'never smoker' },
    ]);
  });
});

describe('absence is handled as absence', () => {
  it('returns nothing when the note has no social-history section', () => {
    expect(socialHistoryRows({ sections: [] } as unknown as ClinicalNoteDoc)).toEqual([]);
  });

  it('returns nothing when the section exists but is empty', () => {
    expect(socialHistoryRows(note('   \n  '))).toEqual([]);
  });

  it('returns nothing for a note that has not loaded yet', () => {
    // The editor renders before the note resolves; this runs on every render.
    expect(socialHistoryRows(null)).toEqual([]);
    expect(socialHistoryRows(undefined)).toEqual([]);
  });

  it('reads only the social-history section, not the rest of the note', () => {
    const mixed = {
      sections: [
        { sectionId: 'hpi', text: 'Fever for three days' },
        { sectionId: 'social_history', text: 'Alcohol: none' },
        { sectionId: 'assessment', text: 'Malaria' },
      ],
    } as unknown as ClinicalNoteDoc;
    expect(socialHistoryRows(mixed)).toEqual([{ comment: 'Alcohol', description: 'none' }]);
  });
});
