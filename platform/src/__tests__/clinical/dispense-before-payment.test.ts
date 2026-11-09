/**
 * Pay-before-dispense is the default, but a STAT order is dispensed with the
 * charge left open, and the prescription records that it went out before
 * payment (the line the pharmacy list and the bill show).
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

jest.setTimeout(30000);

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { usersDB, hospitalsDB, patientsDB, pharmacyInventoryDB } from '@/lib/db';
import { createArrivalEncounter, advanceEncounterToClinician } from '@/lib/services/encounter-service';
import { createPrescription as createPrescriptionScoped, advancePrescription, getPrescriptionsByPatient } from '@/lib/services/prescription-service';

// Fixtures here are single-tenant; a system-wide scope reads every doc, so the
// tenant barrier is exercised by the dedicated cross-org suite instead.
const TEST_SCOPE = { role: 'super_admin' } as const;
const createPrescription = (data: Parameters<typeof createPrescriptionScoped>[0]) =>
  createPrescriptionScoped(data, TEST_SCOPE);
import { dispenseMedication } from '@/lib/services/dispensing-service';
import { paymentReleaseFor } from '@/lib/pharmacy-workflow';

const HOSP = 'hosp-001';
const ORG = 'org-moh-ss';
const DOCTOR = { _id: 'user-dr-wani', name: 'Dr. Wani' };
const PHARMACIST = { _id: 'user-pharma-rose', name: 'Pharmacist Rose' };
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
  await putDoc(patientsDB(), {
    _id: PATIENT._id, type: 'patient', firstName: 'Nyakuma', surname: 'Deng',
    registrationHospital: HOSP, orgId: ORG, state: 'Central Equatoria', county: 'Juba',
  } as never);
  await putDoc(pharmacyInventoryDB(), {
    _id: 'inv-amox', type: 'pharmacy_inventory', hospitalId: HOSP,
    hospitalName: 'Juba Teaching Hospital', medicationName: 'Amoxicillin 500mg',
    category: 'Antibiotic', stockLevel: 200, unit: 'tablets', reorderLevel: 20,
    batchNumber: 'B-2026-01', expiryDate: '2027-01-01', dispensedToday: 0, orgId: ORG,
  } as never);
}

async function clearForDispensing(rxId: string) {
  await advancePrescription(rxId, 'cleared_for_dispensing', undefined, PHARMACIST._id);
}

afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

async function stat(frequency: string) {
  await seedWorld();
  const arrival = await createArrivalEncounter({
    patientId: PATIENT._id, patientName: PATIENT.name,
    hospitalId: HOSP, hospitalName: 'Juba Teaching Hospital', orgId: ORG,
    arrivalChannel: 'walk_in', actorId: 'user-frontdesk-1',
  });
  const claimed = await advanceEncounterToClinician(arrival._id, {
    clinicianId: DOCTOR._id, clinicianName: DOCTOR.name, actorId: DOCTOR._id,
  });
  const { prescription } = await createPrescription({
    patientId: PATIENT._id, patientName: PATIENT.name, encounterId: claimed._id,
    medication: 'Amoxicillin 500mg', dose: '500mg', route: 'oral',
    frequency, duration: '1 day', prescribedBy: DOCTOR.name,
    status: 'pending', hospitalId: HOSP, quantityToDispense: 1,
  } as never);
  await clearForDispensing(prescription._id);
  return (await getPrescriptionsByPatient(PATIENT._id)).find(r => r._id === prescription._id)!;
}

it('marks the prescription dispensed before payment when it was released ahead of the bill', async () => {
  const cleared = await stat('STAT (Immediately)');
  expect(paymentReleaseFor(cleared)).toBe('stat');
  const result = await dispenseMedication({
    prescription: cleared, quantity: 1,
    dispenserId: PHARMACIST._id, dispenserName: PHARMACIST.name,
    facilityId: HOSP, orgId: ORG,
    dispensedBeforePayment: { reason: 'stat', balanceDue: 1500 },
  });
  expect(result.prescription.dispensedBeforePayment).toMatchObject({ reason: 'stat', balanceDue: 1500 });
  expect(result.prescription.dispensedBeforePayment?.at).toBeTruthy();
});

it('leaves an ordinary dispense unmarked', async () => {
  const cleared = await stat('Three times daily');
  expect(paymentReleaseFor(cleared)).toBeNull();
  const result = await dispenseMedication({
    prescription: cleared, quantity: 1,
    dispenserId: PHARMACIST._id, dispenserName: PHARMACIST.name,
    facilityId: HOSP, orgId: ORG,
  });
  expect(result.prescription.dispensedBeforePayment).toBeUndefined();
});
