/**
 * Prescriptions the patient fills outside the facility.
 *
 * A clinic with no dispensary used to send every order to a pharmacy queue
 * nobody worked, and the checkout gate then waited for a dispense that could
 * never be recorded. An outside-pharmacy script is finished, for the
 * facility, when the patient has been handed their copy — and not before.
 */
jest.mock('uuid', () => {
  let n = 0;
  return { v4: () => `uuid-${++n}` };
});
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

jest.setTimeout(30000);

import { teardownTestDBs } from '../helpers/test-db';
import { prescriptionsDB } from '@/lib/db';
import { evaluateCheckoutGate } from '@/lib/services/checkout-gate-service';
import {
  OUTSIDE_PHARMACY_REFUSAL, advancePrescription, createPrescription, recordPrescriptionPatientCopy,
  rerouteToOutsidePharmacy,
} from '@/lib/services/prescription-service';
import { saveFacilitySettings } from '@/lib/settings/settings-service';
import { dispenseMedication } from '@/lib/services/dispensing-service';
import { isOutsidePharmacyOrder } from '@/lib/pharmacy-workflow';
import { buildProgressFeed } from '@/lib/clinical-flow/progress-feed';
import { DEFAULT_FACILITY_SETTINGS, mergeFacilitySettings } from '@/lib/settings/facility-settings';
import type { EncounterDoc, PrescriptionDoc } from '@/lib/db-types';

afterEach(async () => {
  await teardownTestDBs();
});

async function seedRx(overrides: Partial<PrescriptionDoc> = {}): Promise<PrescriptionDoc> {
  const doc = {
    _id: `rx-${Math.random().toString(36).slice(2)}`,
    type: 'prescription', patientId: 'pat-1', patientName: 'Mary Akol', medication: 'Amoxicillin',
    dose: '500mg', route: 'Capsule', frequency: 'Three times daily', duration: '5 days',
    prescribedBy: 'Dr. James Wani', status: 'pending', orderStatus: 'prescribed', hospitalId: 'hosp-1',
    createdAt: '2026-10-03T08:00:00.000Z', updatedAt: '2026-10-03T08:00:00.000Z',
    ...overrides,
  } as PrescriptionDoc;
  await prescriptionsDB().put(doc);
  return doc;
}

const read = async (id: string) => await prescriptionsDB().get(id) as PrescriptionDoc;

function closedEncounter(): EncounterDoc {
  return {
    _id: 'enc-test', type: 'clinical_encounter', patientId: 'pat-1', patientName: 'Mary Akol',
    clinicianId: '', clinicianName: '', hospitalId: 'hosp-1', status: 'ready_for_clinic_checkout',
    stageKey: 'clinical_consultation', snapshot: {}, labOrderIds: [],
    startedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as EncounterDoc;
}

async function rxGate() {
  const gate = await evaluateCheckoutGate('pat-1', closedEncounter());
  return gate.conditions.find(c => c.key === 'prescriptions_dispensed')!;
}

const PRINT = { channel: 'print' as const, at: '2026-10-03T09:00:00.000Z', byId: 'user-1', byName: 'Dr. James Wani' };

describe('facility policy', () => {
  it('assumes an on-site pharmacy until an administrator says otherwise', () => {
    expect(DEFAULT_FACILITY_SETTINGS.clinicalPolicy.onSitePharmacy).toBe(true);
    // Settings saved before the field existed keep working.
    expect(mergeFacilitySettings({ clinicalPolicy: { allergyHardStop: true } as never }).clinicalPolicy)
      .toMatchObject({ allergyHardStop: true, onSitePharmacy: true });
    expect(mergeFacilitySettings({ clinicalPolicy: { onSitePharmacy: false } as never }).clinicalPolicy.onSitePharmacy)
      .toBe(false);
  });
});

describe('writing an order at a facility with no dispensary', () => {
  const order = (overrides: Partial<PrescriptionDoc> = {}) => ({
    patientId: 'pat-1', patientName: 'Mary Akol', medication: 'Paracetamol', dose: '500mg', route: 'Oral',
    frequency: 'Three times daily', duration: '3 days', prescribedBy: 'Dr. James Wani',
    status: 'pending', orderStatus: 'received_in_pharmacy_queue', hospitalId: 'hosp-1', orgId: 'org-1',
    ...overrides,
  }) as Omit<PrescriptionDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>;

  it('becomes an outside-pharmacy script whichever screen wrote it', async () => {
    await saveFacilitySettings('hosp-1', { clinicalPolicy: { onSitePharmacy: false } as never }, 'org-1');
    // A caller that knows nothing about the policy and asks for the queue.
    const { prescription } = await createPrescription(order());
    expect(prescription.fulfilment).toBe('external');
    expect(prescription.orderStatus).toBe('prescribed');
    expect(prescription.status).toBe('pending');
  });

  it('is left alone where there is a pharmacy', async () => {
    const { prescription } = await createPrescription(order());
    expect(prescription.fulfilment).toBeUndefined();
    expect(prescription.orderStatus).toBe('received_in_pharmacy_queue');
  });

  it('honours an explicit outside-pharmacy choice at a facility that has a pharmacy', async () => {
    const { prescription } = await createPrescription(order({ fulfilment: 'external' }));
    expect(prescription.fulfilment).toBe('external');
    expect(prescription.orderStatus).toBe('prescribed');
  });

  it('keeps a ward order on site even with no dispensary', async () => {
    await saveFacilitySettings('hosp-1', { clinicalPolicy: { onSitePharmacy: false } as never }, 'org-1');
    const { prescription } = await createPrescription(order({ admissionId: 'adm-1', orderStatus: 'prescribed' }));
    expect(prescription.fulfilment).toBeUndefined();
    expect(prescription.admissionId).toBe('adm-1');
  });
});

describe('recording a copy given to the patient', () => {
  it('logs the copy, and stamps the handover on an outside-pharmacy script', async () => {
    const rx = await seedRx({ fulfilment: 'external' });
    const updated = await recordPrescriptionPatientCopy(rx._id, PRINT);
    expect(updated?.patientCopies).toEqual([PRINT]);
    expect(updated?.issuedToPatientAt).toBe(PRINT.at);
    expect(updated?.issuedToPatientBy).toBe('Dr. James Wani');
  });

  it('keeps a courtesy copy of an on-site order from counting as a handover', async () => {
    const rx = await seedRx();
    const updated = await recordPrescriptionPatientCopy(rx._id, PRINT);
    expect(updated?.patientCopies).toHaveLength(1);
    expect(updated?.issuedToPatientAt).toBeUndefined();
    expect(updated?.fulfilment).toBeUndefined();
  });

  it('keeps the first handover time across later copies', async () => {
    const rx = await seedRx({ fulfilment: 'external' });
    await recordPrescriptionPatientCopy(rx._id, PRINT);
    const again = await recordPrescriptionPatientCopy(rx._id, { ...PRINT, at: '2026-10-04T09:00:00.000Z' });
    expect(again?.patientCopies).toHaveLength(2);
    expect(again?.issuedToPatientAt).toBe(PRINT.at);
  });

  it('records a texted copy once per message, however often the send is retried', async () => {
    const rx = await seedRx({ fulfilment: 'external' });
    const sms = { channel: 'sms' as const, at: PRINT.at, byName: 'Dr. James Wani', messageId: 'msg-1', to: '091•••••145' };
    await recordPrescriptionPatientCopy(rx._id, sms);
    await recordPrescriptionPatientCopy(rx._id, sms);
    expect((await read(rx._id)).patientCopies).toHaveLength(1);
  });

  it('returns null for an order that does not exist', async () => {
    expect(await recordPrescriptionPatientCopy('rx-missing', PRINT)).toBeNull();
  });
});

describe('re-routing an on-site order to an outside pharmacy', () => {
  it('re-routes an order the pharmacy has not taken yet', async () => {
    const rx = await seedRx();
    const updated = await rerouteToOutsidePharmacy(rx._id, { id: 'user-1', name: 'Dr. James Wani' });
    expect(updated?.fulfilment).toBe('external');
    expect(updated?.issuedToPatientAt).toBeUndefined();
  });

  it('re-routes an order the pharmacy reported it could not fill', async () => {
    const rx = await seedRx({ orderStatus: 'stockout_partial_referred' });
    expect((await rerouteToOutsidePharmacy(rx._id, { name: 'Dr. James Wani' }))?.fulfilment).toBe('external');
  });

  it('leaves an order on the pharmacist\'s bench alone', async () => {
    const rx = await seedRx({ orderStatus: 'under_review' });
    const updated = await rerouteToOutsidePharmacy(rx._id, { name: 'Dr. James Wani' });
    expect(updated?.fulfilment).toBeUndefined();
    expect((await read(rx._id)).fulfilment).toBeUndefined();
  });

  it('counts a copy given before the re-route as the handover', async () => {
    // A text is recorded when the gateway accepts it, which can land before
    // the re-route write does.
    const rx = await seedRx();
    await recordPrescriptionPatientCopy(rx._id, PRINT);
    const updated = await rerouteToOutsidePharmacy(rx._id, { name: 'Dr. James Wani' });
    expect(updated?.fulfilment).toBe('external');
    expect(updated?.issuedToPatientAt).toBe(PRINT.at);
  });
});

describe('an outside-pharmacy script is not the on-site pharmacy\'s work', () => {
  // The patient is holding a signed script. Filling the same order here as
  // well would supply the course twice.
  it('is recognised by one shared rule', async () => {
    expect(isOutsidePharmacyOrder(await seedRx({ fulfilment: 'external' }))).toBe(true);
    expect(isOutsidePharmacyOrder(await seedRx())).toBe(false);
    expect(isOutsidePharmacyOrder(await seedRx({ fulfilment: 'on_site' }))).toBe(false);
  });

  it('cannot be pulled into the dispensing queue', async () => {
    const rx = await seedRx({ fulfilment: 'external' });
    await expect(advancePrescription(rx._id, 'received_in_pharmacy_queue')).rejects.toThrow(OUTSIDE_PHARMACY_REFUSAL);
    expect((await read(rx._id)).orderStatus).toBe('prescribed');
  });

  it('cannot be re-checked into the queue after a stock-out referral was sent out', async () => {
    const rx = await seedRx({ orderStatus: 'stockout_partial_referred', quantityToDispense: 30, quantityDispensed: 10 });
    await rerouteToOutsidePharmacy(rx._id, { name: 'Dr. James Wani' });
    await expect(advancePrescription(rx._id, 'cleared_for_dispensing', undefined, 'user-pharmacist'))
      .rejects.toThrow(OUTSIDE_PHARMACY_REFUSAL);
  });

  it('cannot be dispensed, whatever stage it carries', async () => {
    const rx = await seedRx({ fulfilment: 'external', orderStatus: 'cleared_for_dispensing' });
    await expect(dispenseMedication({
      prescription: rx, quantity: 1, dispenserId: 'user-pharmacist', dispenserName: 'Rose Pharmacist',
      dispenserRole: 'pharmacist', facilityId: 'hosp-1',
    })).rejects.toThrow(OUTSIDE_PHARMACY_REFUSAL);
    expect((await read(rx._id)).status).toBe('pending');
  });

  it('still lets an on-site order through the queue', async () => {
    const rx = await seedRx();
    const advanced = await advancePrescription(rx._id, 'received_in_pharmacy_queue');
    expect(advanced?.orderStatus).toBe('received_in_pharmacy_queue');
  });

  it('does not appear in the pharmacist\'s progress feed', () => {
    const now = Date.parse('2026-10-03T10:00:00.000Z');
    const row = (id: string, fulfilment?: string) => ({
      _id: id, patientId: 'pat-1', patientName: 'Mary Akol', medicationName: 'Amoxicillin',
      orderStatus: 'prescribed' as const, status: 'pending', fulfilment,
      createdAt: '2026-10-03T09:30:00.000Z', updatedAt: '2026-10-03T09:30:00.000Z',
    });
    const feed = buildProgressFeed({ prescriptions: [row('rx-in'), row('rx-out', 'external')] }, { nowMs: now });
    expect(feed).toHaveLength(1);
    expect(JSON.stringify(feed)).not.toContain('rx-out');
  });
});

describe('checkout gate — prescriptions', () => {
  it('still holds a visit for an on-site order that has not been dispensed', async () => {
    await seedRx();
    const gate = await rxGate();
    expect(gate.satisfied).toBe(false);
    expect(gate.detail).toMatch(/1 prescription\(s\) not yet dispensed/);
    expect(gate.resolveHref).toBe('/pharmacy');
  });

  it('holds an outside-pharmacy script until the patient has been given it', async () => {
    await seedRx({ fulfilment: 'external' });
    const gate = await rxGate();
    expect(gate.satisfied).toBe(false);
    expect(gate.detail).toMatch(/1 outside-pharmacy script\(s\) not yet given to the patient/);
    // Nothing for the pharmacy to do — the fix is on the chart.
    expect(gate.resolveHref).toBe('/patients/pat-1?tab=prescriptions');
  });

  it('releases an outside-pharmacy script once a copy is handed over', async () => {
    const rx = await seedRx({ fulfilment: 'external' });
    await recordPrescriptionPatientCopy(rx._id, PRINT);
    expect((await rxGate()).satisfied).toBe(true);
  });

  it('reports both kinds when a visit has one of each outstanding', async () => {
    await seedRx({ medication: 'Amoxicillin' });
    await seedRx({ medication: 'Paracetamol', fulfilment: 'external' });
    const gate = await rxGate();
    expect(gate.satisfied).toBe(false);
    expect(gate.detail).toMatch(/1 prescription\(s\) not yet dispensed: Amoxicillin\./);
    expect(gate.detail).toMatch(/1 outside-pharmacy script\(s\) not yet given to the patient — print or text: Paracetamol\./);
    expect(gate.resolveHref).toBe('/pharmacy');
  });
});
