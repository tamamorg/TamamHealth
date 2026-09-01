/**
 * Behavioral coverage for `assembleNurseWorklist`
 * (src/components/dashboards/NurseHomeView.tsx).
 *
 * Same contract as the doctor module's worklist.test.ts: the function is a
 * pure combiner over already-scoped hook output, so this suite exercises only
 * the assembler's own combining logic (ward/rooming merge + dedup, tone
 * derivation, entry filtering) — never tenancy/scope filtering, which
 * happens upstream in the hooks.
 *
 * Every test passes a fixed `now` so nothing here depends on the wall clock.
 */
import {
  assembleNurseWorklist,
  assembleNurseWeekActivity,
  type NurseWorklistInput,
} from '@/components/dashboards/NurseHomeView';
import {
  makePatient,
  makeTriage,
  makeAdmission,
  makeRoomingEntry,
  makeMarEntry,
  makeHandoff,
  makeFollowUp,
  resetFixtureSeq,
} from './fixtures';
import { makeAppointment } from '../doctor/fixtures';

// Fixed reference instant for every test: 2026-08-04T12:00:00.000Z.
// todayIso = '2026-08-04'.
const NOW = new Date('2026-08-04T12:00:00.000Z');

const CURRENT_USER = { _id: 'nurse-1', name: 'Nurse Stella' };

function baseInput(overrides: Partial<NurseWorklistInput> = {}): NurseWorklistInput {
  return {
    currentUser: CURRENT_USER,
    patients: [],
    admissions: [],
    triages: [],
    roomingEntries: [],
    marEntries: [],
    handoffs: [],
    followUpsDue: [],
    appointments: [],
    now: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  resetFixtureSeq();
});

describe('assembleNurseWorklist — ward roster rows', () => {
  test('a patient assigned to the signed-in nurse appears without an admission or rooming record', () => {
    const patient = makePatient({
      _id: 'p-assigned',
      assignedNurse: 'nurse-1',
      assignedNurseName: 'Nurse Stella',
    });

    const result = assembleNurseWorklist(baseInput({ patients: [patient] }));

    expect(result.patients.find(row => row._id === patient._id)?.ward).toBe('Assigned care');
  });

  test('a nurse carrying a primary-care patient as responsible provider sees the patient', () => {
    const patient = makePatient({
      _id: 'p-nurse-led',
      assignedDoctor: 'nurse-1',
      assignedDoctorName: 'Nurse Stella',
    });

    const result = assembleNurseWorklist(baseInput({ patients: [patient] }));

    expect(result.patients.find(row => row._id === patient._id)?.ward).toBe('Assigned care');
  });

  test('a nurse-led appointment appears on today\'s dashboard even without secondary staff', () => {
    const patient = makePatient({ _id: 'p-nurse-appointment' });
    const appointment = makeAppointment({
      patientId: patient._id,
      providerId: 'nurse-1',
      providerName: 'Nurse Stella',
      staffId: '',
      appointmentDate: '2026-08-04',
    });

    const result = assembleNurseWorklist(baseInput({ patients: [patient], appointments: [appointment] }));

    expect(result.patients.find(row => row._id === patient._id)?.ward).toBe('OPD');
  });

  test('an active admission produces a row joined to the patient doc, with real ward/bed, doctor and nurse', () => {
    const patient = makePatient({ _id: 'p1', firstName: 'Akol', surname: 'Deng', gender: 'Female' });
    const admission = makeAdmission({
      patientId: 'p1', wardName: 'Maternity Ward', bedNumber: 'M-04',
      attendingPhysician: 'doc-9', attendingPhysicianName: 'Dr. Nyandeng',
      nurseAssignedName: 'Nurse Grace',
    });

    const result = assembleNurseWorklist(baseInput({ patients: [patient], admissions: [admission] }));

    const row = result.patients.find(p => p._id === 'p1');
    expect(row?.ward).toBe('Maternity Ward · M-04');
    expect(row?.division).toBe('Maternity Ward');
    expect(row?.doctor).toBe('Dr. Nyandeng');
    expect(row?.assignedDoctor).toBe('doc-9');
    expect(row?.nurse).toBe('Nurse Grace');
    expect(row?.gender).toBe('F');
    // Real DOB-based age, not a synthesized demo value.
    expect(row?.age).not.toBeNull();
  });

  test('nurse falls back to the most recent triage\'s triagedByName when the admission has no nurseAssignedName', () => {
    const patient = makePatient({ _id: 'p2' });
    const admission = makeAdmission({ patientId: 'p2', nurseAssignedName: undefined });
    const triage = makeTriage({ patientId: 'p2', triagedAt: '2026-08-04T07:00:00.000Z', triagedByName: 'Nurse Achol' });

    const result = assembleNurseWorklist(baseInput({ patients: [patient], admissions: [admission], triages: [triage] }));

    expect(result.patients.find(p => p._id === 'p2')?.nurse).toBe('Nurse Achol');
  });

  test('an admission whose patient doc is missing from the registry synthesizes a row with no age/gender guess', () => {
    const admission = makeAdmission({ patientId: 'p-ghost', patientName: 'Unknown Ghost', hospitalNumber: 'HN-777' });

    const result = assembleNurseWorklist(baseInput({ patients: [], admissions: [admission] }));

    const row = result.patients.find(p => p._id === 'p-ghost');
    expect(row?.name).toBe('Unknown Ghost');
    expect(row?.age).toBeNull();
    expect(row?.gender).toBe('');
    expect(row?.id).toBe('HN-777');
  });

  test('two active admissions for the same patient collapse into a single row', () => {
    const admissions = [
      makeAdmission({ _id: 'adm-1', patientId: 'p-dup' }),
      makeAdmission({ _id: 'adm-2', patientId: 'p-dup' }),
    ];

    const result = assembleNurseWorklist(baseInput({ admissions }));

    expect(result.patients.filter(p => p._id === 'p-dup')).toHaveLength(1);
  });

  test('triage priority: today\'s max overrides severity-derived acuity; severity is the fallback when there\'s no triage today', () => {
    const bySeverity = makeAdmission({ patientId: 'p-sev', severity: 'critical' });
    const overridden = makeAdmission({ patientId: 'p-overridden', severity: 'mild' });
    const triageToday = makeTriage({ patientId: 'p-overridden', triagedAt: '2026-08-04T09:00:00.000Z', priority: 'RED' });

    const result = assembleNurseWorklist(baseInput({
      admissions: [bySeverity, overridden],
      triages: [triageToday],
    }));

    expect(result.patients.find(p => p._id === 'p-sev')?.triagePriority).toBe('RED');
    expect(result.patients.find(p => p._id === 'p-overridden')?.triagePriority).toBe('RED');
  });
});

describe('assembleNurseWorklist — rooming queue rows', () => {
  test('a rooming entry produces a row labelled with the step, for a patient not already admitted', () => {
    const entry = makeRoomingEntry({
      step: 'awaiting_rooming', waitingMinutes: 15,
      encounter: { patientId: 'p-room', patientName: 'Room Patient' },
    });

    const result = assembleNurseWorklist(baseInput({ roomingEntries: [entry] }));

    const row = result.patients.find(p => p._id === 'p-room');
    expect(row?.ward).toBe('Awaiting rooming');
    expect(row?.division).toBe('Awaiting rooming');
  });

  test('an entry with an assigned room number shows the room instead of the step label', () => {
    const entry = makeRoomingEntry({ step: 'being_roomed', encounter: { patientId: 'p-inroom', roomNumber: '4' } });

    const result = assembleNurseWorklist(baseInput({ roomingEntries: [entry] }));

    expect(result.patients.find(p => p._id === 'p-inroom')?.ward).toBe('Room 4');
  });

  test('a patient with BOTH an active admission and a rooming-queue entry appears exactly once, from the ward roster', () => {
    const admission = makeAdmission({ patientId: 'p-both', wardName: 'ICU' });
    const roomingEntry = makeRoomingEntry({ encounter: { patientId: 'p-both' } });

    const result = assembleNurseWorklist(baseInput({ admissions: [admission], roomingEntries: [roomingEntry] }));

    const matches = result.patients.filter(p => p._id === 'p-both');
    expect(matches).toHaveLength(1);
    expect(matches[0].ward).toContain('ICU'); // from the ward roster, not the rooming label
  });

  // "No-dup guarantee vs triage-queue patient ids": a patient identified only
  // via a TriageDoc — no active admission, no rooming-queue encounter — must
  // never be manufactured into a ward/rooming row here. EhrClinicalDashboard
  // already carries its own internal triage-derived queue machinery
  // (buildActiveTriageByPatient / buildQueueEntryByPatient) that enriches
  // rows already present in the `patients` prop; this assembler fabricating
  // a second, differently-shaped row for the same patient from raw triage
  // docs would double up on that, not complement it.
  test('a patient with only a triage record (no admission, no rooming entry) never appears in the worklist table', () => {
    const patient = makePatient({ _id: 'p-triage-only' });
    const triage = makeTriage({ patientId: 'p-triage-only', status: 'pending', triagedAt: '2026-08-04T09:00:00.000Z' });

    const result = assembleNurseWorklist(baseInput({ patients: [patient], triages: [triage] }));

    expect(result.patients.some(p => p._id === 'p-triage-only')).toBe(false);
  });
});

describe('assembleNurseWorklist — outstanding: medications due', () => {
  test('only due/overdue doses for patients with an active admission are counted; upcoming/given and non-admitted patients are excluded', () => {
    const admission = makeAdmission({ _id: 'adm-1', patientId: 'p1' });
    const due = makeMarEntry({ id: 'm-due', patientId: 'p1', status: 'due' });
    const overdue = makeMarEntry({ id: 'm-overdue', patientId: 'p1', status: 'overdue' });
    const upcoming = makeMarEntry({ id: 'm-upcoming', patientId: 'p1', status: 'upcoming' });
    const given = makeMarEntry({ id: 'm-given', patientId: 'p1', status: 'given' });
    const noAdmission = makeMarEntry({ id: 'm-no-admission', patientId: 'p-outpatient', status: 'due' });

    const result = assembleNurseWorklist(baseInput({
      admissions: [admission],
      marEntries: [due, overdue, upcoming, given, noAdmission],
    }));

    const item = result.outstanding.find(o => o.label === 'Medications due');
    expect(item?.count).toBe(2);
    expect(item?.entries?.map(e => e.id).sort()).toEqual(['m-due', 'm-overdue']);
  });

  test('overdue entries sort first and carry danger tone; due entries carry warning tone', () => {
    const admission = makeAdmission({ _id: 'adm-1', patientId: 'p1' });
    const due = makeMarEntry({ id: 'm-due', patientId: 'p1', status: 'due' });
    const overdue = makeMarEntry({ id: 'm-overdue', patientId: 'p1', status: 'overdue' });

    const result = assembleNurseWorklist(baseInput({ admissions: [admission], marEntries: [due, overdue] }));

    const entries = result.outstanding.find(o => o.label === 'Medications due')!.entries!;
    expect(entries.map(e => e.id)).toEqual(['m-overdue', 'm-due']);
    expect(entries[0].tone).toBe('danger');
    expect(entries[1].tone).toBe('warning');
  });

  test('the item-level tone escalates to danger as soon as any dose is overdue', () => {
    const admission = makeAdmission({ _id: 'adm-1', patientId: 'p1' });
    const overdue = makeMarEntry({ id: 'm-overdue', patientId: 'p1', status: 'overdue' });

    const result = assembleNurseWorklist(baseInput({ admissions: [admission], marEntries: [overdue] }));

    expect(result.outstanding.find(o => o.label === 'Medications due')?.tone).toBe('danger');
  });

  test('each entry deep-links to the patient\'s active-admission MAR grid', () => {
    const admission = makeAdmission({ _id: 'adm-77', patientId: 'p1' });
    const due = makeMarEntry({ id: 'm-due', patientId: 'p1', status: 'due' });

    const result = assembleNurseWorklist(baseInput({ admissions: [admission], marEntries: [due] }));

    const entry = result.outstanding.find(o => o.label === 'Medications due')!.entries![0];
    expect(entry.href).toBe('/wards/mar/adm-77');
    expect(entry.actionHref).toBe('/wards/mar/adm-77');
  });

  test('zero due meds is neutral-toned with zero count', () => {
    const result = assembleNurseWorklist(baseInput());
    const item = result.outstanding.find(o => o.label === 'Medications due');
    expect(item?.count).toBe(0);
    expect(item?.tone).toBe('neutral');
  });
});

describe('assembleNurseWorklist — outstanding: handoffs to acknowledge', () => {
  test('a signed handoff from another nurse counts; an acknowledged one and the viewer\'s own signed handoff are excluded', () => {
    const fromOther = makeHandoff({ _id: 'h-signed', status: 'signed', outgoingNurseId: 'nurse-other' });
    const alreadyAcked = makeHandoff({ _id: 'h-acked', status: 'acknowledged', outgoingNurseId: 'nurse-other' });
    const own = makeHandoff({ _id: 'h-own', status: 'signed', outgoingNurseId: CURRENT_USER._id });

    const result = assembleNurseWorklist(baseInput({ handoffs: [fromOther, alreadyAcked, own] }));

    const item = result.outstanding.find(o => o.label === 'Handoffs to acknowledge');
    expect(item?.count).toBe(1);
    expect(item?.entries?.map(e => e.id)).toEqual(['h-signed']);
    expect(item?.href).toBe('/wards/handoff');
    expect(item?.entries?.[0].href).toBe('/wards/handoff');
    expect(item?.entries?.[0].actionLabel).toBe('Acknowledge handoff');
  });

  test('the entry subtitle names the outgoing nurse and the patient count', () => {
    const handoff = makeHandoff({
      outgoingNurseName: 'Nurse Akur',
      outgoingNurseId: 'nurse-other',
      patients: [
        { patientId: 'p1', patientName: 'A' },
        { patientId: 'p2', patientName: 'B' },
      ],
    });

    const result = assembleNurseWorklist(baseInput({ handoffs: [handoff] }));

    expect(result.outstanding.find(o => o.label === 'Handoffs to acknowledge')?.entries?.[0].subtitle)
      .toBe('From Nurse Akur · 2 patients');
  });

  test('zero unacknowledged handoffs is neutral-toned with zero count', () => {
    const result = assembleNurseWorklist(baseInput());
    const item = result.outstanding.find(o => o.label === 'Handoffs to acknowledge');
    expect(item?.count).toBe(0);
    expect(item?.tone).toBe('neutral');
  });
});

describe('assembleNurseWorklist — outstanding: rooming queue', () => {
  test('every rooming entry becomes an outstanding entry linked to the per-patient rooming page', () => {
    const entries = [
      makeRoomingEntry({ encounter: { patientId: 'p-a' } }),
      makeRoomingEntry({ encounter: { patientId: 'p-b' } }),
    ];

    const result = assembleNurseWorklist(baseInput({ roomingEntries: entries }));

    const item = result.outstanding.find(o => o.label === 'Rooming queue');
    expect(item?.count).toBe(2);
    expect(item?.entries?.map(e => e.href).sort()).toEqual(['/rooming/p-a', '/rooming/p-b']);
  });

  test('a wait past the overdue threshold gets danger tone at both entry and item level; a short wait is warning', () => {
    const overdue = makeRoomingEntry({ encounter: { patientId: 'p-slow' }, waitingMinutes: 90 });
    const fresh = makeRoomingEntry({ encounter: { patientId: 'p-fast' }, waitingMinutes: 10 });

    const result = assembleNurseWorklist(baseInput({ roomingEntries: [overdue, fresh] }));

    const item = result.outstanding.find(o => o.label === 'Rooming queue');
    expect(item?.tone).toBe('danger');
    const slowEntry = item?.entries?.find(e => e.href === '/rooming/p-slow');
    const fastEntry = item?.entries?.find(e => e.href === '/rooming/p-fast');
    expect(slowEntry?.tone).toBe('danger');
    expect(fastEntry?.tone).toBe('warning');
  });

  test('zero rooming entries is neutral-toned with zero count', () => {
    const result = assembleNurseWorklist(baseInput());
    const item = result.outstanding.find(o => o.label === 'Rooming queue');
    expect(item?.count).toBe(0);
    expect(item?.tone).toBe('neutral');
  });
});

describe('assembleNurseWorklist — outstanding: follow-ups due', () => {
  test('an active follow-up due within the window appears, warning-toned, linked to the care checklist tab', () => {
    const followUp = makeFollowUp({
      _id: 'fu-due', patientId: 'patient-fu', patientName: 'Nyandeng Akec',
      condition: 'Malaria follow-up', status: 'active', scheduledDate: '2026-08-05',
    });

    const result = assembleNurseWorklist(baseInput({ followUpsDue: [followUp] }));

    const item = result.outstanding.find(o => o.label === 'Follow-ups due');
    expect(item?.count).toBe(1);
    expect(item?.tone).toBe('warning');
    expect(item?.entries?.[0].href).toBe('/patients/patient-fu?tab=careChecklist');
  });

  test('an active follow-up scheduled beyond the due window is excluded', () => {
    const farOut = makeFollowUp({ _id: 'fu-far', status: 'active', scheduledDate: '2026-08-20' });
    const result = assembleNurseWorklist(baseInput({ followUpsDue: [farOut] }));
    expect(result.outstanding.find(o => o.label === 'Follow-ups due')?.count).toBe(0);
  });

  test('only active follow-ups are counted — completed/missed are excluded', () => {
    const active = makeFollowUp({ _id: 'fu-active', status: 'active', scheduledDate: '2026-08-04' });
    const completed = makeFollowUp({ _id: 'fu-completed', status: 'completed', scheduledDate: '2026-08-04' });

    const result = assembleNurseWorklist(baseInput({ followUpsDue: [active, completed] }));

    const item = result.outstanding.find(o => o.label === 'Follow-ups due');
    expect(item?.count).toBe(1);
    expect(item?.entries?.map(e => e.id)).toEqual(['fu-active']);
  });

  test('no follow-ups due is neutral-toned with zero count', () => {
    const result = assembleNurseWorklist(baseInput());
    const item = result.outstanding.find(o => o.label === 'Follow-ups due');
    expect(item?.count).toBe(0);
    expect(item?.tone).toBe('neutral');
  });
});

/**
 * Day-activity bars. The schedule-derived chart is built from the signed-in
 * clinician's own appointments, which a nurse never has — so before this the
 * panel read "No activity this week" on a ward that had been full all week.
 */
describe('assembleNurseWeekActivity', () => {
  test('counts admissions as series 0 and arrivals as series 1', () => {
    const admission = makeAdmission({ patientId: 'p-adm', admissionDate: '2026-08-04' });
    const arrival = makeTriage({ patientId: 'p-walk', triagedAt: '2026-08-05T09:15:00.000Z' });

    const items = assembleNurseWeekActivity([admission], [arrival]);

    expect(items).toEqual([
      { date: '2026-08-04', series: 0 },
      { date: '2026-08-05', time: '09:15', series: 1 },
    ]);
  });

  test('a patient triaged and admitted the same day raises one bar, not two', () => {
    const admission = makeAdmission({ patientId: 'p-same', admissionDate: '2026-08-04' });
    const itsTriage = makeTriage({ patientId: 'p-same', triagedAt: '2026-08-04T06:00:00.000Z' });

    const items = assembleNurseWeekActivity([admission], [itsTriage]);

    expect(items).toEqual([{ date: '2026-08-04', series: 0 }]);
  });

  test('the same patient triaged on a later day still counts as an arrival', () => {
    // Readmission/return visit — a genuinely separate event from the admission.
    const admission = makeAdmission({ patientId: 'p-again', admissionDate: '2026-08-04' });
    const laterVisit = makeTriage({ patientId: 'p-again', triagedAt: '2026-08-06T10:00:00.000Z' });

    const items = assembleNurseWeekActivity([admission], [laterVisit]);

    expect(items.filter(i => i.series === 1)).toHaveLength(1);
  });

  test('an empty ward produces no bars rather than throwing', () => {
    expect(assembleNurseWeekActivity([], [])).toEqual([]);
  });
});
