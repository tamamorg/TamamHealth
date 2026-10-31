/**
 * The lab and pharmacy homes run on the doctor's workspace, but every row,
 * lane and count is the station's own: one row per patient (first order +N),
 * station status and lane, the chart link opening the station's form, and
 * patients the front desk routed to this person on the list.
 */
import { assembleLabWorklist, labFormHref } from '@/components/dashboards/LabHomeView';
import { assemblePharmacyWorklist, dispenseFormHref } from '@/components/dashboards/PharmacyHomeView';
import type { LabResultDoc, PatientDoc, PrescriptionDoc } from '@/lib/db-types';

const NOW = new Date('2026-10-29T10:00:00+02:00');
const me = { _id: 'u-lab', name: 'Lab Tech Gatluak Puok' };

const patient = (id: string, extra: Partial<PatientDoc> = {}) =>
  ({ _id: id, type: 'patient', firstName: id, surname: 'Test', hospitalNumber: `H-${id}`, gender: 'Female', ...extra }) as unknown as PatientDoc;

const lab = (id: string, patientId: string, testName: string, extra: Partial<LabResultDoc> = {}) => ({
  _id: id, type: 'lab_result', patientId, patientName: `${patientId} Test`, hospitalNumber: '', testName, specimen: 'Blood',
  status: 'pending', result: '', unit: '', referenceRange: '', abnormal: false, critical: false,
  orderedBy: 'Dr. James Igga', orderedAt: '2026-10-29T07:00:00.000Z', completedAt: '', ...extra,
}) as LabResultDoc;

const labLabels = {
  collect: 'To collect', bench: 'On the bench', resulted: 'Resulted', critical: 'Critical',
  assigned: 'Assigned to me', resultedToday: 'Resulted today', tests: (n: number) => `${n} tests`,
};

describe('assembleLabWorklist', () => {
  it('puts each patient on one row named by their most pressing test', () => {
    const { patients, counts } = assembleLabWorklist({
      currentUser: me,
      patients: [patient('p1'), patient('p2')],
      results: [
        lab('l1', 'p1', 'HIV Rapid Test'),
        lab('l2', 'p1', 'Full Blood Count', { status: 'in_progress' }),
        lab('l3', 'p1', 'Malaria RDT'),
        lab('l4', 'p2', 'Urinalysis'),
        lab('x1', 'p2', 'Chest X-Ray', { specimen: 'Imaging' }),
      ],
      labels: labLabels,
      now: NOW,
    });
    expect(patients.map(p => p._id)).toEqual(['p1', 'p2']);
    // The bench test leads: it is the one already being worked.
    expect(patients[0].ward).toBe('Full Blood Count +2');
    expect(patients[0].station).toMatchObject({ status: 'On the bench', lane: 'in_office', statusSubtext: '3 tests', chartHref: labFormHref('p1', 'l2') });
    expect(patients[1].station).toMatchObject({ status: 'To collect', lane: 'scheduled' });
    expect(counts).toEqual({ collect: 3, bench: 1, resulted: 0 });
  });

  it('flags a critical result red, and files today\'s results under Resulted', () => {
    const { patients, outstanding } = assembleLabWorklist({
      currentUser: me,
      patients: [patient('p1')],
      results: [lab('l1', 'p1', 'Haemoglobin', { status: 'completed', critical: true, result: '4.2', completedAt: '2026-10-29T07:40:00.000Z' })],
      labels: labLabels,
      now: NOW,
    });
    expect(patients[0]).toMatchObject({ triagePriority: 'RED' });
    expect(patients[0].station).toMatchObject({ lane: 'finished', statusTone: 'danger', statusSubtext: 'Critical' });
    expect(outstanding.find(o => o.label === 'Critical')?.count).toBe(1);
  });

  it('files a result under Resulted even while the same patient has a test open', () => {
    const { patients, counts } = assembleLabWorklist({
      currentUser: me,
      patients: [patient('p1')],
      results: [
        lab('l1', 'p1', 'Haemoglobin', { status: 'completed', result: '12', completedAt: '2026-10-29T07:40:00.000Z' }),
        lab('l2', 'p1', 'Malaria RDT'),
      ],
      labels: labLabels,
      now: NOW,
    });
    expect(patients.map(p => p.station?.lane)).toEqual(['scheduled', 'finished']);
    expect(new Set(patients.map(p => p.station?.rowKey ?? p._id)).size).toBe(2);
    expect(counts.resulted).toBe(1);
  });

  it('lists a patient the front desk sent to this technician before anything is ordered', () => {
    const routed = patient('p9', { stationAssignments: { lab: { staffId: 'u-lab', staffName: me.name, assignedAt: '2026-10-29T07:55:00.000Z', note: 'Fasting glucose' } } });
    const other = patient('p8', { stationAssignments: { lab: { staffId: 'u-other', staffName: 'Someone', assignedAt: '2026-10-29T07:55:00.000Z' } } });
    const { patients, outstanding } = assembleLabWorklist({ currentUser: me, patients: [routed, other], results: [], labels: labLabels, now: NOW });
    expect(patients.map(p => p._id)).toEqual(['p9']);
    expect(patients[0].station).toMatchObject({ status: 'Assigned to me', statusSubtext: 'Fasting glucose', chartHref: labFormHref('p9') });
    expect(outstanding.find(o => o.label === 'Assigned to me')?.count).toBe(1);
  });
});

const rx = (id: string, patientId: string, medication: string, extra: Partial<PrescriptionDoc> = {}) => ({
  _id: id, type: 'prescription', patientId, patientName: `${patientId} Test`, medication, dose: '500mg', route: 'Oral',
  frequency: 'BD', duration: '5 days', prescribedBy: 'Dr. Peter Deng', status: 'pending',
  createdAt: '2026-10-29T07:00:00.000Z', updatedAt: '2026-10-29T07:00:00.000Z', ...extra,
}) as unknown as PrescriptionDoc;

const rxLabels = {
  safety: 'Safety review', toReceive: 'To receive', ready: 'Ready to dispense', toCounsel: 'To counsel',
  dispensedToday: 'Dispensed today', assigned: 'Assigned to me', immediate: 'Immediate', scripts: (n: number) => `${n} scripts`,
};

describe('assemblePharmacyWorklist', () => {
  it('folds a patient\'s scripts into one row and sends Open chart to the dispensing form', () => {
    const { patients } = assemblePharmacyWorklist({
      currentUser: { _id: 'u-rx' },
      patients: [patient('p1')],
      prescriptions: [rx('r1', 'p1', 'Metformin'), rx('r2', 'p1', 'Amlodipine'), rx('r3', 'p1', 'Paracetamol')],
      labels: rxLabels,
      now: NOW,
    });
    expect(patients).toHaveLength(1);
    expect(patients[0].ward).toMatch(/ \+2$/);
    expect(patients[0].station?.statusSubtext).toBe('3 scripts');
    expect(patients[0].station?.chartHref).toMatch(/^\/patients\/p1\?form=dispense&focus=r\d$/);
  });

  it('leads with a script that carried a safety warning', () => {
    const warned = rx('r2', 'p2', 'Amoxicillin', {
      medicationSafety: { assessedAt: '', allergyWarnings: [{ medication: 'Amoxicillin', allergy: 'Penicillin', reason: 'class', criticality: 'severe', requiresOverride: true }], interactionWarnings: [], duplicateWarnings: [] },
    });
    const { patients, outstanding } = assemblePharmacyWorklist({
      currentUser: { _id: 'u-rx' },
      patients: [patient('p1'), patient('p2')],
      prescriptions: [rx('r1', 'p1', 'Metformin'), warned],
      labels: rxLabels,
      now: NOW,
    });
    expect(patients[0]._id).toBe('p2');
    expect(patients[0]).toMatchObject({ triagePriority: 'RED' });
    expect(patients[0].station).toMatchObject({ statusTone: 'danger', statusSubtext: 'Safety review', chartHref: dispenseFormHref('p2', 'r2') });
    expect(outstanding[0]).toMatchObject({ label: 'Safety review', count: 1 });
  });

  it('leaves scripts for an outside pharmacy off the counter', () => {
    const outside = rx('r1', 'p1', 'Insulin', { fulfilment: 'external' } as Partial<PrescriptionDoc>);
    const { patients } = assemblePharmacyWorklist({ currentUser: { _id: 'u-rx' }, patients: [patient('p1')], prescriptions: [outside], labels: rxLabels, now: NOW });
    expect(patients).toEqual([]);
  });
});
