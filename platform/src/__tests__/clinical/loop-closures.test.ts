/**
 * Five clinical loops that used to close silently — the secondary side effect
 * of an action never reached the person (or record) that needed it:
 *
 *  1. A pharmacy clarification/stock-out stalled a prescription with nobody
 *     told (dispensing-service.recordUnfilled).
 *  2. A referral outcome never notified the sending facility
 *     (referral-service.completeReferralWithOutcome).
 *  3. Admitting a patient never closed the OPD encounter it grew out of
 *     (ward-service.admitPatient).
 *  4. An appointment closing (completed/no_show/cancelled) never touched its
 *     linked encounter (appointment-service.updateAppointmentStatus).
 *  5. Registering a death never closed the visit (deaths/page.tsx calls
 *     transitionEncounter directly — this file verifies the encounter-service
 *     leg only; the page's wiring is not exercised by a unit test).
 *
 * All run against the real service layer on pouchdb-adapter-memory, exactly
 * like the doctor/care-journey integration suites.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { usersDB, patientsDB, hospitalsDB, prescriptionsDB } from '@/lib/db';
import { recordUnfilled } from '@/lib/services/dispensing-service';
import { getTasks } from '@/lib/services/clinician-task-service';
import { createReferral, completeReferralWithOutcome } from '@/lib/services/referral-service';
import { getPatientById } from '@/lib/services/patient-service';
import { admitPatient } from '@/lib/services/ward-service';
import { createEncounter, getEncounter, transitionEncounter } from '@/lib/services/encounter-service';
import { createAppointment, updateAppointmentStatus } from '@/lib/services/appointment-service';
import type { PrescriptionDoc } from '@/lib/db-types';

const HOSP = 'hosp-001';
const ORG = 'org-moh-ss';

afterEach(async () => {
  await teardownTestDBs();
  uuidCounter = 0;
});

beforeEach(async () => {
  await putDoc(hospitalsDB(), { _id: HOSP, type: 'hospital', name: 'Juba Teaching Hospital', orgId: ORG } as never);
});

// ── 1. Rx clarification reaches the prescriber ──────────────────────────
describe('recordUnfilled', () => {
  it('puts a task on the prescriber list when the pharmacy requests clarification', async () => {
    await putDoc(usersDB(), {
      _id: 'user-dr-akol', type: 'user', username: 'dr.akol', name: 'Dr. Akol',
      role: 'doctor', hospitalId: HOSP, orgId: ORG, isActive: true,
    } as never);
    const rx = await putDoc(prescriptionsDB(), {
      _id: 'rx-00001', type: 'prescription',
      patientId: 'pat-00001', patientName: 'Nyakuma Deng',
      medication: 'Amoxicillin', dose: '500mg', route: 'oral', frequency: 'TDS', duration: '5 days',
      prescribedBy: 'Dr. Akol', status: 'pending',
      hospitalId: HOSP, orgId: ORG,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as never) as unknown as PrescriptionDoc;

    await recordUnfilled(
      rx, 'clarification_requested',
      'Dose looks high for this age — please confirm.',
      { id: 'user-pharm-1', name: 'Pharm. Achol' },
    );

    const tasks = await getTasks('user-dr-akol');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Pharmacy needs clarification: Amoxicillin');
    expect(tasks[0].priority).toBe('high');
    expect(tasks[0].patientId).toBe('pat-00001');
  });

  it('also puts a task on the prescriber list for a stock-out', async () => {
    await putDoc(usersDB(), {
      _id: 'user-dr-akol', type: 'user', username: 'dr.akol', name: 'Dr. Akol',
      role: 'doctor', hospitalId: HOSP, orgId: ORG, isActive: true,
    } as never);
    const rx = await putDoc(prescriptionsDB(), {
      _id: 'rx-00002', type: 'prescription',
      patientId: 'pat-00001', patientName: 'Nyakuma Deng',
      medication: 'Ceftriaxone', dose: '1g', route: 'IV', frequency: 'OD', duration: '3 days',
      prescribedBy: 'Dr. Akol', status: 'pending',
      hospitalId: HOSP, orgId: ORG,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as never) as unknown as PrescriptionDoc;

    await recordUnfilled(rx, 'stock_out', 'No stock at this facility.', { id: 'user-pharm-1', name: 'Pharm. Achol' });

    const tasks = await getTasks('user-dr-akol');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Rx unavailable (stock-out): Ceftriaxone');
  });
});

// ── 2. Referral outcome notifies the sender ─────────────────────────────
describe('completeReferralWithOutcome', () => {
  it('writes a care alert on the patient mentioning the completion', async () => {
    await putDoc(hospitalsDB(), { _id: 'hosp-from', type: 'hospital', name: 'Bor PHCC', orgId: ORG } as never);
    // completeReferralWithOutcome's notification writes through mutatePatient,
    // which validates the whole patient doc (not just the patched field) — a
    // minimal stub patient fails that validation and the care alert silently
    // never lands. Seed a doc that passes validatePatientData, matching the
    // shape care-journey.test.ts registers patients with.
    await putDoc(patientsDB(), {
      _id: 'pat-00002', type: 'patient', firstName: 'Deng', surname: 'Malual',
      gender: 'Male', dateOfBirth: '1990-01-01', state: 'Jonglei', county: 'Bor',
      primaryLanguage: 'Dinka', nokName: 'Malual Deng', nokRelationship: 'Father', nokPhone: '+211925001003',
      registrationHospital: 'hosp-from', orgId: ORG,
    } as never);
    const referral = await createReferral({
      patientId: 'pat-00002', patientName: 'Deng Malual',
      fromHospital: 'Bor PHCC', fromHospitalId: 'hosp-from',
      toHospital: 'Juba Teaching Hospital', toHospitalId: HOSP,
      referralDate: new Date().toISOString().slice(0, 10),
      urgency: 'urgent', reason: 'Suspected appendicitis',
      department: 'Surgery', status: 'sent', referringDoctor: 'Dr. Deng', notes: '',
      orgId: ORG,
    } as never);

    await completeReferralWithOutcome(referral._id, {
      disposition: 'treated_discharged',
      summary: 'Appendectomy performed, recovering well.',
      recordedBy: 'Dr. Wani',
      recordedAt: new Date().toISOString(),
    });

    const patient = await getPatientById('pat-00002');
    const alerts = patient?.careAlerts ?? [];
    expect(alerts.length).toBeGreaterThan(0);
    const closingAlert = alerts.find(a => a.message.toLowerCase().includes('completed'));
    expect(closingAlert).toBeTruthy();
    expect(closingAlert!.message.toLowerCase()).toContain('treated discharged');
  });
});

// ── 3. Admit closes the visit ───────────────────────────────────────────
describe('admitPatient', () => {
  it('stamps encounterId and closes the OPD encounter (with_clinician -> admitted)', async () => {
    const enc = await createEncounter({
      patientId: 'pat-00003', patientName: 'Achol Deng',
      clinicianId: 'user-dr-wani', clinicianName: 'Dr. Wani',
      hospitalId: HOSP, hospitalName: 'Juba Teaching Hospital', orgId: ORG,
      status: 'with_clinician', snapshot: {}, labOrderIds: [], startedAt: new Date().toISOString(),
      arrivalChannel: 'walk_in',
    } as never);

    const admission = await admitPatient({
      patientId: 'pat-00003', patientName: 'Achol Deng',
      admittingDiagnosis: 'Severe malaria', severity: 'severe',
      admittedBy: 'user-dr-wani', admittedByName: 'Dr. Wani',
      wardId: 'ward-001', wardName: 'Female Medical Ward',
      facilityId: HOSP, facilityName: 'Juba Teaching Hospital', facilityLevel: 'county',
      attendingPhysician: 'user-dr-wani', attendingPhysicianName: 'Dr. Wani',
      state: 'Central Equatoria',
      orgId: ORG,
      encounterId: enc._id,
    });

    expect(admission.encounterId).toBe(enc._id);

    const closedEnc = await getEncounter(enc._id);
    expect(closedEnc?.status).toBe('admitted');
    expect(closedEnc?.closedAt).toBeTruthy();
  });

  it('does not fail the admission when the encounter cannot legally close', async () => {
    // Encounter already terminal — 'admitted' is not a legal move from
    // 'discharged'; admission must still succeed (best-effort close).
    const enc = await createEncounter({
      patientId: 'pat-00003b', patientName: 'Nyandit Deng',
      clinicianId: 'user-dr-wani', clinicianName: 'Dr. Wani',
      hospitalId: HOSP, hospitalName: 'Juba Teaching Hospital', orgId: ORG,
      status: 'discharged', snapshot: {}, labOrderIds: [], startedAt: new Date().toISOString(),
      arrivalChannel: 'walk_in',
    } as never);

    const admission = await admitPatient({
      patientId: 'pat-00003b', patientName: 'Nyandit Deng',
      admittingDiagnosis: 'Relapse', severity: 'moderate',
      admittedBy: 'user-dr-wani', admittedByName: 'Dr. Wani',
      wardId: 'ward-001', wardName: 'Female Medical Ward',
      facilityId: HOSP, facilityName: 'Juba Teaching Hospital', facilityLevel: 'county',
      attendingPhysician: 'user-dr-wani', attendingPhysicianName: 'Dr. Wani',
      state: 'Central Equatoria',
      orgId: ORG,
      encounterId: enc._id,
    });

    expect(admission._id).toMatch(/^adm-/);
    // Left untouched — the illegal transition was swallowed.
    expect((await getEncounter(enc._id))?.status).toBe('discharged');
  });
});

// ── 4. Appointment <-> encounter sync ───────────────────────────────────
describe('updateAppointmentStatus bridges the linked encounter', () => {
  async function seedAppointment(patientId: string) {
    return createAppointment({
      patientId, patientName: 'Nyandeng Bul',
      providerId: 'user-dr-wani', providerName: 'Dr. Wani',
      facilityId: HOSP, facilityName: 'Juba Teaching Hospital', facilityLevel: 'county',
      appointmentDate: '2026-08-08', appointmentTime: '09:00', duration: 30,
      appointmentType: 'general', status: 'scheduled', reason: 'Follow-up',
      bookedBy: 'user-desk-1', bookedByName: 'Amira', orgId: ORG, source: 'staff',
    } as never);
  }

  it("'completed' discharges an encounter sitting at ready_for_clinic_checkout", async () => {
    const appt = await seedAppointment('pat-00004');
    const enc = await createEncounter({
      patientId: 'pat-00004', patientName: 'Nyandeng Bul',
      clinicianId: 'user-dr-wani', clinicianName: 'Dr. Wani',
      hospitalId: HOSP, hospitalName: 'Juba Teaching Hospital', orgId: ORG,
      status: 'ready_for_clinic_checkout', snapshot: {}, labOrderIds: [], startedAt: new Date().toISOString(),
      arrivalChannel: 'walk_in', appointmentId: appt._id,
    } as never);

    const { documentCheckout } = await import('../helpers/checkout');
    await documentCheckout(enc);
    await updateAppointmentStatus(appt._id, 'completed', { actorId: 'user-desk-1', actorRole: 'front_desk' });

    expect((await getEncounter(enc._id))?.status).toBe('discharged');
  });

  it("'no_show' records LWBS on an encounter still at awaiting_triage", async () => {
    const appt = await seedAppointment('pat-00005');
    const enc = await createEncounter({
      patientId: 'pat-00005', patientName: 'Nyandeng Bul',
      clinicianId: '', clinicianName: '',
      hospitalId: HOSP, hospitalName: 'Juba Teaching Hospital', orgId: ORG,
      status: 'awaiting_triage', snapshot: {}, labOrderIds: [], startedAt: new Date().toISOString(),
      arrivalChannel: 'walk_in', appointmentId: appt._id,
    } as never);

    await updateAppointmentStatus(appt._id, 'no_show');

    expect((await getEncounter(enc._id))?.status).toBe('lwbs');
  });

  it("'cancelled' never touches an encounter with clinical activity (with_clinician)", async () => {
    const appt = await seedAppointment('pat-00006');
    const enc = await createEncounter({
      patientId: 'pat-00006', patientName: 'Nyandeng Bul',
      clinicianId: 'user-dr-wani', clinicianName: 'Dr. Wani',
      hospitalId: HOSP, hospitalName: 'Juba Teaching Hospital', orgId: ORG,
      status: 'with_clinician', snapshot: {}, labOrderIds: [], startedAt: new Date().toISOString(),
      arrivalChannel: 'walk_in', appointmentId: appt._id,
    } as never);

    await updateAppointmentStatus(appt._id, 'cancelled');

    expect((await getEncounter(enc._id))?.status).toBe('with_clinician');
  });
});

// ── 5. Death closes the visit (encounter-service leg only) ──────────────
// deaths/page.tsx calls transitionEncounter(encounterId, 'deceased', ...)
// directly as a client-side best-effort side effect after registration; this
// is a UI wiring path with no service-layer seam to unit-test. What IS
// verifiable here is that the transition it relies on is actually legal, and
// that it closes the visit the way the rest of this suite expects.
describe('encounter-service: with_clinician -> deceased', () => {
  it('is a legal transition that stamps closedAt', async () => {
    const enc = await createEncounter({
      patientId: 'pat-00007', patientName: 'Awut Garang',
      clinicianId: 'user-dr-wani', clinicianName: 'Dr. Wani',
      hospitalId: HOSP, hospitalName: 'Juba Teaching Hospital', orgId: ORG,
      status: 'with_clinician', snapshot: {}, labOrderIds: [], startedAt: new Date().toISOString(),
      arrivalChannel: 'walk_in',
    } as never);

    const updated = await transitionEncounter(enc._id, 'deceased', { actorId: 'user-dr-wani', actorRole: 'doctor' });

    expect(updated.status).toBe('deceased');
    expect(updated.closedAt).toBeTruthy();
  });
});
