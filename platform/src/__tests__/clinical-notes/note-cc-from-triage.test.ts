/**
 * A new note's CC section starts from the chief complaint triage recorded for
 * the same visit, so the clinician edits what the nurse heard rather than
 * asking again. Same harness as note-actions.test.ts.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs } from '../helpers/test-db';
import { triageDB } from '@/lib/db';
import { createClinicalNote } from '@/lib/clinical-notes/note-service';
import type { ClinicalNoteDoc } from '@/lib/clinical-notes/types';

afterEach(async () => {
  await teardownTestDBs();
});

async function triageFor(encounterId: string, chiefComplaint: string, createdAt = '2026-10-20T08:00:00.000Z') {
  await triageDB().put({
    _id: `triage-${encounterId}-${createdAt}`,
    type: 'triage',
    patientId: 'pat-00001',
    encounterId,
    chiefComplaint,
    createdAt,
    updatedAt: createdAt,
  } as never);
}

function note(overrides: Record<string, unknown> = {}) {
  return createClinicalNote({
    patientId: 'pat-00001',
    patientName: 'Nyakuma Deng',
    noteType: 'soap',
    serviceDate: '2026-10-20',
    authorId: 'user-dr-wani',
    authorName: 'Dr. Wani',
    hospitalId: 'hosp-001',
    orgId: 'org-moh-ss',
    ...overrides,
  } as never);
}

const cc = (n: ClinicalNoteDoc) => n.sections.find(s => s.sectionId === 'cc')?.text;

describe('createClinicalNote — CC from triage', () => {
  it("prefills CC with the visit's triage complaint", async () => {
    await triageFor('enc-1', '  Fever and cough for 3 days ');
    expect(cc(await note({ encounterId: 'enc-1' }))).toBe('Fever and cough for 3 days');
  });

  it("uses the newest triage for the visit, never another visit's", async () => {
    await triageFor('enc-old', 'Headache');
    await triageFor('enc-1', 'Abdominal pain', '2026-10-20T08:00:00.000Z');
    await triageFor('enc-1', 'Abdominal pain, vomiting', '2026-10-20T09:00:00.000Z');
    expect(cc(await note({ encounterId: 'enc-1' }))).toBe('Abdominal pain, vomiting');
  });

  it('leaves CC empty when the note has no encounter or the visit was not triaged', async () => {
    await triageFor('enc-1', 'Fever');
    expect(cc(await note())).toBe('');
    expect(cc(await note({ encounterId: 'enc-untriaged' }))).toBe('');
  });

  it('keeps a CC the caller supplied', async () => {
    await triageFor('enc-1', 'Fever');
    const n = await note({ encounterId: 'enc-1', sections: [{ sectionId: 'cc', text: 'Chest pain' }] });
    expect(cc(n)).toBe('Chest pain');
  });

  it('does not prefill an amendment', async () => {
    await triageFor('enc-1', 'Fever');
    expect(cc(await note({ encounterId: 'enc-1', amendsNoteId: 'note-orig' }))).toBe('');
  });
});
