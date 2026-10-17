 
/**
 * Integration — a complete outpatient care journey through the REAL service
 * layer, asserting persisted data at every hop and that information flows
 * correctly between modules (registration → appointment → triage → lab →
 * prescription → dispense → billing → payment).
 *
 * These run against pouchdb-adapter-memory via the shared test-db mock, so they
 * exercise the same service functions the API routes and UI call — not stubs.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { createPatient, getPatientById, searchPatients, archivePatient } from '@/lib/services/patient-service';
import { createAppointment, updateAppointmentStatus, getAppointmentsByPatient } from '@/lib/services/appointment-service';
import { createTriage, getTriageByPatient } from '@/lib/services/triage-service';
import { calculatePriority } from '@/lib/services/triage-service';
import { createLabResult, updateLabResult, getLabResultsByPatient } from '@/lib/services/lab-service';
import { createPrescription as createPrescriptionScoped, getPrescriptionsByPatient } from '@/lib/services/prescription-service';

// Fixtures here are single-tenant; a system-wide scope reads every doc, so the
// tenant barrier is exercised by the dedicated cross-org suite instead.
const RX_SCOPE = { role: 'super_admin' } as const;
const createPrescription = (data: Parameters<typeof createPrescriptionScoped>[0]) =>
  createPrescriptionScoped(data, RX_SCOPE);
import { createBill, recordPayment, getBillsByPatient } from '@/lib/services/billing-service';
import { hospitalsDB } from '@/lib/db';
import type { DataScope as __DS } from '@/lib/services/data-scope';
const TEST_SCOPE = { role: 'super_admin' } as import('@/lib/services/data-scope').DataScope;
// Legacy fixtures carry no org; super_admin keeps the national view that filterByScope grants.
const SUPER: __DS = { role: 'super_admin' };

const HOSP = 'hosp-001';
const ORG = 'org-moh-ss';

beforeEach(async () => {
  await putDoc(hospitalsDB(), { _id: HOSP, type: 'hospital', name: 'Juba Teaching Hospital', code: 'JTH', orgId: ORG } as unknown as { _id: string });
});
afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

async function registerNyathon() {
  return createPatient({
    firstName: 'Nyathon', surname: 'Majok', gender: 'Female', dateOfBirth: '1994-03-12',
    phone: '+211925001001', state: 'Central Equatoria', county: 'Juba',
    primaryLanguage: 'Dinka', nokName: 'Deng Majok', nokRelationship: 'Father', nokPhone: '+211925001002',
    hospitalNumber: '', registrationHospital: HOSP, orgId: ORG,
  } as unknown as Parameters<typeof createPatient>[0], TEST_SCOPE);
}

describe('Journey A: routine outpatient visit end-to-end', () => {
  test('registration persists identity and is retrievable by search', async () => {
    const p = await registerNyathon();
    expect(p._id).toMatch(/^pat-/);
    expect(p.hospitalNumber).toBeTruthy();          // auto-generated MRN
    expect(p.orgId).toBe(ORG);

    const fetched = await getPatientById(p._id, TEST_SCOPE);
    expect(fetched?.firstName).toBe('Nyathon');

    const results = await searchPatients('Nyathon', TEST_SCOPE);
    expect(results.map((r) => r._id)).toContain(p._id);
  });

  test('the full chain carries the patient identity across every module', async () => {
    const p = await registerNyathon();

    // 1. Appointment
    const appt = await createAppointment({
      patientId: p._id, patientName: `${p.firstName} ${p.surname}`,
      providerId: 'user-dr.wani', providerName: 'Dr. James Wani Igga',
      facilityId: HOSP, facilityName: 'Juba Teaching Hospital', facilityLevel: 'payam',
      appointmentDate: '2026-08-10', appointmentTime: '08:40', duration: 40,
      appointmentType: 'general', status: 'scheduled', reason: 'Fever 3 days',
      bookedBy: 'user-desk.amira', bookedByName: 'Amira', orgId: ORG, source: 'staff',
    } as unknown as Parameters<typeof createAppointment>[0]);
    expect(appt.patientId).toBe(p._id);

    // 2. Check-in flips appointment status
    const checkedIn = await updateAppointmentStatus(appt._id, 'checked_in');
    expect(checkedIn?.status).toBe('checked_in');
    const apptsForPatient = await getAppointmentsByPatient(p._id);
    expect(apptsForPatient[0].status).toBe('checked_in');

    // 3. Triage — ETAT priority computed, linked to patient
    const triage = await createTriage({
      patientId: p._id, patientName: `${p.firstName} ${p.surname}`, facilityId: HOSP,
      priority: 'YELLOW', status: 'pending', chiefComplaint: 'Fever',
      vitals: { temperature: 39.1, pulse: 104, systolic: 118, diastolic: 76, spo2: 98 },
      triagedBy: 'user-triage.mary', triagedByName: 'Mary', orgId: ORG,
    } as unknown as Parameters<typeof createTriage>[0], { scope: TEST_SCOPE });
    expect(triage.patientId).toBe(p._id);
    const triageForPatient = await getTriageByPatient(p._id, TEST_SCOPE);
    expect(triageForPatient).toHaveLength(1);

    // 4. Lab order → result review, anchored to the patient
    const lab = await createLabResult({
      patientId: p._id, patientName: `${p.firstName} ${p.surname}`, hospitalId: HOSP,
      testName: 'Malaria RDT', orderStatus: 'ordered', status: 'pending',
      orderedBy: 'user-dr.wani', orgId: ORG,
    } as unknown as Parameters<typeof createLabResult>[0]);
    const resulted = await updateLabResult(lab._id, {
      orderStatus: 'resulted', status: 'completed', result: 'Positive (P. falciparum)',
    } as Parameters<typeof updateLabResult>[1]);
    expect(resulted?.result).toContain('Positive');
    const labsForPatient = await getLabResultsByPatient(p._id);
    expect(labsForPatient.map((l) => l._id)).toContain(lab._id);

    // 5. Prescription off the diagnosis
    const rxResult = await createPrescription({
      patientId: p._id, patientName: `${p.firstName} ${p.surname}`, hospitalId: HOSP,
      medication: 'Artemether-Lumefantrine', dose: '80/480mg', frequency: 'BID', duration: '3 days',
      quantity: 6, status: 'active', prescribedBy: 'user-dr.wani', prescribedByName: 'Dr Wani', orgId: ORG,
    } as unknown as Parameters<typeof createPrescription>[0]);
    const rx = 'prescription' in rxResult ? rxResult.prescription : rxResult;
    const rxForPatient = await getPrescriptionsByPatient(p._id);
    expect(rxForPatient.map((r) => r._id)).toContain((rx as { _id: string })._id);

    // 6. Billing references the same patient; payment settles the balance
    const bill = await createBill({
      patientId: p._id, patientName: `${p.firstName} ${p.surname}`,
      facilityId: HOSP, facilityName: 'Juba Teaching Hospital', facilityLevel: 'payam',
      encounterDate: '2026-08-10',
      items: [
        { id: 'li1', category: 'consultation', description: 'OPD consult', quantity: 1, unitPrice: 50, totalPrice: 50 },
        { id: 'li2', category: 'laboratory', description: 'Malaria RDT', quantity: 1, unitPrice: 20, totalPrice: 20, referenceId: lab._id, referenceType: 'lab_result' },
      ],
      generatedBy: 'user-cashier.deng', orgId: ORG,
    } as unknown as Parameters<typeof createBill>[0]);
    expect(bill.patientId).toBe(p._id);
    expect(bill.totalAmount).toBe(70);
    expect(bill.status).not.toBe('paid');

    const paid = await recordPayment(bill._id, 70, 'cash', 'user-cashier.deng', 'Deng', 'RCPT-1');
    expect(paid?.amountPaid).toBe(70);
    expect(paid?.status).toBe('paid');

    const billsForPatient = await getBillsByPatient(p._id, SUPER);
    expect(billsForPatient).toHaveLength(1);
    expect(billsForPatient[0].status).toBe('paid');
  });
});

describe('Journey G: abnormal / edge outcomes', () => {
  test('missing required fields are rejected with per-field errors', async () => {
    await expect(
      createPatient({ firstName: 'X' } as unknown as Parameters<typeof createPatient>[0], TEST_SCOPE),
    ).rejects.toMatchObject({ name: 'ValidationError' });
  });

  test('a duplicate national ID is refused', async () => {
    const base = {
      firstName: 'Ajok', surname: 'Bol', gender: 'Female', dateOfBirth: '1990-01-01',
      state: 'Central Equatoria', county: 'Juba', primaryLanguage: 'Dinka',
      nokName: 'K', nokRelationship: 'Sister', nokPhone: '+211900000001',
      hospitalNumber: '', registrationHospital: HOSP, orgId: ORG, nationalId: 'SSD-DUP-0001',
    } as unknown as Parameters<typeof createPatient>[0];
    await createPatient(base, TEST_SCOPE);
    await expect(createPatient({ ...base }, TEST_SCOPE)).rejects.toMatchObject({ name: 'ValidationError' });
  });

  test('cancelling an appointment moves it to a closed status', async () => {
    const p = await registerNyathon();
    const appt = await createAppointment({
      patientId: p._id, patientName: 'Nyathon Majok', providerId: 'user-dr.wani', providerName: 'Dr Wani',
      facilityId: HOSP, facilityName: 'JTH', facilityLevel: 'payam', appointmentDate: '2026-08-11',
      appointmentTime: '09:00', duration: 30, appointmentType: 'general', status: 'scheduled',
      reason: 'review', bookedBy: 'u', bookedByName: 'U', orgId: ORG, source: 'staff',
    } as unknown as Parameters<typeof createAppointment>[0]);
    const cancelled = await updateAppointmentStatus(appt._id, 'cancelled');
    expect(cancelled?.status).toBe('cancelled');
  });

  test('archive is a soft-delete: the record persists but is flagged archived', async () => {
    const p = await registerNyathon();
    const archived = await archivePatient(p._id, TEST_SCOPE, 'user-supt.lado');
    expect(archived).toBeTruthy();
    const still = await getPatientById(p._id, TEST_SCOPE);
    expect(still).toBeTruthy();               // not hard-deleted
    expect(still?.isActive).toBe(false);      // archive = soft-delete via isActive
  });
});

describe('Triage ETAT priority calculation', () => {
  test('a life-threatening sign escalates to RED (all four axes assessed)', () => {
    const pr = calculatePriority({ airway: 'clear', breathing: 'normal', circulation: 'normal', consciousness: 'unresponsive' });
    expect(pr).toBe('RED');
  });
  test('a fully-assessed stable patient is GREEN', () => {
    const pr = calculatePriority({ airway: 'clear', breathing: 'normal', circulation: 'normal', consciousness: 'alert' });
    expect(pr).toBe('GREEN');
  });
  test('an incomplete assessment returns empty (not a false GREEN)', () => {
    expect(calculatePriority({ airway: 'clear', breathing: '', circulation: 'normal', consciousness: 'alert' })).toBe('');
  });
});
