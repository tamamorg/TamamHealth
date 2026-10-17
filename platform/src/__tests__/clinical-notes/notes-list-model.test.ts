import {
  mergeNoteRows, filterNoteRows, statusCounts, typeCounts, RECORD_TYPE_KEY,
} from '@/components/clinical-notes/notes-list-model';
import type { ClinicalNoteDoc } from '@/lib/clinical-notes/types';
import type { MedicalRecordDoc, PatientNoteDoc } from '@/lib/db-types';

const note = (o: Partial<ClinicalNoteDoc>): ClinicalNoteDoc => ({
  _id: 'n1', type: 'clinical_note', patientId: 'p1', patientName: 'A B', noteType: 'soap',
  sections: [{ sectionId: 'subjective', text: 'cough for 3 days' }],
  serviceDate: '2026-10-01', serviceTime: '09:00', status: 'draft',
  ...o,
}) as ClinicalNoteDoc;

const record = (o: Partial<MedicalRecordDoc>): MedicalRecordDoc => ({
  _id: 'r1', type: 'medical_record', patientId: 'p1', visitDate: '2026-09-20',
  chiefComplaint: 'Fever', providerName: 'Dr. Igga', documentStatus: 'signed',
  ...o,
}) as unknown as MedicalRecordDoc;

describe('mergeNoteRows', () => {
  it('shows consultation records so the tab is not empty, newest first', () => {
    const rows = mergeNoteRows([note({})], [record({})]);
    expect(rows.map(r => r.kind)).toEqual(['clinical', 'record']);
    expect(rows[1]).toMatchObject({ typeKey: RECORD_TYPE_KEY, status: 'signed', author: 'Dr. Igga', preview: 'Fever' });
  });

  it('works with records only', () => {
    expect(mergeNoteRows([], [record({})])).toHaveLength(1);
  });

  it('drops nursing vitals, corrections and records already covered by a note', () => {
    const rows = mergeNoteRows(
      [note({ encounterId: 'e1' })],
      [
        record({ _id: 'r2', recordKind: 'nursing_vitals' }),
        record({ _id: 'r3', correctsRecordId: 'r1' }),
        record({ _id: 'r4', encounterId: 'e1' }),
        record({ _id: 'r5', encounterId: 'e2' }),
      ],
    );
    expect(rows.map(r => r.id).sort()).toEqual(['n1', 'r5']);
  });

  it('merges legacy notes by created time', () => {
    const legacy = { _id: 'l1', type: 'patient_note', patientId: 'p1', body: 'old', authorId: 'u', authorName: 'Nurse', createdAt: '2026-10-05T08:00:00Z' } as PatientNoteDoc;
    const rows = mergeNoteRows([note({})], [], [legacy]);
    expect(rows[0].kind).toBe('legacy');
  });
});

describe('filters', () => {
  const rows = mergeNoteRows(
    [
      note({ _id: 'a', status: 'draft' }),
      note({ _id: 'b', status: 'signed', noteType: 'phone', serviceDate: '2026-10-02' }),
      note({ _id: 'c', status: 'awaiting_cosign', noteType: 'hp', serviceDate: '2026-10-03' }),
      note({ _id: 'd', status: 'amended', serviceDate: '2026-10-04' }),
    ],
    [record({})],
  );
  const base = { typeKey: 'all', status: 'all' as const, search: '' };

  it('filters by status', () => {
    expect(filterNoteRows(rows, { ...base, status: 'unsigned' }).map(r => r.id)).toEqual(['a']);
    expect(filterNoteRows(rows, { ...base, status: 'signed' }).map(r => r.id).sort()).toEqual(['b', 'r1']);
    expect(filterNoteRows(rows, { ...base, status: 'awaiting_cosign' }).map(r => r.id)).toEqual(['c']);
    expect(filterNoteRows(rows, { ...base, status: 'amended' }).map(r => r.id)).toEqual(['d']);
  });

  it('filters by type and searches', () => {
    expect(filterNoteRows(rows, { ...base, typeKey: 'phone' }).map(r => r.id)).toEqual(['b']);
    expect(filterNoteRows(rows, { ...base, search: 'igga' }).map(r => r.id)).toEqual(['r1']);
  });

  it('a status typed in full in search matches only that status', () => {
    expect(filterNoteRows(rows, { ...base, search: 'Signed' }).map(r => r.id).sort()).toEqual(['b', 'r1']);
    expect(filterNoteRows(rows, { ...base, search: 'draft' }).map(r => r.id)).toEqual(['a']);
    expect(filterNoteRows(rows, { ...base, search: 'cosign' }).map(r => r.id)).toEqual(['c']);
  });

  it('counts per status within the chosen type and lists types present', () => {
    expect(statusCounts(rows, 'all')).toEqual({ all: 5, unsigned: 1, signed: 2, awaiting_cosign: 1, amended: 1 });
    expect(statusCounts(rows, 'soap').all).toBe(2);
    expect(typeCounts(rows).map(t => t.typeKey).sort()).toEqual(['hp', 'phone', RECORD_TYPE_KEY, 'soap'].sort());
  });
});
