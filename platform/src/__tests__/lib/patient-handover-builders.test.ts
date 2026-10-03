/**
 * What the patient is handed: the printed script, the texted script, the visit
 * summary, and the text plumbing under them. All pure builders.
 */
import { maskPhone, smsSegments, toSmsSafe } from '@/lib/sms/text';
import {
  buildPrescriptionScriptHtml, buildPrescriptionText, canRerouteToOutsidePharmacy, scriptDate, scriptQuantity,
  scriptReference, type ScriptContext,
} from '@/lib/prescription-script';
import {
  buildVisitSummary, buildVisitSummaryHtml, buildVisitSummaryText, isVisitSummaryEmpty, visitDays,
} from '@/lib/visit-summary';
import type { AppointmentDoc, LabResultDoc, MedicalRecordDoc, PrescriptionDoc } from '@/lib/db-types';
import type { ClinicalNoteDoc } from '@/lib/clinical-notes/types';

function rx(overrides: Partial<PrescriptionDoc> = {}): PrescriptionDoc {
  return {
    _id: 'rx-0b7c2f6e-51d0-4b0e-9c7e-2a11d94f2a9c',
    type: 'prescription',
    patientId: 'pat-1',
    patientName: 'Mary Akol Deng',
    medication: 'Artesunate-Amodiaquine',
    dose: 'As directed',
    route: 'Tablet',
    frequency: 'One tablet twice daily after food',
    duration: '3 days',
    prescribedBy: 'Dr. James Igga',
    status: 'pending',
    orderStatus: 'prescribed',
    quantityToDispense: 6,
    createdAt: '2026-10-03T08:30:00.000Z',
    updatedAt: '2026-10-03T08:30:00.000Z',
    ...overrides,
  } as PrescriptionDoc;
}

const CTX: ScriptContext = {
  patient: { name: 'Mary Akol Deng', hospitalNumber: 'TAB-000123', ageLabel: '34y', sex: 'Female', allergies: ['Penicillin'] },
  facilityName: 'Wau State Hospital',
  prescriberName: 'Dr. James Igga',
  issuedAt: '2026-10-03T09:00:00',
};

describe('sms text helpers', () => {
  it('replaces typographic characters that would force UCS-2', () => {
    const safe = toSmsSafe('One tablet — twice daily · “after food”…');
    expect(safe).toBe('One tablet - twice daily - "after food"...');
    expect(smsSegments(safe).encoding).toBe('gsm7');
  });

  it('counts a single and a concatenated GSM-7 message', () => {
    expect(smsSegments('a'.repeat(160))).toMatchObject({ encoding: 'gsm7', segments: 1, perSegment: 160 });
    expect(smsSegments('a'.repeat(161))).toMatchObject({ encoding: 'gsm7', segments: 2, perSegment: 153 });
    expect(smsSegments('')).toMatchObject({ segments: 0 });
  });

  it('counts extension characters twice and non-GSM text as UCS-2', () => {
    expect(smsSegments('[ok]').length).toBe(6);
    expect(smsSegments('دواء')).toMatchObject({ encoding: 'ucs2', segments: 1, perSegment: 70 });
    expect(smsSegments('د'.repeat(71)).segments).toBe(2);
  });

  it('masks a phone number down to what identifies the send', () => {
    expect(maskPhone('+211912345145')).toBe('+211•••••145');
    expect(maskPhone('')).toBe('');
  });
});

describe('prescription script', () => {
  it('derives a stable short reference from the document id', () => {
    expect(scriptReference(rx())).toBe('RX-4F2A9C');
  });

  it('formats dates the same on every device', () => {
    expect(scriptDate('2026-10-03')).toBe('03 Oct 2026');
    expect(scriptDate('')).toBe('');
  });

  it('prints an issued prescription, not a draft', () => {
    const html = buildPrescriptionScriptHtml([rx()], CTX);
    expect(html).toContain('Artesunate-Amodiaquine');
    expect(html).toContain('One tablet twice daily after food');
    expect(html).toContain('RX-4F2A9C');
    expect(html).toContain('Penicillin');
    expect(html).toContain('Wau State Hospital');
    expect(html).not.toMatch(/DRAFT|NOT YET ISSUED/);
  });

  it('never reprints a discontinued order as valid', () => {
    const html = buildPrescriptionScriptHtml([rx({ status: 'discontinued' })], CTX);
    expect(html).not.toContain('Artesunate-Amodiaquine');
    expect(html).toContain('No active prescription to print.');
  });

  it('escapes record text placed in the document', () => {
    const html = buildPrescriptionScriptHtml([rx({ frequency: '<script>alert(1)</script>' })], CTX);
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('texts the medicines and directions without the diagnosis or record number', () => {
    const { text, included } = buildPrescriptionText([rx({ indication: '1F40 · Malaria' })], CTX);
    expect(included).toHaveLength(1);
    expect(text).toContain('Wau State Hospital - Prescription');
    expect(text).toContain('Artesunate-Amodiaquine, qty 6');
    expect(text).toContain('One tablet twice daily after food for 3 days');
    expect(text).toContain('Ref RX-4F2A9C');
    expect(text).not.toMatch(/Malaria|TAB-000123|Penicillin/);
    expect(smsSegments(text).encoding).toBe('gsm7');
  });

  it('numbers a multi-item script and lists every reference', () => {
    const second = rx({ _id: 'rx-aaaaaaaa-bbbb-cccc-dddd-eeeeee11b2c3', medication: 'Paracetamol 500mg', quantityToDispense: 18 });
    const { text } = buildPrescriptionText([rx(), second], CTX);
    expect(text).toContain('1. Artesunate-Amodiaquine');
    expect(text).toContain('2. Paracetamol 500mg, qty 18');
    expect(text).toContain('Ref RX-4F2A9C, RX-11B2C3');
  });

  it('withholds controlled medicines from a text', () => {
    const morphine = rx({ _id: 'rx-morphine-000001', medication: 'Morphine' });
    const result = buildPrescriptionText([rx(), morphine], CTX, item => item.medication === 'Morphine');
    expect(result.included.map(i => i.medication)).toEqual(['Artesunate-Amodiaquine']);
    expect(result.withheld.map(i => i.medication)).toEqual(['Morphine']);
    expect(result.text).not.toContain('Morphine');
    // Nothing textable at all: no message body.
    expect(buildPrescriptionText([morphine], CTX, () => true).text).toBe('');
  });

  it('writes the balance owed on a part-filled order, never the full course again', () => {
    // 30 prescribed, 10 dispensed on site, the rest referred out.
    const partFilled = rx({ medication: 'Morphine', quantityToDispense: 30, quantityDispensed: 10, orderStatus: 'stockout_partial_referred' });
    expect(scriptQuantity(partFilled)).toBe(20);
    const html = buildPrescriptionScriptHtml([partFilled], CTX);
    expect(html).toContain('<td class="num">20</td>');
    expect(html).not.toContain('<td class="num">30</td>');
    expect(html).toContain('Balance only');
    expect(html).toContain('10 of 30 already dispensed at Wau State Hospital');
    expect(buildPrescriptionText([partFilled], CTX).text).toContain('Morphine, qty 20 (balance)');
    // An untouched order is its full course.
    expect(scriptQuantity(rx({ quantityToDispense: 30 }))).toBe(30);
  });

  it('allows re-routing only before or after the pharmacist has the order', () => {
    expect(canRerouteToOutsidePharmacy(rx({ orderStatus: 'prescribed' }))).toBe(true);
    expect(canRerouteToOutsidePharmacy(rx({ orderStatus: undefined }))).toBe(true);
    expect(canRerouteToOutsidePharmacy(rx({ orderStatus: 'stockout_partial_referred' }))).toBe(true);
    expect(canRerouteToOutsidePharmacy(rx({ orderStatus: 'under_review' }))).toBe(false);
    expect(canRerouteToOutsidePharmacy(rx({ orderStatus: 'cleared_for_dispensing' }))).toBe(false);
    expect(canRerouteToOutsidePharmacy(rx({ status: 'dispensed', orderStatus: 'dispensed' }))).toBe(false);
  });
});

describe('visit summary', () => {
  const record = {
    _id: 'rec-1', type: 'medical_record', patientId: 'pat-1', hospitalId: 'hosp-001', hospitalName: 'Wau State Hospital',
    visitDate: '2026-10-03', visitType: 'outpatient', providerName: 'Dr. James Igga', providerRole: 'doctor',
    department: 'OPD', chiefComplaint: 'Fever and headache for 3 days', historyOfPresentIllness: '',
    vitalSigns: {}, diagnoses: [
      { icd10Code: '1F40', name: 'Malaria', type: 'primary', certainty: 'confirmed', severity: 'moderate' },
      { icd10Code: 'X', name: 'Typhoid', type: 'differential', certainty: 'suspected', severity: 'mild' },
    ],
    prescriptions: [], labResults: [], treatmentPlan: 'Start ACT; review Hb',
    followUp: { date: '2026-10-10', reason: 'Review' }, syncStatus: 'synced',
    createdAt: '2026-10-03T08:00:00.000Z', updatedAt: '2026-10-03T08:00:00.000Z',
  } as unknown as MedicalRecordDoc;

  const note = {
    _id: 'note-1', type: 'clinical_note', patientId: 'pat-1', patientName: 'Mary Akol Deng', noteType: 'soap',
    serviceDate: '2026-10-03', status: 'signed', signedByName: 'Dr. James Igga',
    sections: [
      { sectionId: 'plan', text: 'ACT x3d. Consider admission if no response.' },
      { sectionId: 'patient_education', text: 'Drink plenty of fluids and finish all the tablets.' },
      { sectionId: 'assessment', text: '', diagnoses: [{ id: 'd1', name: 'Malaria', addedAt: '2026-10-03' }] },
    ],
    createdAt: '2026-10-03T08:10:00.000Z', updatedAt: '2026-10-03T08:10:00.000Z',
  } as unknown as ClinicalNoteDoc;

  const lab = {
    _id: 'lab-1', type: 'lab_result', patientId: 'pat-1', testName: 'Malaria RDT', status: 'pending',
    result: 'POSITIVE', orderedAt: '2026-10-03T08:20:00', completedAt: '',
  } as unknown as LabResultDoc;

  const appointment = {
    _id: 'apt-1', type: 'appointment', patientId: 'pat-1', appointmentDate: '2026-10-10', appointmentTime: '09:00',
    status: 'scheduled', providerName: 'Dr. James Igga', reason: 'Malaria review',
  } as unknown as AppointmentDoc;

  const base = {
    today: '2026-10-03',
    visitDate: '2026-10-03',
    records: [record],
    notes: [note],
    prescriptions: [rx({ createdAt: '2026-10-03T08:30:00', fulfilment: 'external' })],
    labOrders: [lab],
    appointments: [appointment],
    patient: { name: 'Mary Akol Deng', hospitalNumber: 'TAB-000123' },
    facilityName: 'Wau State Hospital',
    clinicianName: 'Fallback Clinician',
  };

  it('lists the days the patient was seen, newest first', () => {
    expect(visitDays({
      records: [record],
      notes: [{ ...note, serviceDate: '2026-09-20' } as ClinicalNoteDoc],
      prescriptions: [rx({ createdAt: '2026-10-03T08:30:00' }), rx({ status: 'discontinued', createdAt: '2026-08-01T08:00:00' })],
    })).toEqual(['2026-10-03', '2026-09-20']);
  });

  it('gathers the visit from the record, the note, the orders and the diary', () => {
    const summary = buildVisitSummary(base);
    expect(summary.clinicianName).toBe('Dr. James Igga');
    expect(summary.reason).toBe('Fever and headache for 3 days');
    // De-duplicated across note and record; differentials are not told to the patient.
    expect(summary.diagnoses).toEqual(['Malaria']);
    expect(summary.medications).toEqual([expect.objectContaining({
      name: 'Artesunate-Amodiaquine', quantity: 6, outsidePharmacy: true,
    })]);
    // Named, with no status: the result is the clinic's to give.
    expect(summary.tests).toEqual(['Malaria RDT']);
    expect(summary.followUp).toMatchObject({ date: '2026-10-10', time: '09:00', with: 'Dr. James Igga' });
    expect(isVisitSummaryEmpty(summary)).toBe(false);
  });

  it('offers only patient-directed sections as advice, never the clinician plan', () => {
    const summary = buildVisitSummary(base);
    expect(summary.advice).toEqual(['Drink plenty of fluids and finish all the tablets.']);
    expect(buildVisitSummaryHtml(summary)).not.toContain('Consider admission');
  });

  it('falls back to the follow-up written in the record when nothing is booked', () => {
    const summary = buildVisitSummary({ ...base, appointments: [] });
    expect(summary.followUp).toMatchObject({ date: '2026-10-10', reason: 'Review' });
  });

  it('takes the earliest visit still to come, and prefers the booking on the same day', () => {
    const later = { ...appointment, _id: 'apt-2', appointmentDate: '2026-11-20', reason: 'Dental check' } as AppointmentDoc;
    // Record says the 10th; the only booking is weeks later.
    expect(buildVisitSummary({ ...base, appointments: [later] }).followUp).toMatchObject({ date: '2026-10-10', reason: 'Review' });
    // Both on the 10th: the booking, which has a time.
    expect(buildVisitSummary(base).followUp).toMatchObject({ date: '2026-10-10', time: '09:00' });
  });

  it('never prints a visit that has already passed as the next visit', () => {
    // Summarising the 3 Oct visit three weeks later: the appointment on the
    // 10th was never closed, and the record's follow-up date has gone by.
    const stale = buildVisitSummary({ ...base, today: '2026-10-24' });
    expect(stale.followUp).toBeUndefined();
    expect(buildVisitSummaryHtml(stale)).toContain('No follow-up visit is booked.');
  });

  it('puts a prescription on the visit that ordered it, even when written a day later', () => {
    const recordWithEncounter = { ...record, encounterId: 'enc-9' } as MedicalRecordDoc;
    const nextMorning = rx({ _id: 'rx-late-000001', medication: 'Ferrous Sulfate', createdAt: '2026-10-04T07:45:00', encounterId: 'enc-9' });
    const sources = { ...base, records: [recordWithEncounter], prescriptions: [...base.prescriptions, nextMorning] };
    expect(buildVisitSummary(sources).medications.map(m => m.name)).toEqual(['Artesunate-Amodiaquine', 'Ferrous Sulfate']);
    // It does not invent a visit of its own on the 4th.
    expect(visitDays(sources)).toEqual(['2026-10-03']);
  });

  it('lists a medicine written twice with the same directions once', () => {
    const again = rx({ _id: 'rx-dup-0000001', createdAt: '2026-10-03T09:10:00', fulfilment: 'external' });
    const summary = buildVisitSummary({ ...base, prescriptions: [...base.prescriptions, again] });
    expect(summary.medications).toHaveLength(1);
  });

  it('never carries a result value', () => {
    const summary = buildVisitSummary(base);
    expect(buildVisitSummaryHtml(summary)).not.toContain('POSITIVE');
    expect(buildVisitSummaryText(summary)).not.toContain('POSITIVE');
  });

  it('keeps the diagnosis out of the text unless the sender opts in', () => {
    const summary = buildVisitSummary(base);
    expect(buildVisitSummaryText(summary)).not.toContain('Malaria');
    expect(buildVisitSummaryText(summary)).not.toMatch(/Diagnosis/);
    // A test's name gives the condition away just as surely.
    expect(buildVisitSummaryText(summary)).toContain('Tests were ordered. Ask the clinic for your results.');
    expect(buildVisitSummaryText(summary, { includeDiagnosis: true })).toContain('Tests ordered: Malaria RDT.');
    expect(buildVisitSummaryText(summary, { includeDiagnosis: true })).toContain('Diagnosis: Malaria.');
    // The follow-up's reason names the condition too, so it follows the same switch.
    expect(buildVisitSummaryText(summary)).toContain('Next visit: 10 Oct 2026 at 09:00 with Dr. James Igga.');
    expect(buildVisitSummaryText(summary)).not.toContain('Malaria review');
    expect(buildVisitSummaryText(summary, { includeDiagnosis: true })).toContain('(Malaria review)');
    // The paper, handed to the patient, does name it.
    expect(buildVisitSummaryHtml(summary)).toContain('Malaria');
  });

  it('uses the sender\'s edited advice in place of the note\'s', () => {
    const summary = buildVisitSummary(base);
    const text = buildVisitSummaryText(summary, { advice: 'Rest for two days.' });
    expect(text).toContain('Advice: Rest for two days.');
    expect(text).not.toContain('Drink plenty');
    expect(smsSegments(text).encoding).toBe('gsm7');
  });

  it('flags a visit documented only by a draft note, and an empty one', () => {
    const draft = buildVisitSummary({ ...base, notes: [{ ...note, status: 'draft' } as ClinicalNoteDoc] });
    expect(draft.hasUnsignedNote).toBe(true);
    const empty = buildVisitSummary({
      ...base, visitDate: '2026-01-01', records: [], notes: [], prescriptions: [], labOrders: [], appointments: [],
    });
    expect(isVisitSummaryEmpty(empty)).toBe(true);
    expect(empty.clinicianName).toBe('Fallback Clinician');
  });
});
