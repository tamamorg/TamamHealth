/**
 * Medication list review in the triage form.
 *
 * The triage nurse reviews what the patient already takes and may add, edit
 * and stop entries on that list. Every one of those writes a `medication`
 * history entry: never a prescription, never anything for the pharmacy. The
 * triage cannot be saved until "Medication list reviewed" is ticked, and the
 * review (who, when, what changed) is saved on the triage.
 */
import { act, useEffect, useState } from 'react';

let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../../helpers/test-db').createDBMock());
const mockScope = { role: 'triage_nurse', orgId: 'org-moh-ss', hospitalId: 'hosp-001' };
jest.mock('@/lib/hooks/useDataScope', () => ({ useDataScope: () => mockScope }));
jest.mock('@/lib/context', () => ({ useAuth: () => ({ currentUser: NURSE }) }));
jest.mock('@/components/Toast', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('@/lib/i18n/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/RowActionsMenu', () => ({
  __esModule: true,
  default: ({ actions }: { actions: { key: string; label: string; onClick: () => void }[] }) => (
    <>{actions.map(a => <button key={a.key} type="button" data-action={a.key} onClick={a.onClick}>{a.label}</button>)}</>
  ),
}));

jest.setTimeout(30000);

import fs from 'node:fs';
import path from 'node:path';
import { mount, flush, type Mounted } from '../clinical-notes/test-utils';
import { ConfirmProvider } from '@/components/ConfirmDialog';
import { teardownTestDBs } from '../../helpers/test-db';
import { historyEntriesDB, prescriptionsDB } from '@/lib/db';
import { createHistoryEntry, getHistoryByPatient } from '@/lib/services/history-service';
import { useHistoryEntries } from '@/lib/hooks/useHistoryEntries';
import { MedicationListReview } from '@/components/nurse/triage/TriageMedicationReview';
import type { ReportedMedicationChange } from '@/components/ehr/chart/sections/ReportedMedications';
import {
  NO_MEDICATION_CHANGES, buildMedicationReview, formatMedicationReview, medicationReviewBlocksSave,
  mergeMedicationChanges, recordMedicationChange, type MedicationReviewChanges,
} from '@/lib/clinical/triage-medication-review';
import { activeHistory } from '@/lib/clinical/patient-history';
import { noteTextFromTriage } from '@/lib/clinical-notes/triage-prefill';
import type { DataScope } from '@/lib/services/data-scope';
import type { TriageDoc } from '@/lib/db-types';

const NURSE = {
  _id: 'user-nurse-ayen', name: 'Nurse Ayen', role: 'triage_nurse',
  hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: 'org-moh-ss',
};
const PATIENT = 'pat-00001';

const tick = () => act(async () => { await flush(); await new Promise(r => setTimeout(r, 0)); });

function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function waitFor(done: () => boolean) {
  for (let i = 0; i < 100 && !done(); i++) await tick();
  await tick();
}

const seen: ReportedMedicationChange[] = [];
const state: { reviewed: boolean; changes: MedicationReviewChanges } = { reviewed: false, changes: NO_MEDICATION_CHANGES };

/** The section wired the way useTriageForm wires it, with a live history hook. */
function Harness() {
  const history = useHistoryEntries(PATIENT);
  const [reviewed, setReviewed] = useState(false);
  const [changes, setChanges] = useState<MedicationReviewChanges>(NO_MEDICATION_CHANGES);
  useEffect(() => { state.reviewed = reviewed; state.changes = changes; });
  return (
    <MedicationListReview
      patientId={PATIENT}
      patientName="Nyakuma Deng"
      entries={history.entries}
      loadFailed={history.error}
      markInError={history.markInError}
      stop={history.stop}
      canRecord
      currentUser={NURSE}
      reviewed={reviewed}
      onReviewedChange={setReviewed}
      changes={changes}
      onChanged={change => { seen.push(change); setChanges(prev => recordMedicationChange(prev, change.kind, change.entry.title)); }}
    />
  );
}

let m: Mounted | null = null;
afterEach(async () => {
  m?.unmount();
  m = null;
  document.body.innerHTML = '';
  seen.length = 0;
  await teardownTestDBs();
  uuidCounter = 0;
});

async function render() {
  m = mount(<ConfirmProvider><Harness /></ConfirmProvider>);
  await tick(); await tick();
}

const allDocs = async (db: PouchDB.Database) => (await db.allDocs({ include_docs: true })).rows
  .map(r => r.doc as unknown as Record<string, unknown>)
  .filter(d => !String(d._id).startsWith('_design'));

describe('recording from triage', () => {
  it('adding a medicine writes a medication history entry and no prescription', async () => {
    await render();
    const add = [...document.body.querySelectorAll('button')].find(b => b.textContent?.includes('triageMeds.add'))!;
    act(() => add.click());
    await tick();

    const title = document.body.querySelector<HTMLInputElement>('#history-title')!;
    act(() => setValue(title, 'Metformin 500 mg'));
    act(() => setValue(document.body.querySelector<HTMLTextAreaElement>('#history-detail')!, 'Twice daily'));
    const form = title.closest('form')!;
    await act(async () => { form.requestSubmit(); });
    // The form writes through a lazily imported service: wait for the save.
    await waitFor(() => seen.length > 0);

    const entries = (await allDocs(historyEntriesDB())).filter(d => d.type === 'history_entry');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ domain: 'medication', patientId: PATIENT, status: 'active', recordedBy: 'user-nurse-ayen' });
    expect(await allDocs(prescriptionsDB())).toHaveLength(0);
    expect(seen.map(c => c.kind)).toEqual(['added']);
    expect(state.changes.added).toEqual(['Metformin 500 mg']);
  });

  it('stopping a medicine takes it off the current list, keeps it on disk, and writes no prescription', async () => {
    await createHistoryEntry({
      domain: 'medication', title: 'Amoxicillin', patientId: PATIENT, patientName: 'Nyakuma Deng',
      recordedBy: 'user-dr-wani', recordedByName: 'Dr. Wani', hospitalId: 'hosp-001', orgId: 'org-moh-ss',
    });
    await render();
    await waitFor(() => Boolean(document.body.textContent?.includes('Amoxicillin')));
    expect(document.body.textContent).toContain('Amoxicillin');

    act(() => document.body.querySelector<HTMLButtonElement>('[data-action="stop"]')!.click());
    await tick();
    const dialog = document.body.querySelector<HTMLElement>('[aria-labelledby="confirm-dialog-title"]')!;
    act(() => dialog.querySelector<HTMLButtonElement>('.btn-primary')!.click());
    await waitFor(() => seen.length > 0);

    const all = await getHistoryByPatient(PATIENT, mockScope as unknown as DataScope);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ status: 'stopped', stoppedBy: 'user-nurse-ayen', stoppedByName: 'Nurse Ayen' });
    expect(activeHistory(all)).toHaveLength(0);
    expect(await allDocs(prescriptionsDB())).toHaveLength(0);
    expect(state.changes.stopped).toEqual(['Amoxicillin']);
  });

  it('the tick is the review confirmation', async () => {
    await render();
    const box = document.body.querySelector<HTMLInputElement>('#triage-medication-reviewed')!;
    expect(box.checked).toBe(false);
    act(() => box.click());
    expect(state.reviewed).toBe(true);
  });
});

describe('the required review', () => {
  it('blocks the save while the patient is known and the list is not reviewed', () => {
    expect(medicationReviewBlocksSave({ patientKnown: true, reviewed: false })).toBe(true);
    expect(medicationReviewBlocksSave({ patientKnown: true, reviewed: true })).toBe(false);
    expect(medicationReviewBlocksSave({ patientKnown: false, reviewed: false })).toBe(false);
  });

  it('the triage save checks it before writing anything, and stores the review', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/components/nurse/triage/useTriageForm.ts'), 'utf8');
    const submit = source.slice(source.indexOf('const handleSubmitTriage = async () => {'));
    const guard = submit.indexOf('medicationReviewBlocksSave({ patientKnown: Boolean(selectedTriagePatient), reviewed: medicationReviewed })');
    expect(guard).toBeGreaterThan(0);
    expect(submit.indexOf("showToast(t('triageMeds.errNotReviewed'), 'error');")).toBeGreaterThan(guard);
    // The guard returns before the first write.
    expect(guard).toBeLessThan(submit.indexOf('setTriageSubmitting(true)'));
    expect(submit).toContain('medicationReview: buildMedicationReview({');
  });
});

describe('the saved review', () => {
  const review = buildMedicationReview({
    reviewedAt: '2026-11-07T08:00:00.000Z', reviewedBy: 'user-nurse-ayen', reviewedByName: 'Nurse Ayen',
    activeCount: 2,
    changes: recordMedicationChange(recordMedicationChange(NO_MEDICATION_CHANGES, 'added', 'Metformin'), 'stopped', 'Amoxicillin'),
  });

  it('names who reviewed it and what changed', () => {
    expect(review).toMatchObject({ reviewedBy: 'user-nurse-ayen', activeCount: 2, added: ['Metformin'], stopped: ['Amoxicillin'], edited: [], removed: [] });
    expect(formatMedicationReview(review)).toBe('Reviewed by Nurse Ayen. 2 on the list. Added: Metformin. Stopped: Amoxicillin.');
    expect(formatMedicationReview({ ...review, added: [], stopped: [] })).toBe('Reviewed by Nurse Ayen. 2 on the list. No changes.');
  });

  it('an edit to a medicine added in the same triage stays "added"; a correction carries the saved changes forward', () => {
    const changes = recordMedicationChange(recordMedicationChange(NO_MEDICATION_CHANGES, 'added', 'Metformin'), 'edited', 'Metformin');
    expect(changes).toMatchObject({ added: ['Metformin'], edited: [] });
    expect(mergeMedicationChanges(review, recordMedicationChange(NO_MEDICATION_CHANGES, 'edited', 'Losartan')))
      .toMatchObject({ added: ['Metformin'], stopped: ['Amoxicillin'], edited: ['Losartan'] });
  });

  it('reaches the note as the triage history', () => {
    const triage = {
      _id: 't-1', type: 'triage', patientId: PATIENT, patientName: 'Nyakuma Deng', priority: 'GREEN',
      airway: 'clear', breathing: 'normal', circulation: 'normal', consciousness: 'alert',
      triagedBy: 'user-nurse-ayen', triagedByName: 'Nurse Ayen', triagedAt: '2026-11-07T08:00:00.000Z',
      status: 'seen', medicationReview: review, createdAt: '', updatedAt: '',
    } as unknown as TriageDoc;
    expect(noteTextFromTriage(triage, ['hpi']).hpi).toContain('Medication list: Reviewed by Nurse Ayen. 2 on the list. Added: Metformin.');
  });
});
