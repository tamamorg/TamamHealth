import { buildClinicalVisitSummaryHtml, visitDiagnoses } from '@/lib/clinical-visit-summary';
import type { MedicalRecordDoc, PatientDoc } from '@/lib/db-types';

const patient = { _id: 'pat-1', firstName: 'Sarah', surname: 'Taylor', hospitalNumber: '10000TA', dateOfBirth: '1964-09-09', gender: 'Female', allergies: [] } as unknown as PatientDoc;
const rec = (diagnoses: unknown[]) => ({ _id: 'r1', consultedAt: '2026-10-28T03:12:00Z', diagnoses } as unknown as MedicalRecordDoc);

describe('clinical visit summary', () => {
  it('ranks diagnoses and marks suspected ones provisional', () => {
    const d = visitDiagnoses([rec([
      { name: 'Headache', type: 'secondary', certainty: 'confirmed' },
      { name: 'Pneumonia due to SARS-CoV-2', type: 'primary', certainty: 'suspected' },
    ])], '2026-10-28');
    expect(d).toEqual([
      { name: 'Pneumonia due to SARS-CoV-2', certainty: 'Provisional', rank: 1 },
      { name: 'Headache', certainty: 'Confirmed', rank: 2 },
    ]);
  });

  it('prints the O3 sections in order, the patient block first', () => {
    const html = buildClinicalVisitSummaryHtml({
      patient, day: '2026-10-28', facilityName: 'Juba Teaching Hospital',
      records: [rec([{ name: 'Malaria', type: 'primary', certainty: 'confirmed' }])],
      notes: [], labs: [], prescriptions: [], problems: [],
      vitals: { id: 'v', at: '2026-10-28', source: 'Nursing', systolic: 100, diastolic: 60, pulse: 80 } as never,
    });
    const order = ['Patient Information', 'Vital Signs', 'Diagnoses', 'Conditions', 'Lab Results', 'Allergies', 'Active Medications', 'Visit Notes'];
    const positions = order.map(t => html.indexOf(`>${t}</h2>`));
    expect(positions.every(p => p > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(html).toContain('100/60 mmHg');
    expect(html).toContain('<h2 class="doc-title">Visit Summary</h2>');
    expect(html).toContain('No data recorded');
    expect(html).toContain('counter(pages)');
  });

  it('escapes what it prints', () => {
    const html = buildClinicalVisitSummaryHtml({
      patient: { ...patient, firstName: '<b>x</b>' } as PatientDoc, day: '2026-10-28',
      records: [], notes: [], labs: [], prescriptions: [], problems: [],
    });
    expect(html).not.toContain('<b>x</b>');
  });
});
