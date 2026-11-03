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
import { copyNoteForward, createClinicalNote } from '@/lib/clinical-notes/note-service';
import { toIsoDate } from '@/lib/date-utils';
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

describe('createClinicalNote — the rest of triage', () => {
  const today = toIsoDate(new Date());
  const now = new Date().toISOString();
  const full = {
    type: 'triage', patientId: 'pat-00001', encounterId: 'enc-1', createdAt: now, updatedAt: now, triagedAt: now,
    triagedByName: 'Nurse Mary', status: 'pending', facilityId: 'hosp-001', orgId: 'org-moh-ss',
    chiefComplaint: 'Chest pain', symptomDuration: '2 days', modeOfArrival: 'ambulance', notes: 'Sweating',
    priority: 'RED', airway: 'clear', breathing: 'distressed', circulation: 'not_assessed', consciousness: 'alert',
    painScore: '7', redCriteria: ['airway_breathing'], immediateInterventions: 'Oxygen given',
    assessmentSource: 'clinician',
  };
  const put = (doc: Record<string, unknown>) => triageDB().put({ _id: 'triage-full', ...full, ...doc } as never);
  const text = (n: ClinicalNoteDoc, id: string) => n.sections.find(s => s.sectionId === id)?.text ?? '';

  it('opens a consultation with the history and findings, for the clinician to edit', async () => {
    await put({});
    const n = await note({ encounterId: 'enc-1' });
    expect(text(n, 'cc')).toBe('Chest pain');
    expect(text(n, 'subjective')).toContain('Duration: 2 days');
    expect(text(n, 'subjective')).toContain('Arrived by: Ambulance');
    expect(text(n, 'subjective')).toContain('Triage notes: Sweating');
    expect(text(n, 'subjective')).toContain('Nurse Mary');
    expect(text(n, 'objective')).toContain('Priority: Emergency');
    expect(text(n, 'objective')).toContain('Breathing: Distressed');
    expect(text(n, 'objective')).toContain('Pain score: 7/10');
    expect(text(n, 'objective')).toContain('Danger signs: Stridor, respiratory distress or central cyanosis');
    expect(text(n, 'objective')).toContain('Treatment at triage: Oxygen given');
  });

  it('carries what the removed SBAR tab was the only place to read', async () => {
    await put({
      isolationRequired: true,
      vitalUrgencyWarnings: [{ field: 'spo2', code: 'low', urgency: 'RED', message: 'SpO2 below 90%' }],
      destinationClinic: 'Emergency',
      assignedProviderName: 'Dr. Wani',
      handoffNote: 'Needs oxygen',
    });
    const objective = text(await note({ encounterId: 'enc-1' }), 'objective');
    expect(objective).toContain('Isolation required');
    expect(objective).toContain('Vital sign warnings: SpO2 below 90%');
    expect(objective).toContain('Sent to: Emergency');
    expect(objective).toContain('Receiving provider: Dr. Wani');
    expect(objective).toContain('Handoff note: Needs oxygen');
  });

  it('names the disposition when no clinic was chosen', async () => {
    await put({ disposition: 'general_clinic' });
    expect(text(await note({ encounterId: 'enc-1' }), 'objective')).toContain('Sent to: General clinic');
  });

  it('never presents an unexamined finding', async () => {
    await put({});
    expect(text(await note({ encounterId: 'enc-1' }), 'objective')).not.toContain('Circulation');
  });

  it('uses HPI and Physical Exam on a note that has them', async () => {
    await put({});
    const n = await note({ encounterId: 'enc-1', noteType: 'hp' });
    expect(text(n, 'hpi')).toContain('Duration: 2 days');
    expect(text(n, 'physical_exam')).toContain('Pain score: 7/10');
  });

  it('takes only the complaint from a clerical check-in', async () => {
    await put({ assessmentSource: 'clerical_checkin' });
    const n = await note({ encounterId: 'enc-1' });
    expect(text(n, 'cc')).toBe('Chest pain');
    expect(text(n, 'subjective')).toBe('');
    expect(text(n, 'objective')).toBe('');
  });

  it('leaves the note empty for a patient who was not triaged', async () => {
    const n = await note({ encounterId: 'enc-1' });
    for (const section of n.sections) expect(section.text ?? '').toBe('');
  });

  it('keeps text the caller supplied', async () => {
    await put({});
    const n = await note({ encounterId: 'enc-1', sections: [{ sectionId: 'objective', text: 'Own exam' }] });
    expect(text(n, 'objective')).toBe('Own exam');
  });

  it('does not write into an amendment or a structured form', async () => {
    await put({});
    expect(text(await note({ encounterId: 'enc-1', amendsNoteId: 'note-1' }), 'objective')).toBe('');
    expect(text(await note({ encounterId: 'enc-1', formData: { score: '3' } }), 'objective')).toBe('');
  });

  it("never uses another patient's triage, even on the note's encounter", async () => {
    await put({ patientId: 'pat-00099' });
    const n = await note({ encounterId: 'enc-1' });
    expect(text(n, 'cc')).toBe('');
    expect(text(n, 'objective')).toBe('');
  });

  it('ignores a triage for a patient who left without being seen', async () => {
    await put({ status: 'lwbs' });
    expect(text(await note({ encounterId: 'enc-1' }), 'objective')).toBe('');
  });

  it('adds nothing to a note copied forward', async () => {
    const source = await note({ sections: [{ sectionId: 'assessment', text: 'Stable' }] });
    await put({ encounterId: undefined });
    const copy = await copyNoteForward(source._id, {
      patientId: 'pat-00001', patientName: 'Nyakuma Deng', serviceDate: today,
      authorId: 'user-dr-wani', authorName: 'Dr. Wani', hospitalId: 'hosp-001', orgId: 'org-moh-ss',
    });
    expect(text(copy!, 'objective')).toBe('');
    expect(text(copy!, 'cc')).toBe('');
    expect(text(copy!, 'assessment')).toBe('Stable');
  });

  describe('a triage with no visit link', () => {
    const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

    it('fills a note from a recent open triage here', async () => {
      await put({ encounterId: undefined, triagedAt: hoursAgo(2) });
      expect(text(await note({ serviceDate: today }), 'objective')).toContain('Priority: Emergency');
    });

    it('stays off a backdated note', async () => {
      await put({ encounterId: undefined, triagedAt: hoursAgo(1) });
      expect(text(await note({ serviceDate: '2026-01-05' }), 'objective')).toBe('');
    });

    it.each([
      ['another visit', { encounterId: 'enc-other' }],
      ['an old visit', { encounterId: undefined, triagedAt: hoursAgo(30) }],
      ['a patient who left', { encounterId: undefined, status: 'lwbs' }],
      ['a discharged visit', { encounterId: undefined, status: 'discharged' }],
      ['another hospital', { encounterId: undefined, facilityId: 'hosp-002' }],
    ])('ignores %s', async (_name, doc) => {
      await put(doc);
      expect(text(await note({ serviceDate: today }), 'objective')).toBe('');
    });
  });
});
