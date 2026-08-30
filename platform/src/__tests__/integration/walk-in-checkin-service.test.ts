/**
 * `checkInPatient` (check-in-service.ts) is the walk-in flow's real service —
 * it wrote the booking, the arrival encounter AND the pending triage row
 * (encounterId linked, not_assessed/clerical_checkin provenance) but had zero
 * callers until the appointments page's walk-in dialog was wired to it
 * (KAN-118). This exercises it against the real service layer: the visit
 * thread it opens, and the same-day-booking scope fix that lets a walk-in at
 * THIS facility proceed instead of hard-blocking on a same-org booking the
 * desk cannot see or act on.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-ciuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

jest.setTimeout(30000);

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { hospitalsDB } from '@/lib/db';
import { checkInPatient } from '@/lib/services/check-in-service';
import { createAppointment, getAppointmentsByPatient } from '@/lib/services/appointment-service';
import { jubaDate } from '@/lib/time-juba';

const ORG = 'org-moh-ss';
const HOSP1 = 'hosp-001';
const HOSP2 = 'hosp-002';
const today = jubaDate();

beforeEach(async () => {
  await putDoc(hospitalsDB(), { _id: HOSP1, type: 'hospital', name: 'Juba Teaching Hospital', orgId: ORG } as never);
  await putDoc(hospitalsDB(), { _id: HOSP2, type: 'hospital', name: 'Wau State Hospital', orgId: ORG } as never);
});
afterEach(async () => {
  await teardownTestDBs();
  uuidCounter = 0;
});

describe('checkInPatient — walk-in opens the full visit thread', () => {
  it('creates a walk-in appointment, an arrival encounter, and a pending triage linked to it', async () => {
    const result = await checkInPatient({
      patientId: 'pat-akech',
      patientName: 'Akech Deng',
      facilityId: HOSP1,
      facilityName: 'Juba Teaching Hospital',
      orgId: ORG,
      chiefComplaint: 'Fever and headache',
      acuity: 'priority',
      patientPhone: '+211925001234',
      checkedInById: 'user-desk.amira',
      checkedInByName: 'Amira',
    });

    expect(result.walkInAppointmentCreated).toBe(true);
    expect(result.appointmentCheckedIn).toBe(false);
    expect(result.appointmentId).toBeTruthy();

    // The triage row is threaded onto the SAME encounter this check-in
    // opened — not a bare "a walk-in happened somewhere" record.
    expect(result.triage.encounterId).toBe(result.encounter._id);
    expect(result.triage.status).toBe('pending');
    expect(result.triage.priority).toBe('YELLOW'); // acuity 'priority' -> YELLOW
    expect(result.triage.assessmentSource).toBe('clerical_checkin');
    expect(result.triage.airway).toBe('not_assessed');
    expect(result.triage.breathing).toBe('not_assessed');

    const appts = await getAppointmentsByPatient('pat-akech');
    expect(appts).toHaveLength(1);
    expect(appts[0]._id).toBe(result.appointmentId);
    expect(appts[0].status).toBe('checked_in');
    expect(appts[0].appointmentType).toBe('walk_in');
    // 'priority' acuity keeps its urgency on the appointment too, instead of
    // collapsing to plain Routine (the pre-wiring bug in checkInPatient's own
    // appointment-priority mapping).
    expect(appts[0].priority).toBe('urgent');
    expect(appts[0].patientPhone).toBe('+211925001234');
  });
});

describe('checkInPatient — same-day booking scope', () => {
  it('checks an existing same-facility SCHEDULED booking in rather than writing a second one', async () => {
    const appt = await createAppointment({
      patientId: 'pat-nyibol', patientName: 'Nyibol Chol',
      providerId: 'user-dr.wani', providerName: 'Dr. Wani',
      facilityId: HOSP1, facilityName: 'Juba Teaching Hospital', facilityLevel: 'payam',
      appointmentDate: today, appointmentTime: '09:00', duration: 30,
      appointmentType: 'general', status: 'scheduled', reason: 'Follow-up',
      bookedBy: 'user-desk.amira', bookedByName: 'Amira', orgId: ORG,
    } as unknown as Parameters<typeof createAppointment>[0]);

    const result = await checkInPatient({
      patientId: 'pat-nyibol', patientName: 'Nyibol Chol',
      facilityId: HOSP1, facilityName: 'Juba Teaching Hospital', orgId: ORG,
      chiefComplaint: 'Follow-up', checkedInById: 'user-desk.amira', checkedInByName: 'Amira',
    });

    expect(result.appointmentCheckedIn).toBe(true);
    expect(result.walkInAppointmentCreated).toBe(false);
    expect(result.appointmentId).toBe(appt._id);

    const appts = await getAppointmentsByPatient('pat-nyibol');
    expect(appts).toHaveLength(1); // no duplicate walk-in booking was created
    expect(appts[0].status).toBe('checked_in');
  });

  it('checks a same-facility REQUESTED portal booking in — it holds the slot the same as a scheduled one', async () => {
    const appt = await createAppointment({
      patientId: 'pat-abuk', patientName: 'Abuk Malou',
      providerId: '', providerName: '',
      facilityId: HOSP1, facilityName: 'Juba Teaching Hospital', facilityLevel: 'payam',
      appointmentDate: today, appointmentTime: '10:00', duration: 30,
      appointmentType: 'general', status: 'requested', reason: 'Cough',
      bookedBy: '', bookedByName: '', orgId: ORG, source: 'portal',
    } as unknown as Parameters<typeof createAppointment>[0]);

    const result = await checkInPatient({
      patientId: 'pat-abuk', patientName: 'Abuk Malou',
      facilityId: HOSP1, facilityName: 'Juba Teaching Hospital', orgId: ORG,
      chiefComplaint: 'Cough', checkedInById: 'user-desk.amira', checkedInByName: 'Amira',
    });

    expect(result.appointmentCheckedIn).toBe(true);
    expect(result.appointmentId).toBe(appt._id);
    const appts = await getAppointmentsByPatient('pat-abuk');
    expect(appts).toHaveLength(1);
    expect(appts[0].status).toBe('checked_in');
  });

  it('allows a walk-in at a DIFFERENT facility without touching the other facility\'s open booking', async () => {
    const otherFacilityAppt = await createAppointment({
      patientId: 'pat-deng', patientName: 'Deng Aluel',
      providerId: 'user-dr.igga', providerName: 'Dr. Igga',
      facilityId: HOSP2, facilityName: 'Wau State Hospital', facilityLevel: 'payam',
      appointmentDate: today, appointmentTime: '08:00', duration: 30,
      appointmentType: 'general', status: 'scheduled', reason: 'Antenatal review',
      bookedBy: 'user-desk.mary', bookedByName: 'Mary', orgId: ORG,
    } as unknown as Parameters<typeof createAppointment>[0]);

    // Without the facility-scoped fix to assertNoBookingConflicts, this threw
    // BookingConflictError — the patient's open HOSP2 booking, in the same
    // org, hard-blocked a walk-in at HOSP1 that this desk has no way to see.
    const result = await checkInPatient({
      patientId: 'pat-deng', patientName: 'Deng Aluel',
      facilityId: HOSP1, facilityName: 'Juba Teaching Hospital', orgId: ORG,
      chiefComplaint: 'Walked in with a cut', checkedInById: 'user-desk.amira', checkedInByName: 'Amira',
    });

    expect(result.walkInAppointmentCreated).toBe(true);
    expect(result.appointmentId).not.toBe(otherFacilityAppt._id);

    const appts = await getAppointmentsByPatient('pat-deng');
    expect(appts).toHaveLength(2);
    // The other facility's booking is untouched — not silently cancelled.
    const untouched = appts.find(a => a._id === otherFacilityAppt._id);
    expect(untouched?.status).toBe('scheduled');
    expect(untouched?.facilityId).toBe(HOSP2);
    // The new walk-in is its own booking, at THIS facility, already checked in.
    const walkIn = appts.find(a => a._id === result.appointmentId);
    expect(walkIn?.facilityId).toBe(HOSP1);
    expect(walkIn?.status).toBe('checked_in');
  });
});
