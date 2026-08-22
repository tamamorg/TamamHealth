'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { AppointmentDoc, AppointmentStatus, FollowUpDoc } from '@/lib/db-types';
import {
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  MoreVertical,
  Pill,
  Plus,
  Printer,
  Search,
  Stethoscope,
  X,
} from '@/components/icons/lucide';
import { initials, stateTint, AVATAR_TINT_NEUTRAL, abbreviateProviderName, shortenPersonName } from '@/lib/patient-utils';
import { formatAppointmentTimeUntil, formatClockTime } from '@/lib/format-utils';
import EhrStageDonut from '@/components/ehr/EhrStageDonut';
import {
  APPOINTMENT_STATUS_TONES, appointmentStatusLabel,
  APPOINTMENT_STATUS_GROUPS, APPOINTMENT_STATUS_GROUP_LABELS,
  appointmentStatusGroup, type AppointmentStatusGroup,
} from '@/lib/appointment-status';
import { useToast } from '@/components/Toast';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { usePatients } from '@/lib/hooks/usePatients';
import { useWards } from '@/lib/hooks/useWards';
import Modal from '@/components/Modal';
import { addDays, addMonths, formatMonthTitle, startOfMonth } from '@/components/ehr/EhrMiniCalendar';
import { parseIsoDate, toIsoDate } from '@/lib/date-utils';
import { EhrWeekActivityChart, type DayStatsItem } from '@/components/ehr/EhrDayStatsChart';
import EhrVisitPopup, { EhrQueueMoveDialog, waitLabel } from '@/components/ehr/EhrVisitPopup';
import { PRIORITY_META, appointmentTriage } from '@/lib/clinical/triage-display';
import PatientDispenseModal from '@/components/pharmacy/PatientDispenseModal';
import AppointmentStatusPillSelect from '@/components/appointments/AppointmentStatusPillSelect';
import BookAppointmentModal from '@/components/appointments/BookAppointmentModal';
import Select from '@/components/Select';
import PrintListDialog, { type PrintListSection } from '@/components/PrintListDialog';
import ProgressFeedCard from '@/components/ehr/ProgressFeedCard';
import { useCreateNote } from '@/lib/clinical-notes/useCreateNote';
import EhrWorkItemProgress from '@/components/ehr/EhrWorkItemProgress';
import { useTriage } from '@/lib/hooks/useTriage';
import { useAppointments } from '@/lib/hooks/useAppointments';
import { useAuth } from '@/lib/context';
import { getRoleConfig } from '@/lib/permissions';
import { isPathAllowed } from '@/lib/role-routes';
import { uniqueAllowedNavItems, getPageHeaderNavItems } from '@/components/ehr/ehr-navigation';
import { buildQueueFromTriage, STAGE_LABELS, type QueueEntry } from '@/lib/services/patient-queue-service';
import type { TriageDoc } from '@/lib/db-types';
import { withReturnTo } from '@/lib/navigation/return-to';
import { useRoleChoice, useRoleFlag } from '@/lib/settings/useRoleSetting';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { exceedsTargetWait } from '@/lib/clinical-flow/payment-model';

export type WorklistPatient = {
  _id: string;
  /** Patient portrait; the avatar falls back to initials when absent. */
  photoUrl?: string;
  name: string;
  age: number | null;
  gender: string;
  id?: string;
  ward?: string;
  doctor?: string;
  nurse?: string;
  division?: string;
  triagePriority?: 'RED' | 'YELLOW' | 'GREEN';
  assignedDoctor?: string;
  assignedDoctorName?: string;
  assignmentStatus?: 'assigned' | 'accepted' | 'in_progress' | 'completed';
  assignmentNote?: string;
};

export type UnifiedPatientRow = {
  id: string;
  photoUrl?: string;
  patient: WorklistPatient | null;
  appointment: AppointmentDoc | null;
  name: string;
  patientId?: string;
  triagePriority: 'RED' | 'YELLOW' | 'GREEN';
  reason: string;
  timeLabel: string;
  status: AppointmentStatus;
  department: string;
  provider: string;
  isAssigned: boolean;
};


/** One row inside an outstanding-item worklist (a document to sign, an open
 *  referral, a paused encounter, …) rendered inline in the centre panel. */
export type OutstandingEntry = {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  tone?: 'neutral' | 'warning' | 'danger';
  href?: string;
  actionLabel?: string;
  actionHref?: string;
  actionKind?: 'navigate' | 'complete-follow-up';
};

export type OutstandingItem = {
  label: string;
  count: number;
  tone?: 'neutral' | 'warning' | 'danger';
  href?: string;
  /** The actual items behind the count — clicking the card swaps the centre
   *  panel (schedule area) for this list instead of navigating away. */
  entries?: OutstandingEntry[];
};

/* The desk's ladder plus `requested`, which only the patient portal writes but
   a clinician may still be looking at. Order and labels come from the shared
   vocabulary so this dropdown and the front desk's offer the same thing. */

const statusLabel = appointmentStatusLabel;

export type ClinicalDashboardQueryPatch = Partial<Record<'day' | 'lane' | 'outstanding' | 'appointment', string | null>>;

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

function formatAppointmentDate(value: string) {
  const date = parseIsoDate(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: '2-digit', year: 'numeric' }).format(date);
}

function appointmentTimeRange(appointment: AppointmentDoc) {
  const start = formatClockTime(appointment.appointmentTime || '00:00');
  if (appointment.endTime) return `${start} - ${formatClockTime(appointment.endTime)}`;
  return `${start} · ${appointment.duration}m`;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="appointment-detail-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

// Outstanding-entry tone → triage-style avatar color and a status pill,
// reusing the codebase's existing tone vocabulary (Overdue/Needs
// attention/Open already appear elsewhere as status labels) rather than
// inventing new copy per entry.
function outstandingTonePriority(tone?: OutstandingEntry['tone']): 'RED' | 'YELLOW' | 'GREEN' {
  if (tone === 'danger') return 'RED';
  if (tone === 'warning') return 'YELLOW';
  return 'GREEN';
}

function outstandingPillTone(tone?: OutstandingEntry['tone']) {
  if (tone === 'danger') return { key: 'red', label: 'Overdue' };
  if (tone === 'warning') return { key: 'yellow', label: 'Needs attention' };
  return { key: 'green', label: 'Open' };
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
    const appointment = appointmentByPatient.get(patient._id) || appointmentByName.get(patient.name.toLowerCase()) || null;
    const status = appointment?.status || (patient.triagePriority === 'RED' ? 'checked_in' : 'scheduled');
    const department = patient.division || patient.ward?.split('-')[0] || appointment?.department || 'OPD';
    return {
      id: patient._id,
      photoUrl: patient.photoUrl,
      patient,
      appointment,
      name: patient.name,
      patientId: patient._id,
      triagePriority: patient.triagePriority || (appointment ? appointmentTriage(appointment.priority) : 'GREEN'),
      assignmentStatus: patient.assignmentStatus || (patient.assignedDoctor ? 'assigned' : undefined),
      assignmentNote: patient.assignmentNote,
      reason: appointment?.reason || patient.division || patient.ward || (patient.assignedDoctor ? 'Assigned patient' : 'Awaiting provider'),
      timeLabel: appointment?.appointmentTime ? formatClockTime(appointment.appointmentTime) : (patient.assignedDoctor ? 'Assigned' : 'Unclaimed'),
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

  // "Show only patients assigned to me" hides the wider facility queue —
  // the unclaimed rows that exist so any doctor can pick them up.
  const visible = mineOnly
    ? rows.filter(row => row.isAssigned && (row.patient?.assignedDoctor || row.patient?.assignmentStatus))
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

/** One worklist row's queue-derived display columns (Coming from / Care team
 *  / Status / Queue / Wait), from its live queue entry when the patient has
 *  arrived and from the appointment/assignment alone when they haven't. */
export interface RowQueueColumns {
  entry: QueueEntry | null;
  triage: TriageDoc | null;
  comingFrom: string;
  careTeamPrimary: string;
  careTeamSecondary: string;
  statusText: string;
  queueText: string;
  waitText: string;
  waitSubtext: string;
  statusSubtext: string;
  overTarget: boolean;
  /** The booked slot has already passed and the patient is not in the queue —
   *  the row is running late, which the Time column shows in red. */
  isPast: boolean;
  inService: boolean;
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
): RowQueueColumns {
  const inService = triage?.handoffStatus === 'in_consultation' || Boolean(triage?.handoffTo) || row.status === 'in_progress';
  const appointmentAt = row.appointment?.appointmentTime
    ? new Date(`${row.appointment.appointmentDate}T${row.appointment.appointmentTime}:00`)
    : null;
  const relativeNow = nowMs === null ? null : new Date(nowMs);
  const appointmentRelative = appointmentAt && relativeNow && !Number.isNaN(appointmentAt.getTime())
    ? formatAppointmentTimeUntil(appointmentAt, relativeNow)
    : '';
  const assignmentLabel = row.patient?.assignmentStatus === 'assigned'
    ? 'Assigned'
    : row.patient?.assignmentStatus === 'accepted'
      ? 'Accepted'
      : row.patient?.assignmentStatus === 'in_progress'
        ? 'In service'
        : row.patient?.assignmentStatus === 'completed'
          ? 'Completed'
          : null;
  return {
    entry: entry ?? null,
    triage: triage ?? null,
    comingFrom: entry
      ? (entry.stage === 'awaiting_triage' ? 'Registration' : 'Triage')
      : row.appointment ? 'Appointment' : 'Registry',
    careTeamPrimary: row.provider || entry?.assignedToName || 'Doctor unassigned',
    careTeamSecondary: row.patient?.nurse || entry?.assignedToName || 'Nurse unassigned',
    statusText: triage?.handoffStatus === 'acknowledged'
      ? 'Acknowledged'
      : triage?.assignedProviderId && triage.handoffStatus === 'assigned'
        ? 'Assigned'
        : inService
      ? 'In service'
      : entry ? 'Waiting' : assignmentLabel || statusLabel(row.status),
    queueText: entry ? STAGE_LABELS[entry.stage] : typeLabel(row.department),
    waitText: entry ? formatClockTime(entry.enteredStageAt) : row.appointment?.appointmentTime ? formatClockTime(row.appointment.appointmentTime) : '—',
    waitSubtext: entry
      ? waitLabel(entry.minutesWaiting)
      : appointmentRelative || row.appointment?.appointmentDate || 'Assigned list',
    statusSubtext: triage?.handoffStatus
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
  };
}

/** Which of the three worklist lanes (Scheduled / In Office / Finished) a row
 *  belongs in. A live queue entry (or being actively in service) promotes an
 *  otherwise-"scheduled" appointment status to In Office — a walk-in or
 *  triaged patient is physically here even when no desk ever checked them in. */
export function computeRowStatusGroup(status: AppointmentStatus, hasLiveQueueEntry: boolean): AppointmentStatusGroup {
  const group = appointmentStatusGroup(status);
  if (group !== 'scheduled') return group;
  return hasLiveQueueEntry ? 'in_office' : 'scheduled';
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

export default function EhrClinicalDashboard({
  clinicianName,
  patients,
  appointments: propAppointments,
  outstanding,
  activityItems,
  activitySeriesNames,
}: {
  clinicianName: string;
  patients: WorklistPatient[];
  appointments: AppointmentDoc[];
  outstanding: OutstandingItem[];
  /**
   * Week bars for the day-activity chart, when the role's week isn't made of
   * appointments. A nurse holds no schedule of their own, so deriving the
   * chart from `appointments` leaves it permanently empty — their week is
   * admissions and arrivals instead. Omit to keep the schedule-derived chart.
   */
  activityItems?: DayStatsItem[];
  activitySeriesNames?: [string, string];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const { showToast } = useToast();
  // "My queue" settings (design 11). Read live, so changing them in Settings
  // reorders this list without a reload.
  const queueSort = useRoleChoice('queue.sort', 'Longest wait first');
  const queueMineOnly = useRoleFlag('queue.mineOnly', true);
  const queueOverTarget = useRoleFlag('queue.overTarget', true);
  // Facility policy — the wait target every role's queue is measured against.
  const facilitySettings = useSettings();
  // Gate the "Start consultation" action to roles that can actually consult,
  // and the "Dispense" action (header button, patient search, and the modal
  // itself) to roles that can actually dispense — a pharmacist working this
  // dashboard is the only one who should ever reach the search/modal.
  const { canConsult, canBookAppointments, canDispense } = usePermissions();
  // Inpatient = the appointment's patient currently holds an active ward
  // admission; everyone else counts as outpatient (day-activity chart).
  const { activeAdmissions } = useWards();
  const admittedPatientIds = useMemo(() => new Set(activeAdmissions.map(admission => admission.patientId)), [activeAdmissions]);
  // Preferred language also lives on the patient record, not the appointment.
  const { patients: patientDocs } = usePatients();
  const patientLanguages = useMemo(() => {
    const map = new Map<string, string>();
    for (const patient of patientDocs) {
      if (patient.primaryLanguage) map.set(patient._id, patient.primaryLanguage);
    }
    return map;
  }, [patientDocs]);
  // Portraits for rows that come from an appointment rather than the assigned
  // worklist, so the same patient shows the same face on every surface.
  const photoByPatientId = useMemo(() => {
    const map = new Map<string, string>();
    for (const patient of patientDocs) {
      const photo = (patient as { photoUrl?: string }).photoUrl;
      if (photo) map.set(patient._id, photo);
    }
    return map;
  }, [patientDocs]);
  // The board renders the parent-assembled appointments prop, but a status
  // set from a row's pill must show up immediately — that write refreshes
  // THIS component's useAppointments instance, not the parent's assembly.
  // Overlay the live docs onto the prop list (matched by _id) so status and
  // timestamps are always current, while which appointments belong on the
  // board stays the parent's decision.
  const { appointments: liveAppointments, updateStatus: updateAppointmentStatus } = useAppointments();
  const appointments = useMemo(() => {
    if (liveAppointments.length === 0) return propAppointments;
    const liveById = new Map(liveAppointments.map(a => [a._id, a]));
    return propAppointments.map(a => liveById.get(a._id) || a);
  }, [propAppointments, liveAppointments]);
  const todayIso = useMemo(() => toIsoDate(new Date()), []);
  const selectedDate = clinicalDashboardDay(search, todayIso);
  const worklistFilter = clinicalDashboardLane(search);
  const outstandingView = searchParams.get('outstanding');
  const previewAppointmentId = searchParams.get('appointment');
  const openAppointment = previewAppointmentId
    ? appointments.find(appointment => appointment._id === previewAppointmentId) ?? null
    : null;
  const [view, setView] = useState<'dashboard' | 'calendar'>('dashboard');
  const [railOpen, setRailOpen] = useState(false);
  const previewHistoryIdRef = useRef<string | null>(null);

  const navigateDashboardState = useCallback((
    patch: ClinicalDashboardQueryPatch,
    mode: 'push' | 'replace' = 'push',
  ) => {
    const href = buildClinicalDashboardHref(pathname, search, patch);
    const currentHref = search ? `${pathname}?${search}` : pathname;
    if (href === currentHref) return;
    router[mode](href, { scroll: false });
  }, [pathname, router, search]);

  const selectDate = useCallback((day: string) => {
    navigateDashboardState({ day });
  }, [navigateDashboardState]);

  const selectWorklistLane = useCallback((lane: AppointmentStatusGroup, mode: 'push' | 'replace' = 'push') => {
    navigateDashboardState({ lane }, mode);
  }, [navigateDashboardState]);

  const openAppointmentPreview = useCallback((appointment: AppointmentDoc) => {
    previewHistoryIdRef.current = appointment._id;
    navigateDashboardState({ appointment: appointment._id });
  }, [navigateDashboardState]);

  const closeAppointmentPreview = useCallback(() => {
    if (previewAppointmentId && previewHistoryIdRef.current === previewAppointmentId) {
      previewHistoryIdRef.current = null;
      router.back();
      return;
    }
    navigateDashboardState({ appointment: null }, 'replace');
  }, [navigateDashboardState, previewAppointmentId, router]);

  // Keep even the default day/lane explicit so a copied URL and a returnTo
  // retain the exact clinical worklist rather than recalculating "today".
  useEffect(() => {
    if (searchParams.get('day') === selectedDate && searchParams.get('lane') === worklistFilter) return;
    navigateDashboardState({ day: selectedDate, lane: worklistFilter }, 'replace');
  }, [navigateDashboardState, searchParams, selectedDate, worklistFilter]);

  useEffect(() => {
    if (!previewAppointmentId) previewHistoryIdRef.current = null;
  }, [previewAppointmentId]);
  // Which action dropdown (if any) is open in the appointment detail popup.
  const [detailMenuOpen, setDetailMenuOpen] = useState<'note' | 'more' | null>(null);
  const noteMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // Close whichever action dropdown is open on an outside click.
  useEffect(() => {
    if (!detailMenuOpen) return;
    const handleClick = (event: MouseEvent) => {
      const ref = detailMenuOpen === 'note' ? noteMenuRef : moreMenuRef;
      if (ref.current && !ref.current.contains(event.target as Node)) setDetailMenuOpen(null);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [detailMenuOpen]);

  // A fresh appointment (or none) shouldn't inherit the previous one's open menu.
  useEffect(() => { setDetailMenuOpen(null); }, [openAppointment?._id]);

  const [calendarMonthOverride, setCalendarMonthOverride] = useState<{ selectedDate: string; month: Date } | null>(null);
  const calendarMonth = calendarMonthOverride?.selectedDate === selectedDate
    ? calendarMonthOverride.month
    : startOfMonth(parseIsoDate(selectedDate));
  const [locationFilter] = useState('all');
  const [providerFilter, setProviderFilter] = useState<string[]>([]);
  const [followUpToComplete, setFollowUpToComplete] = useState<OutstandingEntry | null>(null);
  const [followUpOutcome, setFollowUpOutcome] = useState<NonNullable<FollowUpDoc['outcome']>>('under_treatment');
  const [followUpNotes, setFollowUpNotes] = useState('');
  const [followUpSaving, setFollowUpSaving] = useState(false);

  // "Dispense" header action — searches the full patient register (not just
  // today's worklist), then opens that patient's prescriptions and dispensing
  // steps in a dialog over this page.
  const [findPatientOpen, setFindPatientOpen] = useState(false);
  const [findPatientQuery, setFindPatientQuery] = useState('');
  const [dispensePatient, setDispensePatient] = useState<{ id: string; name: string } | null>(null);
  // "Book appointment" — the booking form as a dialog; it used to route to
  // /appointments?new=1 and leave the clinician on the schedule module.
  const [bookingOpen, setBookingOpen] = useState(false);
  // "Print" — choose which lanes and which output (paper/PDF or CSV) instead
  // of window.print()'s whole-dashboard dump.
  const [printOpen, setPrintOpen] = useState(false);
  // Inline search under the mini-calendar that filters the day's appointment list.
  const [appointmentSearch, setAppointmentSearch] = useState('');
  const findPatientInputRef = useRef<HTMLInputElement>(null);
  // Modal renders its children a tick after open (portal mount) and then
  // focuses its dialog, so autoFocus — and a 0ms refocus — both lose the
  // race. Focus the input once the dialog has settled.
  useEffect(() => {
    if (!findPatientOpen) return;
    const id = window.setTimeout(() => findPatientInputRef.current?.focus(), 120);
    return () => window.clearTimeout(id);
  }, [findPatientOpen]);

  const findPatientResults = useMemo(() => {
    const query = findPatientQuery.trim().toLowerCase();
    if (!query) return [];
    return patientDocs
      .filter(patient => {
        const name = [patient.firstName, patient.middleName, patient.surname].filter(Boolean).join(' ').toLowerCase();
        return (
          name.includes(query) ||
          patient.hospitalNumber?.toLowerCase().includes(query) ||
          patient.phone?.toLowerCase().includes(query)
        );
      })
      .slice(0, 8);
  }, [findPatientQuery, patientDocs]);

  const openFoundPatient = (patient: (typeof findPatientResults)[number]) => {
    setFindPatientOpen(false);
    // Their prescriptions and the dispensing steps open here, over the
    // worklist — the pharmacy workbench was a whole role dashboard loaded to
    // answer one question about one patient.
    const name = [patient.firstName, patient.middleName, patient.surname].filter(Boolean).join(' ');
    setDispensePatient({ id: patient._id, name });
  };

  const activeOutstanding = outstandingView
    ? outstanding.find(item => item.label === outstandingView) ?? null
    : null;

  // The rail search stays mounted over the outstanding drill-down, so it has
  // to filter this list too — otherwise typing there silently does nothing.
  const visibleOutstandingEntries = useMemo(() => {
    const entries = activeOutstanding?.entries ?? [];
    const q = appointmentSearch.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(entry =>
      [entry.title, entry.subtitle, entry.meta].some(value => value?.toLowerCase().includes(q)));
  }, [activeOutstanding, appointmentSearch]);

  const openOutstanding = (item: OutstandingItem) => {
    setView('dashboard');
    navigateDashboardState({ outstanding: outstandingView === item.label ? null : item.label });
    setRailOpen(false);
  };

  const openPatientRecord = (appointment: AppointmentDoc) => {
    const patientId = appointment.patientId || patients.find(patient => patient.name === appointment.patientName)?._id;
    if (patientId) {
      router.push(`/patients/${patientId}`);
    } else {
      // Both the direct id and the name-match fallback failed — say so
      // instead of silently doing nothing.
      showToast(`No patient record found for ${appointment.patientName}`, 'error');
    }
  };

  const openOutstandingEntry = (entry: OutstandingEntry) => {
    const appointment = appointments.find(a => a._id === entry.id);
    if (entry.href) { router.push(entry.href); return; }
    // No href — never let the click dead-end: open the matching appointment,
    // else the patient's chart (resolved by name), else say so out loud.
    if (appointment) { openAppointmentPreview(appointment); return; }
    const patientId = patients.find(patient => patient.name === entry.title)?._id;
    if (patientId) { router.push(`/patients/${patientId}`); return; }
    showToast(`Couldn't open “${entry.title}”`, 'error');
  };

  const handleOutstandingAction = (entry: OutstandingEntry) => {
    if (entry.actionKind === 'complete-follow-up') {
      setFollowUpToComplete(entry);
      setFollowUpOutcome('under_treatment');
      setFollowUpNotes('');
      return;
    }
    if (entry.actionHref) {
      router.push(entry.actionHref);
      return;
    }
    openOutstandingEntry(entry);
  };

  const completeFollowUp = async () => {
    if (!followUpToComplete) return;
    setFollowUpSaving(true);
    try {
      const { updateFollowUp } = await import('@/lib/services/follow-up-service');
      const updated = await updateFollowUp(followUpToComplete.id, {
        status: 'completed',
        outcome: followUpOutcome,
        completedDate: toIsoDate(new Date()),
        notes: followUpNotes.trim() || undefined,
      });
      if (!updated) throw new Error('Could not update follow-up');
      showToast('Follow-up completed', 'success');
      setFollowUpToComplete(null);
    } catch {
      showToast('Could not complete follow-up', 'error');
    } finally {
      setFollowUpSaving(false);
    }
  };

  const providerOptions = useMemo(() => {
    const names = [clinicianName, ...appointments.map(appointment => appointment.providerName)]
      .filter((name): name is string => Boolean(name));
    return Array.from(new Set(names));
  }, [appointments, clinicianName]);

  useEffect(() => {
    setProviderFilter(current => {
      const active = current.filter(provider => providerOptions.includes(provider));
      if (active.length === providerOptions.length) return active;
      if (current.length > 0 && active.length > 0) return active;
      return providerOptions;
    });
  }, [providerOptions]);

  useEffect(() => {
    // Calendar view was removed — the dashboard is the only view for all users.
    setView('dashboard');
  }, [searchParams]);

  const matchesProviderFilter = useCallback((appointment: AppointmentDoc) => {
    if (providerOptions.length === 0 || providerFilter.length === 0) return true;
    return providerFilter.includes(appointment.providerName || clinicianName);
  }, [clinicianName, providerFilter, providerOptions.length]);

  const appointmentCounts = useMemo(() => {
    return appointments.reduce<Map<string, number>>((counts, appointment) => {
      if (locationFilter !== 'all' && appointment.facilityName !== locationFilter) return counts;
      if (!matchesProviderFilter(appointment)) return counts;
      counts.set(appointment.appointmentDate, (counts.get(appointment.appointmentDate) || 0) + 1);
      return counts;
    }, new Map());
  }, [appointments, locationFilter, matchesProviderFilter]);

  const calendarCells = useMemo(() => {
    const monthStart = startOfMonth(calendarMonth);
    const gridStart = addDays(monthStart, -monthStart.getDay());
    // Only as many week rows as the month needs (design shows no trailing
    // blank week — July 2026 renders 5 rows, not a fixed 6).
    const daysInMonth = addDays(startOfMonth(addMonths(monthStart, 1)), -1).getDate();
    const weekCount = Math.ceil((monthStart.getDay() + daysInMonth) / 7);
    return Array.from({ length: weekCount * 7 }).map((_, index) => {
      const date = addDays(gridStart, index);
      const iso = toIsoDate(date);
      return {
        iso,
        day: date.getDate(),
        inMonth: date.getMonth() === calendarMonth.getMonth(),
        isToday: iso === todayIso,
        isSelected: iso === selectedDate,
        count: appointmentCounts.get(iso) || 0,
      };
    });
  }, [appointmentCounts, calendarMonth, selectedDate, todayIso]);

  // Provider/location-scoped but NOT date-scoped — the day-activity chart
  // needs adjacent days too, for its two-day comparison.
  const filteredAppointments = useMemo(() => (
    appointments
      .filter(appointment => locationFilter === 'all' || appointment.facilityName === locationFilter)
      .filter(matchesProviderFilter)
  ), [appointments, locationFilter, matchesProviderFilter]);

  const selectedAppointmentsForDay = useMemo(() => {
    return filteredAppointments
      .filter(appointment => appointment.appointmentDate === selectedDate)
      .sort((a, b) => (a.appointmentTime || '').localeCompare(b.appointmentTime || ''));
  }, [filteredAppointments, selectedDate]);

  const appointmentQuery = appointmentSearch.trim().toLowerCase();
  const unifiedPatientRows = useMemo<UnifiedPatientRow[]>(() => buildUnifiedPatientRows({
    patients, selectedAppointmentsForDay, photoByPatientId, clinicianName,
    sortMode: queueSort, mineOnly: queueMineOnly,
  }), [clinicianName, patients, photoByPatientId, selectedAppointmentsForDay, queueSort, queueMineOnly]);
  const visiblePatientRows = unifiedPatientRows.filter(row => {
    // Assigned patients without a scheduled appointment belong to today's
    // worklist. Appointment-backed rows follow the selected calendar day.
    const rowDate = row.appointment?.appointmentDate || todayIso;
    if (rowDate !== selectedDate) return false;
    return !appointmentQuery ||
      [row.name, row.reason, row.timeLabel, row.department, row.provider, row.status]
        .some(value => value?.toLowerCase().includes(appointmentQuery));
  });

  // ── Live queue state behind the worklist columns ──
  // Coming from / Queue / Wait time derive from the patient's active triage
  // record via the acuity-weighted, time-aged queue builder. Scoped to the
  // last 24 hours (older docs are unclosed visits, not waiting patients) and
  // deduped to the newest record per patient.
  const { currentUser } = useAuth();
  const { triages, update: updateTriageDoc } = useTriage();
  // Same gate the chart's forms panel uses: triage capture is a route grant,
  // not a permission flag — doctors and the whole nurse family hold /triage.
  const canTriage = isPathAllowed(currentUser?.role || '', '/triage');
  // Nurse-family users read this worklist as ward admissions, rooming
  // arrivals and triaged walk-ins — never "patients assigned to you" — so the
  // empty state has to speak that language or an empty ward reads as a bug.
  const isNurseFamily = currentUser?.role === 'nurse' || currentUser?.role === 'midwife'
    || currentUser?.role === 'triage_nurse' || currentUser?.role === 'rooming_nurse';

  // Quick links in the header strip.
  // Deliberately the destinations the top rail does NOT already carry: the rail
  // keeps four shortcuts, so repeating them here would spend the widest row on
  // the page on buttons that already exist two centimetres above it. These are
  // the next ones down the same priority order, which for a clinician is where
  // Referrals/Wards land and for a nurse the ward-side pages.
  const quickNavItems = useMemo(() => {
    const roleConfig = currentUser ? getRoleConfig(currentUser.role) : null;
    if (!roleConfig) return [];
    const navItems = uniqueAllowedNavItems(roleConfig.navItems || [], roleConfig.allowedRoutes || []);
    return getPageHeaderNavItems(navItems, currentUser?.role, roleConfig.defaultDashboard || '/dashboard');
  }, [currentUser]);
  // "Create clinical note" on a visit card — the appointment already carries
  // the patient, provider and date the note header needs.
  const { createNote, creating: creatingNote } = useCreateNote(currentUser);

  // Wall-clock sampled in an effect (render stays pure) and refreshed once a
  // minute so wait times and the time-aged scores keep aging on screen. Every
  // consumer below (the 24h active-triage window, minutesWaiting/score via
  // buildQueueFromTriage, and the appointment countdown text) is floor'd to
  // minutes already, so a 60s tick keeps them accurate without re-rendering
  // this ~2,100-line dashboard every second. The one sub-minute reader —
  // formatAppointmentTimeUntil's "in Ns" text for a not-yet-arrived
  // appointment inside its final minute — only shows that precision in a
  // ≤60s window and isn't the queue's live-wait signal, so it ages on the
  // same 60s tick rather than justifying a separate fast-ticking leaf.
  const [queueNowMs, setQueueNowMs] = useState<number | null>(null);
  useEffect(() => {
    setQueueNowMs(Date.now());
    const timer = setInterval(() => setQueueNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const activeTriageByPatient = useMemo(
    () => buildActiveTriageByPatient(triages, queueNowMs),
    [triages, queueNowMs],
  );
  const queueEntryByPatient = useMemo(
    () => buildQueueEntryByPatient(activeTriageByPatient),
    [activeTriageByPatient],
  );
  // Unwindowed: supplies the visit panel's vitals when the patient has no
  // active triage (an inpatient's arrival ETAT, a returning patient's last
  // visit). Never feeds the queue — see buildLatestTriageByPatient.
  const latestTriageByPatient = useMemo(() => buildLatestTriageByPatient(triages), [triages]);

  // Worklist column values for one row, from its queue entry when the patient
  // has arrived and from the appointment alone when they haven't.
  const rowQueueColumns = (row: UnifiedPatientRow) => computeRowQueueColumns(
    row,
    row.patientId ? queueEntryByPatient.get(row.patientId) ?? null : null,
    row.patientId ? activeTriageByPatient.get(row.patientId) ?? null : null,
    queueNowMs,
    { enabled: queueOverTarget, targetMinutes: facilitySettings.clinicalPolicy.doorToClinicianMinutes },
  );

  // Daybar filter pills — the shared three-lane vocabulary every role
  // dashboard uses: Scheduled (booked/assigned, patient not with us yet),
  // In Office (in the building: live queue entry, checked in, or in service),
  // Finished (visit closed — checked out, cancelled, no-show, rescheduled).
  const rowStatusGroup = (row: UnifiedPatientRow): AppointmentStatusGroup => {
    // A live queue entry means the patient is physically here even when the
    // appointment rung still says scheduled/arrived (walk-ins, triage).
    const columns = rowQueueColumns(row);
    return computeRowStatusGroup(row.status, Boolean(columns.entry) || columns.inService);
  };
  const groupCounts = tallyByStatusGroup(visiblePatientRows, rowStatusGroup);
  const filteredPatientRows = visiblePatientRows.filter(row => rowStatusGroup(row) === worklistFilter);

  // The print dialog's choices: each lane as a pure text list, derived through
  // the same rowQueueColumns as the on-screen table so paper matches screen.
  // Built only while the dialog is open.
  const printSections: PrintListSection[] = printOpen ? APPOINTMENT_STATUS_GROUPS.map(group => ({
    key: group,
    label: APPOINTMENT_STATUS_GROUP_LABELS[group],
    columns: [
      { key: 'patient', label: 'Patient' },
      { key: 'reason', label: 'Reason' },
      { key: 'time', label: 'Time' },
      { key: 'careTeam', label: 'Care team' },
      { key: 'context', label: 'Context' },
      { key: 'status', label: 'Status' },
    ],
    rows: visiblePatientRows.filter(row => rowStatusGroup(row) === group).map(row => {
      const columns = rowQueueColumns(row);
      return {
        patient: row.name,
        reason: row.reason || '',
        time: [columns.waitText, columns.waitSubtext].filter(Boolean).join(' · '),
        careTeam: [columns.careTeamPrimary, columns.careTeamSecondary].filter(Boolean).join(' · '),
        context: [columns.queueText, columns.comingFrom].filter(Boolean).join(' · '),
        status: [columns.statusText, columns.statusSubtext].filter(Boolean).join(' · '),
      };
    }),
  })) : [];

  // Row popup (visit info + actions) and the Move dialog it can open.
  const [visitRow, setVisitRow] = useState<UnifiedPatientRow | null>(null);


  // A visit opened from the alert rail may belong to a lane the worklist is
  // filtered away from — the panel would then expand a row nobody can see. So
  // opening a row jumps to that row's lane and scrolls it into view.
  //
  // Keyed on the row id, and only once per row: re-running it whenever the
  // filter changed made the lane tabs unusable. Choosing another lane hid the
  // open row, which this read as "the row is not visible" and snapped the
  // filter straight back — so with a row expanded, the tabs did nothing.
  const visitRowGroup = visitRow ? rowStatusGroup(visitRow) : null;
  const followedRowId = useRef<string | null>(null);
  useEffect(() => {
    if (!visitRow || !visitRowGroup) { followedRowId.current = null; return; }
    if (followedRowId.current === visitRow.id) return;
    followedRowId.current = visitRow.id;
    selectWorklistLane(visitRowGroup, 'replace');
    // Let the lane switch paint before scrolling to the row inside it.
    requestAnimationFrame(() => {
      document.getElementById(`worklist-row-${visitRow.id}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, [selectWorklistLane, visitRow, visitRowGroup]);

  const [moveEntry, setMoveEntry] = useState<QueueEntry | null>(null);
  const [moveSaving, setMoveSaving] = useState(false);

  // Doctor-side clinical dispositions (KAN-100 follow-through). Escalation and
  // LWBS were nurse-only — a doctor watching a patient deteriorate in their
  // own worklist had no way to record either. Both mirror the triage doc the
  // way the triage station does, so the (triage-derived) queues stay honest.
  const escalateVisit = async (triage: TriageDoc) => {
    if (!triage.encounterId) return;
    if (!window.confirm(`Escalate ${triage.patientName} to emergency care?`)) return;
    try {
      const { getEncounter, transitionEncounter, escalateEncounterToEmergency } =
        await import('@/lib/services/encounter-service');
      // The machine deliberately has no awaiting_triage → escalated edge: an
      // escalation asserts an assessment. The clinician pressing this button
      // IS assessing the patient, so a still-queued visit is taken into
      // triage first — the one legal hop — under that clinician's name.
      const enc = await getEncounter(triage.encounterId);
      if (enc?.status === 'awaiting_triage') {
        await transitionEncounter(triage.encounterId, 'in_triage', {
          actorId: currentUser?._id, actorRole: currentUser?.role,
        });
      }
      await escalateEncounterToEmergency(triage.encounterId, { actorId: currentUser?._id });
      await updateTriageDoc(triage._id, { status: 'referred' });
      showToast(`${triage.patientName} escalated to emergency care.`, 'success');
      setVisitRow(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not escalate this visit.', 'error');
    }
  };

  const markVisitLwbs = async (triage: TriageDoc) => {
    if (!triage.encounterId) return;
    if (!window.confirm(`Record that ${triage.patientName} left without being seen?`)) return;
    try {
      const { recordLeftWithoutBeingSeen } = await import('@/lib/services/encounter-service');
      await recordLeftWithoutBeingSeen(triage.encounterId, { actorId: currentUser?._id });
      await updateTriageDoc(triage._id, { status: 'lwbs' });
      showToast(`${triage.patientName} recorded as left without being seen.`, 'success');
      setVisitRow(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not record the departure.', 'error');
    }
  };

  const acknowledgeTriage = async (triage: TriageDoc) => {
    if (!currentUser) return;
    try {
      const updated = await updateTriageDoc(triage._id, {
        handoffStatus: 'acknowledged',
        acknowledgedAt: new Date().toISOString(),
        acknowledgedBy: currentUser._id,
        acknowledgedByName: currentUser.name,
        handoffTo: currentUser._id,
        handoffToName: currentUser.name,
        status: 'seen',
      });
      if (!updated) throw new Error('The triage handoff could not be updated.');
      showToast(`${triage.patientName} handoff acknowledged.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not acknowledge this handoff.', 'error');
    }
  };

  // Call = take the patient now: record the handoff on the triage doc (the
  // row flips to "In service" for every station) and open the consultation.
  const callPatient = async (row: UnifiedPatientRow) => {
    if (!row.patientId) return;
    const patientAssignment = row.patient;
    try {
      const { updatePatient } = await import('@/lib/services/patient-service');
      await updatePatient(row.patientId, buildClaimUpdate(patientAssignment, currentUser));
    } catch {
      // The queue handoff and consultation can still proceed if the patient
      // cache is temporarily unavailable; the event is retried by sync.
    }
    const entry = queueEntryByPatient.get(row.patientId);
    if (entry && currentUser && (!entry.assignedToId || entry.assignedToId === currentUser._id)) {
      await updateTriageDoc(entry.triageId, {
        handoffTo: currentUser._id,
        handoffToName: currentUser.name,
        handoffAt: new Date().toISOString(),
        // A clinician has laid eyes on the patient — same convention the
        // triage station uses. Without it, pending-gated actions (escalate,
        // LWBS) stayed offered on a patient already in consultation.
        status: 'seen',
        handoffStatus: 'in_consultation',
      });
    }
    try {
      const { ensureConsultationProgress, assignProgressOwner, updateProgressStage } = await import('@/lib/services/consultation-progress-service');
      const tracker = await ensureConsultationProgress({
        patientId: row.patientId,
        patientName: row.name,
        hospitalId: currentUser?.hospitalId || '',
        hospitalName: currentUser?.hospital?.name || currentUser?.hospitalName || '',
        orgId: currentUser?.orgId,
        appointmentId: row.appointment?._id,
        actor: { id: currentUser?._id, name: currentUser?.name, role: currentUser?.role },
      });
      await assignProgressOwner(tracker._id, {
        id: currentUser?._id,
        name: currentUser?.name,
        role: currentUser?.role,
      }, { id: currentUser?._id, name: currentUser?.name, role: currentUser?.role });
      await updateProgressStage(tracker._id, 'in_progress', {
        id: currentUser?._id,
        name: currentUser?.name,
        role: currentUser?.role,
      }, 'Complete the consultation assessment');
    } catch {
      // Tracker updates must not block opening the clinical encounter.
    }

    // Move the VISIT, not just the tracker.
    //
    // Calling a patient used to advance `ConsultationProgressDoc` alone and
    // leave `EncounterDoc` wherever rooming had parked it. The encounter is
    // what every queue, gate and discharge path reads, so a visit that reached
    // the clinician still looked un-started to the rest of the building: the
    // facility-checkout queue never filled, `dischargeEncounter` had nothing
    // legal to walk, and the stale open encounter went on absorbing the same
    // patient's next arrival for 24 hours.
    //
    // `advanceEncounterToClinician` picks the encounter up wherever it sits and
    // walks the legal chain, so a patient called straight from the waiting room
    // and one called after rooming both end at `with_clinician` with an honest
    // history. An encounter already there, or clinically diverted (escalated,
    // admitted), is returned untouched.
    try {
      const { findOpenEncounterForPatient, advanceEncounterToClinician } =
        await import('@/lib/services/encounter-service');
      const open = await findOpenEncounterForPatient(row.patientId, currentUser?.hospitalId || '');
      if (open) {
        await advanceEncounterToClinician(open._id, {
          clinicianId: currentUser?._id,
          clinicianName: currentUser?.name,
          actorId: currentUser?._id,
        });
      }
    } catch {
      // A visit thread that cannot be advanced must not stop the clinician
      // seeing the patient; the consultation opens either way and the desk can
      // correct the queue.
    }

    router.push(`/consultation?patientId=${row.patientId}`);
  };

  const handleMove = async (change: { stage: QueueEntry['stage'] | null; priority: QueueEntry['acuity']; room: string; comment: string }) => {
    if (!moveEntry || !currentUser) return;
    setMoveSaving(true);
    try {
      const doc = triages.find(triage => triage._id === moveEntry.triageId);
      const updates: Partial<TriageDoc> = {};
      if (change.stage && change.stage !== moveEntry.stage) {
        // pending→seen is the only status hop these destinations need; the
        // room field is what separates rooming from consultation.
        if (doc?.status === 'pending') updates.status = 'seen';
        updates.assignedRoom = change.stage === 'awaiting_consultation' ? change.room : '';
      }
      if (change.priority !== moveEntry.acuity) updates.priority = change.priority;
      if (change.comment) {
        const stamp = `${new Date().toISOString().slice(0, 16).replace('T', ' ')} ${currentUser.name}`;
        updates.notes = [doc?.notes, `[Queue ${stamp}] ${change.comment}`].filter(Boolean).join('\n');
      }
      const updated = await updateTriageDoc(moveEntry.triageId, updates);
      if (!updated) {
        showToast('Move failed — the triage record could not be updated.', 'error');
        return;
      }
      showToast(`${moveEntry.patientName} updated in the queue.`, 'success');
      setMoveEntry(null);
    } finally {
      setMoveSaving(false);
    }
  };
  const dashboardReturnTo = search ? `${pathname}?${search}` : pathname;
  const openFullAppointmentHref = openAppointment
    ? buildClinicalAppointmentHref(openAppointment._id, dashboardReturnTo)
    : '/appointments';
  // Compact doctor-facing appointment popup. The scheduler owns the full
  // appointment record; clinicians need the clinical next step.
  const appointmentPanel = openAppointment ? (
    <div
      className="modal-panel modal-panel--md appointment-detail-panel appointment-detail-panel--clinical"
    >
      <div className="appointment-detail-modal__header">
        <div className="appointment-detail-modal__header-row">
          <div>
            <h2 id="appointment-clinical-title" className="appointment-detail-modal__time">{openAppointment.patientName}</h2>
            <p className="appointment-detail-modal__reason">{openAppointment.reason || typeLabel(openAppointment.appointmentType)}</p>
          </div>
          <div className="appointment-detail-modal__header-right">
            {/* Display-only: the appointment editor's Status & billing tab
                is the one place a booking changes, for every role. */}
            <span className={`appointment-status-pill ${APPOINTMENT_STATUS_TONES[openAppointment.status]}`}>
              {statusLabel(openAppointment.status)}
            </span>
            <button type="button" className="appointment-detail-modal__close" onClick={closeAppointmentPreview} aria-label="Close appointment details">
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="appointment-detail-modal__subrow">
          <span>{appointmentTimeRange(openAppointment)}</span>
          <span>{openAppointment.department || 'OPD'}</span>
          <span className="appointment-detail-modal__priority-badge">{typeLabel(openAppointment.priority)}</span>
        </div>
      </div>

      <div className="appointment-detail-modal__body" role="tabpanel">
        <EhrWorkItemProgress
          status={statusLabel(openAppointment.status)}
          owner={openAppointment.providerName || clinicianName || 'Unassigned'}
          waiting={appointmentTimeRange(openAppointment)}
          timeLabel="Visit time"
          nextAction={canConsult && openAppointment.patientId ? 'Start consultation' : 'Open patient record'}
        />
        <div className="appointment-detail-modal__summary-grid">
          {[
            { label: 'Visit', value: openAppointment.appointmentType === 'walk_in' ? 'Walk-in' : 'In office' },
            { label: 'Date', value: formatAppointmentDate(openAppointment.appointmentDate) },
            { label: 'Provider', value: openAppointment.providerName || clinicianName || 'Unassigned' },
            { label: 'Language', value: patientLanguages.get(openAppointment.patientId) || 'Not recorded' },
          ].map(row => <DetailRow key={row.label} label={row.label} value={row.value} />)}
        </div>

        <div className="appointment-doctor-next">
          <h3>Doctor next steps</h3>
          <ul>
            <li><Check className="w-4 h-4" /> Confirm the patient is ready to be seen.</li>
            <li><Check className="w-4 h-4" /> Review the reason for visit and any intake note.</li>
            <li><Check className="w-4 h-4" /> Start the consultation and document the clinical note.</li>
          </ul>
        </div>
      </div>

      <div className="appointment-detail-modal__actions">
        {canConsult && openAppointment.patientId ? (
          <div className="appointment-detail-modal__split" ref={noteMenuRef}>
            <button
              type="button"
              className="btn btn-primary btn-sm appointment-detail-modal__split-main"
              title="Create clinical note"
              onClick={() => router.push(`/consultation?patientId=${encodeURIComponent(openAppointment.patientId)}`)}
            >
              <Stethoscope className="w-4 h-4" /> <span className="appointment-detail-modal__btn-label">Start Consultation</span>
            </button>
            <button
              type="button"
              className="appointment-detail-modal__split-toggle"
              aria-label="More clinical note options"
              aria-expanded={detailMenuOpen === 'note'}
              onClick={() => setDetailMenuOpen(current => (current === 'note' ? null : 'note'))}
            >
              {detailMenuOpen === 'note' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {detailMenuOpen === 'note' && (
              <div className="appointment-detail-modal__menu">
                <button
                  type="button"
                  onClick={() => { setDetailMenuOpen(null); router.push(`/consultation?patientId=${encodeURIComponent(openAppointment.patientId)}`); }}
                >
                  <Stethoscope size={14} /> Start consultation
                </button>
                <button type="button" onClick={() => { setDetailMenuOpen(null); openPatientRecord(openAppointment); }}>
                  <ClipboardList size={14} /> Open patient record
                </button>
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => openPatientRecord(openAppointment)}
          >
            Open patient record
          </button>
        )}
        <div className="appointment-detail-modal__split" ref={moreMenuRef}>
          <button
            type="button"
            className="appointment-detail-modal__more-toggle"
            title="More options"
            aria-expanded={detailMenuOpen === 'more'}
            onClick={() => setDetailMenuOpen(current => (current === 'more' ? null : 'more'))}
          >
            <MoreVertical size={16} /> <span className="appointment-detail-modal__btn-label">More</span> {detailMenuOpen === 'more' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {detailMenuOpen === 'more' && (
            <div className="appointment-detail-modal__menu appointment-detail-modal__menu--right">
              <button
                type="button"
                onClick={() => { setDetailMenuOpen(null); router.push(openFullAppointmentHref); }}
              >
                <Calendar size={14} /> Open full page
              </button>
              <button type="button" onClick={() => { setDetailMenuOpen(null); window.print(); }}>
                <Printer size={14} /> Print appointment
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="ehr-schedule-shell">
      <section className="ehr-schedule-header ehr-clinical-dashboard-header">
        <div className="ehr-clinical-dashboard-tabs">
          {canBookAppointments && (
            <div className="ehr-segmented ehr-segmented-single">
              <button type="button" className="active" aria-label="Book appointment" onClick={() => setBookingOpen(true)}>
                <Plus className="w-4 h-4" /> Book appointment
              </button>
            </div>
          )}
        </div>
        <div className="ehr-schedule-primary-controls ehr-clinical-dashboard-header-main">
          <div className="ehr-greeting-row">
            <div className="ehr-care-header-copy">
              {/* The design greets with the short name — "Welcome, Dr. Wani",
                  never the full legal name — over a small-caps role line. */}
              <p className="ehr-care-greeting">Welcome, {abbreviateProviderName(clinicianName)}</p>
              {/* This shell is shared by every clinical role (doctors,
                  clinicians and nurse-family roles alike) — the role line
                  under the greeting has to name the signed-in user's actual
                  role rather than assume "Doctor". */}
              <p className="ehr-care-greeting-sub">
                {currentUser ? `${getRoleConfig(currentUser.role).label} · Clinical workspace` : 'Clinical workspace'}
              </p>
            </div>
          </div>
        </div>
        <div className="ehr-schedule-actions">
          {canDispense && (
            <button
              type="button"
              aria-label="Dispense"
              onClick={() => { setFindPatientQuery(''); setFindPatientOpen(true); }}
            >
              <Pill className="w-4 h-4" /> Dispense
            </button>
          )}
          {quickNavItems.map(item => {
            const ItemIcon = item.icon;
            return (
              <button
                key={item.href}
                type="button"
                aria-label={item.label}
                onClick={() => router.push(item.href)}
              >
                <ItemIcon className="w-4 h-4" /> {item.label}
              </button>
            );
          })}
          <button
            type="button"
            aria-label="Print worklist"
            onClick={() => setPrintOpen(true)}
          >
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
      </section>

      <section className={`ehr-workspace-grid ${view === 'dashboard' ? 'is-dashboard' : 'is-calendar'}`}>
        <aside className="ehr-left-rail">
          <div className="ehr-mini-calendar">
            {/* The design anchors the calendar card with a full-width "Go to
                today" — one press home from any month the rail has wandered
                to. */}
            <button
              type="button"
              className="ehr-mini-calendar-goto"
              onClick={() => {
                selectDate(todayIso);
                setCalendarMonthOverride(null);
              }}
            >
              <Calendar size={15} /> Go to today
            </button>
            <div className="ehr-mini-calendar-title">
              <button
                type="button"
                onClick={() => setCalendarMonthOverride(current => ({
                  selectedDate,
                  month: addMonths(current?.selectedDate === selectedDate ? current.month : startOfMonth(parseIsoDate(selectedDate)), -1),
                }))}
                aria-label="Previous month"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span>{formatMonthTitle(calendarMonth)}</span>
              <button
                type="button"
                onClick={() => setCalendarMonthOverride(current => ({
                  selectedDate,
                  month: addMonths(current?.selectedDate === selectedDate ? current.month : startOfMonth(parseIsoDate(selectedDate)), 1),
                }))}
                aria-label="Next month"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <div className="ehr-mini-calendar-grid">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <b key={`${day}-${index}`}>{day}</b>)}
              {calendarCells.map(cell => (
                <button
                  key={cell.iso}
                  type="button"
                  data-date={cell.iso}
                  className={[
                    cell.isToday ? 'today' : '',
                    cell.isSelected ? 'selected' : '',
                    !cell.inMonth ? 'muted' : '',
                    cell.count > 0 ? 'has-events' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => {
                    selectDate(cell.iso);
                    setCalendarMonthOverride(null);
                  }}
                  aria-label={`${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(parseIsoDate(cell.iso))}${cell.count ? `, ${cell.count} appointment${cell.count === 1 ? '' : 's'}` : ''}`}
                  aria-pressed={cell.isSelected}
                >
                  <span>{cell.day}</span>
                </button>
              ))}
            </div>
          </div>

          <DayActivityChart
            appointments={filteredAppointments}
            items={activityItems}
            seriesNames={activitySeriesNames}
            selectedDate={selectedDate}
            todayIso={todayIso}
            admittedPatientIds={admittedPatientIds}
            onSelectDate={iso => {
              selectDate(iso);
              setCalendarMonthOverride(null);
            }}
          />

          {/* The design's third rail card: the day's list split by acuity —
              the same ring the reception rail draws by stage, fed here by the
              triage colours of the doctor's own list, so the ring and the row
              plates can never disagree. */}
          <EhrStageDonut
            title="Today by acuity"
            centerLabel="on list"
            segments={[
              { name: 'Emergency', value: visiblePatientRows.filter(row => row.triagePriority === 'RED').length, color: '#9E1B14' },
              { name: 'Urgent', value: visiblePatientRows.filter(row => row.triagePriority === 'YELLOW').length, color: '#B35900' },
              { name: 'Routine', value: visiblePatientRows.filter(row => row.triagePriority !== 'RED' && row.triagePriority !== 'YELLOW').length, color: '#0A6E4A' },
            ]}
          />
        </aside>

        <main className="ehr-center-panel">
          {view === 'dashboard' && activeOutstanding ? (
            <>
              <div className="ehr-daybar">
                <h2 className="ehr-outstanding-title">
                  <button
                    type="button"
                    className="ehr-outstanding-back"
                    onClick={() => navigateDashboardState({ outstanding: null })}
                  >
                    <ChevronLeft className="w-4 h-4" /> Schedule
                  </button>
                  {activeOutstanding.label}
                </h2>
                <div className="ehr-day-tabs">
                  <button type="button" className="active">
                    {appointmentQuery
                      ? `${visibleOutstandingEntries.length} of ${activeOutstanding.count}`
                      : `${activeOutstanding.count} ${activeOutstanding.count === 1 ? 'item' : 'items'}`}
                  </button>
                  {activeOutstanding.href && (
                    <button type="button" onClick={() => router.push(withReturnTo(activeOutstanding.href!, dashboardReturnTo))}>
                      Open full page
                    </button>
                  )}
                </div>
              </div>

              <div className="ehr-appointment-list">
                {visibleOutstandingEntries.length === 0 && (
                  <div className="ehr-empty-state">
                    <ClipboardList className="w-8 h-8" />
                    <strong>{appointmentQuery ? 'Nothing matches your search' : 'Nothing outstanding'}</strong>
                    <span>
                      {appointmentQuery
                        ? `No ${activeOutstanding.label.toLowerCase()} items match “${appointmentSearch.trim()}”.`
                        : `${activeOutstanding.label} is clear — no items need your attention.`}
                    </span>
                    {appointmentQuery
                      ? <button type="button" onClick={() => setAppointmentSearch('')}>Clear search</button>
                      : <button type="button" onClick={() => navigateDashboardState({ outstanding: null })}>Back to schedule</button>}
                  </div>
                )}

                {visibleOutstandingEntries.length > 0 && (
                  <div className="ehr-queue-scroll">
                    <div className="ehr-queue-cards ehr-queue-cards--compact">
                      {visibleOutstandingEntries.map(entry => {
                        const pill = outstandingPillTone(entry.tone);
                        return (
                          <div
                            key={entry.id}
                            className="ehr-queue-card ehr-queue-card--compact"
                            data-triage={outstandingTonePriority(entry.tone)}
                            role="button"
                            tabIndex={0}
                            onClick={() => openOutstandingEntry(entry)}
                            onKeyDown={event => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                openOutstandingEntry(entry);
                              }
                            }}
                          >
                            <div className="ehr-queue-patient">
                              <span
                                className="ehr-patient-icon"
                                data-acuity={outstandingTonePriority(entry.tone)}
                              >
                                {initials(entry.title)}
                              </span>
                              <div className="ehr-queue-patient-text">
                                <button type="button" className="ehr-queue-name" onClick={event => { event.stopPropagation(); openOutstandingEntry(entry); }}>
                                  {entry.title}
                                </button>
                                {entry.subtitle && <p>{entry.subtitle}</p>}
                              </div>
                            </div>

                            <div className="ehr-queue-cell ehr-queue-muted-cell">{entry.meta || '—'}</div>

                            <div className="ehr-queue-cell">
                              <span className="ehr-queue-pill" data-tone={pill.key}>{pill.label}</span>
                            </div>
                            {entry.actionLabel && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={event => { event.stopPropagation(); handleOutstandingAction(entry); }}
                              >
                                {entry.actionLabel}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
	          <div className="ehr-daybar">
	            {/* The design's queue head: the day itself is the title
	                ("Thursday, August 13"), the list is described under it, the
	                search sits over the table it filters, the lanes hang right. */}
	            <div>
	              <h2>
	                {new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(parseIsoDate(selectedDate))}
	              </h2>
	            </div>
	            <div className="ehr-queue-search">
	              <Search className="ehr-queue-search-icon w-4 h-4" />
	              <input
	                type="search"
	                placeholder="Search appointments"
	                aria-label="Search the day's appointments"
	                value={appointmentSearch}
	                onChange={event => setAppointmentSearch(event.target.value)}
	              />
	              {appointmentSearch && (
	                <button type="button" className="ehr-queue-search-clear" aria-label="Clear search" onClick={() => setAppointmentSearch('')}>
	                  <X className="w-3.5 h-3.5" />
	                </button>
	              )}
	            </div>
	            <div className="ehr-day-tabs">
              {APPOINTMENT_STATUS_GROUPS.map(group => (
                <button
                  key={group}
                  type="button"
                  className={worklistFilter === group ? 'active' : undefined}
                  aria-pressed={worklistFilter === group}
                  // Collapse the expanded row: it belongs to the lane being
                  // left, so keeping it open would leave a panel hanging under
                  // a list that no longer contains its row.
                  onClick={() => { setVisitRow(null); selectWorklistLane(group); }}
                >
                  {/* The count is its own fixed-width cell: a lane going 7 → 24
                      would otherwise widen the whole tab row, and the row's
                      width is what positions the search field beside it. */}
                  {APPOINTMENT_STATUS_GROUP_LABELS[group]} · <span className="ehr-day-tab-count">{groupCounts[group]}</span>
                </button>
              ))}
	            </div>
	          </div>

          <div className="ehr-appointment-list ehr-care-list ehr-care-list--no-actions">
              <div className="ehr-queue-scroll">
                {/* Patient / Time / Care team / Context / Status, with every
                    column using a primary line plus a secondary line. */}
                <div className="appointment-card-flow">
                  {/* The column head is the list's frame, not a label for the
                      rows that happen to be loaded: it stays put through an
                      empty worklist or a lane with nothing in it, so the table
                      never collapses into a bare message. */}
                  <div className="appointment-card-head" aria-hidden="true">
                    <span>Patient</span>
                    <span>Time</span>
                    <span>Care team</span>
                    <span>Context</span>
                    <span>Status</span>
                  </div>
                  {visiblePatientRows.length === 0 && (
                    <div className="ehr-empty-state">
                      <ClipboardList className="w-8 h-8" />
                      <strong>
                        {appointmentQuery
                          ? 'No assigned patients match your search'
                          : isNurseFamily ? 'No patients on your worklist right now' : 'No patients are assigned to you right now'}
                      </strong>
                      <span>
                        {appointmentQuery
                          ? `Nothing matches “${appointmentSearch.trim()}”.`
                          : isNurseFamily
                            ? 'Ward admissions, rooming arrivals and triaged walk-ins appear here as they come in.'
                            : 'Assigned patients will appear here with appointment times when scheduled.'}
                      </span>
                      {appointmentQuery
                        ? <button type="button" onClick={() => setAppointmentSearch('')}>Clear search</button>
                        : isNurseFamily
                          ? <button type="button" onClick={() => router.push('/wards')}>Open ward board</button>
                          : <button type="button" onClick={() => router.push('/patients')}>Open patient registry</button>}
                    </div>
                  )}
                  {visiblePatientRows.length > 0 && filteredPatientRows.length === 0 && (
                    <div className="ehr-empty-state">
                      <strong>No {APPOINTMENT_STATUS_GROUP_LABELS[worklistFilter].toLowerCase()} patients</strong>
                      <span>Nothing is in the {APPOINTMENT_STATUS_GROUP_LABELS[worklistFilter].toLowerCase()} lane right now.</span>
                    </div>
                  )}
                  {filteredPatientRows.map((row) => {
                    const columns = rowQueueColumns(row);
                    // Details drop down under the row rather than covering the
                    // list — the queue is the context for reading one visit.
                    const isExpanded = visitRow?.id === row.id;
                    const openRow = () => {
                      if (row.patientId) setVisitRow(isExpanded ? null : row);
                      else if (row.appointment) openAppointmentPreview(row.appointment);
                    };
                    return (
                      <div
                        key={row.id}
                        id={`worklist-row-${row.id}`}
                        className={isExpanded ? 'ehr-appointment-group is-expanded' : 'ehr-appointment-group'}
                      >
                      <div
                        data-triage={row.triagePriority}
                        className="ehr-appointment-row appointment-card-row"
                        role="button"
                        tabIndex={0}
                        aria-expanded={row.patientId ? isExpanded : undefined}
                        onClick={openRow}
                        onKeyDown={event => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openRow();
                          }
                        }}
                      >
                        <div className="ehr-appointment-identity">
                          {/* Photo when the record has one (the acuity tint
                              still rings it); tinted initials otherwise. */}
                          <div className="ehr-patient-icon" style={stateTint(row.triagePriority)}>
                            {row.photoUrl
                              // eslint-disable-next-line @next/next/no-img-element
                              ? <img src={row.photoUrl} alt="" className="ehr-patient-icon-photo" />
                              : initials(row.name)}
                          </div>
                          <div className="ehr-appointment-main appointment-card-patient">
                            {/* The name opens the chart; the rest of the row
                                expands this visit underneath. */}
                            <button
                              type="button"
                              className={row.patientId ? 'print-visible ehr-row-name-link' : 'print-visible'}
                              title={row.patientId ? `Open ${row.name}'s chart` : undefined}
                              onClick={event => {
                                event.stopPropagation();
                                if (row.patientId) router.push(`/patients/${row.patientId}`);
                                else openRow();
                              }}
                            >
                              {/* Two words on the row — first and last; the
                                  chart header keeps the full legal name. */}
                              {shortenPersonName(row.name)}
                            </button>
                            {/* Chief complaint only — demographics live in
                                the visit popup and the chart, not the row. */}
                            <p>{row.reason}</p>
                          </div>
                        </div>

                        {/* Over-target waits are carried by colour alone — the
                            "· over target" suffix that used to follow the time
                            was removed. `title` keeps the meaning reachable for
                            anyone the red doesn't reach. */}
                        <div
                          className="ehr-appointment-time"
                          title={columns.overTarget ? 'Wait is over target' : undefined}
                        >
                          <strong style={columns.overTarget ? { color: 'var(--color-danger-text)' } : undefined}>{columns.waitText}</strong>
                          {columns.waitSubtext && (
                            <span className={columns.overTarget ? 'is-soon' : columns.isPast ? 'is-past' : ''}>
                              {columns.waitSubtext}
                            </span>
                          )}
                        </div>

                        <div className="appointment-card-provider">
                          {/* Cell-width names — "Dr. J. Wani", not the full
                              legal name; print keeps the long form. */}
                          <strong>{abbreviateProviderName(columns.careTeamPrimary)}</strong>
                          <span>{abbreviateProviderName(columns.careTeamSecondary)}</span>
                        </div>

                        <div className="ehr-appointment-department">
                          <strong>{columns.queueText || '—'}</strong>
                          <span>{columns.comingFrom}</span>
                        </div>

                        <div className="appointment-card-status">
                          {row.appointment ? (() => {
                            const visitStatus = row.appointment!.status;
                            const tone = APPOINTMENT_STATUS_TONES[visitStatus];
                            const pillClass = tone === 'done' ? 'status-completed'
                              : tone === 'active' ? 'status-checked-in'
                              : tone === 'ready' ? 'status-confirmed'
                              : tone === 'danger' ? 'status-no-show'
                              : tone === 'warning' ? 'status-attention'
                              : 'status-scheduled';
                            return (
                              <AppointmentStatusPillSelect
                                status={visitStatus}
                                className={pillClass}
                                ariaLabel={`Status for ${row.name}`}
                                role={currentUser?.role}
                                onChange={async next => {
                                  try {
                                    await updateAppointmentStatus(row.appointment!._id, next);
                                  } catch (error) {
                                    showToast(error instanceof Error ? error.message : 'Could not update visit status.', 'error');
                                  }
                                }}
                              />
                            );
                          })() : (
                            <span className="appointment-status-pill status-confirmed">{columns.statusText}</span>
                          )}
                          <small>{columns.statusSubtext}</small>
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="ehr-row-detail ehr-row-detail--visit">
                          <EhrVisitPopup
                            inline
                            patientId={row.patientId}
                            name={row.name}
                            detail={row.patient
                              ? `${row.reason} · ${row.patient.age ? `${row.patient.age}y` : 'Age unknown'} · ${row.patient.gender || 'Not recorded'}`
                              : row.reason}
                            acuity={row.triagePriority}
                            wait={columns.waitText}
                            appointment={row.appointment}
                            triage={columns.triage}
                            lastTriage={row.patientId ? latestTriageByPatient.get(row.patientId) ?? null : null}
                            entry={columns.entry}
                            onClose={() => setVisitRow(null)}
                            onCall={() => { setVisitRow(null); void callPatient(row); }}
                            onAcknowledge={columns.triage && canConsult && (!columns.triage.assignedProviderId || columns.triage.assignedProviderId === currentUser?._id)
                              ? () => void acknowledgeTriage(columns.triage!)
                              : undefined}
                            onMove={columns.entry ? () => { setVisitRow(null); setMoveEntry(columns.entry); } : undefined}
                            onOpenChart={row.patientId ? () => router.push(`/patients/${row.patientId}`) : undefined}
                            onStartTriage={row.patientId && canTriage && (!columns.triage || columns.triage.status === 'pending' || columns.triage.status === 'seen')
                              ? () => router.push(`/triage/${row.patientId}`)
                              : undefined}
                            onEscalate={columns.triage?.encounterId && (columns.triage.status === 'pending' || columns.triage.status === 'seen')
                              ? () => void escalateVisit(columns.triage!)
                              : undefined}
                            onLwbs={columns.triage?.encounterId && (columns.triage.status === 'pending' || columns.triage.status === 'seen')
                              ? () => void markVisitLwbs(columns.triage!)
                              : undefined}
                            creatingNote={creatingNote}
                            onCreateNote={row.patientId ? (noteType) => {
                              void createNote({
                                noteType,
                                patientId: row.patientId!,
                                patientName: row.name,
                                mrn: row.patient?.id,
                                appointmentId: row.appointment?._id,
                                serviceTime: row.appointment?.appointmentTime,
                              });
                            } : undefined}
                          />
                        </div>
                      )}
                      </div>
                    );
                  })}
                </div>
              </div>
          </div>
            </>
          )}

          {openAppointment && (
            <Modal onClose={closeAppointmentPreview} width={480} labelledBy="appointment-clinical-title">
              {appointmentPanel}
            </Modal>
          )}

          {moveEntry && (
            <EhrQueueMoveDialog
              entry={moveEntry}
              saving={moveSaving}
              onClose={() => setMoveEntry(null)}
              onMove={change => void handleMove(change)}
            />
          )}

          {/* canDispense re-checked here (not just at the button that opens
              this) so leftover `findPatientOpen` state — e.g. a role switch
              mid-session — can't render the search itself for a non-pharmacist. */}
          {canDispense && findPatientOpen && (
            <Modal onClose={() => setFindPatientOpen(false)} width={480} align="top" labelledBy="find-patient-title">
              <div className="ehr-find-patient">
                <div className="modal-headband">
                  <h3 id="find-patient-title">Dispense to patient</h3>
                </div>
                <div className="ehr-find-patient-input">
                  <Search className="w-4 h-4" />
                  <input
                    ref={findPatientInputRef}
                    type="search"
                    placeholder="Search by name, hospital number, or phone"
                    value={findPatientQuery}
                    onChange={event => setFindPatientQuery(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' && findPatientResults.length > 0) {
                        event.preventDefault();
                        openFoundPatient(findPatientResults[0]);
                      }
                    }}
                  />
                </div>
                {findPatientQuery.trim() === '' ? (
                  <p className="ehr-find-patient-hint">Start typing to find the patient to dispense to.</p>
                ) : findPatientResults.length === 0 ? (
                  <p className="ehr-find-patient-hint">No patients match &ldquo;{findPatientQuery.trim()}&rdquo;.</p>
                ) : (
                  <ul className="ehr-find-patient-results">
                    {findPatientResults.map(patient => {
                      const name = [patient.firstName, patient.middleName, patient.surname].filter(Boolean).join(' ');
                      return (
                        <li key={patient._id}>
                          <button type="button" onClick={() => openFoundPatient(patient)}>
                            <span className="ehr-patient-icon" style={AVATAR_TINT_NEUTRAL}>{initials(name)}</span>
                            <span className="ehr-find-patient-identity">
                              <strong>{name}</strong>
                              <small>{[patient.hospitalNumber, patient.gender, patient.phone].filter(Boolean).join(' · ')}</small>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </Modal>
          )}

          {/* Same reasoning as the search modal above: gate the dialog itself,
              not just its trigger, so leftover state can't render it. */}
          {canDispense && dispensePatient && (
            <PatientDispenseModal
              patientId={dispensePatient.id}
              patientName={dispensePatient.name}
              onClose={() => setDispensePatient(null)}
            />
          )}

          {bookingOpen && (
            <BookAppointmentModal
              defaultDate={selectedDate}
              onClose={() => setBookingOpen(false)}
            />
          )}

          {followUpToComplete && (
            <Modal onClose={() => { if (!followUpSaving) setFollowUpToComplete(null); }} width={480} labelledBy="complete-follow-up-title">
              <div className="modal-content card-elevated p-6 w-full" onClick={event => event.stopPropagation()}>
                <div className="modal-headband">
                  <h3 id="complete-follow-up-title" className="text-base font-semibold mb-1">Complete follow-up</h3>
                  <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                    {followUpToComplete.title} · {followUpToComplete.subtitle || 'Scheduled follow-up'}
                  </p>
                </div>
                <div className="space-y-3">
                  <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    Outcome
                    <Select value={followUpOutcome} onChange={event => setFollowUpOutcome(event.target.value as NonNullable<FollowUpDoc['outcome']>)} className="w-full mt-1">
                      <option value="recovered">Recovered</option>
                      <option value="under_treatment">Under treatment</option>
                      <option value="referred">Referred</option>
                      <option value="died">Died</option>
                    </Select>
                  </label>
                  <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    Notes
                    <textarea
                      value={followUpNotes}
                      onChange={event => setFollowUpNotes(event.target.value)}
                      rows={3}
                      className="w-full mt-1 p-2 rounded-lg text-sm"
                      placeholder="Record what happened during the follow-up"
                    />
                  </label>
                </div>
                <div className="flex gap-2 mt-5">
                  <button type="button" className="btn btn-secondary flex-1" disabled={followUpSaving} onClick={() => setFollowUpToComplete(null)}>Cancel</button>
                  <button type="button" className="btn btn-primary flex-1" disabled={followUpSaving} onClick={() => void completeFollowUp()}>
                    {followUpSaving ? 'Saving…' : 'Complete follow-up'}
                  </button>
                </div>
              </div>
            </Modal>
          )}

          {printOpen && (
            <PrintListDialog
              title="Print worklist"
              subtitle={`${new Date(`${selectedDate}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} — ${clinicianName}`}
              sections={printSections}
              filename={`worklist-${selectedDate}`}
              onClose={() => setPrintOpen(false)}
            />
          )}

        </main>

        {view === 'dashboard' && railOpen && (
          <button type="button" className="ehr-rail-backdrop" aria-label="Close outstanding items panel" onClick={() => setRailOpen(false)} />
        )}
        {view === 'dashboard' && (
        <aside className={`ehr-right-rail ${railOpen ? 'is-open' : ''}`}>
          <button type="button" className="ehr-rail-close" aria-label="Close panel" onClick={() => setRailOpen(false)}>
            <X className="w-4 h-4" />
          </button>
          <section className="ehr-side-card ehr-outstanding-card">
            <div className="ehr-side-card-head">
              <ClipboardList className="w-5 h-5" />
              <h2>Outstanding items</h2>
            </div>
            <div className="ehr-outstanding-chips">
              {outstanding.map(item => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => openOutstanding(item)}
                  className={`${item.tone || 'neutral'}${outstandingView === item.label ? ' is-open' : ''}`}
                >
                  <span>{item.label}</span>
                  <b>{item.count}</b>
                </button>
              ))}
            </div>
          </section>
          {/* Patient flow — who moved where just now (triaged toward the
              clinician, results back, treatment dispensed). The same card
              every station rail carries; it renders nothing when the feed is
              empty or the role has no configured slice. */}
          <ProgressFeedCard />
          {/* The clinical mission card — the design closes the rail with the
              day's one instruction, same treatment as reception's "Keep the
              desk moving". */}
          <div className="ehr-side-card ehr-mission-card">
            <div className="ehr-side-card-head ehr-mission-head">
              <Stethoscope className="w-5 h-5" />
              <h2>Close the loop</h2>
            </div>
            <p>Sign what is waiting, answer the labs that came back, and finish the visits you started.</p>
          </div>
        </aside>
        )}
      </section>

    </div>
  );
}

/* ─── Day activity chart (left rail) ───
   Maps the clinician's own (provider/location-filtered) schedule onto the
   weekly `EhrWeekActivityChart`: Inpatient (the patient holds an active ward
   admission) vs Outpatient (everyone else). Cancelled and no-show visits are
   excluded, so the bars stay a truthful picture of the doctor's week. */
const CHART_HIDDEN_STATUSES: AppointmentStatus[] = ['cancelled', 'no_show'];

function DayActivityChart({ appointments, items: providedItems, seriesNames, selectedDate, todayIso, admittedPatientIds, onSelectDate }: {
  appointments: AppointmentDoc[]; selectedDate: string; todayIso: string; admittedPatientIds: Set<string>;
  /** Pre-computed bars for roles whose week isn't a schedule (see the prop
   *  of the same name on EhrClinicalDashboard). */
  items?: DayStatsItem[];
  seriesNames?: [string, string];
  onSelectDate?: (iso: string) => void;
}) {
  const scheduleItems = useMemo<DayStatsItem[]>(() => appointments
    .filter(appointment => !CHART_HIDDEN_STATUSES.includes(appointment.status))
    .map(appointment => ({
      date: appointment.appointmentDate,
      time: appointment.appointmentTime,
      series: admittedPatientIds.has(appointment.patientId) ? 0 : 1,
    })), [appointments, admittedPatientIds]);

  return (
    <EhrWeekActivityChart
      items={providedItems ?? scheduleItems}
      seriesNames={seriesNames ?? ['Inpatient', 'Outpatient']}
      selectedDate={selectedDate}
      todayIso={todayIso}
      onSelectDate={onSelectDate}
    />
  );
}
