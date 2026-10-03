/**
 * Recommendations was folded into Plan: the two sat next to each other, asked
 * for the same thing, and Recommendations offered a subset of Plan's actions.
 *
 * Retiring a section has three parts, and each is a way to get it wrong:
 *  - nothing may offer it again (catalog, Add Optional, copy-forward);
 *  - a draft that already holds one must end up with ONE place to write the
 *    plan, without losing a word of what was typed;
 *  - a signed note must not change at all — it was attested as written.
 *
 * Same harness as note-signing.test.ts: mocked uuid + in-memory PouchDB.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs } from '../helpers/test-db';
import {
  NOTE_TYPES, NOTE_SECTIONS, RETIRED_SECTIONS,
  availableOptionalSections, resolveSections, getSectionLabel,
  type NoteSectionId, type NoteTypeId,
} from '@/lib/clinical-notes/note-catalog';
import { actionsForSection } from '@/lib/clinical-notes/section-actions';
import { TEMPLATE_BLOCK_START, TEMPLATE_BLOCK_END } from '@/lib/clinical-notes/section-templates';
import {
  createClinicalNote, saveNoteSection, signClinicalNote, getClinicalNoteById,
  changeNoteType, copyNoteForward,
  foldRetiredSections, foldRetiredNoteSections,
} from '@/lib/clinical-notes/note-service';

afterEach(async () => {
  await teardownTestDBs();
});

const identity = {
  patientId: 'pat-00001',
  patientName: 'Nyakuma Deng',
  serviceDate: '2026-08-08',
  authorId: 'user-dr-wani',
  authorName: 'Dr. Wani',
  assignedToId: 'user-dr-wani',
  assignedToName: 'Dr. Wani',
  hospitalId: 'hosp-001',
  orgId: 'org-moh-ss',
};

/** A draft as it looked before the retirement: Recommendations beside Plan. */
async function legacyDraft(noteType: NoteTypeId, texts: Partial<Record<NoteSectionId, string>>) {
  const note = await createClinicalNote({ ...identity, noteType } as never);
  // saveNoteSection appends a section the note does not have yet — the same
  // shape "Add Optional → Recommendations" used to leave behind.
  await saveNoteSection(note._id, 'recommendations', { text: texts.recommendations ?? '' });
  for (const [sectionId, text] of Object.entries(texts)) {
    if (sectionId !== 'recommendations') await saveNoteSection(note._id, sectionId as NoteSectionId, { text });
  }
  return note._id;
}

const ids = (note: { sections: { sectionId: string }[] } | null) => note!.sections.map(s => s.sectionId);
const textOf = (note: { sections: { sectionId: string; text?: string }[] } | null, id: string) =>
  note!.sections.find(s => s.sectionId === id)?.text;

describe('catalog — a retired section is not offered anywhere', () => {
  const retired = Object.keys(RETIRED_SECTIONS) as NoteSectionId[];

  it('retires Recommendations into Plan', () => {
    expect(RETIRED_SECTIONS.recommendations).toBe('plan');
  });

  it.each(Object.keys(NOTE_TYPES) as NoteTypeId[])('%s neither seeds nor offers one', (typeId) => {
    for (const id of retired) {
      expect(NOTE_TYPES[typeId].sections).not.toContain(id);
      expect(NOTE_TYPES[typeId].optionalSections).not.toContain(id);
    }
    expect(resolveSections(typeId)).toEqual(expect.not.arrayContaining(retired));
    expect(availableOptionalSections(typeId).map(d => d.id)).toEqual(expect.not.arrayContaining(retired));
  });

  it('keeps the referral question on offer — only the duplicate answer box went', () => {
    expect(availableOptionalSections('soap').map(d => d.id)).toContain('reason_for_consultation');
    expect(resolveSections('consultation')).toEqual(expect.arrayContaining(['reason_for_consultation', 'plan']));
  });

  it('still names the section, so a signed note that holds one renders its heading', () => {
    expect(NOTE_SECTIONS.recommendations).toBeDefined();
    expect(getSectionLabel('recommendations')).toBe('Recommendations');
  });

  it('every successor is a live section that carries the retired one\'s actions', () => {
    for (const [from, to] of Object.entries(RETIRED_SECTIONS)) {
      expect(RETIRED_SECTIONS[to as NoteSectionId]).toBeUndefined();
      expect(actionsForSection(from)).toEqual([]);
      // What Recommendations offered — labs and referral — is all on Plan.
      expect(actionsForSection(to as string).map(a => a.id)).toEqual(expect.arrayContaining(['order_lab', 'refer']));
    }
  });
});

describe('foldRetiredSections', () => {
  it('moves the narrative ahead of the plan and drops the section', () => {
    const folded = foldRetiredSections([
      { sectionId: 'assessment', text: 'Uncomplicated malaria.' },
      { sectionId: 'recommendations', text: 'Repeat smear at 48h — referring CO to arrange.' },
      { sectionId: 'plan', text: 'Start ACT.' },
    ]);
    expect(folded.map(s => s.sectionId)).toEqual(['assessment', 'plan']);
    expect(folded[1].text).toBe('Repeat smear at 48h — referring CO to arrange.\n\nStart ACT.');
  });

  it('fills an empty plan without a stray separator', () => {
    const folded = foldRetiredSections([
      { sectionId: 'recommendations', text: 'Refer to surgery.' },
      { sectionId: 'plan', text: '' },
    ]);
    expect(folded).toEqual([{ sectionId: 'plan', text: 'Refer to surgery.' }]);
  });

  it('drops an empty one and leaves the plan exactly as it was', () => {
    const plan = { sectionId: 'plan' as const, text: 'Start ACT.' };
    const folded = foldRetiredSections([{ sectionId: 'recommendations', text: '  ' }, plan]);
    expect(folded).toEqual([plan]);
    expect(folded[0]).toBe(plan);
  });

  it('keeps written text where it is when the note has no plan to receive it', () => {
    const sections = [
      { sectionId: 'hospital_course' as const, text: 'Uneventful.' },
      { sectionId: 'recommendations' as const, text: 'Review in clinic.' },
    ];
    expect(foldRetiredSections(sections)).toBe(sections);
  });

  it('moves plain narrative — the plan keeps its own template block intact', () => {
    const planText = `${TEMPLATE_BLOCK_START}Rest, fluids.${TEMPLATE_BLOCK_END}`;
    const folded = foldRetiredSections([
      { sectionId: 'recommendations', text: `${TEMPLATE_BLOCK_START}Repeat FBC.${TEMPLATE_BLOCK_END}` },
      { sectionId: 'plan', text: planText },
    ]);
    expect(folded[0].text).toBe(`Repeat FBC.\n\n${planText}`);
  });

  it('returns the same array when there is nothing to fold', () => {
    const sections = [{ sectionId: 'cc' as const, text: 'Fever' }, { sectionId: 'plan' as const, text: 'ACT' }];
    expect(foldRetiredSections(sections)).toBe(sections);
  });
});

describe('foldRetiredNoteSections — opening a draft written before the retirement', () => {
  it('leaves one Plan holding both texts, and stops listing the section as added', async () => {
    const id = await legacyDraft('soap', {
      recommendations: 'Repeat smear at 48h.',
      plan: 'Start ACT.',
    });
    // The pre-retirement doc also recorded it as an added section.
    const { updateClinicalNote } = await import('@/lib/clinical-notes/note-service');
    await updateClinicalNote(id, { addedSections: ['hpi', 'recommendations'] });

    const opened = await foldRetiredNoteSections(id);
    expect(ids(opened)).not.toContain('recommendations');
    expect(textOf(opened, 'plan')).toBe('Repeat smear at 48h.\n\nStart ACT.');
    expect(opened?.addedSections).toEqual(['hpi']);

    // Persisted, not just returned — the next autosave re-reads the document.
    const stored = await getClinicalNoteById(id);
    expect(ids(stored)).not.toContain('recommendations');
    expect(textOf(stored, 'plan')).toBe('Repeat smear at 48h.\n\nStart ACT.');
  });

  it('folds a retired-type Consultation draft too', async () => {
    const id = await legacyDraft('consultation', { recommendations: 'Safe for theatre.' });
    const opened = await foldRetiredNoteSections(id);
    expect(ids(opened)).toEqual(resolveSections('consultation'));
    expect(textOf(opened, 'plan')).toBe('Safe for theatre.');
  });

  it('does not write when the draft has nothing to fold', async () => {
    const note = await createClinicalNote({ ...identity, noteType: 'soap' } as never);
    const opened = await foldRetiredNoteSections(note._id);
    expect(opened?._rev).toBe(note._rev);
  });

  it('never touches a signed note — it was attested with that section in it', async () => {
    const id = await legacyDraft('soap', {
      recommendations: 'Repeat smear at 48h.',
      plan: 'Start ACT.',
    });
    const signed = await signClinicalNote(id, { signedBy: 'user-dr-wani', signedByName: 'Dr. Wani', signerRole: 'doctor' });

    const opened = await foldRetiredNoteSections(id);
    expect(opened?._rev).toBe(signed?._rev);
    expect(textOf(opened, 'recommendations')).toBe('Repeat smear at 48h.');
    expect(textOf(opened, 'plan')).toBe('Start ACT.');
  });

  it('never touches a note awaiting co-sign — the trainee has already attested it', async () => {
    // Folding here moved text between the trainee signing and the supervisor
    // reading, so the supervisor co-signed something other than what was signed.
    const id = await legacyDraft('soap', {
      recommendations: 'Repeat smear at 48h.',
      plan: 'Start ACT.',
    });
    const attested = await signClinicalNote(id, {
      signedBy: 'user-dr-wani', signedByName: 'Dr. Wani', signerRole: 'doctor', awaitingCosign: true,
    });
    expect(attested?.status).toBe('awaiting_cosign');

    const opened = await foldRetiredNoteSections(id);
    expect(opened?._rev).toBe(attested?._rev);
    expect(textOf(opened, 'recommendations')).toBe('Repeat smear at 48h.');
    expect(textOf(opened, 'plan')).toBe('Start ACT.');
  });

  it('returns null for a note that does not exist', async () => {
    expect(await foldRetiredNoteSections('note-missing')).toBeNull();
  });
});

describe('a retired section does not come back through the other write paths', () => {
  it('copy-forward from a signed legacy note carries the text into Plan', async () => {
    const sourceId = await legacyDraft('consultation', {
      recommendations: 'Repeat smear at 48h.',
      plan: 'Start ACT.',
    });
    await signClinicalNote(sourceId, { signedBy: 'user-dr-wani', signedByName: 'Dr. Wani', signerRole: 'doctor' });

    const copy = await copyNoteForward(sourceId, { ...identity, serviceDate: '2026-08-15' });
    expect(ids(copy)).not.toContain('recommendations');
    expect(copy?.addedSections ?? []).not.toContain('recommendations');
    expect(textOf(copy, 'plan')).toBe('Repeat smear at 48h.\n\nStart ACT.');
    // The source is the record; it keeps what it was signed with.
    expect(textOf(await getClinicalNoteById(sourceId), 'recommendations')).toBe('Repeat smear at 48h.');
  });

  it('changing type folds a section that only now has a Plan to go to', async () => {
    // A discharge summary has no Plan, so the text stayed where it was written.
    const id = await legacyDraft('discharge_summary', { recommendations: 'Review in clinic in 2 weeks.' });
    expect(ids(await foldRetiredNoteSections(id))).toContain('recommendations');

    const switched = await changeNoteType(id, 'soap');
    expect(ids(switched)).not.toContain('recommendations');
    expect(switched?.addedSections ?? []).not.toContain('recommendations');
    expect(textOf(switched, 'plan')).toBe('Review in clinic in 2 weeks.');
  });
});
