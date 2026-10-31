import { codedDiagnosis, recordFormPatch, recordFormValues } from '@/components/patients/detail/RecordSignPanel';
import type { MedicalRecordDoc } from '@/lib/db-types';

const record = {
  _id: 'm1',
  chiefComplaint: 'Fever',
  treatmentPlan: '',
  pastMedicalHistory: { chronicConditions: ['Asthma'], notes: 'Old' },
  followUp: { date: '2026-11-01', reason: 'Review' },
} as unknown as MedicalRecordDoc;

describe('record sign form', () => {
  it('reads top-level and nested text fields', () => {
    const values = recordFormValues(record);
    expect(values.chiefComplaint).toBe('Fever');
    expect(values['pastMedicalHistory.notes']).toBe('Old');
    expect(values['drugHistory.chronicMedications']).toBe('');
  });

  it('writes nothing for an untouched draft', () => {
    expect(recordFormPatch(record, recordFormValues(record))).toEqual({});
  });

  it('keeps the rest of a nested group when one field changes', () => {
    const values = { ...recordFormValues(record), 'pastMedicalHistory.notes': 'New' };
    expect(recordFormPatch(record, values)).toEqual({
      pastMedicalHistory: { chronicConditions: ['Asthma'], notes: 'New' },
    });
  });

  it('seeds the required list when a group did not exist', () => {
    const values = { ...recordFormValues(record), 'drugHistory.chronicMedications': 'Metformin' };
    expect(recordFormPatch(record, values)).toEqual({
      drugHistory: { allergies: [], chronicMedications: 'Metformin' },
    });
  });

  it('removes a follow-up once both fields are cleared', () => {
    const values = { ...recordFormValues(record), 'followUp.date': '', 'followUp.reason': '' };
    expect(recordFormPatch(record, values)).toEqual({ followUp: undefined });
  });

  it('codes a picked diagnosis in both code fields, the first as primary', () => {
    expect(codedDiagnosis('1F40', 'Malaria', true)).toMatchObject({ icd10Code: '1F40', icd11Code: '1F40', type: 'primary' });
    expect(codedDiagnosis('CA40', 'Pneumonia', false).type).toBe('secondary');
  });
});
