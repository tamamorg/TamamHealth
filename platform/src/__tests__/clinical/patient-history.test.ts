/**
 * @jest-environment node
 *
 * The patient's standing history: how an entry reads as a line, and what each
 * of a note's history sections carries.
 *
 * These lines are frozen into signed notes and split by the referral summary,
 * so their shape is a contract rather than presentation.
 */
import type { HistoryEntryDoc, ProblemDoc, ProcedureDoc } from '@/lib/db-types';
import {
  activeHistory, existingSocialEntry, formatHistoryDomain, formatHistoryEntry,
  formatPastHistory, historyForDomain, performedProcedures,
} from '@/lib/clinical/patient-history';
import { snapshotForSection } from '@/lib/clinical-notes/chart-snapshot';
import { socialHistoryRows } from '@/lib/clinical-notes/social-history-summary';

let seq = 0;
const entry = (over: Partial<HistoryEntryDoc>): HistoryEntryDoc => ({
  _id: `history-${++seq}`,
  type: 'history_entry',
  patientId: 'pat-1',
  domain: 'medical',
  title: 'Typhoid',
  status: 'active',
  createdAt: `2026-10-0${(seq % 9) + 1}T08:00:00Z`,
  updatedAt: '2026-10-01T08:00:00Z',
  ...over,
});

const problem = (over: Partial<ProblemDoc>): ProblemDoc => ({
  _id: `problem-${++seq}`, type: 'problem', patientId: 'pat-1', name: 'Hypertension',
  status: 'active', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...over,
});

const procedure = (over: Partial<ProcedureDoc>): ProcedureDoc => ({
  _id: `procedure-${++seq}`, type: 'procedure', patientId: 'pat-1', name: 'Incision and drainage',
  date: '2026-03-02', createdAt: '2026-03-02T00:00:00Z', updatedAt: '2026-03-02T00:00:00Z', ...over,
} as ProcedureDoc);

describe('formatHistoryEntry', () => {
  it('reads a medical entry as the illness, when, then detail', () => {
    expect(formatHistoryEntry(entry({ title: 'Typhoid', when: '2019', detail: 'admitted 5 days' })))
      .toBe('Typhoid (2019) — admitted 5 days');
    expect(formatHistoryEntry(entry({ title: 'Blood transfusion' }))).toBe('Blood transfusion');
  });

  it('adds where an operation was done', () => {
    expect(formatHistoryEntry(entry({
      domain: 'surgical', title: 'Caesarean section', when: '2021', facility: 'Juba Teaching Hospital',
    }))).toBe('Caesarean section (2021) — Juba Teaching Hospital');
  });

  it('leads family history with the relative', () => {
    expect(formatHistoryEntry(entry({
      domain: 'family', relation: 'Mother', title: 'Diabetes', when: 'in her fifties',
    }))).toBe('Mother: Diabetes (in her fifties)');
    // No relative recorded: the condition alone, not ": Diabetes".
    expect(formatHistoryEntry(entry({ domain: 'family', title: 'Diabetes' }))).toBe('Diabetes');
  });

  it('writes social history as "Factor: finding"', () => {
    expect(formatHistoryEntry(entry({
      domain: 'social', factor: 'tobacco', title: 'Tobacco', detail: 'Never smoked',
    }))).toBe('Tobacco: Never smoked');
  });
});

describe('reading the history', () => {
  it('leaves out entries marked entered in error', () => {
    const rows = [entry({ title: 'Typhoid' }), entry({ title: 'Wrong patient', status: 'entered_in_error' })];
    expect(activeHistory(rows).map(e => e.title)).toEqual(['Typhoid']);
    expect(formatHistoryDomain(rows, 'medical')).toBe('• Typhoid');
  });

  it('orders social history the way it is asked, not the way it was typed', () => {
    const rows = [
      entry({ domain: 'social', factor: 'occupation', title: 'Occupation', detail: 'Teacher' }),
      entry({ domain: 'social', factor: 'other', title: 'Diet', detail: 'One meal a day' }),
      entry({ domain: 'social', factor: 'tobacco', title: 'Tobacco', detail: 'Never smoked' }),
    ];
    expect(historyForDomain(rows, 'social').map(e => e.title)).toEqual(['Tobacco', 'Occupation', 'Diet']);
  });

  it('finds the line a single-answer factor already has, so saving it again replaces it', () => {
    const tobacco = entry({ domain: 'social', factor: 'tobacco', title: 'Tobacco', detail: 'Current smoker' });
    const rows = [tobacco, entry({ domain: 'social', factor: 'other', title: 'Diet', detail: 'Vegetarian' })];
    expect(existingSocialEntry(rows, 'tobacco')).toBe(tobacco);
    expect(existingSocialEntry(rows, 'alcohol')).toBeUndefined();
    // "Other" can hold several lines; none of them is replaced by a new one.
    expect(existingSocialEntry(rows, 'other')).toBeUndefined();
  });

  it('does not offer a withdrawn factor as the one to replace', () => {
    const rows = [entry({ domain: 'social', factor: 'tobacco', title: 'Tobacco', detail: 'x', status: 'entered_in_error' })];
    expect(existingSocialEntry(rows, 'tobacco')).toBeUndefined();
  });
});

describe('performedProcedures', () => {
  it('counts what was done, not what was only ordered or withdrawn', () => {
    const rows = [
      procedure({ name: 'Legacy, no status' }),
      procedure({ name: 'Completed', status: 'completed' }),
      procedure({ name: 'Ordered', status: 'ordered' }),
      procedure({ name: 'Aborted', status: 'aborted' }),
      procedure({ name: 'Mistake', status: 'completed', recordStatus: 'entered_in_error' }),
    ];
    expect(performedProcedures(rows).map(p => p.name)).toEqual(['Legacy, no status', 'Completed']);
  });
});

describe('formatPastHistory', () => {
  it('reads the problem list, then medical entries, then operations', () => {
    const text = formatPastHistory({
      problems: [
        problem({ name: 'Hypertension', icd11Code: 'BA00', status: 'chronic', onsetDate: '2020-01-01' }),
        problem({ name: 'Malaria', status: 'resolved', resolvedDate: '2025-03-10' }),
        problem({ name: 'Set aside', status: 'inactive' }),
      ],
      entries: [
        entry({ title: 'Typhoid', when: '2019' }),
        entry({ domain: 'surgical', title: 'Appendicectomy', when: '2015' }),
        entry({ domain: 'family', relation: 'Mother', title: 'Diabetes' }),
      ],
      procedures: [procedure({ name: 'Incision and drainage', date: '2026-03-02', hospitalName: 'Juba Clinic' })],
    });
    expect(text.split('\n')).toEqual([
      '• Hypertension [BA00] (since 2020-01-01) — chronic',
      '• Malaria — resolved 2025-03-10',
      '• Typhoid (2019)',
      '• Surgical: Appendicectomy (2015)',
      '• Surgical: Incision and drainage (2026-03-02) — Juba Clinic',
    ]);
  });

  it('is empty when the chart holds nothing, rather than asserting a clean history', () => {
    expect(formatPastHistory({ entries: [] })).toBe('');
  });
});

describe('a note’s history sections', () => {
  const input = {
    historyEntries: [
      entry({ domain: 'family', relation: 'Father', title: 'Hypertension' }),
      entry({ domain: 'social', factor: 'alcohol', title: 'Alcohol', detail: 'Occasional' }),
    ],
    problems: [problem({ name: 'Asthma' })],
  };

  it('snapshot each domain from the chart', () => {
    expect(snapshotForSection('past_medical_history', input)).toBe('• Asthma');
    expect(snapshotForSection('family_history', input)).toBe('• Father: Hypertension');
    expect(snapshotForSection('social_history', input)).toBe('• Alcohol: Occasional');
  });

  it('say nothing for a patient with no history — there is no "none known" to fall back to', () => {
    expect(snapshotForSection('family_history', {})).toBe('');
    expect(snapshotForSection('social_history', {})).toBe('');
    expect(snapshotForSection('past_medical_history', {})).toBe('');
  });

  it('give the referral summary one row per social fact, from the chart and the visit', () => {
    const rows = socialHistoryRows({
      sections: [{
        sectionId: 'social_history',
        snapshot: '• Tobacco: Never smoked\n• Alcohol: Occasional',
        text: 'Recently moved to Juba',
      }],
    });
    expect(rows).toEqual([
      { comment: 'Tobacco', description: 'Never smoked' },
      { comment: 'Alcohol', description: 'Occasional' },
      { comment: '', description: 'Recently moved to Juba' },
    ]);
  });
});
