import { AppointmentDoc, AppointmentStatus, EncounterDoc, PatientDoc, TriageDoc } from '@/lib/db-types';
import { APPOINTMENT_CHECKED_IN_STATUSES, appointmentStatusLabel } from '@/lib/appointment-status';
import { formatClockTime } from '@/lib/format-utils';
import { patientFullName, patientAgeLabel } from '@/lib/patient-utils';
import { appointmentTriage } from '@/lib/clinical/triage-display';
import { buildQueueFromTriage, STAGE_LABELS, deriveAppointmentWait } from '@/lib/services/patient-queue-service';
import { suggestDepartment, splitDateTime, appointmentMoment, isoDateKey, patientFacilityName } from '@/lib/front-desk-utils';
import { resolveVisitDisplay, type VisitDisplayInput } from '@/lib/visit-display-status';
import { resolveOperationalVisitState } from '@/lib/clinical-flow/visit-state';
import { findActiveAppointmentForPatient } from '@/lib/appointment-workflow';
import type { QueueItem } from './desk-types';

/**
 * The unified queue: triaged walk-ins + checked-in appointments + checkout-only
 * encounters, ordered by acuity+wait score. Moved verbatim from page.tsx's
 * `queue` memo; the memo (and its dependency list) stays in FrontDeskBoard.
 */
/** The shared tab + colour tone for a queue item (visit-display-status.ts). */
function visitDisplayFields(input: VisitDisplayInput) {
  const d = resolveVisitDisplay(input);
  return { visitTab: d.tab, visitTone: d.rowTone };
}

export function buildDeskQueue({
  patients, hospitalName, viewingToday, encounters, today, boardDate, triages,
  todaysAppointments, nursingReviewIds, queueNowMs,
}: {
  patients: PatientDoc[];
  hospitalName: string | undefined;
  viewingToday: boolean;
  encounters: EncounterDoc[];
  today: string;
  boardDate: string;
  triages: TriageDoc[];
  todaysAppointments: AppointmentDoc[];
  nursingReviewIds: Set<string>;
  queueNowMs: number;
}): QueueItem[] {
  const items: QueueItem[] = [];
  // Look up gender/age per queue entry from the patient record (all entry
  // types carry a patientId), so Gender and Age render in their own columns.
  const patientById = new Map(patients.map(p => [p._id, p]));
  const genderOf = (pid: string) => patientById.get(pid)?.gender || '—';
  const ageOf = (pid: string) => { const p = patientById.get(pid); return p ? patientAgeLabel(p) : '—'; };
  const doctorOf = (pid: string) => patientById.get(pid)?.assignedDoctorName || '';
  // The patient's covering nurse. This used to read `assignedByName`, which is
  // whoever last assigned a doctor — not a nurse at all.
  const nurseOf = (pid: string) => patientById.get(pid)?.assignedNurseName || '';
  const locationOf = (pid: string, fallback?: string) => {
    const p = patientById.get(pid);
    return fallback || patientFacilityName(p, hospitalName || 'Facility');
  };
  const checkoutStatuses = new Set<EncounterDoc['status']>([
    'ready_for_clinic_checkout',
    'in_clinic_checkout',
    'clinic_complete_awaiting_next_station',
    'awaiting_facility_checkout',
    'in_facility_checkout',
  ]);
  // Live checkout encounters belong to today's building, not to whichever
  // day the calendar is showing — an empty map on other days keeps them out
  // of both the encounter rows below and the appointment rows' checkout state.
  const checkoutEncounterByPatient = new Map<string, EncounterDoc>();
  const encounterByPatient = new Map<string, EncounterDoc>();
  if (viewingToday) {
    for (const enc of encounters) {
      const dateKey = isoDateKey(enc.startedAt || enc.createdAt);
      if (dateKey !== today) continue;
      const held = encounterByPatient.get(enc.patientId);
      if (!held || (enc.updatedAt || enc.createdAt || '').localeCompare(held.updatedAt || held.createdAt || '') > 0) {
        encounterByPatient.set(enc.patientId, enc);
      }
      if (!checkoutStatuses.has(enc.status)) continue;
      const current = checkoutEncounterByPatient.get(enc.patientId);
      if (!current || (enc.updatedAt || enc.createdAt || '').localeCompare(current.updatedAt || current.createdAt || '') > 0) {
        checkoutEncounterByPatient.set(enc.patientId, enc);
      }
    }
  }

  // Active triage per patient, driving the stage-based live queue, newest
  // per patient. The live queue only exists for TODAY: another board day has
  // no one physically in the building, so its lanes come from that day's
  // appointments alone (the loop below).
  //
  // Scoped to the board DAY, not a rolling 24h window. The window counted
  // yesterday's never-closed triages as "in office" today — 25 on the tab
  // against 3 actually listed, because those rows carry yesterday's date and
  // the shared dashboard only renders the selected day. A visit left open
  // overnight is stale data, not someone standing in reception; encounters
  // that never close are the root cause (see
  // docs/PATIENT-JOURNEY-GAP-AUDIT-2026-08.md §A5).
  const activeTriageByPatient = new Map<string, TriageDoc>();
  if (viewingToday) {
    for (const doc of triages) {
      if (isoDateKey(doc.triagedAt) !== boardDate) continue;
      const held = activeTriageByPatient.get(doc.patientId);
      if (!held || doc.triagedAt > held.triagedAt) activeTriageByPatient.set(doc.patientId, doc);
    }
  }

  // Add triaged patients (walk-ins and triaged appointments) via the
  // shared queue-stage service — no lab/pharmacy args since this page
  // doesn't load prescriptions or lab results.
  const stageEntries = buildQueueFromTriage([...activeTriageByPatient.values()]);
  for (const entry of stageEntries) {
    const triageDoc = activeTriageByPatient.get(entry.patientId);
    const checkoutEncounter = checkoutEncounterByPatient.get(entry.patientId);
    const isCheckout = Boolean(checkoutEncounter);
    const room = triageDoc?.assignedRoom;
    // A clinician has taken the patient when the handoff was ACCEPTED
    // (acknowledged / in consultation) or the triage was marked seen. A
    // handoff that is merely assigned stays Waiting: ownership begins when
    // care begins, not when a name is put on the row.
    const inConsult = triageDoc?.handoffStatus === 'acknowledged'
      || triageDoc?.handoffStatus === 'in_consultation'
      || triageDoc?.status === 'seen';
    // The booking this walk-in's visit is threaded onto (check-in creates one
    // for every arrival). Its rung is the authority on where the patient
    // actually is; the triage record only proves an assessment exists, which
    // is why "has a triage" was the wrong test for "is in the building".
    // Matched via the encounter's own `appointmentId` first, falling back to
    // the earliest ACTIVE (non-cancelled/no-show/rescheduled) booking today —
    // never the first same-patient row regardless of whether it is still live.
    const activeEncounter = encounterByPatient.get(entry.patientId);
    const linkedAppointment = findActiveAppointmentForPatient(todaysAppointments, entry.patientId, activeEncounter?.appointmentId);
    const triageVisitStatus: AppointmentStatus =
      linkedAppointment?.status
      ?? triageDoc?.visitStatus
      // A walk-in with no booking at all: the triage record IS the proof of
      // presence, so it files as checked in (or further along).
      ?? (isCheckout ? 'completed' : inConsult ? 'in_progress' : 'checked_in');
    items.push({
      id: `triage-${entry.triageId}`,
      visitStatus: triageVisitStatus,
      ...visitDisplayFields({
        appointmentStatus: triageVisitStatus,
        encounterStatus: activeEncounter?.status,
        nursingReviewOpen: !!activeEncounter && nursingReviewIds.has(activeEncounter._id),
        inService: inConsult,
      }),
      patientId: entry.patientId,
      patientName: entry.patientName,
      type: 'walk-in',
      priority: entry.acuity,
      complaint: entry.chiefComplaint || 'ETAT Assessment',
      department: entry.chiefComplaint ? suggestDepartment(entry.chiefComplaint) : 'Triage',
      gender: genderOf(entry.patientId),
      age: ageOf(entry.patientId),
      ...splitDateTime(entry.enteredStageAt),
      timeAt: entry.enteredStageAt,
      calendarDate: isoDateKey(entry.enteredStageAt),
      status: isCheckout ? 'DONE' : inConsult ? 'IN CONSULT' : 'WAITING',
      stage: entry.stage,
      stageLabel: isCheckout ? 'Ready for checkout' : STAGE_LABELS[entry.stage],
      ...(() => {
        const nursingReviewOpen = !!activeEncounter && nursingReviewIds.has(activeEncounter._id);
        const state = linkedAppointment
          ? resolveOperationalVisitState(linkedAppointment, activeEncounter, { nursingReviewOpen })
          : activeEncounter ? resolveOperationalVisitState({ status: triageVisitStatus }, activeEncounter, { nursingReviewOpen }) : null;
        return state ? { operationalLabel: state.label, operationalI18nKey: state.i18nKey } : {};
      })(),
      waitMinutes: entry.minutesWaiting,
      overTarget: entry.flaggedForReassessment,
      score: entry.score,
      sourceId: entry.triageId,
      encounterId: activeEncounter?._id,
      assignedRoom: room,
      assignedDoctorName: activeEncounter?.assignedClinicianName || activeEncounter?.clinicianName || entry.assignedToName || linkedAppointment?.providerName || doctorOf(entry.patientId),
      assignedNurseName: activeEncounter?.assignedNurseName || linkedAppointment?.staffName || nurseOf(entry.patientId) || triageDoc?.triagedByName,
      location: locationOf(entry.patientId, room || (entry.chiefComplaint ? suggestDepartment(entry.chiefComplaint) : 'Triage')),
    });
  }

  // Appointments only join the queue once the desk has CHECKED THEM IN.
  // Scheduled/reminded/confirmed appointments — and ones merely marked
  // `arrived`, where the patient is in the waiting room but the desk has not
  // opened the visit — stay in the Today's Appointments card until the
  // receptionist checks them in via the check-in popup.
  const ARRIVED = new Set<AppointmentDoc['status']>(APPOINTMENT_CHECKED_IN_STATUSES);
  // Slots closed without the patient being seen. They file into the Finished
  // lane (as DONE rows wearing their own red/muted pill) instead of being
  // dropped from the board — a cancellation the desk can still see is one it
  // can still reverse.
  const CLOSED_UNSEEN = new Set<AppointmentDoc['status']>(['cancelled', 'rescheduled', 'no_show']);
  // Only a rendered triage row may suppress its appointment. A discharged
  // triage is deliberately absent from stageEntries; its completed booking
  // must remain visible in Finished.
  const triagedPatientIds = new Set(stageEntries.map(entry => entry.patientId));
  const APPT_SCORE: Record<string, number> = { emergency: 3, urgent: 2 };
  for (const a of todaysAppointments) {
    if (triagedPatientIds.has(a.patientId)) continue;
    if (!ARRIVED.has(a.status) && !CLOSED_UNSEEN.has(a.status)) continue; // not checked in yet → not in the queue
    const checkoutEncounter = checkoutEncounterByPatient.get(a.patientId);
    const activeEncounter = encounterByPatient.get(a.patientId);
    const status = CLOSED_UNSEEN.has(a.status) ? 'DONE' :
                   checkoutEncounter ? 'DONE' :
                   a.status === 'completed' ? 'DONE' :
                   a.status === 'in_progress' ? 'IN CONSULT' : 'WAITING';
    // Wait clock: a booked patient the desk checked in waits the same clock
    // as a walk-in. `checkedInAt` is stamped the moment that happened
    // (updateAppointmentStatus) but neither field was ever read here
    // before, so a checked-in appointment row showed no wait at all.
    const { waitMinutes, overTarget } = deriveAppointmentWait(a.status, a.checkedInAt, queueNowMs);
    items.push({
      id: `appt-${a._id}`,
      visitStatus: a.status,
      ...visitDisplayFields({
        appointmentStatus: a.status,
        encounterStatus: CLOSED_UNSEEN.has(a.status) ? null : activeEncounter?.status,
        nursingReviewOpen: !!activeEncounter && nursingReviewIds.has(activeEncounter._id),
      }),
      patientId: a.patientId,
      patientName: a.patientName,
      type: 'appointment',
      // A booking always has an acuity — routine is one, not the absence of
      // one. 'normal' is left for rows that genuinely carry none (a bare
      // registration), which is the only case that falls back to the stage
      // or department under the pill.
      priority: appointmentTriage(a.priority),
      complaint: a.reason || 'Scheduled visit',
      department: a.department || 'OPD',
      gender: genderOf(a.patientId),
      age: ageOf(a.patientId),
      date: splitDateTime(a.appointmentDate).date,
      time: formatClockTime(a.appointmentTime),
      timeAt: appointmentMoment(a.appointmentDate, a.appointmentTime),
      calendarDate: isoDateKey(a.appointmentDate),
      status,
      ...(CLOSED_UNSEEN.has(a.status)
        ? { closedStatus: a.status, stageLabel: appointmentStatusLabel(a.status) }
        : {}),
      operationalLabel: resolveOperationalVisitState(a, activeEncounter).label,
      operationalI18nKey: resolveOperationalVisitState(a, activeEncounter).i18nKey,
      waitMinutes,
      overTarget,
      score: APPT_SCORE[a.priority ?? ''] ?? 1,
      sourceId: a._id,
      encounterId: activeEncounter?._id,
      assignedDoctorName: activeEncounter?.assignedClinicianName || activeEncounter?.clinicianName || a.providerName || doctorOf(a.patientId),
      // Same ladder as the doctor line above: the patient-level assignment
      // when reception has stamped it, else the nurse named on the booking —
      // a clinician-booked appointment carries staffName before the patient
      // document learns it (reconciled at check-in / front-desk save).
      assignedNurseName: activeEncounter?.assignedNurseName || nurseOf(a.patientId) || a.staffName || activeTriageByPatient.get(a.patientId)?.triagedByName || '',
      location: a.department || a.facilityName || locationOf(a.patientId),
    });
  }

  const queuedPatientIds = new Set(items.map(it => it.patientId));
  for (const enc of checkoutEncounterByPatient.values()) {
    if (queuedPatientIds.has(enc.patientId)) continue;
    const patient = patientById.get(enc.patientId);
    items.push({
      id: `encounter-${enc._id}`,
      // Clinical work is done but the desk has not closed them out: the
      // visit files under Finished (Ready for discharge) and carries the
      // Checkout action there; checkout itself is what completes it.
      visitStatus: 'in_progress',
      // Provider is done; the desk is closing the visit out: Ready for discharge.
      ...visitDisplayFields({ appointmentStatus: 'in_progress', encounterStatus: enc.status }),
      patientId: enc.patientId,
      patientName: enc.patientName || (patient ? patientFullName(patient) : 'Patient'),
      type: 'walk-in',
      priority: 'normal',
      complaint: String(enc.snapshot?.chiefComplaint || 'Clinical checkout'),
      department: 'Checkout',
      gender: genderOf(enc.patientId),
      age: ageOf(enc.patientId),
      ...splitDateTime(enc.updatedAt || enc.closedAt || enc.startedAt),
      timeAt: enc.updatedAt || enc.closedAt || enc.startedAt,
      calendarDate: isoDateKey(enc.updatedAt || enc.closedAt || enc.startedAt),
      status: 'DONE',
      score: 0,
      sourceId: enc._id,
      encounterId: enc._id,
      assignedDoctorName: doctorOf(enc.patientId),
      assignedNurseName: nurseOf(enc.patientId),
      location: 'Checkout',
    });
    queuedPatientIds.add(enc.patientId);
  }

  // Order by the queue-stage service's acuity+wait score (desc) — highest
  // priority, longest-waiting patients surface first. Same-score rows keep
  // a stable time-based tiebreak.
  items.sort((a, b) => (b.score - a.score) || (a.time || '').localeCompare(b.time || ''));

  return items;
}
