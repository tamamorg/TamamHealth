/**
 * An outside-pharmacy script and the visit it was written in.
 *
 * The first cut of outside scripts fixed the checkout gate and stopped there:
 * the order still parked the visit at the pharmacy (where nothing could ever
 * release it), still raised a pharmacy charge for a medicine the patient buys
 * elsewhere, and a re-routed order kept both. Alongside that, three handover
 * rules that looked right and were not:
 *   - a fully dispensed order printed as a fresh, signed script for "qty 1";
 *   - a medicine counted as controlled only if this facility stocked it, so a
 *     clinic with no dispensary could text a morphine script;
 *   - a note's two sections saved a moment apart collided and one was refused.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

const chargeForServices = jest.fn(async (..._args: unknown[]) => null);
jest.mock('@/lib/services/fee-schedule-service', () => ({
  ...jest.requireActual('@/lib/services/fee-schedule-service'),
  chargeForServices: (...args: unknown[]) => chargeForServices(...args),
}));

jest.setTimeout(30000);

import { teardownTestDBs } from '../helpers/test-db';
import { billingDB, encountersDB } from '@/lib/db';
import { clinicalNotesDB, createClinicalNote, getClinicalNoteById, saveNoteSection, recordPlanAction } from '@/lib/clinical-notes/note-service';
import { createPrescription, rerouteToOutsidePharmacy } from '@/lib/services/prescription-service';
import { getEncounter } from '@/lib/services/encounter-service';
import { reversePaidBillCharge } from '@/lib/services/billing-service';
import { createLedgerEntry, getPatientBalance } from '@/lib/services/ledger-service';
import { holdsVisitAtPharmacy } from '@/lib/pharmacy-workflow';
import { isScriptable, scriptableOnly, buildPrescriptionText } from '@/lib/prescription-script';
import { isControlledMedicine } from '@/lib/data/formulary';
import type { EncounterDoc, PrescriptionDoc } from '@/lib/db-types';
import type { BillingDoc } from '@/lib/db-types-billing';

afterEach(async () => {
  await teardownTestDBs();
  chargeForServices.mockClear();
  uuidCounter = 0;
});

const order = (overrides: Partial<PrescriptionDoc> = {}) => ({
  patientId: 'pat-1', patientName: 'Mary Akol', medication: 'Paracetamol', dose: '500mg', route: 'Oral',
  frequency: 'Three times daily', duration: '3 days', prescribedBy: 'Dr. James Wani',
  status: 'pending', orderStatus: 'prescribed', hospitalId: 'hosp-1', orgId: 'org-1', encounterId: 'enc-1',
  ...overrides,
}) as Omit<PrescriptionDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>;

async function seedVisit(status: EncounterDoc['status'] = 'with_clinician') {
  const now = new Date().toISOString();
  await encountersDB().put({
    _id: 'enc-1', type: 'clinical_encounter', patientId: 'pat-1', patientName: 'Mary Akol',
    clinicianId: 'user-1', clinicianName: 'Dr. James Wani', hospitalId: 'hosp-1', orgId: 'org-1',
    status, snapshot: {}, labOrderIds: [], startedAt: now, createdAt: now, updatedAt: now,
  } as unknown as EncounterDoc);
}

async function seedSignedNote() {
  const now = new Date().toISOString();
  await clinicalNotesDB().put({
    _id: 'note-signed', type: 'clinical_note', patientId: 'pat-1', patientName: 'Mary Akol',
    encounterId: 'enc-1', noteType: 'soap', sections: [], serviceDate: '2026-10-03', status: 'signed',
    signedBy: 'user-1', signedByName: 'Dr. James Wani', signedAt: now, createdAt: now, updatedAt: now,
  } as never);
}

const statusOf = async () => (await getEncounter('enc-1'))?.status;

const LEDGER = { patientId: 'pat-1', encounterId: 'enc-1', currency: 'SSP', facilityId: 'hosp-1', orgId: 'org-1', createdBy: 'user-1' } as const;

describe('writing the order', () => {
  it('parks the visit at the pharmacy and bills an order this pharmacy will fill', async () => {
    await seedVisit();
    await createPrescription(order());
    expect(await statusOf()).toBe('awaiting_pharmacy');
    expect(chargeForServices).toHaveBeenCalledTimes(1);
  });

  it('does neither for a script the patient fills outside', async () => {
    await seedVisit();
    const { prescription } = await createPrescription(order({ fulfilment: 'external' }));
    expect(prescription.fulfilment).toBe('external');
    // Nothing here could ever dispense it, so nothing would ever move the visit on.
    expect(await statusOf()).toBe('with_clinician');
    // And the facility is not selling the medicine.
    expect(chargeForServices).not.toHaveBeenCalled();
  });
});

describe('one rule for "is the visit still waiting on the pharmacy"', () => {
  it('counts an undispensed on-site order and nothing else', () => {
    expect(holdsVisitAtPharmacy({ status: 'pending' })).toBe(true);
    expect(holdsVisitAtPharmacy({ status: 'dispensed' })).toBe(false);
    expect(holdsVisitAtPharmacy({ status: 'discontinued' })).toBe(false);
    expect(holdsVisitAtPharmacy({ status: 'pending', fulfilment: 'external' })).toBe(false);
  });
});

describe('re-routing an on-site order to an outside pharmacy', () => {
  async function seedCharge(rxId: string, overrides: Partial<BillingDoc> = {}) {
    const now = new Date().toISOString();
    await billingDB().put({
      _id: `bill-${rxId}`, type: 'billing', patientId: 'pat-1', patientName: 'Mary Akol', invoiceNumber: 'INV-1',
      facilityId: 'hosp-1', orgId: 'org-1', encounterId: 'enc-1', currency: 'SSP', status: 'approved',
      items: [{ description: 'Paracetamol', category: 'pharmacy', quantity: 1, unitPrice: 3000, totalPrice: 3000, referenceId: rxId, referenceType: 'prescription' }],
      payments: [], subtotal: 3000, discount: 0, totalAmount: 3000, amountPaid: 0, balanceDue: 3000,
      createdAt: now, updatedAt: now,
      ...overrides,
    } as unknown as BillingDoc);
  }
  const bill = async (rxId: string) => await billingDB().get(`bill-${rxId}`) as BillingDoc;

  it('cancels the charge raised when the order was written', async () => {
    await seedVisit();
    const { prescription } = await createPrescription(order());
    await seedCharge(prescription._id);

    await rerouteToOutsidePharmacy(prescription._id, { id: 'user-1', name: 'Dr. James Wani' });

    const after = await bill(prescription._id);
    expect(after.status).toBe('cancelled');
    expect(after.balanceDue).toBe(0);
  });

  it('turns a charge the patient already paid into a credit they are owed', async () => {
    // Cancelling is refused once money is recorded, and used to end there: the
    // facility kept payment for a medicine it would not supply, and nothing
    // said it was owed back.
    await seedVisit();
    const { prescription } = await createPrescription(order());
    await seedCharge(prescription._id, {
      status: 'paid', amountPaid: 3000, balanceDue: 0,
      payments: [{ amount: 3000, method: 'cash', receivedAt: new Date().toISOString(), receivedByName: 'Cashier' }],
    } as unknown as Partial<BillingDoc>);
    // What billing and paying it had put in the ledger.
    await createLedgerEntry({ ...LEDGER, entryType: 'charge', amount: 3000, description: 'Paracetamol — INV-1' });
    await createLedgerEntry({ ...LEDGER, entryType: 'payment', amount: -3000, description: 'Cash' });
    expect(await getPatientBalance('pat-1')).toBe(0);

    await rerouteToOutsidePharmacy(prescription._id, { id: 'user-1', name: 'Dr. James Wani' });

    const after = await bill(prescription._id);
    // The payment stays on the record exactly as collected…
    expect(after.status).toBe('paid');
    expect(after.amountPaid).toBe(3000);
    expect(after.payments).toHaveLength(1);
    // …the charge is marked withdrawn, with who and why…
    expect(after.chargeReversedAt).toBeTruthy();
    expect(after.chargeReversedBy).toBe('Dr. James Wani');
    expect(after.chargeReversalReason).toBe('Prescription sent to an outside pharmacy');
    expect(after.notes).toMatch(/3000 SSP was collected and is owed back/);
    // …and the account is in credit by what was paid, for the cashier to refund.
    expect(await getPatientBalance('pat-1')).toBe(-3000);
  });

  it('reverses a part-paid charge the same way, and stops asking for the rest', async () => {
    await seedVisit();
    const { prescription } = await createPrescription(order());
    await seedCharge(prescription._id, {
      status: 'partial', amountPaid: 1000, balanceDue: 2000,
      payments: [{ amount: 1000, method: 'cash', receivedAt: new Date().toISOString(), receivedByName: 'Cashier' }],
    } as unknown as Partial<BillingDoc>);
    await createLedgerEntry({ ...LEDGER, entryType: 'charge', amount: 3000, description: 'Paracetamol — INV-1' });
    await createLedgerEntry({ ...LEDGER, entryType: 'payment', amount: -1000, description: 'Cash' });

    await rerouteToOutsidePharmacy(prescription._id, { id: 'user-1', name: 'Dr. James Wani' });

    const after = await bill(prescription._id);
    expect(after.balanceDue).toBe(0);
    expect(after.chargeReversedAt).toBeTruthy();
    expect(await getPatientBalance('pat-1')).toBe(-1000);
  });

  it('reverses a paid charge once, however often it is asked', async () => {
    await seedCharge('rx-x', {
      status: 'paid', amountPaid: 3000, balanceDue: 0,
      payments: [{ amount: 3000, method: 'cash', receivedAt: new Date().toISOString(), receivedByName: 'Cashier' }],
    } as unknown as Partial<BillingDoc>);
    await createLedgerEntry({ ...LEDGER, entryType: 'charge', amount: 3000, description: 'x' });
    await createLedgerEntry({ ...LEDGER, entryType: 'payment', amount: -3000, description: 'Cash' });

    expect(await reversePaidBillCharge('bill-rx-x', 'user-1', 'Dr. James Wani', 'Sent out')).not.toBeNull();
    expect(await reversePaidBillCharge('bill-rx-x', 'user-1', 'Dr. James Wani', 'Sent out')).toBeNull();
    expect(await getPatientBalance('pat-1')).toBe(-3000);
  });

  it('has nothing to reverse on a bill nobody has paid — that one is cancelled', async () => {
    await seedCharge('rx-y');
    expect(await reversePaidBillCharge('bill-rx-y', 'user-1', 'Dr. James Wani', 'Sent out')).toBeNull();
    expect((await bill('rx-y')).chargeReversedAt).toBeUndefined();
  });

  it('does not touch another order\'s invoice', async () => {
    await seedVisit();
    const { prescription } = await createPrescription(order());
    await seedCharge('rx-someone-else');
    await rerouteToOutsidePharmacy(prescription._id, { id: 'user-1', name: 'Dr. James Wani' });
    expect((await bill('rx-someone-else')).status).toBe('approved');
  });

  it('releases a signed visit that was waiting only on that order', async () => {
    await seedVisit();
    const { prescription } = await createPrescription(order());
    expect(await statusOf()).toBe('awaiting_pharmacy');
    await seedSignedNote();

    await rerouteToOutsidePharmacy(prescription._id, { id: 'user-1', name: 'Dr. James Wani' });
    expect(await statusOf()).toBe('ready_for_clinic_checkout');
  });

  it('keeps the visit at the pharmacy while another on-site order is still to dispense', async () => {
    await seedVisit();
    const { prescription } = await createPrescription(order());
    await createPrescription(order({ medication: 'Amoxicillin' }));
    await seedSignedNote();

    await rerouteToOutsidePharmacy(prescription._id, { id: 'user-1', name: 'Dr. James Wani' });
    expect(await statusOf()).toBe('awaiting_pharmacy');
  });

  it('leaves an unsigned visit where it is — signing the note makes the move', async () => {
    await seedVisit();
    const { prescription } = await createPrescription(order());
    await rerouteToOutsidePharmacy(prescription._id, { id: 'user-1', name: 'Dr. James Wani' });
    expect(await statusOf()).toBe('awaiting_pharmacy');
  });
});

describe('what can still be handed over as a script', () => {
  const rx = (overrides: Partial<PrescriptionDoc>) => ({
    _id: 'rx-1', type: 'prescription', patientId: 'pat-1', patientName: 'Mary Akol', medication: 'Amoxicillin',
    dose: '500mg', route: 'Oral', frequency: 'TDS', duration: '5 days', prescribedBy: 'Dr. James Wani',
    status: 'pending', ...overrides,
  }) as PrescriptionDoc;

  it('is an open order, or the balance of a part-filled one', () => {
    expect(isScriptable(rx({}))).toBe(true);
    expect(isScriptable(rx({ quantityToDispense: 30, quantityDispensed: 10 }))).toBe(true);
  });

  it('is never a stopped order, nor one already dispensed in full', () => {
    expect(isScriptable(rx({ status: 'discontinued' }))).toBe(false);
    expect(isScriptable(rx({ status: 'dispensed', quantityToDispense: 30, quantityDispensed: 30 }))).toBe(false);
    // Fully supplied, whatever the status field says.
    expect(isScriptable(rx({ quantityToDispense: 30, quantityDispensed: 30 }))).toBe(false);
    expect(scriptableOnly([rx({ status: 'dispensed' }), rx({ _id: 'rx-2' })]).map(r => r._id)).toEqual(['rx-2']);
  });

  it('leaves a dispensed order out of a texted prescription', () => {
    const ctx = { patient: { name: 'Mary Akol' }, facilityName: 'Juba Teaching Hospital', prescriberName: 'Dr. James Wani', issuedAt: '2026-10-03T09:00:00.000Z' };
    const text = buildPrescriptionText([rx({ status: 'dispensed' })], ctx as never);
    expect(text.text).toBe('');
    expect(text.included).toEqual([]);
  });
});

describe('a controlled medicine is controlled wherever it is stocked', () => {
  it('recognises the class, not the shelf', () => {
    for (const name of ['Morphine', 'Morphine 10mg tablet', 'Tramadol', 'Codeine', 'Diazepam 5mg', 'Phenobarbital', 'Ketamine']) {
      expect(isControlledMedicine(name)).toBe(true);
    }
  });

  it('catches the controlled part of a combination and names the formulary does not list', () => {
    expect(isControlledMedicine('Paracetamol + Codeine')).toBe(true);
    expect(isControlledMedicine('Pethidine 50mg injection')).toBe(true);
    expect(isControlledMedicine('Midazolam')).toBe(true);
  });

  it('does not flag ordinary medicines or an empty name', () => {
    for (const name of ['Paracetamol', 'Amoxicillin', 'Artemether-Lumefantrine (Coartem)', 'Metformin', '', '   ']) {
      expect(isControlledMedicine(name)).toBe(false);
    }
  });
});

describe('two writes to one note at the same moment', () => {
  const identity = {
    patientId: 'pat-1', patientName: 'Mary Akol', serviceDate: '2026-10-03',
    authorId: 'user-1', authorName: 'Dr. James Wani', hospitalId: 'hosp-1', orgId: 'org-1',
  };
  const textOf = (note: Awaited<ReturnType<typeof getClinicalNoteById>>, id: string) =>
    note?.sections.find(section => section.sectionId === id)?.text;

  it('both land — neither is refused, neither overwrites the other', async () => {
    const note = await createClinicalNote({ ...identity, noteType: 'soap' } as never);
    // What the editor does when two sections are typed inside one debounce
    // window: both saves start from the same revision.
    const results = await Promise.allSettled([
      saveNoteSection(note._id, 'subjective', { text: 'Fever and headache for 3 days' }),
      saveNoteSection(note._id, 'assessment', { text: 'Likely malaria' }),
      saveNoteSection(note._id, 'plan', { text: 'RDT, then treat' }),
      recordPlanAction(note._id, { kind: 'lab', label: 'Lab/study ordered from the note', createdBy: 'user-1' }),
    ]);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled']);

    const saved = await getClinicalNoteById(note._id);
    expect(textOf(saved, 'subjective')).toBe('Fever and headache for 3 days');
    expect(textOf(saved, 'assessment')).toBe('Likely malaria');
    expect(textOf(saved, 'plan')).toBe('RDT, then treat');
    expect(saved?.planActions).toHaveLength(1);
  });

  it('a failed write does not jam the ones queued behind it', async () => {
    const note = await createClinicalNote({ ...identity, noteType: 'soap' } as never);
    const results = await Promise.allSettled([
      saveNoteSection('note-does-not-exist', 'plan', { text: 'x' }),
      saveNoteSection(note._id, 'plan', { text: 'First' }),
      saveNoteSection(note._id, 'plan', { text: 'Second' }),
    ]);
    expect(results.every(result => result.status === 'fulfilled')).toBe(true);
    expect(textOf(await getClinicalNoteById(note._id), 'plan')).toBe('Second');
  });
});
