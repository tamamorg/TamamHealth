/**
 * What the interaction and duplicate checks compare a new order against.
 *
 * They used to read only orders still `pending`, so a medicine that had been
 * dispensed yesterday, and a medicine the patient reports taking, were
 * invisible: warfarin dispensed on Monday raised nothing when metronidazole was
 * prescribed on Tuesday. They now read every medicine the patient is on, and
 * only those, so an old finished course stays quiet.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-cmuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

jest.setTimeout(30000);

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { hospitalsDB, patientsDB, prescriptionsDB, historyEntriesDB, triageDB } from '@/lib/db';
import {
  assessPrescriptionSafety, createPrescription, isMedicationCurrent, UNREADABLE_COURSE_LOOKBACK_DAYS,
} from '@/lib/services/prescription-service';
import { checkDoseAdvisory } from '@/lib/pharmacy/dose-check';
import { doseWarningText } from '@/lib/pharmacy/rx-safety';

const HOSP = 'hosp-001';
const ORG = 'org-moh-ss';
const SCOPE = { role: 'super_admin' } as const;
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

const seedRx = (id: string, medication: string, extra: Record<string, unknown> = {}) => putDoc(prescriptionsDB(), {
  _id: id, type: 'prescription', patientId: 'pat-1', patientName: 'Nyakuma Deng', medication,
  dose: '1', route: 'oral', frequency: 'OD', duration: '5 days', prescribedBy: 'Dr. Wani',
  status: 'pending', hospitalId: HOSP, orgId: ORG, createdAt: ago(1), updatedAt: ago(1), ...extra,
} as never);

beforeEach(async () => {
  await putDoc(hospitalsDB(), { _id: HOSP, type: 'hospital', name: 'JTH', orgId: ORG } as never);
  await putDoc(patientsDB(), {
    _id: 'pat-1', type: 'patient', firstName: 'Nyakuma', surname: 'Deng',
    registrationHospital: HOSP, orgId: ORG, state: 'Central Equatoria', county: 'Juba',
  } as never);
});

afterEach(async () => {
  jest.restoreAllMocks();
  await teardownTestDBs();
  uuidCounter = 0;
});

describe('which medicines count as current', () => {
  const now = Date.now();
  it('reads the number beside the unit, not the first number', () => {
    expect(isMedicationCurrent({ status: 'dispensed', duration: '1 tablet for 10 days', dispensedAt: ago(5) } as never)).toBe(true);
    expect(isMedicationCurrent({ status: 'dispensed', duration: '10', dispensedAt: ago(5) } as never)).toBe(true);
  });

  it('counts an open order, a course still running and nothing else', () => {
    expect(isMedicationCurrent({ status: 'pending' }, now)).toBe(true);
    expect(isMedicationCurrent({ status: 'discontinued' }, now)).toBe(false);
    expect(isMedicationCurrent({ status: 'dispensed', duration: '7 days', dispensedAt: ago(3) }, now)).toBe(true);
    expect(isMedicationCurrent({ status: 'dispensed', duration: '7 days', dispensedAt: ago(9) }, now)).toBe(false);
    expect(isMedicationCurrent({ status: 'dispensed', duration: '2 weeks', dispensedAt: ago(10) }, now)).toBe(true);
    expect(isMedicationCurrent({ status: 'dispensed', duration: '1 month', dispensedAt: ago(20) }, now)).toBe(true);
  });

  it('uses a bounded look-back when the course length is unreadable', () => {
    const inside = ago(UNREADABLE_COURSE_LOOKBACK_DAYS - 2);
    const outside = ago(UNREADABLE_COURSE_LOOKBACK_DAYS + 2);
    expect(isMedicationCurrent({ status: 'dispensed', duration: 'ongoing', dispensedAt: inside }, now)).toBe(true);
    expect(isMedicationCurrent({ status: 'dispensed', duration: 'ongoing', dispensedAt: outside }, now)).toBe(false);
    expect(isMedicationCurrent({ status: 'dispensed', dispensedAt: outside }, now)).toBe(false);
  });
});

describe('interaction and duplicate checks', () => {
  it('see a dispensed medicine that is still inside its course', async () => {
    await seedRx('rx-w', 'Warfarin 5mg', { status: 'dispensed', duration: '30 days', dispensedAt: ago(2) });
    const safety = await assessPrescriptionSafety('pat-1', 'Metronidazole 400mg', SCOPE);
    expect(safety.interactionWarnings?.highestSeverity).toBe('contraindicated');
    expect(safety.interactionCheckUnavailable).toBe(false);
    const again = await assessPrescriptionSafety('pat-1', 'Warfarin 5mg', SCOPE);
    expect(again.duplicateWarnings).toEqual(['Warfarin 5mg']);
  });

  it('stay quiet about a course that finished', async () => {
    await seedRx('rx-w', 'Warfarin 5mg', { status: 'dispensed', duration: '5 days', dispensedAt: ago(40) });
    const safety = await assessPrescriptionSafety('pat-1', 'Metronidazole 400mg', SCOPE);
    expect(safety.interactionWarnings?.hasInteractions).toBe(false);
    expect((await assessPrescriptionSafety('pat-1', 'Warfarin 5mg', SCOPE)).duplicateWarnings).toBeNull();
  });

  it('see what the patient reports taking, but not an entry marked in error', async () => {
    await putDoc(historyEntriesDB(), {
      _id: 'h1', type: 'history_entry', patientId: 'pat-1', domain: 'medication', title: 'Warfarin 5mg',
      status: 'active', orgId: ORG, hospitalId: HOSP, createdAt: ago(1), updatedAt: ago(1),
    } as never);
    expect((await assessPrescriptionSafety('pat-1', 'Metronidazole 400mg', SCOPE)).interactionWarnings?.highestSeverity)
      .toBe('contraindicated');
    const current = await historyEntriesDB().get('h1');
    await historyEntriesDB().put({
      ...current, status: 'entered_in_error', _id: 'h1', type: 'history_entry', patientId: 'pat-1', domain: 'medication', title: 'Warfarin 5mg', orgId: ORG, hospitalId: HOSP, createdAt: ago(1), updatedAt: ago(1),
    } as never);
    expect((await assessPrescriptionSafety('pat-1', 'Metronidazole 400mg', SCOPE)).interactionWarnings?.hasInteractions)
      .toBe(false);
  });

  it('say so when the check could not run, instead of reading as "no interactions"', async () => {
    jest.spyOn(prescriptionsDB(), 'find').mockRejectedValue(new Error('index rebuilding'));
    jest.spyOn(prescriptionsDB(), 'allDocs').mockRejectedValue(new Error('index rebuilding'));
    const safety = await assessPrescriptionSafety('pat-1', 'Metronidazole 400mg', SCOPE);
    expect(safety.interactionWarnings).toBeNull();
    expect(safety.interactionCheckUnavailable).toBe(true);
  });
});

describe('the advisory dose check', () => {
  it('stays silent at or under the usual maximum', () => {
    expect(checkDoseAdvisory({ medication: 'Paracetamol 500mg', dose: '1000 mg', frequency: 'QDS' })).toBeNull();
    expect(checkDoseAdvisory({ medication: 'Ibuprofen 400mg', dose: '400 mg', frequency: 'TDS' })).toBeNull();
  });

  it('warns above the adult maximum', () => {
    expect(checkDoseAdvisory({ medication: 'Paracetamol 500mg', dose: '1000 mg', frequency: 'every 4 hours' }))
      .toMatchObject({ drug: 'paracetamol', dailyMg: 6000, limitMg: 4000, basis: 'adult_max' });
    // Two 400 mg tablets four times a day: 3200 mg.
    expect(checkDoseAdvisory({ medication: 'Ibuprofen 400mg', dose: '2', frequency: 'QDS' }))
      .toMatchObject({ drug: 'ibuprofen', dailyMg: 3200, limitMg: 2400 });
    expect(checkDoseAdvisory({ medication: 'Ibuprofen 400mg', dose: '2', frequency: 'TDS' })).toBeNull();
  });

  it('uses the per-kg ceiling for a light patient', () => {
    expect(checkDoseAdvisory({ medication: 'Paracetamol 500mg', dose: '500 mg', frequency: 'QDS', weightKg: 20 }))
      .toMatchObject({ dailyMg: 2000, limitMg: 1200, basis: 'per_kg', weightKg: 20 });
    expect(checkDoseAdvisory({ medication: 'Paracetamol 500mg', dose: '500 mg', frequency: 'QDS', weightKg: 70 })).toBeNull();
  });

  it('says nothing when the order cannot be read, a drug is not on the list, or it is a combination', () => {
    expect(checkDoseAdvisory({ medication: 'Paracetamol syrup', dose: '10 ml', frequency: 'QDS' })).toBeNull();
    expect(checkDoseAdvisory({ medication: 'Paracetamol 500mg', dose: '1000 mg' })).toBeNull();
    expect(checkDoseAdvisory({ medication: 'Warfarin 5mg', dose: '50 mg', frequency: 'OD' })).toBeNull();
    expect(checkDoseAdvisory({ medication: 'Amoxicillin/Clavulanate 500/125', dose: '1000 mg', frequency: 'QDS' })).toBeNull();
  });

  it('is plain to read', () => {
    const t = (key: string, p?: Record<string, string>) => `${key}|${p?.daily}|${p?.limit}|${p?.weight}`;
    const warn = checkDoseAdvisory({ medication: 'Paracetamol 500mg', dose: '500 mg', frequency: 'QDS', weightKg: 20 })!;
    expect(doseWarningText(t, warn)).toBe('prescribe.doseAboveMaxWeight|2000|1200|20');
  });

  it('flows through assessment with the patient weight from triage, and never blocks the order', async () => {
    await putDoc(triageDB(), {
      _id: 'tri-1', type: 'triage', patientId: 'pat-1', weight: '20', triagedAt: ago(2), createdAt: ago(2),
      hospitalId: HOSP, orgId: ORG,
    } as never);
    const safety = await assessPrescriptionSafety('pat-1', 'Paracetamol 500mg', SCOPE, { dose: '500 mg', frequency: 'QDS' });
    expect(safety.doseWarnings?.[0]).toMatchObject({ basis: 'per_kg', weightKg: 20, limitMg: 1200 });

    const { prescription } = await createPrescription({
      patientId: 'pat-1', patientName: 'Nyakuma Deng', medication: 'Paracetamol 500mg', dose: '500 mg', route: 'oral',
      frequency: 'QDS', duration: '3 days', prescribedBy: 'Dr. Wani', status: 'pending', hospitalId: HOSP, orgId: ORG,
      quantityToDispense: 12,
    } as never, SCOPE);
    expect(prescription.medicationSafety?.doseWarnings?.[0]).toMatchObject({ dailyMg: 2000, limitMg: 1200 });
    expect(prescription.medicationSafety?.acknowledgement).toBeUndefined();
  });

  it('ignores a weight older than 90 days', async () => {
    await putDoc(triageDB(), {
      _id: 'tri-1', type: 'triage', patientId: 'pat-1', weight: '20', triagedAt: ago(200), createdAt: ago(200),
      hospitalId: HOSP, orgId: ORG,
    } as never);
    const safety = await assessPrescriptionSafety('pat-1', 'Paracetamol 500mg', SCOPE, { dose: '500 mg', frequency: 'QDS' });
    expect(safety.doseWarnings).toBeNull();
  });
});
