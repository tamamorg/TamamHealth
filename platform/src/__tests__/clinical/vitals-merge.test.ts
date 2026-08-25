/**
 * mergeVitalsTimeline (src/lib/clinical/vitals.ts) — merges a patient's
 * MedicalRecordDoc vitals and TriageDoc vitals into one normalized,
 * newest-first timeline. Pure/DB-free: chart-snapshot.ts's note vitals
 * lookup and the patient chart's vitals band/table/trends both build on it.
 */
import { mergeVitalsTimeline } from '@/lib/clinical/vitals';
import type { MedicalRecordDoc, TriageDoc } from '@/lib/db-types';

function record(overrides: Partial<MedicalRecordDoc> & { _id: string }): MedicalRecordDoc {
  return {
    type: 'medical_record',
    patientId: 'p1',
    hospitalId: 'h1',
    hospitalName: 'Test Hospital',
    visitDate: '2026-01-01',
    visitType: 'outpatient',
    providerName: 'Dr. Test',
    providerRole: 'doctor',
    department: 'OPD',
    chiefComplaint: 'Cough',
    historyOfPresentIllness: '',
    diagnoses: [],
    prescriptions: [],
    labResults: [],
    treatmentPlan: '',
    createdAt: '2026-01-01T08:00:00.000Z',
    updatedAt: '2026-01-01T08:00:00.000Z',
    ...overrides,
  } as unknown as MedicalRecordDoc;
}

function triage(overrides: Partial<TriageDoc> & { _id: string }): TriageDoc {
  return {
    type: 'triage',
    patientId: 'p1',
    patientName: 'Test Patient',
    airway: 'clear',
    breathing: 'normal',
    circulation: 'normal',
    consciousness: 'alert',
    priority: 'green',
    triagedBy: 'u1',
    triagedByName: 'Nurse Test',
    triagedAt: '2026-01-01T07:00:00.000Z',
    status: 'seen',
    createdAt: '2026-01-01T07:00:00.000Z',
    updatedAt: '2026-01-01T07:00:00.000Z',
    ...overrides,
  } as unknown as TriageDoc;
}

describe('mergeVitalsTimeline', () => {
  test('record-only: returns one Consult-sourced entry with numeric vitals', () => {
    const rows = mergeVitalsTimeline([
      record({
        _id: 'mr1',
        consultedAt: '2026-02-01T10:00:00.000Z',
        vitalSigns: { temperature: 37.2, systolic: 118, diastolic: 76, pulse: 72, respiratoryRate: 16, oxygenSaturation: 98, weight: 60, height: 165, bmi: 22 } as MedicalRecordDoc['vitalSigns'],
      }),
    ], []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'mr1', source: 'Consult', temperature: 37.2, systolic: 118, diastolic: 76 });
  });

  test('a nursing-vitals record is tagged Nursing, not Consult', () => {
    const rows = mergeVitalsTimeline([
      record({
        _id: 'mr-nurse',
        recordKind: 'nursing_vitals',
        consultedAt: '2026-02-01T10:00:00.000Z',
        vitalSigns: { temperature: 38.1 } as MedicalRecordDoc['vitalSigns'],
      }),
    ], []);
    expect(rows[0].source).toBe('Nursing');
  });

  test('an appended correction replaces the original row without erasing provenance', () => {
    const original = record({
      _id: 'mr-wrong', recordKind: 'nursing_vitals', consultedAt: '2026-02-01T10:00:00.000Z',
      vitalSigns: { temperature: 39.1 } as MedicalRecordDoc['vitalSigns'],
    });
    const correction = record({
      _id: 'mr-corrected', recordKind: 'nursing_vitals', consultedAt: '2026-02-01T10:05:00.000Z',
      correctsRecordId: original._id, correctionReason: 'Decimal entered incorrectly',
      vitalSigns: { temperature: 36.9 } as MedicalRecordDoc['vitalSigns'],
    });

    const rows = mergeVitalsTimeline([original, correction], []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'mr-corrected', temperature: 36.9, corrected: true,
      correctionReason: 'Decimal entered incorrectly',
    });
  });

  test('triage-only: returns one Triage-sourced entry with strings parsed to numbers', () => {
    const rows = mergeVitalsTimeline([], [
      triage({
        _id: 't1',
        triagedAt: '2026-02-01T09:00:00.000Z',
        temperature: '38.5',
        systolic: '130',
        diastolic: '85',
        pulse: '90',
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 't1', source: 'Triage', temperature: 38.5, systolic: 130, diastolic: 85, pulse: 90 });
    // Confirms actual numeric type, not just loose equality against a string.
    expect(typeof rows[0].temperature).toBe('number');
  });

  test('merge ordering: newest first across both sources', () => {
    const rows = mergeVitalsTimeline(
      [
        record({ _id: 'mr-old', consultedAt: '2026-01-01T08:00:00.000Z', vitalSigns: { temperature: 36.9 } as MedicalRecordDoc['vitalSigns'] }),
        record({ _id: 'mr-new', consultedAt: '2026-01-03T08:00:00.000Z', vitalSigns: { temperature: 37.0 } as MedicalRecordDoc['vitalSigns'] }),
      ],
      [
        triage({ _id: 't-mid', triagedAt: '2026-01-02T08:00:00.000Z', temperature: '37.8' }),
      ],
    );
    expect(rows.map(r => r.id)).toEqual(['mr-new', 't-mid', 'mr-old']);
  });

  test('a same-instant tie resolves to the record, not the triage stop', () => {
    const sameInstant = '2026-01-05T08:00:00.000Z';
    const rows = mergeVitalsTimeline(
      [record({ _id: 'mr-tie', consultedAt: sameInstant, vitalSigns: { temperature: 37.0 } as MedicalRecordDoc['vitalSigns'] })],
      [triage({ _id: 't-tie', triagedAt: sameInstant, temperature: '37.0' })],
    );
    expect(rows[0].id).toBe('mr-tie');
    expect(rows[0].source).toBe('Consult');
  });

  test('partial vitals: only the captured fields are populated, others stay undefined', () => {
    const rows = mergeVitalsTimeline([], [
      triage({ _id: 't-partial', triagedAt: '2026-02-01T09:00:00.000Z', temperature: '38.0', systolic: undefined, diastolic: undefined, pulse: undefined }),
    ]);
    expect(rows[0].temperature).toBe(38.0);
    expect(rows[0].systolic).toBeUndefined();
    expect(rows[0].diastolic).toBeUndefined();
    expect(rows[0].pulse).toBeUndefined();
  });

  test('a record/triage row with no vitals at all is dropped, not returned empty', () => {
    const rows = mergeVitalsTimeline(
      [record({ _id: 'mr-empty' })],
      [triage({ _id: 't-empty' })],
    );
    expect(rows).toHaveLength(0);
  });
});
