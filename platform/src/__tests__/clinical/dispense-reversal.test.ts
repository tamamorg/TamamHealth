/**
 * reverseDispense: a dispensed order goes back to ready-to-fill and the
 * medicine back to the batches it came from; the controlled-substance register
 * gets an APPENDED `return` entry, never an edit.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

jest.setTimeout(30000);

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { usersDB, hospitalsDB, patientsDB, pharmacyInventoryDB, controlledSubstanceLogDB, prescriptionsDB } from '@/lib/db';
import { createPrescription as createScoped, advancePrescription } from '@/lib/services/prescription-service';
import { dispenseMedication, reverseDispense, DispenseError, isWithinReversalWindow } from '@/lib/services/dispensing-service';
import { getMovementsForInventory, dailyReconciliation } from '@/lib/services/controlled-substance-service';
import { jubaDate } from '@/lib/time-juba';
import type { PrescriptionDoc, PharmacyInventoryDoc } from '@/lib/db-types';

const HOSP = 'hosp-001';
const ORG = 'org-moh-ss';
const PHARMACIST = { _id: 'user-pharma-rose', name: 'Pharmacist Rose' };
const WITNESS = { _id: 'user-nurse-stella', name: 'Nurse Stella' };
const PATIENT = { _id: 'pat-00001', name: 'Nyakuma Deng' };

async function seedWorld() {
  await putDoc(hospitalsDB(), { _id: HOSP, type: 'hospital', name: 'JTH', orgId: ORG } as never);
  await putDoc(usersDB(), { _id: 'user-dr', type: 'user', username: 'dr', name: 'Dr. Wani', role: 'doctor', hospitalId: HOSP, orgId: ORG, isActive: true } as never);
  await putDoc(usersDB(), { _id: PHARMACIST._id, type: 'user', username: 'pharma.rose', name: PHARMACIST.name, role: 'pharmacist', hospitalId: HOSP, orgId: ORG, isActive: true } as never);
  await putDoc(usersDB(), { _id: 'user-pharma-2', type: 'user', username: 'p2', name: 'Pharm Two', role: 'pharmacist', hospitalId: HOSP, orgId: ORG, isActive: true } as never);
  await putDoc(usersDB(), { _id: WITNESS._id, type: 'user', username: 'nurse.stella', name: WITNESS.name, role: 'nurse', hospitalId: HOSP, orgId: ORG, isActive: true } as never);
  await putDoc(patientsDB(), { _id: PATIENT._id, type: 'patient', firstName: 'Nyakuma', surname: 'Deng', registrationHospital: HOSP, orgId: ORG, state: 'Central Equatoria', county: 'Juba' } as never);
}

const batch = (id: string, name: string, no: string, expiry: string, stock: number, extra: Record<string, unknown> = {}) => putDoc(pharmacyInventoryDB(), {
  _id: id, type: 'pharmacy_inventory', hospitalId: HOSP, hospitalName: 'JTH', medicationName: name, category: 'x',
  stockLevel: stock, unit: 'tablets', reorderLevel: 5, batchNumber: no, expiryDate: expiry, dispensedToday: 0, orgId: ORG, ...extra,
} as never);

async function dispensed(medication: string, qty: number, witness = false): Promise<PrescriptionDoc> {
  const { prescription } = await createScoped({
    patientId: PATIENT._id, patientName: PATIENT.name, medication, dose: '1', route: 'oral', frequency: 'TDS',
    duration: '5 days', prescribedBy: 'Dr. Wani', status: 'pending', hospitalId: HOSP, orgId: ORG, quantityToDispense: qty,
  } as never, { role: 'super_admin' } as const);
  await advancePrescription(prescription._id, 'cleared_for_dispensing', undefined, PHARMACIST._id);
  const cleared = await prescriptionsDB().get(prescription._id) as PrescriptionDoc;
  const res = await dispenseMedication({
    prescription: cleared, quantity: qty, dispenserId: PHARMACIST._id, dispenserName: PHARMACIST.name,
    facilityId: HOSP, orgId: ORG, ...(witness ? { witnessId: WITNESS._id, witnessName: WITNESS.name } : {}),
  });
  return res.prescription;
}

const base = (rx: PrescriptionDoc) => ({
  prescription: rx, reason: 'Wrong strength handed over', actorId: PHARMACIST._id, actorName: PHARMACIST.name,
  facilityId: HOSP, orgId: ORG,
});
const stock = async (id: string) => ((await pharmacyInventoryDB().get(id)) as PharmacyInventoryDoc).stockLevel;
async function code(p: Promise<unknown>) {
  try { await p; } catch (e) { if (e instanceof DispenseError) return e.code; throw e; }
  throw new Error('expected rejection');
}

afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

describe('reverseDispense', () => {
  it('returns units to the batches they came from and makes the order fillable again', async () => {
    await seedWorld();
    await batch('inv-a', 'Amoxicillin 500mg', 'A', '2026-12-01', 10);
    await batch('inv-b', 'Amoxicillin 500mg', 'B', '2027-06-01', 20);
    const rx = await dispensed('Amoxicillin 500mg', 15); // 10 from A, 5 from B
    expect(await stock('inv-a')).toBe(0);
    expect(await stock('inv-b')).toBe(15);

    const res = await reverseDispense({ ...base(rx), quantity: 6 }); // newest allocation (B:5) first, then A:1
    expect(res.quantityReturned).toBe(6);
    expect(res.approximateBatch).toBe(false);
    expect(res.billing).toBe('charge_stands');
    expect(await stock('inv-b')).toBe(20);
    expect(await stock('inv-a')).toBe(1);
    expect(res.prescription.quantityDispensed).toBe(9);
    expect(res.prescription.dispenseAllocations).toEqual([expect.objectContaining({ inventoryId: 'inv-a', quantity: 9 })]);
    expect(res.prescription.dispenseReversals).toHaveLength(1);
    expect(res.prescription.dispenseReversals![0]).toEqual(expect.objectContaining({ reason: 'Wrong strength handed over', byName: PHARMACIST.name }));
    expect(res.prescription.orderStatus).toBe('cleared_for_dispensing');
    expect(res.prescription.status).toBe('pending');

    // A full return clears the dispense stamps and the order can be dispensed again.
    const rest = await reverseDispense(base(res.prescription));
    expect(rest.prescription.quantityDispensed).toBe(0);
    expect(rest.prescription.dispensedAt).toBeUndefined();
    expect(await stock('inv-a')).toBe(10);
    const again = await dispenseMedication({
      prescription: rest.prescription, quantity: 15, dispenserId: PHARMACIST._id, dispenserName: PHARMACIST.name, facilityId: HOSP, orgId: ORG,
    });
    expect(again.outcome).toBe('full');
  });

  it('appends a return entry to the register for a controlled batch and requires a witness', async () => {
    await seedWorld();
    await batch('inv-m', 'Morphine 10mg/mL', 'M1', '2027-01-01', 50, { controlledSchedule: 'II', unit: 'ampoules' });
    const rx = await dispensed('Morphine 10mg/mL', 2, true);
    const before = await getMovementsForInventory('inv-m');
    expect(before.map(m => m.movement)).toEqual(['dispense']);

    expect(await code(reverseDispense(base(rx)))).toBe('WITNESS_REQUIRED');
    expect(await code(reverseDispense({ ...base(rx), witnessId: PHARMACIST._id }))).toBe('WITNESS_REQUIRED');
    expect(await stock('inv-m')).toBe(48); // refused writes nothing

    const res = await reverseDispense({ ...base(rx), witnessId: WITNESS._id, witnessName: 'spoofed' });
    expect(await stock('inv-m')).toBe(50);
    const after = await getMovementsForInventory('inv-m');
    expect(after).toHaveLength(2);
    const ret = after.find(m => m.movement === 'return')!;
    expect(ret).toEqual(expect.objectContaining({ quantity: 2, beforeBalance: 48, afterBalance: 50, witnessName: WITNESS.name, prescriptionId: rx._id }));
    expect(after.find(m => m.movement === 'dispense')).toEqual(expect.objectContaining({ quantity: 2, afterBalance: 48 })); // untouched
    expect(res.controlledLogIds).toEqual([ret._id]);
    expect(res.prescription.controlledLogId).toBeUndefined();
    expect(res.prescription.dispenseReversals![0].witnessId).toBe(WITNESS._id);
    expect(controlledSubstanceLogDB()).toBeDefined();

    const day = await dailyReconciliation(jubaDate());
    expect(day.movementsByMedication['inv-m']).toEqual(expect.objectContaining({ dispenses: 0, netChange: 0 }));
  });

  it('guards role, reason, state, quantity and the same-day window', async () => {
    await seedWorld();
    await batch('inv-a', 'Amoxicillin 500mg', 'A', '2027-12-01', 30);
    const rx = await dispensed('Amoxicillin 500mg', 10);

    expect(await code(reverseDispense({ ...base(rx), actorId: WITNESS._id, actorName: WITNESS.name }))).toBe('NOT_AUTHORISED');
    expect(await code(reverseDispense({ ...base(rx), reason: '  ' }))).toBe('REASON_REQUIRED');
    expect(await code(reverseDispense({ ...base(rx), quantity: 11 }))).toBe('BAD_QUANTITY');
    expect(await code(reverseDispense({ ...base(rx), quantity: 0 }))).toBe('BAD_QUANTITY');
    expect(await stock('inv-a')).toBe(20);

    // Not dispensed.
    const pending = { ...rx, status: 'pending', orderStatus: 'cleared_for_dispensing', quantityDispensed: 0 } as PrescriptionDoc;
    expect(await code(reverseDispense(base(pending)))).toBe('NOT_DISPENSED');

    // Another day: the stored dispense time is yesterday.
    const old = await prescriptionsDB().get(rx._id) as PrescriptionDoc;
    const yesterday = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
    await prescriptionsDB().put({ ...old, dispensedAt: yesterday });
    const stale = await prescriptionsDB().get(rx._id) as PrescriptionDoc;
    expect(await code(reverseDispense(base(stale)))).toBe('WINDOW_CLOSED');
    expect(await stock('inv-a')).toBe(20);
  });

  it('puts an unrecorded-batch dispense on the earliest-expiring matching batch and says so', async () => {
    await seedWorld();
    await batch('inv-a', 'Amoxicillin 500mg', 'A', '2027-12-01', 30);
    await batch('inv-b', 'Amoxicillin 500mg', 'B', '2026-12-01', 0);
    const rx = await dispensed('Amoxicillin 500mg', 5);
    const legacy = await prescriptionsDB().get(rx._id) as PrescriptionDoc;
    await prescriptionsDB().put({ ...legacy, dispenseAllocations: undefined });
    const res = await reverseDispense(base(await prescriptionsDB().get(rx._id) as PrescriptionDoc));
    expect(res.approximateBatch).toBe(true);
    expect(await stock('inv-b')).toBe(5);
  });

  it('window helper: same Juba day only', () => {
    expect(isWithinReversalWindow(new Date().toISOString())).toBe(true);
    expect(isWithinReversalWindow(undefined)).toBe(false);
    expect(isWithinReversalWindow('2020-01-01T10:00:00Z')).toBe(false);
  });
});
