/**
 * Patient check-in (front desk arrival).
 *
 * Records a patient's arrival at the facility as a triage queue entry (status
 * 'pending') so they appear on the reception / nurse-triage worklist, and — if
 * they have a scheduled appointment today — marks that appointment as
 * checked_in in the same action. Full ETAT ABCC assessment is left to the nurse
 * triage station; the front desk captures arrival context + an acuity flag.
 */
import type { AppointmentDoc, TriageDoc, TriagePriority, EncounterDoc, UserRole } from '../db-types';
import {
  createTriage, updateTriage, getTriageByEncounter, findActiveTriageForPatient, DuplicateActiveTriageError,
} from './triage-service';
import { createAppointment, getAppointmentsByPatient, updateAppointmentStatus, BookingConflictError } from './appointment-service';
import { jubaDate, jubaTime } from '../time-juba';
import { APPOINTMENT_PENDING_STATUSES } from '../appointment-status';
import { createArrivalEncounter, findOpenEncounterForPatient, hasClosedEncounterForPatient, PRE_CLINICIAN_STATUSES } from './encounter-service';
import { getRecordsByPatient } from './medical-record-service';
import { resolveWorkflowRepair, upsertWorkflowRepair } from './workflow-repair-service';

export type AttendanceType = 'new' | 'repeat';

/**
 * New case vs re-attendance, auto-derived once at arrival: a patient with any
 * prior medical record or any previously closed encounter is a repeat
 * attendance; otherwise it's a new case. Callers may override it — the front
 * desk's arrival dialog asks when it matters.
 */
export async function deriveAttendanceType(patientId: string): Promise<AttendanceType> {
  try {
    const records = await getRecordsByPatient(patientId);
    if (records.length > 0) return 'repeat';
  } catch {
    // best-effort — fall through to the encounter check
  }
  try {
    if (await hasClosedEncounterForPatient(patientId)) return 'repeat';
  } catch {
    // best-effort — default to 'new' below
  }
  return 'new';
}

/**
 * Check a BOOKED patient in from the appointment itself — the only check-in
 * path now that the standalone Check-In module is gone.
 *
 * Flipping the appointment status is not a check-in on its own: the visit
 * thread every downstream station joins (triage, rooming, the clinician's
 * note, the checkout gate) hangs off the arrival encounter. The appointments
 * page used to write the status and nothing else, so a patient checked in from
 * there had no visit; this is why the two callers share one function.
 *
 * The appointment is written first so the patient is never hidden from the
 * arrivals board. Encounter creation is nevertheless REQUIRED for the command
 * to report success: downstream triage, rooming, notes and checkout all join
 * that visit thread. A partial failure stays visible as checked in and returns
 * an actionable error; retry is idempotent because an existing encounter is
 * reused.
 */
export async function checkInAppointment(input: {
  appointmentId: string;
  patientId: string;
  patientName: string;
  hospitalNumber?: string;
  facilityId?: string;
  facilityName?: string;
  orgId?: string;
  /** New case vs re-attendance; auto-derived when omitted. */
  attendanceType?: AttendanceType;
  actorId?: string;
  actorName?: string;
  actorRole?: string;
}): Promise<void> {
  const repairId = `repair:appointment-check-in:${input.appointmentId}`;
  const repairBase = {
    workflow: 'appointment_check_in' as const,
    patientId: input.patientId,
    appointmentId: input.appointmentId,
    hospitalId: input.facilityId,
    orgId: input.orgId,
  };
  try {
    await upsertWorkflowRepair(repairId, { ...repairBase, status: 'open', currentStep: 'appointment' });
    const appointment = await updateAppointmentStatus(input.appointmentId, 'checked_in', {
      actorId: input.actorId,
      actorName: input.actorName,
      actorRole: input.actorRole as never,
    });
    if (!appointment) throw new Error('The appointment could not be marked checked in.');
    await upsertWorkflowRepair(repairId, { ...repairBase, status: 'open', currentStep: 'encounter' });
    const existing = await findOpenEncounterForPatient(input.patientId, input.facilityId || '');
    if (!existing) {
      const attendanceType = input.attendanceType ?? await deriveAttendanceType(input.patientId);
      await createArrivalEncounter({
        patientId: input.patientId,
        patientName: input.patientName,
        hospitalNumber: input.hospitalNumber,
        hospitalId: input.facilityId || '',
        hospitalName: input.facilityName,
        orgId: input.orgId,
        arrivalChannel: 'appointment',
        appointmentId: input.appointmentId,
        attendanceType,
        actorId: input.actorId,
      });
    }
    // Check-in is reception's touchpoint on every booked visit, so it is also
    // where the booking's care team is promoted onto the patient document — a
    // clinician-booked appointment names a provider/nurse the patient document
    // never learned, because only reception may write those fields (the CouchDB
    // validator enforces the same). Never throws; skips non-reception actors.
    const { reconcileCareTeamFromAppointment } = await import('./patient-assignment-service');
    await reconcileCareTeamFromAppointment({
      appointmentId: input.appointmentId,
      actor: { id: input.actorId, name: input.actorName, role: input.actorRole as UserRole | undefined },
    });
    await resolveWorkflowRepair(repairId);
  } catch (error) {
    await upsertWorkflowRepair(repairId, {
      ...repairBase,
      status: 'open',
      currentStep: 'needs_repair',
      lastError: error instanceof Error ? error.message : 'Unknown check-in failure',
    }).catch(() => undefined);
    throw new Error(
      'The patient is marked checked in, but the clinical visit could not be opened. Keep them at the desk and retry check-in before triage.',
      { cause: error },
    );
  }
}

export type CheckInAcuity = 'routine' | 'priority' | 'emergency';

const ACUITY_TO_PRIORITY: Record<CheckInAcuity, TriagePriority> = {
  routine: 'GREEN',
  priority: 'YELLOW',
  emergency: 'RED',
};

export interface CheckInVitals {
  temperature?: string;
  pulse?: string;
  respiratoryRate?: string;
  systolic?: string;
  diastolic?: string;
  oxygenSaturation?: string;
  weight?: string;
  painScore?: string;
}

export interface CheckInInput {
  patientId: string;
  patientName: string;
  hospitalNumber?: string;
  patientPhone?: string;
  facilityId?: string;
  facilityName?: string;
  orgId?: string;
  /** How the patient arrived. */
  modeOfArrival?: TriageDoc['modeOfArrival'];
  chiefComplaint?: string;
  symptomDuration?: string;
  knownAllergies?: string;
  /** Front-desk acuity flag → triage priority (nurse confirms full ETAT). */
  acuity?: CheckInAcuity;
  vitals?: CheckInVitals;
  notes?: string;
  /** The walk-in booking's department. Defaults to 'OPD' when omitted. */
  department?: string;
  /**
   * New case vs re-attendance. When omitted, auto-derived via
   * `deriveAttendanceType` from the patient's history.
   */
  attendanceType?: AttendanceType;
  /** Acting front-desk user. */
  checkedInById: string;
  checkedInByName: string;
}

export interface CheckInResult {
  triage: TriageDoc;
  /** The visit (encounter) this check-in joined or created. */
  encounter: EncounterDoc;
  /** True when a scheduled appointment for today was also marked checked_in. */
  appointmentCheckedIn: boolean;
  /** The appointment now linked to this visit — matched-existing or the walk-in's own new one. */
  appointmentId?: string;
  /** True when this check-in wrote a brand-new walk-in booking (no scheduled appointment matched). */
  walkInAppointmentCreated: boolean;
  attendanceType: AttendanceType;
}

/**
 * Check a patient in. Always creates the triage/queue entry; additionally marks
 * a same-day scheduled/confirmed appointment as checked_in when one exists.
 */
export async function checkInPatient(input: CheckInInput): Promise<CheckInResult> {
  if (!input.patientId || !input.patientName) {
    throw new Error('A patient is required to check in.');
  }
  const acuity = input.acuity ?? 'routine';
  const v = input.vitals ?? {};
  const repairId = `repair:walk-in-check-in:${input.orgId || 'none'}:${input.facilityId || 'none'}:${input.patientId}:${jubaDate()}`;
  const repairBase = {
    workflow: 'walk_in_check_in' as const,
    patientId: input.patientId,
    hospitalId: input.facilityId,
    orgId: input.orgId,
  };
  await upsertWorkflowRepair(repairId, { ...repairBase, status: 'open', currentStep: 'appointment_lookup' });

  // Resolve a same-day scheduled/confirmed appointment up front so the match
  // is threaded onto the encounter instead of being computed and discarded
  // (docs/EMR-FIELD-AUDIT-2026-07.md §1, structural break #1) — non-fatal.
  let appointmentId: string | undefined;
  try {
    const today = jubaDate();
    // getAppointmentsByPatient is unscoped (matches across every org/facility
    // the patient has ever visited), so the match below must apply its own
    // org + facility filter — otherwise a booking at a different tenant's
    // facility for the same patient gets treated as today's visit here: it
    // is marked checked_in on THEIR board, this walk-in is silently linked to
    // it, and the walk-in booking branch below never fires.
    const appts = await getAppointmentsByPatient(input.patientId);
    // Any rung that still expects the patient: booked, reminded, confirmed, or
    // marked arrived but not yet checked in at the desk — plus a bare portal
    // `requested` ask for today at THIS facility, which holds the slot the
    // same way a scheduled booking does (KAN-118): without it, a patient who
    // asked for today's slot through the portal got a second, walk-in booking
    // instead of the desk answering the one they already made.
    const match = appts.find(
      (a) =>
        a.appointmentDate === today &&
        (APPOINTMENT_PENDING_STATUSES.includes(a.status) || a.status === 'checked_in' || a.status === 'requested') &&
        a.orgId === input.orgId &&
        a.facilityId === input.facilityId,
    );
    if (match) appointmentId = match._id;
  } catch {
    // appointment lookup is best-effort; a walk-in check-in still proceeds
  }

  const arrivalChannel: 'appointment' | 'walk_in' | 'referral' = appointmentId
    ? 'appointment'
    : input.modeOfArrival === 'referral'
      ? 'referral'
      : 'walk_in';

  // Join the patient's already-open visit (e.g. re-checked-in after a lapse)
  // instead of spawning a duplicate encounter for the same episode of care —
  // scoped to THIS facility, so another facility's open encounter in the
  // shared org DB is never absorbed. Checked BEFORE the walk-in booking below
  // is written: a rejected check-in must not leave a stray appointment on
  // today's schedule.
  let encounter = await findOpenEncounterForPatient(input.patientId, input.facilityId || '');
  if (encounter && !PRE_CLINICIAN_STATUSES.includes(encounter.status)) {
    // The visit is already with a clinician (or in a downstream loop such as
    // labs/checkout). A duplicate check-in here would attach a fresh pending
    // triage to a mid-flight encounter and re-queue a patient who is already
    // being seen — reject it with a message the front-desk toast can show.
    throw new Error('This patient already has a visit in progress — no new check-in was recorded.');
  }

  // A walk-in gets a booking of its own, created at the moment they are
  // checked in. Without one, half the patients in the building had no
  // appointment record, so every surface that reasons about a visit — the
  // front desk's status ladder, its detail panel, the day's schedule — had two
  // kinds of patient to special-case, and the walk-in always got the poorer
  // half. The triage record is untouched: that is where the ETAT assessment
  // lives, and this is a slot, not an assessment.
  let walkInAppointmentId: string | undefined;
  if (!appointmentId) {
    try {
      const created = await createAppointment({
        patientId: input.patientId,
        patientName: input.patientName,
        patientPhone: input.patientPhone,
        // The desk does not choose a clinician at check-in; the queue assigns
        // one. Left unassigned rather than guessed.
        providerId: '',
        providerName: '',
        facilityId: input.facilityId ?? '',
        facilityName: input.facilityName ?? '',
        facilityLevel: 'county',
        appointmentDate: jubaDate(),
        // Same clock as the date above — reading the hour off the browser's
        // own timezone paired a Juba calendar date with a non-Juba wall-clock
        // time for anyone outside Africa/Juba.
        appointmentTime: jubaTime(),
        duration: 15,
        // Recorded as what it is. The status is already `checked_in`: the
        // patient is at the desk, not expected later.
        appointmentType: 'walk_in',
        status: 'checked_in',
        // 'priority' flags emergency at the front desk too; 'routine' collapsed
        // both routine AND urgent walk-ins to the same word, so an urgent
        // walk-in showed as plain Routine everywhere the appointment (not the
        // triage record) is read from.
        priority: acuity === 'emergency' ? 'emergency' : acuity === 'priority' ? 'urgent' : 'routine',
        department: input.department || 'OPD',
        reason: input.chiefComplaint || 'Walk-in visit',
        orgId: input.orgId,
        createdBy: input.checkedInById,
      } as Omit<AppointmentDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>);
      walkInAppointmentId = created._id;
    } catch (error) {
      // A booking conflict is not an infrastructure failure — it names a real
      // clash (same-day open visit, room, provider) the caller can act on, so
      // it is rethrown as-is rather than folded into the generic message
      // below, which would have discarded the one detail worth showing.
      if (error instanceof BookingConflictError) throw error;
      await upsertWorkflowRepair(repairId, {
        ...repairBase, status: 'open', currentStep: 'appointment',
        lastError: error instanceof Error ? error.message : 'Walk-in appointment could not be saved',
      }).catch(() => undefined);
      throw new Error('The walk-in visit could not be added to today’s schedule. Retry check-in; no duplicate visit will be created.', { cause: error });
    }
  }

  // The appointment now linked to this visit: the matched scheduled booking,
  // or the walk-in's own new one. The two branches above are mutually
  // exclusive, so this never merges two different bookings.
  const linkedAppointmentId = appointmentId ?? walkInAppointmentId;

  const attendanceType = input.attendanceType ?? await deriveAttendanceType(input.patientId);

  if (!encounter) {
    encounter = await createArrivalEncounter({
      patientId: input.patientId,
      patientName: input.patientName,
      hospitalNumber: input.hospitalNumber,
      hospitalId: input.facilityId || '',
      hospitalName: input.facilityName,
      orgId: input.orgId,
      arrivalChannel,
      appointmentId: linkedAppointmentId,
      attendanceType,
      actorId: input.checkedInById,
    });
  }

  await upsertWorkflowRepair(repairId, {
    ...repairBase,
    appointmentId: linkedAppointmentId,
    encounterId: encounter._id,
    status: 'open',
    currentStep: 'triage',
  });

  const existingTriage = await getTriageByEncounter(encounter._id);
  let triage: TriageDoc;
  if (existingTriage) {
    triage = existingTriage;
  } else {
    const triagePayload = {
      patientId: input.patientId,
      patientName: input.patientName,
      hospitalNumber: input.hospitalNumber,
      // ABCC is NOT assessed at the front desk, and the record must say so
      // (KAN-100): writing normal-looking defaults here fabricated clinical
      // findings no clinician made. The clerk-selected acuity is real user
      // input and is kept; the nurse re-triages with the full ETAT tree.
      airway: 'not_assessed',
      breathing: 'not_assessed',
      circulation: 'not_assessed',
      consciousness: 'not_assessed',
      assessmentSource: 'clerical_checkin',
      priority: ACUITY_TO_PRIORITY[acuity],
      temperature: v.temperature,
      pulse: v.pulse,
      respiratoryRate: v.respiratoryRate,
      systolic: v.systolic,
      diastolic: v.diastolic,
      oxygenSaturation: v.oxygenSaturation,
      weight: v.weight,
      painScore: v.painScore,
      chiefComplaint: input.chiefComplaint,
      symptomDuration: input.symptomDuration,
      knownAllergies: input.knownAllergies,
      modeOfArrival: input.modeOfArrival ?? 'walk-in',
      notes: input.notes,
      triagedBy: input.checkedInById,
      triagedByName: input.checkedInByName,
      triagedAt: new Date().toISOString(),
      facilityId: input.facilityId,
      facilityName: input.facilityName,
      orgId: input.orgId,
      status: 'pending',
      encounterId: encounter._id,
    } as Omit<TriageDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>;
    try {
      triage = await createTriage(triagePayload);
    } catch (error) {
      if (!(error instanceof DuplicateActiveTriageError)) throw error;
      // The patient already has an active (pending/seen, <24h) triage that
      // createTriage's one-active-triage-per-patient guard refuses to
      // duplicate — e.g. left at 'seen' from an earlier visit whose encounter
      // closed without the triage itself ever reaching a terminal status, or
      // a same-day return after discharge. The clerical placeholder must
      // never dead-end here: re-attendance has to succeed.
      const existingActive = await findActiveTriageForPatient(input.patientId);
      if (!existingActive) {
        // Raced with something that resolved the duplicate between
        // createTriage's own check and this one (e.g. discharged on another
        // workstation) — retry once rather than surface a now-stale
        // conflict to the clerk.
        triage = await createTriage(triagePayload);
      } else if (existingActive.facilityId === input.facilityId) {
        // Same-facility re-attendance: attach THIS check-in's encounter to
        // the existing active triage instead of fabricating a second one.
        // Only encounterId is touched — updateTriage's vitals-safety gate
        // only re-runs for fields that affect the recommendation, so a
        // 'seen' triage's real ETAT findings are never overwritten by the
        // front desk's not_assessed placeholder.
        triage = await updateTriage(existingActive._id, { encounterId: encounter._id }, {
          userId: input.checkedInById, username: input.checkedInByName,
        });
      } else {
        // Active at a DIFFERENT facility — not this visit. Relinking it here
        // would pull another facility's queue entry off its own worklist, so
        // it is surfaced as this visit's triage as-is: the clerk still gets
        // a normal check-in result instead of an uncaught throw and a
        // stranded repair doc.
        triage = existingActive;
      }
      await upsertWorkflowRepair(repairId, {
        ...repairBase, appointmentId: linkedAppointmentId, encounterId: encounter._id, triageId: triage._id,
        status: 'open', currentStep: 'triage_attached_existing',
      });
    }
  }

  // Mark the matched EXISTING appointment checked_in — non-fatal. A
  // newly-created walk-in booking is already written with status
  // 'checked_in' above, so this only ever fires for the matched-appointment
  // branch: `appointmentCheckedIn` means "an existing scheduled appointment
  // was marked checked_in", not "this visit now has an appointment".
  let appointmentCheckedIn = false;
  if (appointmentId) {
    try {
      await updateAppointmentStatus(appointmentId, 'checked_in');
      appointmentCheckedIn = true;
      // Same promotion as checkInAppointment: a matched scheduled booking may
      // carry a care team the patient document never learned. The walk-in
      // booking created above has neither, so only this branch reconciles.
      const { reconcileCareTeamFromAppointment } = await import('./patient-assignment-service');
      await reconcileCareTeamFromAppointment({
        appointmentId,
        actor: { id: input.checkedInById, name: input.checkedInByName },
      });
    } catch (error) {
      await upsertWorkflowRepair(repairId, {
        ...repairBase, appointmentId, encounterId: encounter._id, triageId: triage._id,
        status: 'open', currentStep: 'appointment_status',
        lastError: error instanceof Error ? error.message : 'Appointment status could not be saved',
      }).catch(() => undefined);
      throw new Error('The clinical visit is open, but the appointment status could not be updated. Retry check-in to finish safely.', { cause: error });
    }
  }

  await resolveWorkflowRepair(repairId);

  return {
    triage,
    encounter,
    appointmentCheckedIn,
    appointmentId: linkedAppointmentId,
    walkInAppointmentCreated: Boolean(walkInAppointmentId),
    attendanceType,
  };
}
