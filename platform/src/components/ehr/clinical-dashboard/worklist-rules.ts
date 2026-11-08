import type { AppointmentDoc, AppointmentStatus, EncounterDoc, TriageDoc } from '@/lib/db-types';
import {
  appointmentStatusLabel,
  APPOINTMENT_STATUS_GROUPS,
  type AppointmentStatusGroup,
} from '@/lib/appointment-status';
import { resolveOperationalVisitState, type VisitLane } from '@/lib/clinical-flow/visit-state';
import { resolveVisitDisplay } from '@/lib/visit-display-status';
import { PRIORITY_META, appointmentTriage } from '@/lib/clinical/triage-display';
import { formatAppointmentTimeUntil, formatClockTime } from '@/lib/format-utils';
import { parseIsoDate, toIsoDate } from '@/lib/date-utils';
import { buildQueueFromTriage, STAGE_LABELS, type QueueEntry } from '@/lib/services/patient-queue-service';
import { withReturnTo } from '@/lib/navigation/return-to';
import { exceedsTargetWait } from '@/lib/clinical-flow/payment-model';
import { waitLabel } from '@/components/ehr/EhrVisitPopup';
import type { WorklistPatient, UnifiedPatientRow, OutstandingEntry, ClinicalDashboardQueryPatch, RowQueueColumns } from './worklist-types';

const statusLabel = appointmentStatusLabel;


/** Build a dashboard URL without dropping query state owned by other features. */
export function buildClinicalDashboardHref(
  pathname: string,
  currentSearch: string,
  patch: ClinicalDashboardQueryPatch,
): string {
  const params = new URLSearchParams(currentSearch.startsWith('?') ? currentSearch.slice(1) : currentSearch);
  for (const [key, value] of Object.entries(patch)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function clinicalDashboardDay(currentSearch: string, todayIso: string): string {
  const value = new URLSearchParams(currentSearch.startsWith('?') ? currentSearch.slice(1) : currentSearch).get('day');
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return todayIso;
  const parsed = parseIsoDate(value);
  return Number.isNaN(parsed.getTime()) || toIsoDate(parsed) !== value ? todayIso : value;
}

export function clinicalDashboardLane(currentSearch: string): AppointmentStatusGroup {
  const value = new URLSearchParams(currentSearch.startsWith('?') ? currentSearch.slice(1) : currentSearch).get('lane');
  return APPOINTMENT_STATUS_GROUPS.includes(value as AppointmentStatusGroup)
    ? value as AppointmentStatusGroup
    : 'scheduled';
}

export function buildClinicalAppointmentHref(appointmentId: string, dashboardHref: string): string {
  const params = new URLSearchParams({ appointment: appointmentId });
  return withReturnTo(`/appointments?${params.toString()}`, dashboardHref);
}

export function typeLabel(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** The chart for a display name, only when exactly one patient carries it —
 *  a namesake guess would open the wrong person's record. */
export function uniquePatientIdByName(patients: WorklistPatient[], name?: string): string | undefined {
  if (!name) return undefined;
  const matches = patients.filter(patient => patient.name === name);
  return matches.length === 1 ? matches[0]._id : undefined;
}

export function formatAppointmentDate(value: string) {
  const date = parseIsoDate(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: '2-digit', year: 'numeric' }).format(date);
}

export function appointmentTimeRange(appointment: AppointmentDoc) {
  const start = formatClockTime(appointment.appointmentTime || '00:00');
  if (appointment.endTime) return `${start} - ${formatClockTime(appointment.endTime)}`;
  return `${start} · ${appointment.duration}m`;
}

// Outstanding-entry tone → triage-style avatar color and a status pill,
// reusing the codebase's existing tone vocabulary (Overdue/Needs
// attention/Open already appear elsewhere as status labels) rather than
// inventing new copy per entry.
export function outstandingTonePriority(tone?: OutstandingEntry['tone']): 'RED' | 'YELLOW' | 'GREEN' {
  if (tone === 'danger') return 'RED';
  if (tone === 'warning') return 'YELLOW';
  return 'GREEN';
}

export function outstandingPillTone(tone?: OutstandingEntry['tone']) {
  if (tone === 'danger') return { key: 'red', label: 'Overdue' };
  if (tone === 'warning') return { key: 'yellow', label: 'Needs attention' };
  return { key: 'green', label: 'Open' };
}

/**
 * Applies only presentation-level filtering to appointments that have already
 * been ownership-scoped by the role dashboard. In particular, providerName is
 * display data: on a nurse's assigned visit it names the doctor, so it must not
 * be used to decide whether that nurse can see the visit.
 */
export function filterRoleOwnedAppointments(
  appointments: AppointmentDoc[],
  locationFilter = 'all',
): AppointmentDoc[] {
  return appointments.filter(
    appointment => locationFilter === 'all' || appointment.facilityName === locationFilter,
  );
}

// Mirrors dashboard/lab/page.tsx's FLAG_COLORS convention (critical=red,
// abnormal=amber) rather than importing it — that page's constant isn't
// exported for reuse, so the same rgba/CSS-var values are matched here.
// A result that's overdue for review but neither flagged abnormal nor
// critical still needs a pill; it gets a neutral gray "Overdue" rather than
// inventing a fabricated severity.
/**
 * The worklist row list: every assigned/claimable patient (`patients` — see
 * dashboard/page.tsx's assembleDoctorWorklist, which already folds in both a
 * doctor's assigned patients AND unclaimed-but-triaged ones) merged with
 * today's appointments, deduped so a patient who is both in `patients` and
 * separately booked for today shows as one enriched row rather than two.
 *
 * Pure and exported so the assembly rules — dedup, and which name a row is
 * labelled with — are directly testable without rendering the component:
 *   - dedup: `assignedIds`/`assignedNames` below stop an appointment for a
 *     patient already in `patients` from adding a second row.
 *   - labelling: `provider` only borrows the viewing clinician's own name
 *     once the patient actually carries an `assignedDoctor`. Falling back to
 *     `clinicianName` unconditionally meant an explicitly unclaimed patient
 *     (surfaced so ANY doctor at the facility could claim them) silently
 *     showed up pre-labelled with whichever doctor happened to be looking —
 *     hiding the exact "nobody has this patient yet" state the row exists to
 *     show. An empty `provider` falls through to computeRowQueueColumns'
 *     'Doctor unassigned'.
 */
export function buildUnifiedPatientRows({
  patients,
  selectedAppointmentsForDay,
  photoByPatientId,
  clinicianName,
  sortMode = 'Appointment time',
  mineOnly = false,
  nowMs,
}: {
  patients: WorklistPatient[];
  selectedAppointmentsForDay: AppointmentDoc[];
  photoByPatientId: Map<string, string>;
  clinicianName: string;
  /** The doctor's "Sort patients by" setting (`queue.sort`). */
  sortMode?: string;
  /** The doctor's "Show only patients assigned to me" setting (`queue.mineOnly`). */
  mineOnly?: boolean;
  /** Wall clock for the wait-time sort. Injected so the ordering is testable
   *  (the rest of this file samples `nowMs` for the same reason). */
  nowMs?: number;
}): UnifiedPatientRow[] {
  const appointmentByPatient = new Map<string, AppointmentDoc>();
  const appointmentByName = new Map<string, AppointmentDoc>();
  for (const appointment of selectedAppointmentsForDay) {
    if (appointment.patientId && !appointmentByPatient.has(appointment.patientId)) appointmentByPatient.set(appointment.patientId, appointment);
    if (appointment.patientName && !appointmentByName.has(appointment.patientName.toLowerCase())) appointmentByName.set(appointment.patientName.toLowerCase(), appointment);
  }

  const rows: UnifiedPatientRow[] = patients.map(patient => {
    // A station row reports the station's work: a booking today moves the visit
    // (the row's panel carries that), never which lane the work sits in.
    const appointment = patient.station ? null : (appointmentByPatient.get(patient._id) || appointmentByName.get(patient.name.toLowerCase()) || null);
    const status = appointment?.status || (patient.triagePriority === 'RED' ? 'checked_in' : 'scheduled');
    const department = patient.division || patient.ward?.split('-')[0] || appointment?.department || 'OPD';
    return {
      id: patient.station?.rowKey ?? patient._id,
      photoUrl: patient.photoUrl,
      patient,
      appointment,
      name: patient.name,
      patientId: patient._id,
      triagePriority: patient.triagePriority || (appointment ? appointmentTriage(appointment.priority) : 'GREEN'),
      assignmentStatus: patient.assignmentStatus || (patient.assignedDoctor ? 'assigned' : undefined),
      assignmentNote: patient.assignmentNote,
      reason: appointment?.reason || patient.division || patient.ward || (patient.assignedDoctor ? 'Assigned patient' : 'Awaiting provider'),
      timeLabel: appointment?.appointmentTime ? formatClockTime(appointment.appointmentTime) : (patient.station?.timeLabel || (patient.assignedDoctor ? 'Assigned' : 'Unclaimed')),
      status: status as AppointmentStatus,
      department,
      // Only borrow the viewing clinician's own name once the patient
      // actually carries an assignedDoctor. Falling back to `clinicianName`
      // unconditionally meant an explicitly unclaimed patient (surfaced so
      // ANY doctor at the facility could claim them) silently showed up
      // pre-labelled with whichever doctor happened to be looking — hiding
      // the exact "nobody has this patient yet" state the row exists to
      // show. Falls through to careTeamPrimary's 'Doctor unassigned' below.
      provider: patient.assignedDoctor
        ? (patient.doctor || clinicianName || 'Not assigned')
        : (appointment?.providerName || ''),
      isAssigned: true,
    };
  });

  const assignedIds = new Set(patients.map(patient => patient._id));
  const assignedNames = new Set(patients.map(patient => patient.name.toLowerCase()));
  for (const appointment of selectedAppointmentsForDay) {
    if ((appointment.patientId && assignedIds.has(appointment.patientId)) || assignedNames.has(appointment.patientName.toLowerCase())) continue;
    rows.push({
      id: appointment._id,
      photoUrl: appointment.patientId ? photoByPatientId.get(appointment.patientId) : undefined,
      patient: null,
      appointment,
      name: appointment.patientName,
      patientId: appointment.patientId,
      triagePriority: appointmentTriage(appointment.priority),
      reason: appointment.reason || typeLabel(appointment.appointmentType),
      timeLabel: appointment.appointmentTime ? formatClockTime(appointment.appointmentTime) : 'Scheduled',
      status: appointment.status,
      department: appointment.department || appointment.appointmentType || 'OPD',
      provider: appointment.providerName || clinicianName || 'Not assigned',
      isAssigned: false,
    });
  }

  // "Show only patients assigned to me" hides the wider facility queue — the
  // unclaimed triage rows that exist so any doctor can pick them up. It must
  // NOT hide the clinician's own booked appointments: the caller already
  // scoped the appointment list to this clinician (DoctorDashboardPage passes
  // only providerId === me), so every appointment-backed row here is the
  // viewer's own schedule. A standalone appointment row carries isAssigned:false
  // and patient:null, so the old test dropped every one of them — a doctor with
  // "only my patients" on (the default) saw their assigned patients but none of
  // their scheduled appointments, even though the same bookings showed on their
  // calendar.
  const visible = mineOnly
    ? rows.filter(row =>
        (row.isAssigned && (row.patient?.assignedDoctor || row.patient?.assignmentStatus))
        || row.appointment != null)
    : rows;

  // Acuity rank for "Acuity first"; also the tiebreak nothing else resolves.
  const acuityRank = (row: UnifiedPatientRow) =>
    row.triagePriority === 'RED' ? 0 : row.triagePriority === 'YELLOW' ? 1 : 2;
  // Minutes waited, from check-in. Rows with no check-in have not started
  // waiting, so they sort last rather than pretending to a zero-minute wait.
  const clock = nowMs ?? Date.now();
  const waitMinutes = (row: UnifiedPatientRow) => {
    const since = row.appointment?.checkedInAt;
    if (!since) return -1;
    const ms = clock - new Date(since).getTime();
    return Number.isFinite(ms) && ms > 0 ? ms / 60_000 : 0;
  };
  const byAppointmentTime = (a: UnifiedPatientRow, b: UnifiedPatientRow) =>
    (a.appointment?.appointmentTime || '99:99').localeCompare(b.appointment?.appointmentTime || '99:99')
    || a.name.localeCompare(b.name);

  return visible.sort((a, b) => {
    if (a.isAssigned !== b.isAssigned) return a.isAssigned ? -1 : 1;
    if (sortMode === 'Longest wait first') {
      const diff = waitMinutes(b) - waitMinutes(a);
      if (diff) return diff;
      return acuityRank(a) - acuityRank(b) || byAppointmentTime(a, b);
    }
    if (sortMode === 'Acuity first') {
      const diff = acuityRank(a) - acuityRank(b);
      if (diff) return diff;
      return waitMinutes(b) - waitMinutes(a) || byAppointmentTime(a, b);
    }
    return byAppointmentTime(a, b);
  });
}

/**
 * The latest active (pending/seen) triage record per patient, windowed to the
 * last 24h — older docs are unclosed visits, not a patient still waiting.
 * `nowMs === null` (wall clock not sampled yet) returns an empty map rather
 * than guessing, so the queue doesn't flash stale entries on first paint.
 *
 * A completed ETAT is still "active" here — `buildQueueFromTriage` (below)
 * is what turns a 'seen' status into "Awaiting Rooming"/"Awaiting
 * Consultation" rather than "Awaiting Triage", and drops terminal statuses
 * ('lwbs', 'admitted', 'discharged', 'referred') from the queue entirely.
 */
export function buildActiveTriageByPatient(
  triages: TriageDoc[],
  nowMs: number | null,
  windowMs = 24 * 60 * 60 * 1000,
): Map<string, TriageDoc> {
  if (nowMs === null) return new Map();
  const cutoff = nowMs - windowMs;
  return buildLatestTriageByPatient(
    triages.filter(doc => new Date(doc.triagedAt).getTime() >= cutoff),
  );
}

/**
 * The most recent triage per patient at ANY age — the patient's last recorded
 * ETAT, which is a different question from "who is waiting now".
 *
 * The worklist needs both: the 24h map above decides queue membership, while
 * this one supplies vitals. An inpatient admitted three days ago WAS triaged,
 * on arrival, and a ward row claiming "no triage vitals recorded" because that
 * happened outside the queue window reports the opposite of the truth — which
 * is why two beds on the same ward could show vitals for one patient and
 * nothing for the next.
 */
export function buildLatestTriageByPatient(triages: TriageDoc[]): Map<string, TriageDoc> {
  const latest = new Map<string, TriageDoc>();
  for (const doc of triages) {
    const held = latest.get(doc.patientId);
    if (!held || doc.triagedAt > held.triagedAt) latest.set(doc.patientId, doc);
  }
  return latest;
}

/** Live queue entry per patient, derived from the active-triage map above via
 *  the shared acuity/time-aged queue builder (patient-queue-service). */
export function buildQueueEntryByPatient(activeTriageByPatient: Map<string, TriageDoc>): Map<string, QueueEntry> {
  const entries = buildQueueFromTriage([...activeTriageByPatient.values()]);
  const map = new Map<string, QueueEntry>();
  for (const entry of entries) map.set(entry.patientId, entry);
  return map;
}


/** A station row's pill tint; a doctor's patient rows keep the confirmed tint. */
export function stationPillClass(tone: NonNullable<WorklistPatient['station']>['statusTone']): string {
  return tone === 'done' ? 'status-tone-green'
    : tone === 'active' ? 'status-tone-purple'
    : tone === 'danger' ? 'status-tone-red'
    : tone === 'warning' ? 'status-attention'
    : tone === 'scheduled' ? 'status-tone-slate'
    : 'status-tone-blue';
}

export function computeRowQueueColumns(
  row: UnifiedPatientRow,
  entry: QueueEntry | null,
  triage: TriageDoc | null,
  nowMs: number | null,
  /**
   * The doctor's "Highlight waits over target" setting (`queue.overTarget`)
   * and the facility's door-to-clinician target in minutes
   * (`clinicalPolicy.doorToClinicianMinutes`). Defaulted so the existing
   * callers and tests keep the behaviour they had.
   */
  waitHighlight: { enabled: boolean; targetMinutes: number } = { enabled: true, targetMinutes: 30 },
  encounter?: Pick<EncounterDoc, 'status'> | null,
  /** The encounter still has post-consultation nursing open (see resolveOperationalVisitState). */
  nursingReviewOpen = false,
): RowQueueColumns {
  const operationalState = encounter
    ? resolveOperationalVisitState(row.appointment ?? { status: row.status }, encounter, { nursingReviewOpen })
    : null;
  // Ownership begins when care begins: an ACCEPTED handoff (acknowledged /
  // in consultation) or a visit already in progress. Merely assigned
  // (`handoffTo` set, not yet accepted) stays Waiting.
  const inService = triage?.handoffStatus === 'in_consultation' || triage?.handoffStatus === 'acknowledged' || row.status === 'in_progress';
  // The shared tab + colour rule (visit-display-status.ts): the encounter wins
  // once there is one; a provider taking the patient lifts a queued row to In service.
  const visitDisplay = resolveVisitDisplay({
    // A walk-in in the queue with no booking has arrived and is waiting: the
    // row's synthesized 'scheduled' would read as idle.
    appointmentStatus: !row.appointment && entry ? 'checked_in' : row.status,
    encounterStatus: encounter?.status,
    nursingReviewOpen,
    inService,
  });
  const appointmentAt = row.appointment?.appointmentTime
    ? new Date(`${row.appointment.appointmentDate}T${row.appointment.appointmentTime}:00`)
    : null;
  const relativeNow = nowMs === null ? null : new Date(nowMs);
  const appointmentRelative = appointmentAt && relativeNow && !Number.isNaN(appointmentAt.getTime())
    ? formatAppointmentTimeUntil(appointmentAt, relativeNow)
    : '';
  // The row's own assignmentStatus, not only the patient's: a patient given an
  // assignedDoctor with no assignmentStatus written yet (most of them) has
  // the row default it to 'assigned'. Reading the patient field alone fell
  // through to statusLabel(row.status) — the synthesized 'scheduled' — so a
  // patient with no booking at all wore a SCHEDULED pill. The default is for
  // that case only: with a real appointment the row's status IS the
  // appointment's (Confirmed, Cancelled, Completed…), and must keep showing.
  const assignment = row.patient?.assignmentStatus ?? (row.appointment ? undefined : row.assignmentStatus);
  const assignmentLabel = assignment === 'assigned'
    ? 'Assigned'
    : assignment === 'accepted'
      ? 'Accepted'
      : assignment === 'in_progress'
        ? 'In service'
        : assignment === 'completed'
          ? 'Completed'
          : null;
  const station = row.appointment ? undefined : row.patient?.station;
  return {
    entry: entry ?? null,
    triage: triage ?? null,
    comingFrom: station?.context ? (station.contextSubtext ?? '') : entry
      ? (entry.stage === 'awaiting_triage' ? 'Registration' : 'Triage')
      : row.appointment ? 'Appointment' : 'Registry',
    careTeamPrimary: row.provider || entry?.assignedToName || 'Doctor unassigned',
    /* The NURSE covering this visit, which is a different person from the one
       above and from the one who took the vitals.

       Two bugs lived on this line. It fell back to `entry.assignedToName`,
       which `patient-queue-service` fills from `triage.assignedProviderName`
       — the PROVIDER — so an assigned doctor rendered as the nurse as well.
       And an appointment-derived row carries `patient: null` by construction,
       so `row.patient?.nurse` could never answer for the rows most likely to
       have a nurse assigned from the appointment editor. That editor writes
       `staffName` onto the appointment (and `assignedNurseName` onto the
       patient), so the appointment is the field to read when there is no
       patient record on the row. */
    careTeamSecondary: row.patient?.station?.careTeamSecondary ?? (row.patient?.nurse || row.appointment?.staffName || 'Nurse unassigned'),
    statusText: row.patient?.station?.status || operationalState?.label || (triage?.handoffStatus === 'acknowledged'
      ? 'Acknowledged'
      : triage?.assignedProviderId && triage.handoffStatus === 'assigned'
        ? 'Assigned'
        : inService
      ? 'In service'
      : entry ? 'Waiting' : assignmentLabel || statusLabel(row.status)),
    queueText: station?.context || operationalState?.label || (entry ? STAGE_LABELS[entry.stage] : typeLabel(row.department)),
    waitText: station?.timeLabel ? station.timeLabel : entry ? formatClockTime(entry.enteredStageAt) : row.appointment?.appointmentTime ? formatClockTime(row.appointment.appointmentTime) : '—',
    waitSubtext: station?.timeLabel ? (station.timeSubtext ?? '') : entry
      ? waitLabel(entry.minutesWaiting)
      // No appointment behind the row: say so, rather than a label that
      // reads like a booking detail.
      : appointmentRelative || row.appointment?.appointmentDate || 'No booking today',
    statusSubtext: row.patient?.station?.statusSubtext !== undefined
      ? row.patient.station.statusSubtext
      : triage?.handoffStatus
      ? triage.handoffStatus.replaceAll('_', ' ')
      : entry?.acuity === 'RED'
      ? 'Critical'
      : entry?.acuity === 'YELLOW'
        ? 'Urgent'
        : entry?.acuity === 'GREEN'
          ? 'Routine'
          : row.patient?.assignmentNote || PRIORITY_META[row.triagePriority].label,
    // Flagged for reassessment by triage, OR simply waiting longer than the
    // facility's door-to-clinician target — the second half is what the
    // "Highlight waits over target" row always claimed to do and never did.
    overTarget: waitHighlight.enabled && Boolean(
      entry && (
        entry.flaggedForReassessment
        || exceedsTargetWait(entry.minutesWaiting, waitHighlight.targetMinutes)
      ),
    ),
    // A booked slot that has come and gone with the patient still not in the
    // queue. Rows that ARE in the queue are excluded deliberately: their time
    // is when they arrived, so "past" would be true of every one of them and
    // the colour would stop meaning anything. Lateness for those is
    // `overTarget`, which the wait clock already tracks.
    isPast: Boolean(
      !entry && appointmentAt && relativeNow && !Number.isNaN(appointmentAt.getTime())
        && appointmentAt.getTime() < relativeNow.getTime(),
    ),
    inService,
    operationalLane: operationalState?.lane ?? null,
    visitTab: visitDisplay.tab,
    visitTone: visitDisplay.rowTone,
  };
}

/** Which of the three worklist lanes (Waiting / In service / Finished) a row
 *  belongs in — the shared rule in visit-display-status.ts. The encounter
 *  stage wins when there is one (it is what the status chip reads); a patient
 *  is Waiting until a provider/clinical team member takes them (`inService`),
 *  so a checked-in or queued patient stays in Waiting. */
export function computeRowStatusGroup(
  status: AppointmentStatus,
  inService: boolean,
  encounterStatus?: EncounterDoc['status'] | null,
  nursingReviewOpen = false,
): AppointmentStatusGroup {
  return resolveVisitDisplay({ appointmentStatus: status, encounterStatus, nursingReviewOpen, inService }).tab;
}

/** Tally rows per lane — used for both the lane-tab counts and (filtered) the
 *  rows actually rendered under each lane, so the two can never disagree. */
export function tallyByStatusGroup<T>(
  rows: T[],
  groupOf: (row: T) => AppointmentStatusGroup,
): Record<AppointmentStatusGroup, number> {
  return rows.reduce(
    (counts, row) => { counts[groupOf(row)] += 1; return counts; },
    { scheduled: 0, in_office: 0, finished: 0 } as Record<AppointmentStatusGroup, number>,
  );
}

/** The patient-record update a "claim" (Call patient) action writes: hands
 *  ownership to whoever is claiming (falling back to the patient's existing
 *  assignment only if there is somehow no signed-in user), never to the
 *  patient's previously-displayed care team. */
export function buildClaimUpdate(
  patientAssignment: WorklistPatient | null | undefined,
  currentUser: { _id?: string; name?: string } | null | undefined,
  now: Date = new Date(),
): {
  assignedDoctor?: string;
  assignedDoctorName?: string;
  assignmentStatus: 'accepted';
  assignmentAcceptedAt: string;
  assignmentAcceptedBy?: string;
  assignmentAcceptedByName?: string;
} {
  return {
    assignedDoctor: currentUser?._id || patientAssignment?.assignedDoctor,
    assignedDoctorName: currentUser?.name || patientAssignment?.assignedDoctorName,
    assignmentStatus: 'accepted',
    assignmentAcceptedAt: now.toISOString(),
    assignmentAcceptedBy: currentUser?._id,
    assignmentAcceptedByName: currentUser?.name,
  };
}
