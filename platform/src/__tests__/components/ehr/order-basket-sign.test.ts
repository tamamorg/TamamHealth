/**
 * The order basket's signing step (O3 model): unsigned orders become
 * prescriptions and lab orders only here, each drug re-checked at the moment
 * it is signed. These pin what reaches the pharmacy and the bench.
 */

import {
  drugOrderGaps, durationText, frequencyText, newDrugOrder, newTestOrder, quantityFor,
  type DrugOrderDraft,
} from '@/components/ehr/chart/panels/order-basket/basket-types';
import { signOrders } from '@/components/ehr/chart/panels/order-basket/sign-orders';
import type { PatientDoc } from '@/lib/db-types';

const assessPrescriptionSafety = jest.fn();
const createPrescription = jest.fn();
jest.mock('@/lib/services/prescription-service', () => ({
  assessPrescriptionSafety: (...args: unknown[]) => assessPrescriptionSafety(...args),
  createPrescription: (...args: unknown[]) => createPrescription(...args),
}));
const placeLabOrder = jest.fn();
jest.mock('@/components/lab/order/place-lab-order', () => ({
  placeLabOrder: (...args: unknown[]) => placeLabOrder(...args),
}));

const patient = { _id: 'pat-1', firstName: 'Grace', surname: 'Deng', registrationHospital: 'hosp-1' } as PatientDoc;
const user = { _id: 'u-1', name: 'Dr. James Wani', role: 'doctor', orgId: 'org-1', hospitalId: 'hosp-1', hospitalName: 'Juba' };
const scope = { orgId: 'org-1', hospitalId: 'hosp-1', role: 'doctor' } as never;
const t = (key: string, values?: Record<string, string | number>) => (values ? `${key} ${JSON.stringify(values)}` : key);
const amoxicillin = { name: 'Amoxicillin 500mg', category: 'Antibiotic', atc: 'J01CA04', form: 'Capsule' };

function filled(overrides: Partial<DrugOrderDraft> = {}): DrugOrderDraft {
  return { ...newDrugOrder(amoxicillin), dose: '1', frequency: 'TDS', route: 'Oral', duration: '5', ...overrides };
}

beforeEach(() => {
  jest.clearAllMocks();
  assessPrescriptionSafety.mockResolvedValue({ allergyWarnings: [], allergyCheckUnavailable: false });
  createPrescription.mockResolvedValue({ interactionWarnings: null });
  placeLabOrder.mockResolvedValue({ orderGroupId: 'req-1', accessionNumbers: [], createdIds: ['lab-1'], placedAt: '' });
});

describe('order drafts', () => {
  test('a drug added straight to the basket is incomplete until dose, route and frequency are set', () => {
    const order = newDrugOrder(amoxicillin);
    expect(order.doseUnit).toBe('Capsule');
    expect(drugOrderGaps(order)).toEqual(['dose', 'frequency']);
    expect(drugOrderGaps(filled())).toEqual([]);
  });

  test('PRN needs its reason; free text replaces the structured fields', () => {
    expect(drugOrderGaps(filled({ prn: true }))).toEqual(['prnReason']);
    expect(drugOrderGaps({ ...newDrugOrder(amoxicillin), freeText: true, freeTextDosage: '' })).toEqual(['freeText']);
    expect(drugOrderGaps({ ...newDrugOrder(amoxicillin), freeText: true, freeTextDosage: '1 cap three times a day' })).toEqual([]);
  });

  test('frequency carries PRN, duration reads as words, quantity follows the course until typed', () => {
    expect(frequencyText(filled({ prn: true, prnReason: 'pain' }))).toBe('TDS PRN');
    expect(durationText(filled({ duration: '1', durationUnit: 'weeks' }))).toBe('1 week');
    expect(quantityFor(filled())).toBe(15);
    expect(quantityFor(filled({ quantity: '21' }))).toBe(21);
  });
});

describe('signOrders', () => {
  const sign = (orders: Parameters<typeof signOrders>[0]['orders'], confirmPrompt = jest.fn()) => signOrders({
    orders, patient, currentUser: user, scope, onSitePharmacy: true, confirmPrompt, t,
  });

  test('a drug order is written to the pharmacy queue with its sig, quantity and instructions', async () => {
    const order = filled({ prn: true, prnReason: 'pain', patientInstructions: 'After food', indication: 'Otitis media' });
    const outcome = await sign([order]);
    expect(outcome.signed).toEqual([order.id]);
    expect(createPrescription).toHaveBeenCalledWith(expect.objectContaining({
      patientId: 'pat-1',
      medication: 'Amoxicillin 500mg',
      dose: '1 Capsule',
      route: 'Oral',
      frequency: 'TDS PRN',
      duration: '5 days',
      quantityToDispense: 15,
      orderStatus: 'received_in_pharmacy_queue',
      indication: 'Otitis media',
      hospitalId: 'hosp-1',
      pharmacyInstructions: expect.stringContaining('After food'),
    }), scope);
  });

  test('with no dispensary the script goes to the patient', async () => {
    await signOrders({ orders: [filled()], patient, currentUser: user, scope, onSitePharmacy: false, confirmPrompt: jest.fn(), t });
    expect(createPrescription).toHaveBeenCalledWith(expect.objectContaining({ orderStatus: 'prescribed', fulfilment: 'external' }), scope);
  });

  test('a severe allergy needs a written override; declining keeps the order in the basket', async () => {
    assessPrescriptionSafety.mockResolvedValue({ allergyWarnings: [{ allergy: 'Penicillin', requiresOverride: true }] });
    const order = filled();
    const declined = await sign([order], jest.fn().mockResolvedValue(null));
    expect(createPrescription).not.toHaveBeenCalled();
    expect(declined.kept).toEqual([expect.objectContaining({ id: order.id, reason: 'declined' })]);

    const accepted = await sign([order], jest.fn().mockResolvedValue('Benefit outweighs risk; no alternative stocked'));
    expect(accepted.signed).toEqual([order.id]);
    expect(createPrescription).toHaveBeenCalledWith(expect.objectContaining({
      medicationSafetyAcknowledgement: { reviewedBy: 'Dr. James Wani', reason: 'Benefit outweighs risk; no alternative stocked' },
    }), scope);
  });

  test('a prescription raised from a note is filed under its visit', async () => {
    await sign([filled({ context: { encounterId: 'enc-9', noteId: 'note-1' } })]);
    expect(createPrescription).toHaveBeenCalledWith(expect.objectContaining({ encounterId: 'enc-9' }), scope);
  });

  test('tests sharing a priority go on one requisition; a STAT test goes on its own', async () => {
    const cbc = newTestOrder({ name: 'Full blood count', specimen: 'Blood', tier: 'basic' });
    const malaria = newTestOrder({ name: 'Malaria RDT', specimen: 'Blood', tier: 'basic' });
    const glucose = { ...newTestOrder({ name: 'Blood glucose', specimen: 'Blood', tier: 'basic' }), priority: 'stat' as const };
    const outcome = await sign([cbc, malaria, glucose]);
    expect(placeLabOrder).toHaveBeenCalledTimes(2);
    expect(placeLabOrder.mock.calls[0][0].draft).toMatchObject({ priority: 'routine', patientId: 'pat-1', tests: [cbc.test, malaria.test] });
    expect(placeLabOrder.mock.calls[1][0].draft).toMatchObject({ priority: 'stat', tests: [glucose.test] });
    expect(placeLabOrder.mock.calls[0][0].currentUser).toMatchObject({ role: 'doctor', hospitalId: 'hosp-1' });
    expect(outcome.signed).toEqual([cbc.id, malaria.id, glucose.id]);
  });

  test('an order that fails to write stays in the basket; the others are signed', async () => {
    createPrescription.mockRejectedValueOnce(new Error('disk full'));
    const first = filled();
    const second = filled({ drug: { ...amoxicillin, name: 'Paracetamol 500mg' } });
    const outcome = await sign([first, second]);
    expect(outcome.signed).toEqual([second.id]);
    expect(outcome.kept).toEqual([expect.objectContaining({ id: first.id, reason: 'failed' })]);
  });
});
