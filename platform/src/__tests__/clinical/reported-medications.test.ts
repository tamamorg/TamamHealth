import {
  HISTORY_DOMAINS, MEDICATION_HISTORY_DOMAIN, formatHistoryEntry, formatPastHistory, historyForDomain, isHistoryDomain,
} from '@/lib/clinical/patient-history';
import { formatMedications, snapshotLoadFailed } from '@/lib/clinical-notes/chart-snapshot';
import type { HistoryEntryDoc, PrescriptionDoc } from '@/lib/db-types';

const entry = (o: Partial<HistoryEntryDoc>): HistoryEntryDoc => ({
  _id: 'h1', type: 'history_entry', patientId: 'p1', domain: 'medication', title: 'Metformin 500 mg',
  status: 'active', createdAt: '2026-10-24T08:00:00Z', updatedAt: '2026-10-24T08:00:00Z',
  ...o,
}) as HistoryEntryDoc;

describe('patient-reported medications', () => {
  it('is a recordable history domain but not a History tab section', () => {
    expect(isHistoryDomain(MEDICATION_HISTORY_DOMAIN)).toBe(true);
    expect(HISTORY_DOMAINS.map(d => d.id)).not.toContain(MEDICATION_HISTORY_DOMAIN);
  });

  it('reads as medicine, how it is taken, and since when', () => {
    expect(formatHistoryEntry(entry({ detail: 'twice daily', when: '2019' })))
      .toBe('Metformin 500 mg — twice daily (taking since 2019)');
    expect(formatHistoryEntry(entry({}))).toBe('Metformin 500 mg');
  });

  it('stays out of past medical history', () => {
    expect(formatPastHistory({ entries: [entry({})] })).toBe('');
  });

  it('drops entries marked in error', () => {
    expect(historyForDomain([entry({ status: 'entered_in_error' })], 'medication')).toEqual([]);
  });

  it('lands in a note’s Medications section, labelled as reported', () => {
    const rx = { _id: 'rx', medication: 'Amoxicillin', dose: '500 mg', status: 'pending' } as PrescriptionDoc;
    expect(formatMedications([rx], [entry({ detail: 'twice daily' })])).toBe(
      '• Amoxicillin · 500 mg\n• Metformin 500 mg — twice daily (patient-reported)',
    );
  });

  it('flags the Medications section when the history read failed', () => {
    expect(snapshotLoadFailed('medications', { historyLoadFailed: true })).toBe(true);
  });
});
