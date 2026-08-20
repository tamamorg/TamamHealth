/**
 * Registration through dispensing, end to end through the REAL services on
 * in-memory PouchDB.
 *
 * The doctor-journey suite stops at prescribing, so nothing anywhere exercised
 * `dispenseMedication` — the single most consequential write in the pharmacy
 * module. This suite covers the last leg, and pins the four behaviours that
 * were missing from it entirely:
 *
 *   1. a prescription raises a charge, so the pay-first gate has something to
 *      check instead of passing vacuously on a balance of zero;
 *   2. prescribing parks the visit at pharmacy, so the queue and the encounter
 *      stop telling different stories;
 *   3. medications carry a criticality tier, so the queue can put insulin
 *      before vitamins and checkout can flag a life-sustaining drug that never
 *      reached the patient;
 *   4. an in-flight procedure blocks facility checkout — a critical gate item
 *      that used to auto-pass because it had nothing to read.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

jest.setTimeout(30000);

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import {
  usersDB, hospitalsDB, patientsDB, pharmacyInventoryDB, feeScheduleDB,
} from '@/lib/db';
import { createArrivalEncounter, advanceEncounterToClinician, getEncounter } from '@/lib/services/encounter-service';
import { createPrescription, advancePrescription, getPrescriptionsByPatient } from '@/lib/services/prescription-service';
import { dispenseMedication } from '@/lib/services/dispensing-service';
import { getPatientBalance } from '@/lib/services/ledger-service';
import { evaluateCheckoutGate } from '@/lib/services/checkout-gate-service';
import { createProcedure, advanceProcedure } from '@/lib/services/procedure-service';
import { comparePharmacyPriority } from '@/lib/clinical-flow/medication-tiers';

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
  // The org's price list. Without a catalogued price nothing is charged at
  // all — chargeForServices skips unpriced lines rather than billing zero.
  await putDoc(feeScheduleDB(), {
    _id: 'fee-ph-disp', type: 'fee_schedule', category: 'pharmacy',
    serviceCode: 'PH-DISP', serviceName: 'Medication dispensing',
    unitPrice: 1000, currency: 'SSP', isActive: true, facilityId: HOSP, orgId: ORG,
  } as never);
  await putDoc(pharmacyInventoryDB(), {
    _id: 'inv-insulin', type: 'pharmacy_inventory', hospitalId: HOSP,
    hospitalName: 'Juba Teaching Hospital', medicationName: 'Insulin (soluble/regular)',
    category: 'Antidiabetic', stockLevel: 40, unit: 'vials', reorderLevel: 10,
    batchNumber: 'B-2026-01', expiryDate: '2027-01-01', dispensedToday: 0, orgId: ORG,
  } as never);
}

/**
 * Walk a fresh order to the only stage from which stock may move. Clearance is
 * pharmacist-gated in the service, so the actor is part of the walk.
 */
async function clearForDispensing(rxId: string) {
  await advancePrescription(rxId, 'received_in_pharmacy_queue', undefined, PHARMACIST._id);
  await advancePrescription(rxId, 'under_review', undefined, PHARMACIST._id);
  await advancePrescription(rxId, 'cleared_for_dispensing', undefined, PHARMACIST._id);
}

afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

it('carries a visit from arrival to a dispensed, billed, tier-aware medication', async () => {
  await seedWorld();

  // ── Arrival → the doctor claims the patient ──────────────────────────
  const arrival = await createArrivalEncounter({
    patientId: PATIENT._id, patientName: PATIENT.name,
    hospitalId: HOSP, hospitalName: 'Juba Teaching Hospital', orgId: ORG,
    arrivalChannel: 'walk_in', actorId: 'user-frontdesk-1',
  });
  const claimed = await advanceEncounterToClinician(arrival._id, {
    clinicianId: DOCTOR._id, clinicianName: DOCTOR.name, actorId: DOCTOR._id,
  });
  expect(claimed.status).toBe('with_clinician');

  // ── Prescribe a life-sustaining drug ────────────────────────────────
  const { prescription: insulin } = await createPrescription({
    patientId: PATIENT._id, patientName: PATIENT.name, encounterId: claimed._id,
    medication: 'Insulin (soluble/regular)', dose: '10 IU', route: 'subcutaneous',
    frequency: 'BD', duration: '30 days', prescribedBy: DOCTOR.name,
    status: 'pending', hospitalId: HOSP, quantityToDispense: 2,
  } as never);

  // (3) The tier is stamped on the document, from the formulary's ATC class.
  expect(insulin.criticalityTier).toBe(1);

  // (2) The visit is parked at the pharmacy — it used to still read
  //     `with_clinician` while the patient stood in the queue.
  expect((await getEncounter(claimed._id))!.status).toBe('awaiting_pharmacy');

  // (1) The medication is billed. This is what the pay-first gate reads; a
  //     medication-only visit used to sit at a balance of zero forever.
  const balanceAfterRx = await getPatientBalance(PATIENT._id);
  expect(balanceAfterRx).toBe(2000); // 2 vials × SSP 1000

  // ── The queue puts it ahead of routine work ─────────────────────────
  const { prescription: vitamins } = await createPrescription({
    patientId: PATIENT._id, patientName: PATIENT.name, encounterId: claimed._id,
    medication: 'Vitamin A (retinol)', dose: '200,000 IU', route: 'oral',
    frequency: 'once', duration: '1 day', prescribedBy: DOCTOR.name,
    status: 'pending', hospitalId: HOSP,
  } as never);
  expect(vitamins.criticalityTier).toBe(3);
  // Every prescription is billed, not just the first: 2 vials + 1 dose.
  expect(await getPatientBalance(PATIENT._id)).toBe(3000);
  const queue = [vitamins, insulin].sort(comparePharmacyPriority);
  expect(queue[0].medication).toBe('Insulin (soluble/regular)');

  // ── Checkout is refused while the insulin is undispensed ────────────
  let gate = await evaluateCheckoutGate(PATIENT._id, (await getEncounter(claimed._id))!);
  expect(gate.canDischarge).toBe(false);
  // (3) And the life-sustaining order is called out on its own, so an
  //     override for the vitamins cannot quietly cover the insulin too.
  expect(gate.tier1Outstanding).toEqual([
    { id: insulin._id, medication: 'Insulin (soluble/regular)' },
  ]);

  // ── Dispense it, for real ───────────────────────────────────────────
  const balanceBeforeDispense = await getPatientBalance(PATIENT._id);
  await clearForDispensing(insulin._id);
  const refreshed = (await getPrescriptionsByPatient(PATIENT._id)).find(r => r._id === insulin._id)!;
  const result = await dispenseMedication({
    prescription: refreshed,
    quantity: 2,
    dispenserId: PHARMACIST._id,
    dispenserName: PHARMACIST.name,
    facilityId: HOSP,
    orgId: ORG,
  });
  expect(result.outcome).toBe('full');
  expect(result.prescription.status).toBe('dispensed');

  // Stock actually moved.
  const batch = await pharmacyInventoryDB().get('inv-insulin') as { stockLevel: number };
  expect(batch.stockLevel).toBe(38);

  // The Tier-1 flag clears once the drug is in the patient's hands.
  gate = await evaluateCheckoutGate(PATIENT._id, (await getEncounter(claimed._id))!);
  expect(gate.tier1Outstanding).toEqual([]);

  // Dispensing does not bill again — the charge was raised at prescribing, so
  // the counter hands over stock without touching the account. Double-billing
  // here would be the obvious way to get this wrong.
  expect(await getPatientBalance(PATIENT._id)).toBe(balanceBeforeDispense);
});

it('refuses to dispense an order nobody cleared', async () => {
  await seedWorld();
  const { prescription: rx } = await createPrescription({
    patientId: PATIENT._id, patientName: PATIENT.name,
    medication: 'Insulin (soluble/regular)', dose: '10 IU', route: 'subcutaneous',
    frequency: 'BD', duration: '30 days', prescribedBy: DOCTOR.name,
    status: 'pending', hospitalId: HOSP, quantityToDispense: 1,
  } as never);

  await expect(dispenseMedication({
    prescription: rx, quantity: 1,
    dispenserId: PHARMACIST._id, dispenserName: PHARMACIST.name, facilityId: HOSP,
  })).rejects.toThrow(/reviewed and cleared/i);

  // And nothing moved.
  const batch = await pharmacyInventoryDB().get('inv-insulin') as { stockLevel: number };
  expect(batch.stockLevel).toBe(40);
});

it('blocks facility checkout while a procedure is still in progress', async () => {
  await seedWorld();
  const arrival = await createArrivalEncounter({
    patientId: PATIENT._id, patientName: PATIENT.name,
    hospitalId: HOSP, hospitalName: 'Juba Teaching Hospital', orgId: ORG,
    arrivalChannel: 'walk_in', actorId: 'user-frontdesk-1',
  });
  const claimed = await advanceEncounterToClinician(arrival._id, {
    clinicianId: DOCTOR._id, clinicianName: DOCTOR.name, actorId: DOCTOR._id,
  });

  const proc = await createProcedure({
    patientId: PATIENT._id, patientName: PATIENT.name, encounterId: claimed._id,
    name: 'Incision and drainage of abscess', date: '2026-08-19',
    status: 'ordered', hospitalId: HOSP, orgId: ORG,
  } as never);

  await advanceProcedure(proc._id, 'consented', { actorId: DOCTOR._id, actorName: DOCTOR.name });
  await advanceProcedure(proc._id, 'in_progress', { actorId: DOCTOR._id });

  const gate = await evaluateCheckoutGate(PATIENT._id, (await getEncounter(claimed._id))!);
  const item = gate.conditions.find(c => c.key === 'in_clinic_procedures_complete')!;
  expect(item.satisfied).toBe(false);
  expect(item.detail).toContain('Incision and drainage');

  // Released — the loop is closed and the gate clears.
  await advanceProcedure(proc._id, 'completed', { actorId: DOCTOR._id });
  await advanceProcedure(proc._id, 'released', { actorId: DOCTOR._id });
  const after = await evaluateCheckoutGate(PATIENT._id, (await getEncounter(claimed._id))!);
  expect(after.conditions.find(c => c.key === 'in_clinic_procedures_complete')!.satisfied).toBe(true);
});

it('refuses an illegal procedure move and demands a reason to abort', async () => {
  await seedWorld();
  const proc = await createProcedure({
    patientId: PATIENT._id, patientName: PATIENT.name,
    name: 'Suturing', date: '2026-08-19', status: 'ordered',
    hospitalId: HOSP, orgId: ORG,
  } as never);

  // ordered → released skips consent and the procedure itself.
  await expect(advanceProcedure(proc._id, 'released')).rejects.toThrow(/cannot move from "ordered"/);
  await expect(advanceProcedure(proc._id, 'aborted')).rejects.toThrow(/requires a reason/);

  const aborted = await advanceProcedure(proc._id, 'aborted', { reason: 'Patient withdrew consent' });
  expect(aborted!.status).toBe('aborted');
  expect(aborted!.abortedReason).toBe('Patient withdrew consent');
});

it('leaves a legacy procedure with no status out of the way of discharge', async () => {
  await seedWorld();
  const arrival = await createArrivalEncounter({
    patientId: PATIENT._id, patientName: PATIENT.name,
    hospitalId: HOSP, hospitalName: 'Juba Teaching Hospital', orgId: ORG,
    arrivalChannel: 'walk_in', actorId: 'user-frontdesk-1',
  });
  const claimed = await advanceEncounterToClinician(arrival._id, {
    clinicianId: DOCTOR._id, clinicianName: DOCTOR.name, actorId: DOCTOR._id,
  });
  // Exactly the shape written before the lifecycle existed: a record of
  // something that had already happened. Blocking on these would make the
  // override routine and defeat the other six gate items.
  await createProcedure({
    patientId: PATIENT._id, patientName: PATIENT.name, encounterId: claimed._id,
    name: 'Wound dressing', date: '2026-08-19', performedByName: DOCTOR.name,
    hospitalId: HOSP, orgId: ORG,
  } as never);

  const gate = await evaluateCheckoutGate(PATIENT._id, (await getEncounter(claimed._id))!);
  expect(gate.conditions.find(c => c.key === 'in_clinic_procedures_complete')!.satisfied).toBe(true);
});
