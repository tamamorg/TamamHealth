/**
 * The patient's standing history as a store, and the one-time step that brings
 * it into a new note.
 *
 * Same harness as the other clinical-notes suites: mocked uuid + in-memory
 * PouchDB.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs } from '../helpers/test-db';
import {
  createHistoryEntry, getHistoryByPatient, markHistoryEntryInError, updateHistoryEntry,
} from '@/lib/services/history-service';
import { activeHistory } from '@/lib/clinical/patient-history';
import {
  createClinicalNote, getClinicalNoteById, includeChartHistory, removeNoteSection,
  sectionBody, signClinicalNote, saveNoteSection,
} from '@/lib/clinical-notes/note-service';
import { DOC_WRITE_ROLES, NURSING_AND_CLINICIANS, isRetainedRecordDatabase } from '@/lib/sync/write-permissions';
import { HIGH_RISK_RESOURCES } from '@/lib/services/conflict-service';
import { DATABASE_DOCUMENT_TYPES, DATABASE_SYNC_CONFIGS } from '@/lib/sync/sync-config';
import type { DataScope } from '@/lib/services/data-scope';

afterEach(async () => {
  await teardownTestDBs();
});

const scope = { role: 'doctor', orgId: 'org-moh-ss', hospitalId: 'hosp-001' } as unknown as DataScope;

const owner = {
  patientId: 'pat-00001',
  patientName: 'Nyakuma Deng',
  recordedBy: 'user-dr-wani',
  recordedByName: 'Dr. Wani',
  hospitalId: 'hosp-001',
  orgId: 'org-moh-ss',
};

const noteIdentity = {
  patientId: 'pat-00001',
  patientName: 'Nyakuma Deng',
  serviceDate: '2026-10-08',
  authorId: 'user-dr-wani',
  authorName: 'Dr. Wani',
  assignedToId: 'user-dr-wani',
  assignedToName: 'Dr. Wani',
  hospitalId: 'hosp-001',
  orgId: 'org-moh-ss',
};

const ids = (note: { sections: { sectionId: string }[] } | null) => note!.sections.map(s => s.sectionId);

describe('history entries', () => {
  it('records an entry against the patient, trimmed, with blank fields left off', async () => {
    const doc = await createHistoryEntry({
      ...owner, domain: 'surgical', title: '  Appendicectomy ', when: '2015', facility: '   ', detail: '',
    });
    expect(doc).toMatchObject({
      type: 'history_entry', domain: 'surgical', title: 'Appendicectomy', when: '2015',
      status: 'active', orgId: 'org-moh-ss', createdBy: 'user-dr-wani',
    });
    expect(doc.facility).toBeUndefined();
    expect(doc.detail).toBeUndefined();
    expect(await getHistoryByPatient('pat-00001', scope)).toHaveLength(1);
  });

  it('refuses an entry that says nothing, or names no domain', async () => {
    await expect(createHistoryEntry({ ...owner, domain: 'family', title: '   ' })).rejects.toThrow();
    await expect(createHistoryEntry({ ...owner, domain: 'dental' as never, title: 'x' })).rejects.toThrow();
    expect(await getHistoryByPatient('pat-00001', scope)).toHaveLength(0);
  });

  it('keeps one patient’s history out of another’s, and out of another org', async () => {
    await createHistoryEntry({ ...owner, domain: 'family', relation: 'Mother', title: 'Diabetes' });
    await createHistoryEntry({ ...owner, patientId: 'pat-00002', domain: 'medical', title: 'Asthma' });

    expect((await getHistoryByPatient('pat-00001', scope)).map(e => e.title)).toEqual(['Diabetes']);

    const otherOrg = { role: 'doctor', orgId: 'org-other', hospitalId: 'hosp-999' } as unknown as DataScope;
    expect(await getHistoryByPatient('pat-00001', otherOrg)).toEqual([]);
  });

  it('edits an entry in place without moving it to another patient or domain', async () => {
    const doc = await createHistoryEntry({ ...owner, domain: 'social', factor: 'tobacco', title: 'Tobacco', detail: 'Current smoker' });
    const updated = await updateHistoryEntry(doc._id, { detail: 'Former smoker' }, scope);
    expect(updated).toMatchObject({ detail: 'Former smoker', domain: 'social', patientId: 'pat-00001', factor: 'tobacco' });
    expect(await getHistoryByPatient('pat-00001', scope)).toHaveLength(1);
    await expect(updateHistoryEntry(doc._id, { title: ' ' }, scope)).rejects.toThrow();
    expect(await updateHistoryEntry('history-missing', { detail: 'x' }, scope)).toBeNull();
  });

  it('records who corrected an entry, without replacing who recorded it', async () => {
    const doc = await createHistoryEntry({ ...owner, recordedBy: 'user-nurse-a', recordedByName: 'Nurse A', domain: 'social', factor: 'tobacco', title: 'Tobacco', detail: 'Never smoked' });
    const updated = await updateHistoryEntry(doc._id, { detail: 'Current smoker' }, scope, { userId: 'user-dr-b', userName: 'Dr. B' });
    expect(updated).toMatchObject({ recordedByName: 'Nurse A', updatedBy: 'user-dr-b', updatedByName: 'Dr. B' });
  });

  it('files an entry from a writer with no home facility at the patient’s own', async () => {
    const { patientsDB } = jest.requireMock('@/lib/db') as { patientsDB: () => PouchDB.Database };
    await patientsDB().put({ _id: 'pat-00009', type: 'patient', orgId: 'org-moh-ss', registrationHospital: 'hosp-007' } as never);
    const doc = await createHistoryEntry({
      patientId: 'pat-00009', domain: 'medical', title: 'Typhoid', recordedBy: 'user-supt', orgId: 'org-moh-ss',
    });
    // Without a facility the entry would replicate to, and show at, every facility in the org.
    expect(doc.hospitalId).toBe('hosp-007');
  });

  it('refuses an entry that belongs to no organisation, instead of saving one nobody can see', async () => {
    await expect(createHistoryEntry({ patientId: 'pat-nowhere', domain: 'medical', title: 'Typhoid' }))
      .rejects.toThrow(/organisation/);
  });

  it('withdraws a mistake without deleting it', async () => {
    const doc = await createHistoryEntry({ ...owner, domain: 'medical', title: 'Wrong patient' });
    await markHistoryEntryInError(doc._id, scope, { userId: 'user-dr-wani', userName: 'Dr. Wani' });

    const all = await getHistoryByPatient('pat-00001', scope);
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe('entered_in_error');
    expect(activeHistory(all)).toEqual([]);
  });

  it('is registered everywhere a synced document type has to be', () => {
    // A type missing any one of these is accepted locally and silently refused
    // at replication — the entry would sit on one device and never arrive.
    expect(DATABASE_SYNC_CONFIGS.find(c => c.localName === 'tamamhealth_history_entries'))
      .toMatchObject({ direction: 'both', orgScoped: true });
    expect(DATABASE_DOCUMENT_TYPES.tamamhealth_history_entries).toEqual(['history_entry']);
    // Nurses take histories, so the grant covers the nursing roles too.
    // An entry is withdrawn, never deleted — and the gateway holds that line,
    // because a modified client is not bound by what this service chooses to do.
    expect(isRetainedRecordDatabase('tamamhealth_history_entries')).toBe(true);
    // Two devices correcting the same line is reconciled by a person.
    expect(HIGH_RISK_RESOURCES.has('history_entry')).toBe(true);
    expect(DOC_WRITE_ROLES.history_entry).toBe(NURSING_AND_CLINICIANS);
    expect(DOC_WRITE_ROLES.history_entry).toEqual(expect.arrayContaining(['nurse', 'midwife', 'triage_nurse', 'doctor']));
  });
});

describe('bringing the chart’s history into a note', () => {
  const texts = {
    past_medical_history: '• Hypertension — chronic',
    family_history: '• Mother: Diabetes',
    social_history: '',
  };

  it('adds the history sections the patient has something for, in the note’s own order', async () => {
    const note = await createClinicalNote({ ...noteIdentity, noteType: 'soap' } as never);
    expect(ids(note)).not.toContain('family_history');

    const updated = await includeChartHistory(note._id, texts);
    expect(ids(updated)).toContain('past_medical_history');
    expect(ids(updated)).toContain('family_history');
    // Nothing on the chart for social history: no empty box is added for it.
    expect(ids(updated)).not.toContain('social_history');
    // History sits before the assessment, where a consultation reads it.
    expect(ids(updated).indexOf('family_history')).toBeLessThan(ids(updated).indexOf('assessment'));

    const family = updated!.sections.find(s => s.sectionId === 'family_history')!;
    expect(family.snapshot).toBe('• Mother: Diabetes');
    expect(family.snapshotAt).toBeTruthy();
    expect(updated!.addedSections).toEqual(expect.arrayContaining(['past_medical_history', 'family_history']));
    expect(updated!.chartHistoryIncludedAt).toBeTruthy();
  });

  it('adds nothing for a first visit, and still records that it was offered', async () => {
    const note = await createClinicalNote({ ...noteIdentity, noteType: 'soap' } as never);
    const updated = await includeChartHistory(note._id, {});
    expect(ids(updated)).toEqual(ids(note));
    expect(updated!.chartHistoryIncludedAt).toBeTruthy();
  });

  it('offers once: a section the clinician removed does not come back', async () => {
    const note = await createClinicalNote({ ...noteIdentity, noteType: 'soap' } as never);
    await includeChartHistory(note._id, texts);
    await removeNoteSection(note._id, 'family_history');

    const again = await includeChartHistory(note._id, texts);
    expect(ids(again)).not.toContain('family_history');
  });

  it('leaves note types that did not ask for it alone', async () => {
    const note = await createClinicalNote({ ...noteIdentity, noteType: 'nurse_visit' } as never);
    const updated = await includeChartHistory(note._id, texts);
    expect(ids(updated)).toEqual(ids(note));
  });

  it('does not touch a note awaiting co-signature — it is attested, though not locked', async () => {
    const note = await createClinicalNote({ ...noteIdentity, noteType: 'soap' } as never);
    await saveNoteSection(note._id, 'subjective', { text: 'Cough for three days.' });
    const attested = await signClinicalNote(note._id, {
      signedBy: 'user-dr-wani', signedByName: 'Dr. Wani', signerRole: 'doctor', awaitingCosign: true,
    });
    expect(attested!.status).toBe('awaiting_cosign');

    const after = await includeChartHistory(note._id, texts);
    // The supervisor must co-sign exactly what the trainee signed.
    expect(ids(after)).toEqual(ids(attested));
    expect(after!.chartHistoryIncludedAt).toBeUndefined();
  });

  it('does not touch a signed note', async () => {
    const note = await createClinicalNote({ ...noteIdentity, noteType: 'soap' } as never);
    await saveNoteSection(note._id, 'subjective', { text: 'Cough for three days.' });
    await signClinicalNote(note._id, { signedBy: 'user-dr-wani', signedByName: 'Dr. Wani', signerRole: 'doctor' });

    await expect(includeChartHistory(note._id, texts)).rejects.toThrow();
    expect(ids(await getClinicalNoteById(note._id))).not.toContain('family_history');
  });
});

describe('a chart the reader cannot see', () => {
  it('counts as a failed allergy read, so the note never claims "no allergy history"', async () => {
    const { loadChartSnapshot, snapshotForSection } = await import('@/lib/clinical-notes/chart-snapshot');
    // No such patient in this reader's scope: the allergy service answers [],
    // which must not be mistaken for a reconciled empty list.
    const snapshot = await loadChartSnapshot('pat-not-visible', scope);
    expect(snapshot.allergiesLoadFailed).toBe(true);
    expect(snapshotForSection('allergies', snapshot)).toBe('');
  });
});

describe('sectionBody', () => {
  it('reads the chart’s lines, then the clinician’s own', () => {
    expect(sectionBody({ snapshot: '• Mother: Diabetes', text: 'Reviewed today, no change.' }))
      .toBe('• Mother: Diabetes\nReviewed today, no change.');
    expect(sectionBody({ text: 'Narrative only' })).toBe('Narrative only');
    expect(sectionBody({ snapshot: 'Temp: 37 °C' })).toBe('Temp: 37 °C');
    expect(sectionBody({})).toBe('');
  });
});
