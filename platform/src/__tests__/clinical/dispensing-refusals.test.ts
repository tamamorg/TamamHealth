/**
 * Issue #85 pharmacy acceptance criteria: "edge cases (insufficient stock,
 * cancelled orders) give clear errors."
 *
 * `dispensing-service.ts` (the ONLY sanctioned way to move stock — see the
 * `@deprecated` note on `prescription-service.dispensePrescription`) already
 * had coverage for "nobody cleared this order" and "exceeds the prescribed
 * course" (integration/pharmacy-journey.test.ts), but nothing exercised:
 *   - a medication with no inventory row at all (STOCK_OUT),
 *   - a medication whose only batch has expired (also refused — expired
 *     stock is excluded from FEFO allocation entirely, never dispensed),
 *   - a medication in stock but short of the requested quantity
 *     (INSUFFICIENT_STOCK, with the real "available" count surfaced),
 *   - a discontinued ("cancelled") prescription, which must never be
 *     dispensable even if it was cleared before being stopped,
 *   - the controlled-substance witness gate (required, must be a different
 *     person, must be a real active member of staff at the facility),
 *   - a short fill that requires explicit confirmation.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

jest.setTimeout(30000);

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { usersDB, hospitalsDB, patientsDB, pharmacyInventoryDB, controlledSubstanceLogDB } from '@/lib/db';
import { createPrescription, advancePrescription, getPrescriptionsByPatient, updatePrescription } from '@/lib/services/prescription-service';
import { dispenseMedication, DispenseError, getDispensableBatches } from '@/lib/services/dispensing-service';
import type { PrescriptionDoc } from '@/lib/db-types';

const HOSP = 'hosp-001';
const ORG = 'org-moh-ss';
const DOCTOR = { _id: 'user-dr-wani', name: 'Dr. Wani' };
const PHARMACIST = { _id: 'user-pharma-rose', name: 'Pharmacist Rose' };
const WITNESS = { _id: 'user-nurse-stella', name: 'Nurse Stella' };
const PATIENT = { _id: 'pat-00001', name: 'Nyakuma Deng' };

async function seedWorld() {
  await putDoc(hospitalsDB(), { _id: HOSP, type: 'hospital', name: 'Juba Teaching Hospital', orgId: ORG } as never);
  await putDoc(usersDB(), {
    _id: DOCTOR._id, type: 'user', username: 'dr.wani', name: DOCTOR.name,
    role: 'doctor', hospitalId: HOSP, orgId: ORG, isActive: true,
  } as never);
  await putDoc(usersDB(), {
    _id: PHARMACIST._id, type: 'user', username: 'pharma.rose', name: PHARMACIST.name,
    role: 'pharmacist', hospitalId: HOSP, orgId: ORG, isActive: true,
  } as never);
  await putDoc(usersDB(), {
    _id: WITNESS._id, type: 'user', username: 'nurse.stella', name: WITNESS.name,
    role: 'nurse', hospitalId: HOSP, orgId: ORG, isActive: true,
  } as never);
  await putDoc(patientsDB(), {
    _id: PATIENT._id, type: 'patient', firstName: 'Nyakuma', surname: 'Deng',
    registrationHospital: HOSP, orgId: ORG, state: 'Central Equatoria', county: 'Juba',
  } as never);
}

async function prescribe(overrides: Partial<PrescriptionDoc> = {}): Promise<PrescriptionDoc> {
  const { prescription } = await createPrescription({
    patientId: PATIENT._id, patientName: PATIENT.name,
    medication: 'Amoxicillin 500mg', dose: '500mg', route: 'oral',
    frequency: 'TDS', duration: '5 days', prescribedBy: DOCTOR.name,
    status: 'pending', hospitalId: HOSP, orgId: ORG, quantityToDispense: 15,
    ...overrides,
  } as never);
  return prescription;
}

async function clearForDispensing(rxId: string) {
  await advancePrescription(rxId, 'cleared_for_dispensing', undefined, PHARMACIST._id);
  return (await getPrescriptionsByPatient(PATIENT._id)).find(r => r._id === rxId)!;
}

async function catchDispenseError(promise: Promise<unknown>): Promise<DispenseError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof DispenseError) return err;
    throw err;
  }
  throw new Error('expected dispenseMedication to reject');
}

afterEach(async () => {
  await teardownTestDBs();
  uuidCounter = 0;
});

describe('insufficient / absent stock', () => {
  it('refuses with STOCK_OUT when the medication has no inventory row at all', async () => {
    await seedWorld();
    const rx = await prescribe();
    const cleared = await clearForDispensing(rx._id);

    const err = await catchDispenseError(dispenseMedication({
      prescription: cleared, quantity: 15,
      dispenserId: PHARMACIST._id, dispenserName: PHARMACIST.name, facilityId: HOSP, orgId: ORG,
    }));
    expect(err.code).toBe('STOCK_OUT');
    expect(err.available).toBe(0);
    expect(err.message).toMatch(/out of stock/i);
  });

  it('refuses with INSUFFICIENT_STOCK and reports what is actually on the shelf', async () => {
    await seedWorld();
    await putDoc(pharmacyInventoryDB(), {
      _id: 'inv-amox', type: 'pharmacy_inventory', hospitalId: HOSP, hospitalName: 'JTH',
      medicationName: 'Amoxicillin 500mg', category: 'Antibiotic', stockLevel: 4, unit: 'tablets',
      reorderLevel: 20, batchNumber: 'B-2026-01', expiryDate: '2027-01-01', dispensedToday: 0, orgId: ORG,
    } as never);
    const rx = await prescribe({ quantityToDispense: 15 });
    const cleared = await clearForDispensing(rx._id);

    const err = await catchDispenseError(dispenseMedication({
      prescription: cleared, quantity: 15,
      dispenserId: PHARMACIST._id, dispenserName: PHARMACIST.name, facilityId: HOSP, orgId: ORG,
    }));
    expect(err.code).toBe('INSUFFICIENT_STOCK');
    expect(err.available).toBe(4);
    expect(err.message).toMatch(/4 available, 15 requested/i);

    // Nothing moved — a rejected dispense costs no stock.
    const batch = await pharmacyInventoryDB().get('inv-amox') as { stockLevel: number };
    expect(batch.stockLevel).toBe(4);
  });

  it('refuses a short fill unless the pharmacist explicitly confirms a partial', async () => {
    await seedWorld();
    await putDoc(pharmacyInventoryDB(), {
      _id: 'inv-amox', type: 'pharmacy_inventory', hospitalId: HOSP, hospitalName: 'JTH',
      medicationName: 'Amoxicillin 500mg', category: 'Antibiotic', stockLevel: 40, unit: 'tablets',
      reorderLevel: 20, batchNumber: 'B-2026-01', expiryDate: '2027-01-01', dispensedToday: 0, orgId: ORG,
    } as never);
    const rx = await prescribe({ quantityToDispense: 15 });
    const cleared = await clearForDispensing(rx._id);

    const err = await catchDispenseError(dispenseMedication({
      prescription: cleared, quantity: 10, // less than the full 15-tablet course
      dispenserId: PHARMACIST._id, dispenserName: PHARMACIST.name, facilityId: HOSP, orgId: ORG,
    }));
    expect(err.code).toBe('PARTIAL_NOT_ALLOWED');

    // Confirmed, it goes through and the order is left open for the balance.
    const result = await dispenseMedication({
      prescription: cleared, quantity: 10, allowPartial: true,
      dispenserId: PHARMACIST._id, dispenserName: PHARMACIST.name, facilityId: HOSP, orgId: ORG,
    });
    expect(result.outcome).toBe('partial');
    expect(result.prescription.status).toBe('pending'); // stays open — balance still owed
    expect(result.prescription.orderStatus).toBe('stockout_partial_referred');
  });
});

describe('expired stock is never dispensable', () => {
  it('excludes an expired batch from FEFO allocation, even with plenty on the shelf', async () => {
    await seedWorld();
    await putDoc(pharmacyInventoryDB(), {
      _id: 'inv-amox-expired', type: 'pharmacy_inventory', hospitalId: HOSP, hospitalName: 'JTH',
      medicationName: 'Amoxicillin 500mg', category: 'Antibiotic', stockLevel: 500, unit: 'tablets',
      reorderLevel: 20, batchNumber: 'B-2020-OLD', expiryDate: '2020-01-01', dispensedToday: 0, orgId: ORG,
    } as never);

    const batches = await getDispensableBatches('Amoxicillin 500mg', HOSP);
    expect(batches).toHaveLength(0);
  });

  it('refuses to dispense when the only stock on the shelf has expired', async () => {
    await seedWorld();
    await putDoc(pharmacyInventoryDB(), {
      _id: 'inv-amox-expired', type: 'pharmacy_inventory', hospitalId: HOSP, hospitalName: 'JTH',
      medicationName: 'Amoxicillin 500mg', category: 'Antibiotic', stockLevel: 500, unit: 'tablets',
      reorderLevel: 20, batchNumber: 'B-2020-OLD', expiryDate: '2020-01-01', dispensedToday: 0, orgId: ORG,
    } as never);
    const rx = await prescribe();
    const cleared = await clearForDispensing(rx._id);

    const err = await catchDispenseError(dispenseMedication({
      prescription: cleared, quantity: 15,
      dispenserId: PHARMACIST._id, dispenserName: PHARMACIST.name, facilityId: HOSP, orgId: ORG,
    }));
    expect(err.code).toBe('STOCK_OUT');

    // The expired batch itself is untouched — a refused dispense is not a
    // licence to quietly write it off.
    const batch = await pharmacyInventoryDB().get('inv-amox-expired') as { stockLevel: number };
    expect(batch.stockLevel).toBe(500);
  });

  it('picks the earlier-expiring valid batch over a later one, skipping the expired lot entirely', async () => {
    await seedWorld();
    await putDoc(pharmacyInventoryDB(), {
      _id: 'inv-expired', type: 'pharmacy_inventory', hospitalId: HOSP, hospitalName: 'JTH',
      medicationName: 'Amoxicillin 500mg', category: 'Antibiotic', stockLevel: 500, unit: 'tablets',
      reorderLevel: 20, batchNumber: 'B-EXPIRED', expiryDate: '2020-01-01', dispensedToday: 0, orgId: ORG,
    } as never);
    await putDoc(pharmacyInventoryDB(), {
      _id: 'inv-later', type: 'pharmacy_inventory', hospitalId: HOSP, hospitalName: 'JTH',
      medicationName: 'Amoxicillin 500mg', category: 'Antibiotic', stockLevel: 20, unit: 'tablets',
      reorderLevel: 20, batchNumber: 'B-LATER', expiryDate: '2028-06-01', dispensedToday: 0, orgId: ORG,
    } as never);
    await putDoc(pharmacyInventoryDB(), {
      _id: 'inv-sooner', type: 'pharmacy_inventory', hospitalId: HOSP, hospitalName: 'JTH',
      medicationName: 'Amoxicillin 500mg', category: 'Antibiotic', stockLevel: 20, unit: 'tablets',
      reorderLevel: 20, batchNumber: 'B-SOONER', expiryDate: '2027-01-01', dispensedToday: 0, orgId: ORG,
    } as never);

    const batches = await getDispensableBatches('Amoxicillin 500mg', HOSP);
    expect(batches.map(b => b._id)).toEqual(['inv-sooner', 'inv-later']); // expired lot never appears
  });
});

describe('a discontinued ("cancelled") prescription can never be dispensed', () => {
  it('refuses even if the order was cleared before being discontinued', async () => {
    await seedWorld();
    await putDoc(pharmacyInventoryDB(), {
      _id: 'inv-amox', type: 'pharmacy_inventory', hospitalId: HOSP, hospitalName: 'JTH',
      medicationName: 'Amoxicillin 500mg', category: 'Antibiotic', stockLevel: 100, unit: 'tablets',
      reorderLevel: 20, batchNumber: 'B-2026-01', expiryDate: '2027-01-01', dispensedToday: 0, orgId: ORG,
    } as never);
    const rx = await prescribe();
    const cleared = await clearForDispensing(rx._id);

    // The prescriber stops the drug after pharmacy clearance but before pickup.
    const discontinued = await updatePrescription(cleared._id, { status: 'discontinued', stoppedAt: new Date().toISOString() });
    expect(discontinued?.status).toBe('discontinued');

    const err = await catchDispenseError(dispenseMedication({
      prescription: discontinued!, quantity: 15,
      dispenserId: PHARMACIST._id, dispenserName: PHARMACIST.name, facilityId: HOSP, orgId: ORG,
    }));
    expect(err.code).toBe('NOT_CLEARED');

    const batch = await pharmacyInventoryDB().get('inv-amox') as { stockLevel: number };
    expect(batch.stockLevel).toBe(100); // a cancelled order moves nothing
  });

  it('a fresh, never-cleared, discontinued order is refused the same way', async () => {
    await seedWorld();
    const rx = await prescribe();
    const discontinued = await updatePrescription(rx._id, { status: 'discontinued' });

    const err = await catchDispenseError(dispenseMedication({
      prescription: discontinued!, quantity: 15,
      dispenserId: PHARMACIST._id, dispenserName: PHARMACIST.name, facilityId: HOSP, orgId: ORG,
    }));
    expect(err.code).toBe('NOT_CLEARED');
  });
});

describe('controlled-substance witness gate', () => {
  async function seedControlledStock() {
    await putDoc(pharmacyInventoryDB(), {
      _id: 'inv-morphine', type: 'pharmacy_inventory', hospitalId: HOSP, hospitalName: 'JTH',
      medicationName: 'Morphine 10mg/mL', category: 'Opioid', stockLevel: 50, unit: 'ampoules',
      reorderLevel: 10, batchNumber: 'B-CTRL-01', expiryDate: '2027-01-01', dispensedToday: 0,
      orgId: ORG, controlledSchedule: 'II',
    } as never);
  }

  it('requires a witness for a controlled schedule medication', async () => {
    await seedWorld();
    await seedControlledStock();
    const rx = await prescribe({ medication: 'Morphine 10mg/mL', quantityToDispense: 2 });
    const cleared = await clearForDispensing(rx._id);

    const err = await catchDispenseError(dispenseMedication({
      prescription: cleared, quantity: 2,
      dispenserId: PHARMACIST._id, dispenserName: PHARMACIST.name, facilityId: HOSP, orgId: ORG,
    }));
    expect(err.code).toBe('WITNESS_REQUIRED');
  });

  it('refuses when the operator and witness are the same person', async () => {
    await seedWorld();
    await seedControlledStock();
    const rx = await prescribe({ medication: 'Morphine 10mg/mL', quantityToDispense: 2 });
    const cleared = await clearForDispensing(rx._id);

    const err = await catchDispenseError(dispenseMedication({
      prescription: cleared, quantity: 2,
      dispenserId: PHARMACIST._id, dispenserName: PHARMACIST.name,
      witnessId: PHARMACIST._id, witnessName: PHARMACIST.name,
      facilityId: HOSP, orgId: ORG,
    }));
    expect(err.code).toBe('WITNESS_REQUIRED');
  });

  it('refuses an unverifiable or inactive witness', async () => {
    await seedWorld();
    await seedControlledStock();
    const rx = await prescribe({ medication: 'Morphine 10mg/mL', quantityToDispense: 2 });
    const cleared = await clearForDispensing(rx._id);

    const unknownWitness = await catchDispenseError(dispenseMedication({
      prescription: cleared, quantity: 2,
      dispenserId: PHARMACIST._id, dispenserName: PHARMACIST.name,
      witnessId: 'user-does-not-exist', witnessName: 'Nobody',
      facilityId: HOSP, orgId: ORG,
    }));
    expect(unknownWitness.code).toBe('WITNESS_INVALID');

    await putDoc(usersDB(), {
      _id: 'user-inactive-nurse', type: 'user', username: 'inactive', name: 'Inactive Nurse',
      role: 'nurse', hospitalId: HOSP, orgId: ORG, isActive: false,
    } as never);
    const inactiveWitness = await catchDispenseError(dispenseMedication({
      prescription: cleared, quantity: 2,
      dispenserId: PHARMACIST._id, dispenserName: PHARMACIST.name,
      witnessId: 'user-inactive-nurse', witnessName: 'Inactive Nurse',
      facilityId: HOSP, orgId: ORG,
    }));
    expect(inactiveWitness.code).toBe('WITNESS_INVALID');
  });

  it('succeeds with a verified, active, same-facility witness and writes the register entry', async () => {
    await seedWorld();
    await seedControlledStock();
    const rx = await prescribe({ medication: 'Morphine 10mg/mL', quantityToDispense: 2 });
    const cleared = await clearForDispensing(rx._id);

    const result = await dispenseMedication({
      prescription: cleared, quantity: 2,
      dispenserId: PHARMACIST._id, dispenserName: PHARMACIST.name,
      witnessId: WITNESS._id, witnessName: WITNESS.name,
      facilityId: HOSP, orgId: ORG,
    });

    expect(result.outcome).toBe('full');
    expect(result.controlledLogId).toBeTruthy();
    const logEntry = await controlledSubstanceLogDB().get(result.controlledLogId!) as {
      operatorId: string; witnessId: string; quantity: number; medicationName: string;
    };
    expect(logEntry.operatorId).toBe(PHARMACIST._id);
    expect(logEntry.witnessId).toBe(WITNESS._id);
    expect(logEntry.quantity).toBe(2);
    expect(logEntry.medicationName).toBe('Morphine 10mg/mL');

    const batch = await pharmacyInventoryDB().get('inv-morphine') as { stockLevel: number };
    expect(batch.stockLevel).toBe(48);
  });
});
