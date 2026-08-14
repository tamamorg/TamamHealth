'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/context';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { usePatients } from '@/lib/hooks/usePatients';
import { useUsers } from '@/lib/hooks/useUsers';
import { useAppointments } from '@/lib/hooks/useAppointments';
import { useTriage } from '@/lib/hooks/useTriage';
import type { AppointmentDoc, AppointmentStatus, EncounterDoc, PatientDoc, TriageDoc } from '@/lib/db-types';
import { APPOINTMENT_STATUS_TONES, APPOINTMENT_CHECKED_IN_STATUSES,
  APPOINTMENT_PENDING_STATUSES, APPOINTMENT_STATUS_OPTIONS,
  appointmentStatusLabel, appointmentStatusGroup,
  APPOINTMENT_STATUS_GROUP_LABELS, type AppointmentStatusGroup,
} from '@/lib/appointment-status';
import { formatCompactDateTime, formatMoney, formatClockTime } from '@/lib/format-utils';
import { patientRegisteredAt, patientFullName, patientGenderAge, patientAgeLabel } from '@/lib/patient-utils';
import { PRIORITY_META, appointmentPriorityLabel, appointmentTriage, isTriagePriority, priorityColor, priorityLabelKey, type TriagePriority } from '@/lib/clinical/triage-display';
import { buildQueueFromTriage, STAGE_LABELS, type QueueStage } from '@/lib/services/patient-queue-service';
import { waitLabel } from '@/components/ehr/EhrVisitPopup';
import AssignDoctorModal, { type AssignDoctorTarget } from '@/components/AssignDoctorModal';
import Modal from '@/components/Modal';
import AppointmentEditModal from '@/components/appointments/AppointmentEditModal';
import { PatientRegistrationForm } from '@/components/patients/registration/PatientRegistrationForm';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { getRoleConfig } from '@/lib/permissions';
import EhrCareDashboard, { useRowCollapse, type EhrCareDashboardAction, type EhrCareDashboardMetric, type EhrCareDashboardRow } from '@/components/ehr/EhrCareDashboard';
import { type DayStatsItem } from '@/components/ehr/EhrDayStatsChart';
import { toIsoDate } from '@/components/ehr/EhrMiniCalendar';
import {
  Calendar, ClipboardCheck, ArrowRightLeft,
  UserPlus, ClipboardList, Plus,
  MapPin, LogOut, Wallet, CheckCircle, X, Maximize2,
  Send, Stethoscope, FileText, RotateCcw, type LucideIcon,
} from '@/components/icons/lucide';
import BookAppointmentModal from '@/components/appointments/BookAppointmentModal';
import SendIntakeFormsModal from '@/components/intake/SendIntakeFormsModal';
import { formatPhoneDisplay } from '@/lib/field-formats';
import Select from '@/components/Select';

/**
 * Front-desk operations workspace.
 *
 * Shows the live queue, today's appointments, and registry snapshots in one
 * view so reception can move patients without jumping between screens.
 */

// Exam rooms / bays a walk-in patient can be placed in to meet the provider.
// Fallback used only when facility settings provide no rooms.
const ROOM_OPTIONS = ['Room 1', 'Room 2', 'Room 3', 'Room 4', 'Room 5', 'Room 6', 'Bay A', 'Bay B', 'Bay C', 'Bay D'];

// Half-hour clinic slots (07:00–18:30) offered when reception reschedules.
const RESCHEDULE_SLOTS = Array.from({ length: 24 }, (_, i) => {
  const hour = 7 + Math.floor(i / 2);
  return `${String(hour).padStart(2, '0')}:${i % 2 ? '30' : '00'}`;
});

const COMPLAINT_DEPARTMENT_MAP: Record<string, string> = {
  fever: 'General Medicine', malaria: 'General Medicine', cough: 'General Medicine',
  headache: 'General Medicine', pregnancy: 'Maternity', anc: 'Maternity',
  antenatal: 'Maternity', injury: 'Emergency', wound: 'Emergency',
  fracture: 'Emergency', accident: 'Emergency', child: 'Pediatrics',
  pediatric: 'Pediatrics', infant: 'Pediatrics', eye: 'Ophthalmology',
  vision: 'Ophthalmology', dental: 'Dental', tooth: 'Dental',
  skin: 'Dermatology', rash: 'Dermatology',
};

function suggestDepartment(complaint: string): string {
  const lower = complaint.toLowerCase();
  for (const [keyword, dept] of Object.entries(COMPLAINT_DEPARTMENT_MAP)) {
    if (lower.includes(keyword)) return dept;
  }
  return 'General Medicine';
}

// Split a timestamp into separate date / time pieces so the queue can show them
// in their own columns. Date-only values (e.g. "YYYY-MM-DD") yield an empty time.
function splitDateTime(iso?: string | null): { date: string; time: string } {
  if (!iso) return { date: '—', time: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: iso, time: '' };
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = /T\d{2}:\d{2}/.test(iso) ? formatClockTime(d) : '';
  return { date, time };
}

// Combine an appointment's day with its "HH:MM" slot into one real moment, so
// the schedule row can count down to it ("in 2h 15m"). Parsed without a zone
// suffix on purpose: appointment slots are wall-clock times at the facility,
// which is how the rest of the client reads "today".
function appointmentMoment(appointmentDate?: string | null, appointmentTime?: string | null): string | undefined {
  const slot = (appointmentTime || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!slot) return undefined;
  const day = isoDateKey(appointmentDate);
  const at = new Date(`${day}T${slot[1].padStart(2, '0')}:${slot[2]}:00`);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

function formatDayMonthYear(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function isoDateKey(value?: string | null): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
}

// Final-checkout target: closing out a completed visit at the front desk.
interface CheckoutTarget {
  patientId: string;
  patientName: string;
  hospitalNumber?: string;
  encounterId?: string;
  /** Set when the queue entry came from an appointment. */
  appointmentId?: string;
  /** Set when the queue entry came from triage (walk-in). */
  triageId?: string;
}

function patientFacilityName(patient: PatientDoc | undefined, fallback = 'Facility'): string {
  return (patient as (PatientDoc & { registrationHospitalName?: string }) | undefined)?.registrationHospitalName || fallback;
}

/**
 * The inline appointment editor, wired to close its own row on save.
 *
 * The rows are built in a `useMemo`, where `useRowCollapse()` cannot be
 * called — so the hook lives here, in a component that renders inside the
 * expanded row and therefore sees the context. Without it these editors were
 * passed `onClose={() => undefined}`: saving showed its toast and left the
 * panel sitting open.
 */
function RowAppointmentEditor({
  appointment,
  appointments,
  patient,
}: {
  appointment: React.ComponentProps<typeof AppointmentEditModal>['appointment'];
  appointments: React.ComponentProps<typeof AppointmentEditModal>['appointments'];
  patient: React.ComponentProps<typeof AppointmentEditModal>['patient'];
}) {
  const collapse = useRowCollapse();
  return (
    <AppointmentEditModal
      inline
      appointment={appointment}
      appointments={appointments}
      patient={patient}
      onClose={collapse}
    />
  );
}

export default function FrontDeskDashboardPage() {
  const router = useRouter();
  const { currentUser } = useAuth();
  const { canConsult, canManageAppointmentSchedule, canCheckInAppointments } = usePermissions();
  // Reception schedules and checks in; a role that can do neither may look at
  // the ladder but not move a booking along it.
  const canSetAppointmentStatus = canManageAppointmentSchedule || canCheckInAppointments;
  // Same roles the chart's Assign-provider action uses, so routing a patient
  // means the same thing wherever it is done from.
  const canAssignCareTeam = ['front_desk', 'central_registration_clerk', 'clinic_clerk'].includes(currentUser?.role ?? '');
  const { patients } = usePatients();
  const { users } = useUsers();
  const { appointments, updateStatus: updateAppointmentStatus, reschedule: rescheduleAppointment } = useAppointments();
  const { triages, update: updateTriage } = useTriage();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const { rooms } = useSettings();
  // Reactive room list from facility settings; fall back to the static list.
  const roomOptions = rooms.length ? rooms : ROOM_OPTIONS;

  // Which of the three shared lanes the tabs show: Scheduled = today's
  // bookings still expecting the patient, In Office = the live in-building
  // queue, Finished = visits at/after checkout. Same lanes as every other
  // role dashboard and the mobile shell.
  const [queueFilter, setQueueFilter] = useState<AppointmentStatusGroup>('scheduled');
  const [panelView, setPanelView] = useState<'all' | 'appointments' | 'pending' | 'queue' | 'registered'>('all');
  const searchParams = useSearchParams();
  const queueSort: 'priority' | 'name' | 'time' | 'status' = 'priority';
  const [queueSearch, setQueueSearch] = useState('');

  const [assignTarget, setAssignTarget] = useState<AssignDoctorTarget | null>(null);
  // The appointment open in the shared edit form, if any.
  const [editAppointment, setEditAppointment] = useState<AppointmentDoc | null>(null);
  const [checkoutTarget, setCheckoutTarget] = useState<CheckoutTarget | null>(null);
  const [checkInTarget, setCheckInTarget] = useState<AppointmentDoc | null>(null);
  // Reception can move an appointment to a new slot or mark it a no-show from
  // the row itself — both are front-desk calls that shouldn't need the
  // full appointments page.
  const [rescheduleTarget, setRescheduleTarget] = useState<AppointmentDoc | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');
  const [reschedSaving, setReschedSaving] = useState(false);
  const [noShowTarget, setNoShowTarget] = useState<AppointmentDoc | null>(null);
  // Cancelling is confirmed first, exactly like no-show: it takes the row off
  // the live board, so an accidental pick from the status dropdown must not
  // land silently. `triage` rides along for walk-in rows whose visit rung is
  // mirrored onto the triage record.
  const [cancelTarget, setCancelTarget] = useState<{ appt: AppointmentDoc; triage?: TriageDoc } | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [registerOpen, setRegisterOpen] = useState(false);
  // "Find availability" — the same booking dialog the doctor module opens.
  const [bookingOpen, setBookingOpen] = useState(false);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [encounters, setEncounters] = useState<EncounterDoc[]>([]);

  const [queueNowMs, setQueueNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setQueueNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // LOCAL calendar day, same helper the mini-calendar's "today" ring uses.
  // This was a UTC slice (`toISOString().slice(0, 10)`), which rolls to
  // tomorrow during the evening (Juba is UTC+2) — so the board's "today"
  // disagreed with the calendar's, clicking back onto today never matched,
  // and the live queue vanished after ~21:00.
  const today = toIsoDate(new Date());
  // The day the board is showing. The mini-calendar drives it; today by
  // default. The LIVE parts of the board (triage queue, checkout encounters,
  // walk-ins physically in the building) only exist for today — another day
  // shows that day's appointments alone, split into the same three lanes.
  const [boardDate, setBoardDate] = useState<string>(today);
  const viewingToday = boardDate === today;

  // Deep link: ?lane= lands on a specific lane tab, ?q= prefills the queue
  // search and ?date= opens the board on a specific day — how "merge intake →
  // land on the patient's Scheduled row" works from /patient-intake (and any
  // other surface that wants to point here).
  //
  // ?date= matters because this board only ever shows one day and defaults to
  // today: pointing at a patient whose booking is later in the week without it
  // lands the clerk on a lane filtered to someone with nothing on it, which
  // reads as "the link did nothing".
  useEffect(() => {
    const lane = searchParams?.get('lane');
    if (lane === 'scheduled' || lane === 'in_office' || lane === 'finished') {
      setQueueFilter(lane);
      setPanelView('all');
    }
    const q = searchParams?.get('q');
    if (q) setQueueSearch(q);
    // Validated shape, not just truthiness — boardDate drives every row filter
    // on the page, so a malformed value would empty the whole board.
    const date = searchParams?.get('date');
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) setBoardDate(date);
  }, [searchParams]);

  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    let changes: { cancel: () => void } | null = null;
    const load = async () => {
      try {
        const { getAllEncounters } = await import('@/lib/services/encounter-service');
        const rows = await getAllEncounters({
          orgId: currentUser.orgId,
          hospitalId: currentUser.hospitalId || currentUser.hospital?._id,
          role: currentUser.role,
        });
        if (!cancelled) setEncounters(rows);
      } catch (err) {
        console.warn('Failed to load front-desk encounter queue', err);
      }
    };
    load();
    import('@/lib/db').then(({ encountersDB }) => {
      if (cancelled) return;
      changes = encountersDB().changes({ since: 'now', live: true, include_docs: false })
        .on('change', load)
        .on('error', err => console.warn('Encounter queue subscription failed', err));
    }).catch(() => {});
    return () => {
      cancelled = true;
      try { changes?.cancel(); } catch { /* noop */ }
    };
  }, [currentUser, currentUser?.hospital?._id, currentUser?.hospitalId, currentUser?.orgId, currentUser?.role]);

  // ── The board day's appointments (today unless the calendar picked another
  //    day). Cancelled ones are KEPT: they surface in the Finished lane with
  //    their red pill rather than vanishing from the board, so the desk can
  //    find and reopen one cancelled by mistake. Lists that must not show them
  //    (pending arrivals, the live queue) filter by status themselves. ──
  const todaysAppointments = useMemo(() =>
    appointments
      .filter(a => a.appointmentDate === boardDate)
      // appointmentTime can be missing on seeded/synced rows — guard before sort
      .sort((a, b) => (a.appointmentTime || '').localeCompare(b.appointmentTime || '')),
    [appointments, boardDate]
  );

  // Work plotted on the "Day activity" week chart. Drawn from the whole booking
  // list rather than the day-scoped rows in the worklist, so all seven columns
  // carry their real numbers; cancellations and no-shows are left out because
  // they are neither active work nor completed work.
  const weekChartItems = useMemo<DayStatsItem[]>(() =>
    appointments
      .filter(a => a.status !== 'cancelled' && a.status !== 'no_show')
      .map(a => ({
        date: isoDateKey(a.appointmentDate),
        time: formatClockTime(a.appointmentTime) || undefined,
        // The same split the rows use: finished visits form the second series.
        series: APPOINTMENT_STATUS_TONES[a.status] === 'done' ? 1 : 0,
      })),
    [appointments]
  );

  // ── Real today's triages (pending/seen = still in queue) ──
  const todaysTriages = useMemo(() =>
    triages
      .filter(t => (t.triagedAt || '').startsWith(today))
      .sort((a, b) => {
        const pOrder: Record<string, number> = { RED: 0, YELLOW: 1, GREEN: 2 };
        return (pOrder[a.priority] ?? 3) - (pOrder[b.priority] ?? 3);
      }),
    [triages, today]
  );


  // ── Unified queue: triaged walk-ins + appointments + recent registrations ──
  interface QueueItem {
    id: string;
    patientId: string;
    patientName: string;
    type: 'walk-in' | 'appointment' | 'registered';
    priority: 'RED' | 'YELLOW' | 'GREEN' | 'normal';
    complaint: string;
    department: string;
    gender: string;
    age: string;
    date: string;
    time: string;
    /** Full timestamp behind `time` — drives the row's "in 2h 15m" countdown. */
    timeAt?: string;
    calendarDate: string;
    status: 'WAITING' | 'IN CONSULT' | 'DONE';
    /** Raw stage code from patient-queue-service (triage-sourced entries only) —
     *  drives the Context column via STAGE_LABELS, the same vocabulary the
     *  doctor's Queue column uses for this patient. */
    stage?: QueueStage;
    /** Stage-based label from patient-queue-service (triage-sourced entries only). */
    stageLabel?: string;
    /** Set when the slot closed WITHOUT the patient being seen (cancelled /
     *  rescheduled / no-show). The row files under Finished wearing this
     *  status's own pill, and never offers Checkout. */
    closedStatus?: AppointmentStatus;
    /**
     * The visit's rung on the shared appointment ladder — the SINGLE fact that
     * decides both which lane this row files into (`appointmentStatusGroup`)
     * and which pill it wears. Previously the lane came from the coarse
     * WAITING/IN CONSULT/DONE field below while the pill came from the linked
     * appointment, so a booking still on "Scheduled" showed a Scheduled pill
     * inside the In Office lane.
     */
    visitStatus: AppointmentStatus;
    waitMinutes?: number;
    overTarget?: boolean;
    /** Ordering weight — the service's acuity+wait score for triage-sourced
     *  entries, an equivalent estimate for the rest. Higher sorts first. */
    score: number;
    sourceId: string; // triage / appointment / patient ID
    encounterId?: string;
    assignedRoom?: string; // OPD exam room/bay (walk-in/triage entries only)
    assignedDoctorName?: string;
    assignedNurseName?: string;
    location?: string;
  }

  const queue = useMemo(() => {
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
      return fallback || patientFacilityName(p, currentUser?.hospitalName || 'Facility');
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
    if (viewingToday) {
      for (const enc of encounters) {
        if (!checkoutStatuses.has(enc.status)) continue;
        const dateKey = isoDateKey(enc.updatedAt || enc.closedAt || enc.startedAt || enc.createdAt);
        if (dateKey !== today) continue;
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
      // A clinician has taken the patient when the triage records a handoff
      // (entry.assignedToId) or was marked seen — the same "in service"
      // signal the doctor/nurse boards derive from this engine, so reception
      // can tell who is actually with a clinician vs still queued.
      const inConsult = Boolean(entry.assignedToId) || triageDoc?.status === 'seen';
      // The booking this walk-in's visit is threaded onto (check-in creates one
      // for every arrival). Its rung is the authority on where the patient
      // actually is; the triage record only proves an assessment exists, which
      // is why "has a triage" was the wrong test for "is in the building".
      const linkedAppointment = todaysAppointments.find(a => a.patientId === entry.patientId);
      const triageVisitStatus: AppointmentStatus =
        linkedAppointment?.status
        ?? triageDoc?.visitStatus
        // A walk-in with no booking at all: the triage record IS the proof of
        // presence, so it files as checked in (or further along).
        ?? (isCheckout ? 'completed' : inConsult ? 'in_progress' : 'checked_in');
      items.push({
        id: `triage-${entry.triageId}`,
        visitStatus: triageVisitStatus,
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
        waitMinutes: entry.minutesWaiting,
        overTarget: entry.flaggedForReassessment,
        score: entry.score,
        sourceId: entry.triageId,
        encounterId: checkoutEncounter?._id,
        assignedRoom: room,
        assignedDoctorName: doctorOf(entry.patientId),
        assignedNurseName: nurseOf(entry.patientId),
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
    const triagedPatientIds = new Set(activeTriageByPatient.keys());
    const APPT_SCORE: Record<string, number> = { emergency: 3, urgent: 2 };
    for (const a of todaysAppointments) {
      if (triagedPatientIds.has(a.patientId)) continue;
      if (!ARRIVED.has(a.status) && !CLOSED_UNSEEN.has(a.status)) continue; // not checked in yet → not in the queue
      const checkoutEncounter = checkoutEncounterByPatient.get(a.patientId);
      const status = CLOSED_UNSEEN.has(a.status) ? 'DONE' :
                     checkoutEncounter ? 'DONE' :
                     a.status === 'completed' ? 'DONE' :
                     a.status === 'in_progress' ? 'IN CONSULT' : 'WAITING';
      items.push({
        id: `appt-${a._id}`,
        visitStatus: a.status,
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
        score: APPT_SCORE[a.priority ?? ''] ?? 1,
        sourceId: a._id,
        encounterId: checkoutEncounter?._id,
        assignedDoctorName: a.providerName || doctorOf(a.patientId),
        assignedNurseName: nurseOf(a.patientId),
        location: a.department || a.facilityName || locationOf(a.patientId),
      });
    }

    const queuedPatientIds = new Set(items.map(it => it.patientId));
    for (const enc of checkoutEncounterByPatient.values()) {
      if (queuedPatientIds.has(enc.patientId)) continue;
      const patient = patientById.get(enc.patientId);
      items.push({
        id: `encounter-${enc._id}`,
        // Clinical work is done but the desk has not closed them out, so the
        // patient is still in the building — In Office, carrying the Checkout
        // action. Finished means checked out, which is what that action does.
        visitStatus: 'in_progress',
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
    // `queueNowMs` ticks every minute purely to recompute the wait labels
    // (buildQueueFromTriage reads the clock) — it is a dependency, not a value
    // read directly in the body above.
  }, [boardDate, currentUser?.hospitalName, encounters, patients, queueNowMs, today, todaysAppointments, triages, viewingToday]);

  /**
   * The queue as it applies to the board's day. Every builder above already
   * scopes to `boardDate`, so this is an enforced invariant rather than a
   * filter that does work: the lane COUNTS and the lane ROWS must come from
   * one list, or the tab says 25 while the table shows 3.
   */
  const boardQueue = useMemo(
    () => queue.filter(item => item.calendarDate === boardDate),
    [queue, boardDate],
  );

  /**
   * The queue split into the three lanes, by the SHARED rule
   * (`appointmentStatusGroup`) every role dashboard files a visit under —
   * never by the coarse WAITING/DONE field, which put a booking still on
   * "Scheduled" into In Office because a triage record happened to exist.
   *
   * In Office therefore means exactly what the pill says: checked in, triaged,
   * or with the clinician. A patient the desk has not opened a visit for is
   * still expected, and belongs in Scheduled.
   */
  const queueByLane = useMemo(() => {
    const lanes: Record<AppointmentStatusGroup, QueueItem[]> = {
      scheduled: [], in_office: [], finished: [],
    };
    for (const item of boardQueue) lanes[appointmentStatusGroup(item.visitStatus)].push(item);
    return lanes;
  }, [boardQueue]);

  const filteredQueue = useMemo(() => {
    // The Live queue tile shows the whole in-building queue regardless of the
    // active lane tab; the tabs themselves split it DONE vs not-DONE (Finished
    // vs In Office). Scheduled is served by pendingAppointments, not this list.
    // The lane's own members — the Live queue tile still shows the whole
    // in-building queue regardless of the active tab.
    let items = panelView === 'queue' ? boardQueue : queueByLane[queueFilter];

    const q = queueSearch.trim().toLowerCase();
    if (q) {
      // Same fields the registered-patients view searches: name, complaint,
      // department, plus the patient's hospital number and phone — so the one
      // rail search behaves identically on every lane tab.
      const patientById = new Map(patients.map(p => [p._id, p]));
      items = items.filter(it => {
        const patient = patientById.get(it.patientId);
        return it.patientName.toLowerCase().includes(q) ||
          it.complaint.toLowerCase().includes(q) ||
          it.department.toLowerCase().includes(q) ||
          (patient?.hospitalNumber || '').toLowerCase().includes(q) ||
          (patient?.phone || '').toLowerCase().includes(q);
      });
    }

    if (queueSort !== 'priority') {
      const statusOrder: Record<string, number> = { 'WAITING': 0, 'IN CONSULT': 1, 'DONE': 2, 'ADMITTED': 3, 'REFERRED': 4 };
      items = [...items].sort((a, b) => {
        if (queueSort === 'name') return (a.patientName || '').localeCompare(b.patientName || '');
        if (queueSort === 'time') return (a.time || '').localeCompare(b.time || '');
        return (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3);
      });
    }

    return items;
  }, [panelView, patients, boardQueue, queueByLane, queueFilter, queueSearch, queueSort]);

  const filteredRegisteredPatients = useMemo(() => {
    const sorted = [...patients].sort((a, b) =>
      patientRegisteredAt(b).localeCompare(patientRegisteredAt(a)));
    const q = queueSearch.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(patient => {
      const name = patientFullName(patient).toLowerCase();
      const phone = (patient.phone || '').toLowerCase();
      const hospitalNumber = (patient.hospitalNumber || '').toLowerCase();
      const location = [patient.county, patient.state].filter(Boolean).join(' ').toLowerCase();
      return name.includes(q) || phone.includes(q) || hospitalNumber.includes(q) || location.includes(q);
    });
  }, [patients, queueSearch]);

  // ── Room assignment (OPD rooming) for triage-sourced queue entries ──
  // The saving flag now lives on RoomAssignmentControl itself (one control
  // mounts per expanded row), so this just does the write + toast.
  // Facility staff the desk can route to. Doctors and clinical officers carry
  // visits; nurses cover patients. Filtered to this facility so a clerk never
  // assigns someone at another hospital.
  const assignableDoctors = useMemo(() => users
    .filter(u => (u.role === 'doctor' || u.role === 'clinical_officer')
      && (!currentUser?.hospitalId || u.hospitalId === currentUser.hospitalId))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '')), [users, currentUser?.hospitalId]);

  const assignableNurses = useMemo(() => users
    .filter(u => (u.role === 'nurse' || u.role === 'midwife')
      && (!currentUser?.hospitalId || u.hospitalId === currentUser.hospitalId))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '')), [users, currentUser?.hospitalId]);

  const handleAssignDoctor = useCallback(async (patient: PatientDoc, doctorId: string, triageId?: string) => {
    const doctor = assignableDoctors.find(d => d._id === doctorId);
    if (!doctor) { showToast('Select a doctor to assign', 'error'); return; }
    try {
      const { assignProviderToPatient } = await import('@/lib/services/patient-assignment-service');
      await assignProviderToPatient({
        patientId: patient._id,
        patientName: `${patient.firstName} ${patient.surname}`.trim(),
        provider: { id: doctor._id, name: doctor.name || doctor.username || 'Provider', role: doctor.role },
        actor: { id: currentUser?._id, name: currentUser?.name, role: currentUser?.role },
        hospitalId: currentUser?.hospitalId,
        hospitalName: currentUser?.hospitalName,
        orgId: currentUser?.orgId,
        triageId,
      });
      showToast(`Assigned to ${doctor.name || doctor.username}`, 'success');
    } catch {
      showToast('Failed to assign the doctor', 'error');
    }
  }, [assignableDoctors, currentUser, showToast]);

  const handleAssignNurse = useCallback(async (patient: PatientDoc, nurseId: string) => {
    const nurse = nurseId ? assignableNurses.find(n => n._id === nurseId) : null;
    if (nurseId && !nurse) { showToast('Select a nurse to assign', 'error'); return; }
    try {
      const { assignNurseToPatient } = await import('@/lib/services/patient-assignment-service');
      await assignNurseToPatient({
        patientId: patient._id,
        nurse: nurse ? { id: nurse._id, name: nurse.name || nurse.username || 'Nurse' } : null,
        actor: { id: currentUser?._id, name: currentUser?.name, role: currentUser?.role },
      });
      showToast(nurse ? `Nurse set to ${nurse.name || nurse.username}` : 'Nurse cleared', 'success');
    } catch {
      showToast('Failed to assign the nurse', 'error');
    }
  }, [assignableNurses, currentUser, showToast]);

  const handleSaveRoom = useCallback(async (triageId: string, room: string) => {
    try {
      await updateTriage(triageId, { assignedRoom: room || undefined });
      showToast(room ? `Room set to ${room}` : 'Room cleared', 'success');
      // Only assigning a room (not clearing one) counts as "roomed a walk-in".
    } catch {
      showToast('Failed to set room', 'error');
    }
  }, [updateTriage, showToast]);

  // ── Final checkout: close out a completed visit ──
  // Stage 10 — Facility checkout gate (KAN-96). The gate decision comes from
  // evaluateCheckoutGate against LIVE data — never from a hand-asserted key
  // list, which is exactly the self-satisfying behaviour the ticket removed.
  // Unmet critical conditions BLOCK the discharge; the desk may override only
  // with an explicit reason, which is audited naming the overridden conditions.
  const handleCompleteCheckout = useCallback(async (
    target: CheckoutTarget,
    override?: { reason: string; authorizedBy: string },
    disposition?: import('@/lib/services/encounter-service').DischargeDisposition,
  ) => {
    try {
      let gateNote = '';
      try {
        const {
          getEncounter, getOpenEncounterForPatient, dischargeEncounter,
        } = await import('@/lib/services/encounter-service');
        const enc = target.encounterId
          ? await getEncounter(target.encounterId)
          : await getOpenEncounterForPatient(target.patientId);
        if (enc) {
          const { evaluateCheckoutGate } = await import('@/lib/services/checkout-gate-service');
          const evaluation = await evaluateCheckoutGate(target.patientId, enc as never);

          if (!evaluation.canDischarge && !override) {
            showToast(
              `Cannot check out — unresolved: ${evaluation.blocking.map(b => b.label).join('; ')}`,
              'error',
            );
            return;
          }
          if (!evaluation.canDischarge && override) {
            const { logAuditSafe } = await import('@/lib/services/audit-service');
            await logAuditSafe(
              'CHECKOUT_GATE_OVERRIDDEN', currentUser?._id, currentUser?.name,
              `Discharged ${target.patientName} over unmet gate conditions ` +
              `[${evaluation.blocking.map(b => b.key).join(', ')}] — ${override.reason} ` +
              `(authorized by ${override.authorizedBy})`,
            );
            gateNote = ` — override: ${evaluation.blocking.map(b => b.label).join('; ')}`;
          }
          // A walk-out ("dismissed") keeps its disposition even over unmet
          // items — it IS the maximal pending case; otherwise unmet items
          // force discharged_with_pending_items.
          const finalDisposition = disposition === 'dismissed_without_formal_checkout'
            ? disposition
            : !evaluation.canDischarge
              ? 'discharged_with_pending_items'
              : disposition ?? 'discharged';
          await dischargeEncounter(enc._id, {
            actorId: currentUser?._id,
            disposition: finalDisposition,
          });
        }
      } catch (e) {
        console.warn('Encounter discharge during checkout failed', e);
      }

      // Both, never either/or: since check-in gives every walk-in a booking of
      // its own, a walk-in row now carries an appointment AND a triage row.
      // Completing only the appointment left the triage record active, and the
      // queue builders kept re-showing a patient who had already gone home.
      if (target.appointmentId) {
        await updateAppointmentStatus(target.appointmentId, 'completed');
      }
      if (target.triageId) {
        // 'discharged' is the terminal status in the TriageDoc status union.
        await updateTriage(target.triageId, { status: 'discharged' });
      }
      showToast(`${target.patientName} checked out${gateNote}`, 'success');
      setCheckoutTarget(null);
    } catch {
      showToast('Failed to complete checkout', 'error');
    }
  }, [updateAppointmentStatus, updateTriage, showToast, currentUser]);

  // ── Appointment check-in: mark the patient as arrived → joins the queue ──
  // Also creates/joins the visit encounter (arrivalChannel: 'appointment',
  // appointmentId threaded through, attendanceType captured) so this arrival
  // door produces the same visit thread walk-ins get via checkInPatient —
  // see docs/EMR-FIELD-AUDIT-2026-07.md §3. Best-effort: the appointment
  // status flip is what actually gets the patient into the live queue, so an
  // encounter-creation failure doesn't block check-in.
  const handleCheckIn = useCallback(async (appt: AppointmentDoc, attendanceType: 'new' | 'repeat') => {
    await updateAppointmentStatus(appt._id, 'checked_in');
    try {
      const { findOpenEncounterForPatient, createArrivalEncounter } = await import('@/lib/services/encounter-service');
      const existing = await findOpenEncounterForPatient(appt.patientId, currentUser?.hospitalId || '');
      if (!existing) {
        await createArrivalEncounter({
          patientId: appt.patientId,
          patientName: appt.patientName,
          hospitalId: currentUser?.hospitalId || '',
          hospitalName: currentUser?.hospitalName || '',
          orgId: currentUser?.orgId,
          arrivalChannel: 'appointment',
          appointmentId: appt._id,
          attendanceType,
          actorId: currentUser?._id,
        });
      }
    } catch {
      // encounter creation is best-effort; the appointment check-in itself still succeeded
    }
    showToast(`${appt.patientName} checked in — added to queue`, 'success');
    setCheckInTarget(null);
  }, [updateAppointmentStatus, showToast, currentUser]);

  // ── Mark an appointment a no-show. Confirmed first: a mistaken no-show
  //    hides the patient from the arrivals list, so reception gets one beat to
  //    check the waiting room before it lands. ──
  const handleNoShow = useCallback(async (appt: AppointmentDoc) => {
    try {
      await updateAppointmentStatus(appt._id, 'no_show');
      showToast(`${appt.patientName} marked as no-show`, 'success');
    } catch {
      showToast('Failed to mark no-show', 'error');
    } finally {
      setNoShowTarget(null);
    }
  }, [updateAppointmentStatus, showToast]);

  // ── A walk-in has no booking, so its rung lives on the triage record. The
  //    desk sets it from the same dropdown a booked patient uses; triage's own
  //    clinical `status` is only touched when the visit actually closes, which
  //    is the one place the two vocabularies genuinely agree. ──
  // `silent` is set when the row also has an appointment whose own handler has
  // already reported the change — the two writes are one action to the clerk.
  const handleWalkInStatusChange = useCallback(async (triage: TriageDoc, status: AppointmentStatus, silent = false) => {
    try {
      const patch: Partial<TriageDoc> = { visitStatus: status };
      if (status === 'completed') patch.status = 'discharged';
      await updateTriage(triage._id, patch);
      if (!silent) showToast(`${triage.patientName} — ${appointmentStatusLabel(status).toLowerCase()}`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update the status', 'error');
    }
  }, [updateTriage, showToast]);

  // ── Set any rung on the ladder straight from the row's status dropdown.
  //    Checking in, no-show and cancelling keep their own dialogs: those do
  //    more than move a status (open the visit thread; confirm before hiding
  //    the patient from the board), so the dropdown routes to them rather than
  //    writing the status behind their backs.
  //    `mirrorTriage` is the walk-in row's triage record, when there is one —
  //    written in the same action so the two records never disagree, and
  //    restored together by Undo. ──
  const handleAppointmentStatusChange = useCallback(async (
    appt: AppointmentDoc,
    status: AppointmentStatus,
    mirrorTriage?: TriageDoc,
  ) => {
    if (status === 'checked_in') { setCheckInTarget(appt); return; }
    if (status === 'no_show') { setNoShowTarget(appt); return; }
    if (status === 'cancelled') { setCancelReason(''); setCancelTarget({ appt, triage: mirrorTriage }); return; }
    // 'rescheduled' is set directly, and means "not happening at this time, to
    // be rebooked" — the Reschedule action beside it moves a booking to a known
    // new slot in place, which leaves it scheduled, not rescheduled.
    const prevStatus = appt.status;
    const prevVisitStatus = mirrorTriage?.visitStatus;
    try {
      await updateAppointmentStatus(appt._id, status, {
        actorId: currentUser?._id,
        actorName: currentUser?.name || currentUser?.username,
        actorRole: currentUser?.role,
      });
      if (mirrorTriage) await handleWalkInStatusChange(mirrorTriage, status, true);
      if (status === 'rescheduled') {
        // One accidental click away from dropping off the live board — the
        // toast itself is the recovery path, restoring both records.
        showToast(`${appt.patientName} — marked rescheduled`, 'success', {
          action: {
            label: t('action.undo'),
            onClick: async () => {
              try {
                await updateAppointmentStatus(appt._id, prevStatus, {
                  actorId: currentUser?._id,
                  actorName: currentUser?.name || currentUser?.username,
                  actorRole: currentUser?.role,
                });
                if (mirrorTriage) await updateTriage(mirrorTriage._id, { visitStatus: prevVisitStatus });
                showToast(`${appt.patientName} — restored to ${appointmentStatusLabel(prevStatus).toLowerCase()}`, 'success');
              } catch {
                showToast('Could not restore the appointment', 'error');
              }
            },
          },
        });
      } else {
        showToast(`${appt.patientName} — ${appointmentStatusLabel(status).toLowerCase()}`, 'success');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update the appointment status', 'error');
    }
  }, [updateAppointmentStatus, updateTriage, handleWalkInStatusChange, showToast, currentUser, t]);

  // ── Cancel, after the dialog confirms it. Mirrors handleNoShow, and leaves
  //    an Undo on the toast that restores the pre-cancel rung (the cancel
  //    reason stays in the status history for the audit trail). ──
  const handleCancelAppointment = useCallback(async () => {
    if (!cancelTarget) return;
    const { appt, triage } = cancelTarget;
    const prevStatus = appt.status;
    const prevVisitStatus = triage?.visitStatus;
    try {
      await updateAppointmentStatus(appt._id, 'cancelled', {
        cancelledReason: cancelReason.trim() || undefined,
        cancelledByName: currentUser?.name || currentUser?.username,
        actorId: currentUser?._id,
        actorName: currentUser?.name || currentUser?.username,
        actorRole: currentUser?.role,
      });
      if (triage) await handleWalkInStatusChange(triage, 'cancelled', true);
      showToast(`${appt.patientName} — appointment cancelled`, 'success', {
        action: {
          label: t('action.undo'),
          onClick: async () => {
            try {
              await updateAppointmentStatus(appt._id, prevStatus, {
                actorId: currentUser?._id,
                actorName: currentUser?.name || currentUser?.username,
                actorRole: currentUser?.role,
              });
              if (triage) await updateTriage(triage._id, { visitStatus: prevVisitStatus });
              showToast(`${appt.patientName} — restored to ${appointmentStatusLabel(prevStatus).toLowerCase()}`, 'success');
            } catch {
              showToast('Could not restore the appointment', 'error');
            }
          },
        },
      });
    } catch {
      showToast('Failed to cancel the appointment', 'error');
    } finally {
      setCancelTarget(null);
      setCancelReason('');
    }
  }, [cancelTarget, cancelReason, updateAppointmentStatus, updateTriage, handleWalkInStatusChange, showToast, currentUser, t]);

  // ── Move an appointment to a new date/time without leaving the desk. ──
  const openReschedule = useCallback((appt: AppointmentDoc) => {
    setRescheduleDate(isoDateKey(appt.appointmentDate));
    setRescheduleTime(appt.appointmentTime || '09:00');
    setRescheduleTarget(appt);
  }, []);

  const submitReschedule = useCallback(async () => {
    if (!rescheduleTarget || !rescheduleDate || !rescheduleTime) return;
    setReschedSaving(true);
    try {
      await rescheduleAppointment(rescheduleTarget._id, rescheduleDate, rescheduleTime);
      showToast(`${rescheduleTarget.patientName} moved to ${formatDayMonthYear(rescheduleDate)} ${formatClockTime(rescheduleTime)}`, 'success');
      setRescheduleTarget(null);
    } catch (err) {
      // A booking conflict names the clash — show it rather than a shrug.
      showToast(err instanceof Error ? err.message : 'Failed to reschedule appointment', 'error');
    } finally {
      setReschedSaving(false);
    }
  }, [rescheduleTarget, rescheduleDate, rescheduleTime, rescheduleAppointment, showToast]);

  // ── Reverse an appointment check-in: send the patient back to scheduled so
  //    a mistaken "arrived" can be corrected. Appointment status has no
  //    forward-only guard, so this round-trips cleanly. (Triage check-in has
  //    no equivalent here — see BACKEND GAPS.) ──
  const handleUndoCheckIn = useCallback(async (appt: AppointmentDoc) => {
    try {
      await updateAppointmentStatus(appt._id, 'scheduled');
      showToast(`${appt.patientName} check-in reversed`, 'success');
      setCheckInTarget(null);
    } catch {
      showToast('Failed to reverse check-in', 'error');
    }
  }, [updateAppointmentStatus, showToast]);

  // ── Reverse a completed checkout for an APPOINTMENT-sourced visit: set the
  //    appointment back to checked_in so the patient re-enters the live queue.
  //    Only appointment checkouts are reversible — a triage checkout writes the
  //    terminal `discharged` status (see BACKEND GAPS). ──
  const handleUndoCheckout = useCallback(async (appointmentId: string, patientName: string) => {
    try {
      await updateAppointmentStatus(appointmentId, 'checked_in');
      showToast(`Checkout reversed for ${patientName}`, 'success');
    } catch {
      showToast('Failed to reverse checkout', 'error');
    }
  }, [updateAppointmentStatus, showToast]);

  const roleConfig = currentUser ? getRoleConfig(currentUser.role) : null;
  const canUseRoute = useCallback((href: string) => {
    if (!roleConfig) return false;
    return roleConfig.allowedRoutes.includes(href);
  }, [roleConfig]);

  const pendingAppointments = useMemo(() => {
    // Every rung that still expects the patient — including the two the desk
    // itself sets, Reminder Sent and Arrived. Hardcoding the old three meant
    // reminding or marking someone arrived dropped their row off this list.
    // `requested` joins them: a portal ask is reception's to answer.
    const pendingStatuses = new Set<AppointmentDoc['status']>(['requested', ...APPOINTMENT_PENDING_STATUSES]);
    // Only today's triages pull a booking out of the Scheduled lane — a
    // patient triaged today must not vanish from tomorrow's schedule.
    const triagedPatientIds = new Set(viewingToday ? todaysTriages.map(item => item.patientId) : []);
    return todaysAppointments.filter(appointment => pendingStatuses.has(appointment.status) && !triagedPatientIds.has(appointment.patientId));
  }, [todaysAppointments, todaysTriages, viewingToday]);

  // The board day's header label — follows the mini-calendar, not the wall
  // clock, so picking a day changes the card title with the data.
  const dateLabel = useMemo(() => (
    new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: '2-digit' })
      .format(new Date(`${boardDate}T12:00:00`))
  ), [boardDate]);

  // Counts come from the very lists the lanes render — same day scope, same
  // status-group filing — so a tab can never advertise work it does not show.
  // Scheduled adds the bookings that have no queue row at all (nobody has
  // checked them in or triaged them yet) to any queue row still on a
  // Scheduled rung.
  const tabs = useMemo(() => ([
    { key: 'scheduled', label: APPOINTMENT_STATUS_GROUP_LABELS.scheduled, count: pendingAppointments.length + queueByLane.scheduled.length },
    { key: 'in_office', label: APPOINTMENT_STATUS_GROUP_LABELS.in_office, count: queueByLane.in_office.length },
    { key: 'finished', label: APPOINTMENT_STATUS_GROUP_LABELS.finished, count: queueByLane.finished.length },
  ]), [queueByLane, pendingAppointments.length]);

  const handleTabChange = useCallback((tab: string) => {
    setQueueFilter(tab as AppointmentStatusGroup);
    // Leave any tile-opened special view: the lane tabs drive the main list.
    setPanelView('all');
  }, []);

  const openFullRegistration = useCallback(() => {
    setRegisterOpen(false);
    router.push('/patients/new');
  }, [router]);

  const visiblePendingAppointments = useMemo(() => {
    // Pending bookings are the Scheduled lane; the tile views that list
    // appointments ('appointments'/'pending') read this list directly, so it
    // must stay populated for them regardless of the active lane tab.
    if (queueFilter !== 'scheduled' && panelView !== 'appointments' && panelView !== 'pending') return [];
    const q = queueSearch.trim().toLowerCase();
    // Same field set as the queue lanes: name, reason, department, hospital
    // number and phone — one search, identical behaviour on every tab.
    const patientById = new Map(patients.map(p => [p._id, p]));
    const items = q
      ? pendingAppointments.filter(appointment => {
          const patient = patientById.get(appointment.patientId);
          return appointment.patientName.toLowerCase().includes(q) ||
            (appointment.reason || '').toLowerCase().includes(q) ||
            (appointment.department || '').toLowerCase().includes(q) ||
            (patient?.hospitalNumber || '').toLowerCase().includes(q) ||
            (patient?.phone || appointment.patientPhone || '').toLowerCase().includes(q);
        })
      : pendingAppointments;
    return items.sort((a, b) => (a.appointmentTime || '').localeCompare(b.appointmentTime || ''));
  }, [panelView, patients, pendingAppointments, queueFilter, queueSearch]);

  // First entry is promoted to the header's primary pill — "Find availability",
  // matching the doctor module's CTA and opening the same booking dialog.
  //
  // There is no "Check in" action here any more: a patient is checked in from
  // their appointment (the row's status picker, which opens the arrival
  // dialog), so the booking is the one place a visit is started from rather
  // than a second, parallel front door.
  const actions = useMemo<EhrCareDashboardAction[]>(() => ([
    { label: 'Find availability', icon: Plus, onClick: () => setBookingOpen(true), tone: 'primary' as const },
    // The intake form wears one glyph everywhere it appears — the nav item,
    // the top rail's patient-create button, the clinical strip, and here.
    ...(canUseRoute('/patient-intake') ? [{ label: 'Intake Form', icon: Send, onClick: () => setIntakeOpen(true), tone: 'orange' as const }] : []),
    ...(canUseRoute('/patients') ? [{ label: t('frontDesk.registerNewPatient'), icon: UserPlus, onClick: () => setRegisterOpen(true) }] : []),
  ]), [canUseRoute, t]);

  // "View Referrals" / "Appointments" now live as labeled nav links in the top
  // rail (next to the module dropdown), not as shortcuts inside this card.

  // Quick-navigation strip mirroring the Clinical Officer dashboard's clinical
  // strip. Route-guarded so a clinic clerk never sees a shortcut they can't open.
  const actionStrip = useMemo<EhrCareDashboardAction[]>(() => ([
    ...(canUseRoute('/patients') ? [{ label: 'Patient Registry', icon: ClipboardList, onClick: () => router.push('/patients') }] : []),
    ...(canUseRoute('/appointments') ? [{ label: 'Appointments', icon: Calendar, onClick: () => router.push('/appointments') }] : []),
    ...(canUseRoute('/referrals') ? [{ label: 'Referrals', icon: ArrowRightLeft, onClick: () => router.push('/referrals') }] : []),
  ]), [canUseRoute, router]);

  const frontDeskRows = useMemo<EhrCareDashboardRow[]>(() => {
    const patientById = new Map(patients.map(patient => [patient._id, patient]));
    const appointmentRows: EhrCareDashboardRow[] = visiblePendingAppointments.map(appointment => {
      const patient = patientById.get(appointment.patientId);
      const patientMeta = patient
        ? `${patientAgeLabel(patient)}${patient.gender ? ` · ${String(patient.gender).charAt(0).toUpperCase()}` : ''}`
        : '';
      return {
        id: `pending-appt-${appointment._id}`,
        photoUrl: (patient as { photoUrl?: string } | undefined)?.photoUrl,
        title: appointment.patientName,
        subtitle: [appointment.reason || 'Scheduled visit', patientMeta].filter(Boolean).join(' · '),
        meta: `${formatClockTime(appointment.appointmentTime) || 'No time'} · ${appointment.providerName || patient?.assignedDoctorName || 'Unassigned'} · ${appointment.facilityName || currentUser?.hospitalName || 'Facility'}`,
        compactMeta: formatClockTime(appointment.appointmentTime) || 'No time',
        time: formatClockTime(appointment.appointmentTime) || undefined,
        timeSecondary: isoDateKey(appointment.appointmentDate),
        timeAt: appointmentMoment(appointment.appointmentDate, appointment.appointmentTime),
        careTeam: appointment.providerName || patient?.assignedDoctorName || 'Doctor unassigned',
        careTeamSecondary: patient?.assignedByName || 'Nurse unassigned',
        careTeamLabel: 'Care team',
        location: appointment.department || appointment.facilityName || patientFacilityName(patient, currentUser?.hospitalName || 'Facility'),
        locationSecondary: appointment.department ? patientFacilityName(patient, currentUser?.hospitalName || 'Facility') : 'Location',
        locationLabel: appointment.department ? 'Department' : 'Location',
        // The pill states the rung the booking is actually on — Reminder Sent
        // and Arrived used to collapse into a flat "Scheduled", which hid the
        // desk's own work from it.
        status: appointment.status,
        statusLabel: appointmentStatusLabel(appointment.status),
        // The pill IS the picker: reception moves a booking along the ladder
        // from the row it is reading. Check-in, no-show and cancel route to
        // their own dialogs (see handleAppointmentStatusChange) rather than
        // being written straight from a dropdown.
        statusValue: appointment.status,
        statusOptions: canSetAppointmentStatus
          ? APPOINTMENT_STATUS_OPTIONS.map(option => ({ value: option, label: appointmentStatusLabel(option) }))
          : undefined,
        onStatusChange: canSetAppointmentStatus
          ? value => handleAppointmentStatusChange(appointment, value as AppointmentStatus)
          : undefined,
        telehealth: appointment.appointmentMode === 'telehealth' || appointment.appointmentType === 'telehealth',
        // The line under the pill states the booking's urgency in the shared
        // Emergency/Urgent/Routine words. It used to write 'Appointment' for
        // anything routine — the row's type, not its priority — so the column
        // read in two vocabularies at once and the majority of rows said
        // nothing about how urgent they were.
        statusSecondary: appointmentPriorityLabel(appointment.priority),
        statusTone: APPOINTMENT_STATUS_TONES[appointment.status],
        // Every booking carries its acuity code, routine included. The word and
        // its colour come from the same value, so "Routine" is green here and
        // on the clinician's worklist rather than green on rows that happen to
        // have been triaged and grey on the ones that have not.
        priority: appointmentTriage(appointment.priority),
        date: isoDateKey(appointment.appointmentDate),
        patientId: appointment.patientId,
        // The row drops down into the appointment itself, the way the doctor
        // dashboard's rows drop down into a visit — no pop-up over the list, and
        // nothing restating what the row already shows.
        popupDetail: (
          <RowAppointmentEditor
            appointment={appointment}
            appointments={appointments}
            patient={patient}
          />
        ),
      };
    });

    const queueRows = filteredQueue.map(entry => {
      const patient = patients.find(pp => pp._id === entry.patientId);
      const activeForCare = entry.status === 'WAITING' || entry.status === 'IN CONSULT';
      // A slot closed without the patient being seen is finished, but there is
      // no visit to check out — it gets its own pill, never the Checkout action.
      const checkoutReady = entry.status === 'DONE' && !entry.closedStatus;
      const statusTone: EhrCareDashboardRow['statusTone'] = entry.closedStatus
        ? APPOINTMENT_STATUS_TONES[entry.closedStatus]
        : entry.status === 'DONE'
        ? 'done'
        : entry.status === 'IN CONSULT'
          ? 'active'
          : entry.overTarget
            ? 'warning'
            : entry.priority === 'RED'
              ? 'danger'
              : entry.priority === 'YELLOW'
                ? 'warning'
                : 'ready';
      // Triage-sourced rows carry the real acuity code, so they get the same
      // RED/YELLOW/GREEN pill the doctor and nurse see for this patient.
      // Appointment/registration rows have no acuity — the pill falls back
      // to the status label instead (handled by the shared row renderer).
      const acuity = entry.priority === 'RED' || entry.priority === 'YELLOW' || entry.priority === 'GREEN'
        ? entry.priority
        : undefined;
      // Status column: the plain human state, distinct from the stage
      // vocabulary now shown in Context.
      const statusLabel = entry.status === 'DONE'
        ? (entry.stageLabel || 'Done')
        : entry.status === 'IN CONSULT'
          ? 'In consult'
          : 'Waiting';
      // Context column: for triage-sourced rows, the same stage vocabulary
      // (STAGE_LABELS) the doctor's Queue column shows for this patient;
      // arrived-but-untriaged appointments show their department instead;
      // checkout-only rows (no triage/appointment on file today) keep the
      // honest 'Checkout' state already on the entry.
      const context = entry.stage ? STAGE_LABELS[entry.stage]
        : entry.type === 'appointment' ? entry.department
        : entry.location || entry.department;
      // Same shared acuity words the Appointments tab of this very dashboard
      // uses; this branch called RED "Critical", so one column said two
      // different things depending on which tab you were on.
      const statusContext = acuity ? PRIORITY_META[acuity].label : entry.stageLabel || context;
      // Wait column: actual queue/slot time on the first line; the shared
      // dashboard row renders hours/minutes underneath from `timeAt`.
      const waitTime = entry.time || entry.date || undefined;

      // Whatever this row is really about: a booking, or a walk-in's triage
      // record. Both carry the same ladder, so the desk sets status the same
      // way for every patient in the building. Computed up front (not just
      // inside the ladder-status block below) so checkout below can complete
      // the SAME linked appointment for a triage-sourced row, not only rows
      // whose queue entry happened to originate as 'appt-'.
      const queueAppointment = entry.id.startsWith('appt-')
        ? todaysAppointments.find(a => a._id === entry.sourceId)
        // A triage-sourced row still belongs to a booking when the patient has
        // one today — check-in now creates one for every walk-in, so the row
        // gets the same ladder and the same panel as anyone else.
        : todaysAppointments.find(a => a.patientId === entry.patientId);

      // Icon actions for the row's inline panel. "Open chart" is always
      // offered; the primary desk action (Checkout/Assign) and the secondary
      // one (Undo/Start consultation) mirror the same state machine the old
      // popup's buttons used — a plain "Record" fallback isn't needed here
      // since Open chart already covers it.
      const popupActions: { icon: LucideIcon; label: string; onClick: () => void; primary?: boolean }[] = [
        { icon: FileText, label: 'Open Chart', onClick: () => router.push(`/patients/${entry.patientId}`) },
      ];
      if (checkoutReady) {
        popupActions.push({
          icon: LogOut,
          label: t('frontDesk.checkout'),
          primary: true,
          onClick: () => setCheckoutTarget({
            patientId: entry.patientId,
            patientName: entry.patientName,
            hospitalNumber: patient?.hospitalNumber,
            encounterId: entry.encounterId,
            // Every walk-in now has its own booking (check-in-service), so a
            // triage-sourced row must complete it too — otherwise the queue
            // row reads DONE while its appointment sits at checked_in forever.
            appointmentId: queueAppointment?._id,
            triageId: entry.id.startsWith('triage-') ? entry.sourceId : undefined,
          }),
        });
      } else if (activeForCare) {
        popupActions.push({
          icon: Stethoscope,
          label: t('frontDesk.assign'),
          primary: true,
          onClick: () => setAssignTarget({
            patientId: entry.patientId,
            patientName: entry.patientName,
            hospitalNumber: patient?.hospitalNumber,
            triageId: entry.id.startsWith('triage-') ? entry.sourceId : undefined,
            currentDoctorId: patient?.assignedDoctor,
          }),
        });
      }
      if (checkoutReady && entry.id.startsWith('appt-')) {
        popupActions.push({ icon: RotateCcw, label: t('action.undo'), onClick: () => handleUndoCheckout(entry.sourceId, entry.patientName) });
      } else if (canConsult && activeForCare) {
        popupActions.push({ icon: Stethoscope, label: t('frontDesk.startConsultation'), onClick: () => router.push(`/consultation?patientId=${entry.patientId}`) });
      }
      const hasAllergies = Boolean(patient?.allergies?.length) && patient?.allergies[0] !== 'None known';

      const queueTriage = entry.id.startsWith('triage-')
        ? triages.find(tr => tr._id === entry.sourceId)
        : undefined;
      // The pill reads the SAME field the lane was filed by, so a row can
      // never show "Scheduled" while sitting under In Office. Resolved once,
      // when the queue item was built.
      const ladderStatus = entry.visitStatus;
      return {
        id: entry.id,
        photoUrl: (patient as { photoUrl?: string } | undefined)?.photoUrl,
        title: entry.patientName,
        subtitle: `${entry.complaint} · ${entry.department}`,
        meta: `${entry.gender} · ${entry.age}${entry.assignedDoctorName ? ` · ${entry.assignedDoctorName}` : ''}`,
        compactMeta: entry.waitMinutes != null ? waitLabel(entry.waitMinutes) : (entry.time || entry.date),
        time: waitTime,
        timeSecondary: entry.waitMinutes != null ? waitLabel(entry.waitMinutes) : entry.calendarDate,
        timeAt: entry.timeAt,
        status: entry.status.toLowerCase(),
        statusLabel: ladderStatus ? appointmentStatusLabel(ladderStatus) : statusLabel,
        statusSecondary: statusContext,
        statusTone: ladderStatus ? APPOINTMENT_STATUS_TONES[ladderStatus] : statusTone,
        // A queue row is movable too — advancing a checked-in patient to
        // Roomed, or closing them out, is the desk's most common action. The
        // walk-in's triage row is mirrored in the same write so the two
        // records never disagree (see the handler).
        statusValue: ladderStatus,
        statusOptions: canSetAppointmentStatus
          ? APPOINTMENT_STATUS_OPTIONS.map(option => ({ value: option, label: appointmentStatusLabel(option) }))
          : undefined,
        onStatusChange: canSetAppointmentStatus
          ? async (value: string) => {
              const next = value as AppointmentStatus;
              if (queueAppointment) await handleAppointmentStatusChange(queueAppointment, next, queueTriage);
              else if (queueTriage) await handleWalkInStatusChange(queueTriage, next);
            }
          : undefined,
        priority: acuity,
        room: entry.assignedRoom,
        careTeam: entry.assignedDoctorName || 'Doctor unassigned',
        careTeamSecondary: entry.assignedNurseName || 'Nurse unassigned',
        careTeamLabel: 'Care team',
        location: context,
        locationSecondary: entry.stage ? entry.department : entry.location || entry.department,
        locationLabel: entry.stage ? 'Stage' : entry.type === 'appointment' ? 'Department' : 'Location',
        date: entry.calendarDate,
        patientId: entry.patientId,
        // The same panel a Scheduled row opens — tabs for the appointment,
        // provider & staff, and status & billing — so a patient's row looks
        // and behaves the same wherever they are in the day. Decided by the
        // row's OWN kind, not by whether an appointment matched: every walk-in
        // now has its own booking (check-in-service), so `queueAppointment`
        // alone would swap a triage/queue row over to this panel too and hide
        // the exam-room / doctor / nurse assignment controls below, which are
        // built for exactly those patients.
        // Having a booking is what decides the panel — not what kind of row it
        // came from. The old test (`entry.id.startsWith('appt-')`) meant a
        // patient who arrived as a walk-in kept the legacy facts-and-assign
        // panel even after check-in gave them a real appointment, so the same
        // booking looked different depending on which door it came through.
        // Rows with no booking at all still get the legacy panel: there is
        // nothing for the editor to edit.
        popupDetail: queueAppointment ? (
          <RowAppointmentEditor
            appointment={queueAppointment}
            appointments={appointments}
            patient={patient}
          />
        ) : (
          <>
            <FrontDeskDetailActions actions={popupActions} />
            <FrontDeskDetailFacts facts={[
              { label: t('patient.phone'), value: patient?.phone ? formatPhoneDisplay(patient.phone) : undefined },
              { label: 'Hospital number', value: patient?.hospitalNumber },
            ]} />
            {hasAllergies && (
              <p className="ehr-care-alert">{t('frontDesk.allergiesLabel', { list: (patient?.allergies ?? []).join(', ') })}</p>
            )}
            {/* Room, doctor and nurse share one line — three stacked blocks ate
                more of the row panel than the fields they contain. */}
            <div className="ehr-care-assign-grid">
            {entry.id.startsWith('triage-') && (
              <RoomAssignmentControl
                triageId={entry.sourceId}
                currentRoom={entry.assignedRoom}
                priority={entry.priority}
                roomOptions={roomOptions}
                onSave={handleSaveRoom}
              />
            )}
            {/* Room, doctor, nurse — the three things reception routes, all in
                the row, all the same control. */}
            {canAssignCareTeam && patient && (
              <>
                <StaffAssignmentControl
                  icon={Stethoscope}
                  label="Doctor"
                  staff={assignableDoctors}
                  currentId={patient.assignedDoctor}
                  currentName={patient.assignedDoctorName}
                  emptyLabel="Unassigned"
                  onSave={doctorId => handleAssignDoctor(patient, doctorId, entry.id.startsWith('triage-') ? entry.sourceId : undefined)}
                />
                <StaffAssignmentControl
                  icon={ClipboardCheck}
                  label="Nurse"
                  staff={assignableNurses}
                  currentId={patient.assignedNurse}
                  currentName={patient.assignedNurseName}
                  emptyLabel="Unassigned"
                  onSave={nurseId => handleAssignNurse(patient, nurseId)}
                />
              </>
            )}
            </div>
          </>
        ),
      };
    });

    const makeRegisteredRow = (patient: PatientDoc): EhrCareDashboardRow => {
      const registered = splitDateTime(patientRegisteredAt(patient));
      return {
        id: `registered-${patient._id}`,
        photoUrl: (patient as { photoUrl?: string }).photoUrl,
        title: patientFullName(patient),
        subtitle: patient.hospitalNumber || patientGenderAge(patient),
        meta: `${patientGenderAge(patient)} · ${registered.date}${registered.time ? ` · ${registered.time}` : ''}`,
        compactMeta: registered.time || registered.date,
        time: registered.time || undefined,
        timeSecondary: registered.date,
        timeAt: registered.time ? patientRegisteredAt(patient) : undefined,
        careTeam: patient.assignedDoctorName || 'Doctor unassigned',
        careTeamSecondary: patient.assignedByName || 'Nurse unassigned',
        careTeamLabel: 'Care team',
        location: patientFacilityName(patient, currentUser?.hospitalName || 'Registration'),
        locationSecondary: [patient.county, patient.state].filter(Boolean).join(', ') || 'Location',
        locationLabel: 'Location',
        status: 'registered',
        statusLabel: 'Registered',
        statusSecondary: patient.assignmentStatus === 'completed'
          ? 'Visit completed'
          : patient.assignmentStatus === 'accepted' || patient.assignmentStatus === 'in_progress'
            ? 'Provider accepted'
            : patient.assignedDoctor
              ? 'Assigned'
              : 'Needs care team',
        statusTone: 'ready',
        date: isoDateKey(patientRegisteredAt(patient)),
        patientId: patient._id,
        popupDetail: (
          <>
            <FrontDeskDetailActions actions={[
              { icon: FileText, label: 'Open Chart', onClick: () => router.push(`/patients/${patient._id}`), primary: true },
              {
                icon: Stethoscope,
                label: patient.assignedDoctor ? t('frontDesk.reassign') : t('frontDesk.assign'),
                onClick: () => setAssignTarget({
                  patientId: patient._id,
                  patientName: patientFullName(patient),
                  hospitalNumber: patient.hospitalNumber,
                  currentDoctorId: patient.assignedDoctor,
                }),
              },
            ]} />
            <FrontDeskDetailFacts facts={[
              { label: t('patient.phone'), value: patient.phone ? formatPhoneDisplay(patient.phone) : undefined },
              { label: 'Assigned doctor', value: patient.assignedDoctorName },
              {
                label: t('frontDesk.lastVisit'),
                value: patient.lastConsultedAt ? formatCompactDateTime(patient.lastConsultedAt) : (patient.lastVisitDate || t('frontDesk.firstVisit')),
              },
            ]} />
          </>
        ),
      };
    };

    const registeredRows: EhrCareDashboardRow[] = filteredRegisteredPatients.map(makeRegisteredRow);

    if (panelView === 'pending') return appointmentRows;
    if (panelView === 'queue') return queueRows;
    if (panelView === 'registered') return registeredRows;
    return [...appointmentRows, ...queueRows];
  }, [
    canConsult,
    canSetAppointmentStatus,
    currentUser?.hospitalName,
    filteredQueue,
    filteredRegisteredPatients,
    handleAppointmentStatusChange,
    handleSaveRoom,
    handleUndoCheckout,
    patients,
    panelView,
    openReschedule,
    roomOptions,
    router,
    t,
    visiblePendingAppointments,
  ]);

  /**
   * The rail's tiles count the same three lanes the tab strip counts, and
   * clicking one selects that lane in the list. They used to count raw
   * documents — every appointment today, every triage row — while the tabs
   * counted deduped rows, so the rail said 34/2/29 where the list said 2/28/1;
   * and each tile set its own `panelView`, which made them feel like separate
   * pages. Deriving both from `tabs` means they cannot disagree.
   */
  /**
   * Reception panel: today's board by ETAT acuity, not by status.
   *
   * It used to list appointment statuses, which the lane tabs above already
   * count — the desk read the same three numbers twice. How many emergencies
   * are waiting is the question the front desk actually has, and it is the one
   * thing the tabs cannot answer.
   *
   * Words, colours and order all come from `triage-display`, the single
   * description of RED/YELLOW/GREEN, so "Emergency" here is the same word and
   * the same red as on the clinician's worklist.
   */
  const metrics = useMemo<EhrCareDashboardMetric[]>(() => {
    const counts = new Map<TriagePriority, number>();
    for (const item of boardQueue) {
      if (isTriagePriority(item.priority)) {
        counts.set(item.priority, (counts.get(item.priority) ?? 0) + 1);
      }
    }
    // Most urgent first — `order` on the acuity table, not this file's opinion.
    const ACUITY_TONE: Record<TriagePriority, EhrCareDashboardMetric['tone']> = {
      RED: 'danger', YELLOW: 'warning', GREEN: 'success',
    };
    return (['RED', 'YELLOW', 'GREEN'] as TriagePriority[]).map(code => {
      const count = counts.get(code) ?? 0;
      return {
        label: PRIORITY_META[code].label,
        value: count,
        // A zero is not an alarm: an empty emergency lane reads neutral, the
        // same way the status panel treated its empty rungs.
        tone: count === 0 ? ('neutral' as const) : ACUITY_TONE[code],
      };
    });
  }, [boardQueue]);

  // No subtitle line under the board title: the lane tabs and the Reception
  // status panel already carry the counts, so the "24 patients scheduled"
  // sentence only restated them.
  const centerCopy = useMemo(() => {
    if (panelView === 'appointments') {
      return {
        title: "Today's appointments",
        emptyTitle: 'No appointments for this view',
        emptyActionLabel: 'Book appointment',
      };
    }
    if (panelView === 'pending') {
      return {
        title: 'Pending arrivals',
        emptyTitle: 'No pending arrivals',
        emptyActionLabel: 'Open schedule',
      };
    }
    if (panelView === 'queue') {
      return {
        title: 'Live queue',
        emptyTitle: t('frontDesk.noPatientsInQueue'),
        emptyActionLabel: 'Register patient',
      };
    }
    if (panelView === 'registered') {
      return {
        title: 'Registered patients',
        emptyTitle: 'No registered patients',
        emptyActionLabel: 'Register patient',
      };
    }
    return {
      title: dateLabel,
      emptyTitle: queueFilter === 'scheduled' ? 'No appointments still expected'
        : queueFilter === 'in_office' ? t('frontDesk.noPatientsInQueue')
        : 'No finished visits yet',
      emptyActionLabel: 'Register patient',
    };
  }, [dateLabel, panelView, queueFilter, t]);

  if (!currentUser) return null;

  return (
    <>
      <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <EhrCareDashboard
          title=""
          greetingName={currentUser.name || 'front desk'}
          dateLabel={dateLabel}
          tabs={tabs}
          activeTab={queueFilter}
          onTabChange={handleTabChange}
          searchValue={queueSearch}
          searchPlaceholder="Search patients, reasons, departments"
          onSearchChange={setQueueSearch}
          filters={[]}
          actions={actions}
          actionStrip={actionStrip}
          chartSeriesNames={['Active', 'Completed']}
          // The list below is one day's schedule, so charting it left a single
          // bar under a "This week" heading. The chart reads the whole booking
          // list instead — the same source the mini-calendar above it dots.
          chartItems={weekChartItems}
          rows={frontDeskRows}
          metrics={metrics}
          calendarEventDates={appointments.map(appointment => appointment.appointmentDate)}
          // The page owns the calendar's selected day: picking a date rebuilds
          // every lane, count and header for that day's schedule.
          selectedDate={boardDate}
          onSelectedDateChange={setBoardDate}
          // Static title: the card's counts follow the selected day already; a
          // date in the title just restated the header and wrapped badly.
          metricsTitle="Reception"
          centerTitle={centerCopy.title}
          centerSubtitle=""
          missionTitle="Keep the desk moving"
          missionDescription="Show the next action clearly so reception can register, check in, route, and close visits."
          showMissionCard
          // Reception rows already open the patient detail on click, so the
          // per-row pencil is redundant.
          showRowOpenAction={false}
          emptyTitle={centerCopy.emptyTitle}
          emptyActionLabel={centerCopy.emptyActionLabel}
          onEmptyAction={() => {
            // "Pending arrivals" sends the clerk to the schedule, where a
            // patient is checked in from their own appointment row.
            if (panelView === 'appointments' || panelView === 'pending') {
              router.push('/appointments');
              return;
            }
            setRegisterOpen(true);
          }}
        />

        {bookingOpen && (
          <BookAppointmentModal
            defaultDate={boardDate}
            onClose={() => setBookingOpen(false)}
          />
        )}

        {intakeOpen && <SendIntakeFormsModal onClose={() => setIntakeOpen(false)} />}

        {editAppointment && (
          <AppointmentEditModal
            appointment={editAppointment}
            appointments={appointments}
            patient={patients.find(p => p._id === editAppointment.patientId)}
            onClose={() => setEditAppointment(null)}
          />
        )}

        {assignTarget && (
          <AssignDoctorModal
            target={assignTarget}
            onClose={() => setAssignTarget(null)}
          />
        )}

        {checkoutTarget && (
          <CheckoutModal
            target={checkoutTarget}
            onClose={() => setCheckoutTarget(null)}
            onComplete={handleCompleteCheckout}
            canCollectPayment={canUseRoute('/payments')}
            onCollectPayment={(pid) => {
              router.push(`/payments?patientId=${pid}`);
            }}
          />
        )}

        {registerOpen && (
          <Modal onClose={() => setRegisterOpen(false)} width={1180} align="center" disableBackdropClose labelledBy="patient-registration-dialog-title">
            <div className="ehr-checkin-dialog ehr-registration-dialog">
              {/* No header band. The form states its own title in the rail
                  ("Register New Patient"), so the bar above it repeated that
                  and spent 60px of a dialog that has to hold a long form.
                  The two controls it carried are pinned over the body instead
                  — they stay put while the form scrolls under them. The
                  heading the dialog is labelled by moves with them, visually
                  hidden, so `aria-labelledby` still resolves. */}
              <div className="ehr-registration-dialog-actions">
                <h2 id="patient-registration-dialog-title" className="sr-only">
                  {t('frontDesk.registerNewPatient')}
                </h2>
                <button type="button" onClick={openFullRegistration} aria-label="Expand patient registration">
                  <Maximize2 className="w-4 h-4" />
                </button>
                <button type="button" onClick={() => setRegisterOpen(false)} aria-label="Close patient registration">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="ehr-checkin-dialog-body">
                <PatientRegistrationForm
                  embedded
                  onCancel={() => setRegisterOpen(false)}
                  onRegistered={() => {
                    setRegisterOpen(false);
                    setPanelView('registered');
                    router.refresh();
                  }}
                />
              </div>
            </div>
          </Modal>
        )}

        {rescheduleTarget && (
          <Modal onClose={() => !reschedSaving && setRescheduleTarget(null)} width={420} labelledBy="reschedule-dialog-title">
            <div className="card-elevated" style={{ padding: 24, borderRadius: 16, background: 'var(--bg-card)' }}>
              <h2 id="reschedule-dialog-title" className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>
                Reschedule appointment
              </h2>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                {rescheduleTarget.patientName} · currently {formatDayMonthYear(rescheduleTarget.appointmentDate)} {formatClockTime(rescheduleTarget.appointmentTime)}
              </p>
              <div className="grid grid-cols-2 gap-3 mt-4">
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--text-muted)' }}>New date</label>
                  <input type="date" value={rescheduleDate} min={today} onChange={e => setRescheduleDate(e.target.value)} />
                </div>
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--text-muted)' }}>New time</label>
                  <Select value={rescheduleTime} onChange={e => setRescheduleTime(e.target.value)}>
                    {RESCHEDULE_SLOTS.map(slot => <option key={slot} value={slot}>{formatClockTime(slot)}</option>)}
                  </Select>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRescheduleTarget(null)} disabled={reschedSaving}>
                  {t('action.cancel')}
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={submitReschedule} disabled={reschedSaving || !rescheduleDate || !rescheduleTime}>
                  {reschedSaving ? 'Saving…' : 'Reschedule'}
                </button>
              </div>
            </div>
          </Modal>
        )}

        {noShowTarget && (
          <Modal onClose={() => setNoShowTarget(null)} width={380} labelledBy="no-show-dialog-title">
            <div className="card-elevated" style={{ padding: 24, borderRadius: 16, background: 'var(--bg-card)' }}>
              <h2 id="no-show-dialog-title" className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>Mark as no-show?</h2>
              <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>
                {noShowTarget.patientName} — {formatClockTime(noShowTarget.appointmentTime)}. Check the waiting room first; this removes them from today&apos;s arrivals.
              </p>
              <div className="flex justify-end gap-2 mt-5">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNoShowTarget(null)}>{t('action.cancel')}</button>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => handleNoShow(noShowTarget)}>Mark no-show</button>
              </div>
            </div>
          </Modal>
        )}

        {cancelTarget && (
          <Modal onClose={() => setCancelTarget(null)} width={420} labelledBy="cancel-dialog-title">
            <div className="card-elevated" style={{ padding: 24, borderRadius: 16, background: 'var(--bg-card)' }}>
              <h2 id="cancel-dialog-title" className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>Cancel this appointment?</h2>
              <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>
                {cancelTarget.appt.patientName} — {formatClockTime(cancelTarget.appt.appointmentTime)}.
                The booking stays on record under Finished; you can undo from the notification or reopen it later.
              </p>
              <label className="block text-xs font-semibold mt-4 mb-1" style={{ color: 'var(--text-secondary)' }} htmlFor="front-desk-cancel-reason">
                Reason (optional)
              </label>
              <textarea
                id="front-desk-cancel-reason"
                value={cancelReason}
                onChange={event => setCancelReason(event.target.value)}
                rows={2}
                placeholder="e.g. patient called to cancel"
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)', resize: 'vertical' }}
              />
              <div className="flex justify-end gap-2 mt-5">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCancelTarget(null)}>{t('appointments.goBack')}</button>
                <button type="button" className="btn btn-primary btn-sm" style={{ background: 'var(--color-danger)', borderColor: 'var(--color-danger)' }} onClick={() => void handleCancelAppointment()}>
                  Cancel appointment
                </button>
              </div>
            </div>
          </Modal>
        )}

        {checkInTarget && (
          <CheckInModal
            appt={checkInTarget}
            onClose={() => setCheckInTarget(null)}
            onCheckIn={handleCheckIn}
            onUndoCheckIn={handleUndoCheckIn}
            onViewPatient={(pid) => router.push(`/patients/${pid}`)}
          />
        )}
      </main>
    </>
  );
}

/* ─── Row-detail panel pieces (inline expansion) ───
   The queue row's popup used to be a Modal; it now drops open in place under
   the row (EhrCareDashboard's shared inline-expansion shell). These three
   pieces reproduce that popup's shape without the dialog chrome: an icon
   action line matching the doctor worklist's ehr-visit-pop-* classes, a
   label/value fact grid for what the row itself doesn't already show, and —
   for triage-sourced rows — the exam-room control. */

// Icon actions on the panel's first line (Open chart / Check in / Assign /
// etc.), reusing EhrVisitPopup's classes so every role's inline panel reads
// the same way. No tabs here — front desk has one view per row — so the
// "tabs" row is just the flex/border-bottom line the icons sit on.
function FrontDeskDetailActions({ actions }: {
  actions: { icon: LucideIcon; label: string; onClick: () => void; primary?: boolean }[];
}) {
  return (
    <div className="ehr-visit-pop-tabs">
      <div className="ehr-visit-pop-actions">
        {actions.map(action => (
          <button
            key={action.label}
            type="button"
            className={`ehr-visit-pop-icon${action.primary ? ' is-primary' : ''}`}
            onClick={action.onClick}
            aria-label={action.label}
            title={action.label}
          >
            <action.icon className="w-4 h-4" aria-hidden />
          </button>
        ))}
      </div>
    </div>
  );
}

// Label/value facts unique to this row — never the name/time/status the row
// above already shows. Empty values are dropped rather than rendered blank.
function FrontDeskDetailFacts({ facts }: { facts: { label: string; value?: string }[] }) {
  const visible = facts.filter((f): f is { label: string; value: string } => Boolean(f.value));
  if (visible.length === 0) return null;
  return (
    <div className="ehr-row-detail__body">
      {visible.map(f => (
        <div className="appointment-detail-row" key={f.label}>
          <dt>{f.label}</dt>
          <dd>{f.value}</dd>
        </div>
      ))}
    </div>
  );
}

/**
 * Care-team assignment for a row — the doctor carrying the visit and the nurse
 * covering the patient, each the same shape as the exam-room control beside
 * them: pick from the facility's staff, press the button, done in the row.
 *
 * The doctor path runs the shared provider assignment (patient fields, the
 * consultation tracker the provider's board reads, and the triage handoff
 * stamp), which is the same path the Assign-provider modal uses. The nurse path
 * only records who is covering, which is all nursing cover means here.
 */
function StaffAssignmentControl({
  icon: Icon,
  label,
  staff,
  currentId,
  currentName,
  emptyLabel,
  onSave,
}: {
  icon: LucideIcon;
  label: string;
  staff: { _id: string; name?: string; username?: string }[];
  currentId?: string;
  currentName?: string;
  emptyLabel: string;
  onSave: (staffId: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(currentId || '');
  const [saving, setSaving] = useState(false);
  return (
    <div className="ehr-care-rooming">
      <Icon className="w-4 h-4" />
      <span>{label}</span>
      <Select value={draft} onChange={event => setDraft(event.target.value)}>
        <option value="">{emptyLabel}</option>
        {/* A provider assigned from elsewhere may not be in this facility's
            staff list; keep them selectable so the control never misreports. */}
        {currentId && !staff.some(person => person._id === currentId) && (
          <option value={currentId}>{currentName || 'Currently assigned'}</option>
        )}
        {staff.map(person => (
          <option key={person._id} value={person._id}>{person.name || person.username}</option>
        ))}
      </Select>
      <button
        type="button"
        disabled={saving || draft === (currentId || '')}
        onClick={async () => { setSaving(true); try { await onSave(draft); } finally { setSaving(false); } }}
      >
        {saving ? 'Saving...' : currentId ? 'Update' : 'Assign'}
      </button>
    </div>
  );
}

// Exam-room assignment for a triage-sourced queue row. Saving state is local
// to this component (not page-level) because it now mounts fresh each time
// its row expands, rather than being the single target of a page-level modal.
function RoomAssignmentControl({
  triageId,
  currentRoom,
  priority,
  roomOptions,
  onSave,
}: {
  triageId: string;
  currentRoom?: string;
  priority: 'RED' | 'YELLOW' | 'GREEN' | 'normal';
  roomOptions: string[];
  onSave: (triageId: string, room: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(currentRoom || '');
  const [saving, setSaving] = useState(false);
  return (
    <div className="ehr-care-rooming">
      <MapPin className="w-4 h-4" />
      <span>Exam room</span>
      {/* The acuity belongs on the header line, not on a third line below the
          button — that extra line was what knocked this control out of
          alignment with the doctor and nurse pickers beside it. */}
      <span style={{ color: priorityColor(priority) }}>
        {t(priorityLabelKey(priority))}
      </span>
      <Select value={draft} onChange={(event) => setDraft(event.target.value)}>
        <option value="">Unassigned</option>
        {roomOptions.map(room => <option key={room} value={room}>{room}</option>)}
      </Select>
      <button
        type="button"
        disabled={saving}
        onClick={async () => { setSaving(true); try { await onSave(triageId, draft); } finally { setSaving(false); } }}
      >
        {saving ? 'Saving...' : currentRoom ? 'Update' : 'Assign'}
      </button>
    </div>
  );
}

// ── Final-checkout modal: confirm balance settled, mark the visit complete ──
function CheckoutModal({
  target,
  onClose,
  onComplete,
  canCollectPayment,
  onCollectPayment,
}: {
  target: CheckoutTarget;
  onClose: () => void;
  onComplete: (
    target: CheckoutTarget,
    override?: { reason: string; authorizedBy: string },
    disposition?: import('@/lib/services/encounter-service').DischargeDisposition,
  ) => Promise<void>;
  canCollectPayment: boolean;
  onCollectPayment: (patientId: string) => void;
}) {
  const [balance, setBalance] = useState<number | null>(null);
  const [charges, setCharges] = useState<{ description: string; amount: number }[]>([]);
  const [completing, setCompleting] = useState(false);
  // Live checkout-gate evaluation (KAN-96): unmet critical conditions render
  // here with a route to resolve each, and block the button until either
  // resolved or explicitly overridden with a reason.
  const [gate, setGate] = useState<import('@/lib/services/checkout-gate-service').CheckoutGateEvaluation | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  // An override needs a named authorizer, not just a reason — "reason +
  // authorization, logged" is the documented gate rule (Principle 2.12).
  const [overrideAuthorizedBy, setOverrideAuthorizedBy] = useState('');
  const [disposition, setDisposition] = useState<import('@/lib/services/encounter-service').DischargeDisposition>('discharged');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getPatientBalance } = await import('@/lib/services/ledger-service');
        const b = await getPatientBalance(target.patientId);
        if (!cancelled) setBalance(b);
      } catch {
        if (!cancelled) setBalance(0);
      }
      // Itemized fee ticket for this visit so the desk sees what was billed.
      try {
        const { getEncounter, getOpenEncounterForPatient } = await import('@/lib/services/encounter-service');
        const enc = target.encounterId
          ? await getEncounter(target.encounterId)
          : await getOpenEncounterForPatient(target.patientId);
        if (enc) {
          const { getChargesByEncounter } = await import('@/lib/services/payment-service');
          const ch = await getChargesByEncounter(enc._id);
          if (!cancelled) setCharges(ch.map(c => ({ description: c.description, amount: c.billedAmount })));
        }
        // The same evaluation the discharge handler runs, shown up front so
        // the desk can resolve conditions before pressing the button.
        const { evaluateCheckoutGate } = await import('@/lib/services/checkout-gate-service');
        const evaluation = await evaluateCheckoutGate(target.patientId, (enc ?? undefined) as never);
        if (!cancelled) setGate(evaluation);
      } catch { /* non-fatal — balance still shows */ }
    })();
    return () => { cancelled = true; };
  }, [target.encounterId, target.patientId]);

  const owes = (balance ?? 0) > 0;

  return (
    <Modal onClose={onClose} width={440}>
      <div className="modal-content card-elevated" style={{ width: '100%' }}>
        {/* Header */}
        <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="flex items-center gap-2">
            <LogOut className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
            <div>
              <h2 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>Final checkout</h2>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {target.patientName}{target.hospitalNumber ? ` · ${target.hospitalNumber}` : ''}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg transition-colors hover:bg-black/5" aria-label="Close">
            <X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          {charges.length > 0 && (
            <div className="rounded-xl p-3" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-muted)' }}>Visit charges</p>
              <ul className="space-y-1">
                {charges.map((c, i) => (
                  <li key={i} className="flex justify-between text-[12px]">
                    <span style={{ color: 'var(--text-primary)' }}>{c.description}</span>
                    <span className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>{formatMoney(c.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {balance === null ? (
            <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>Checking balance…</p>
          ) : owes ? (
            <div className="rounded-xl p-3" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)' }}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-danger-text)' }}>Outstanding balance</span>
                <Wallet className="w-4 h-4" style={{ color: 'var(--color-danger-text)' }} />
              </div>
              <p className="text-2xl font-bold mt-1 tabular-nums" style={{ color: 'var(--color-danger-text)' }}>{formatMoney(balance)}</p>
              {canCollectPayment ? (
                <button
                  onClick={() => onCollectPayment(target.patientId)}
                  className="mt-2.5 w-full text-[12px] font-semibold py-2 rounded-lg text-white transition-opacity hover:opacity-90 flex items-center justify-center gap-1.5"
                  style={{ background: 'var(--color-danger)' }}
                >
                  <Wallet className="w-4 h-4" />Collect payment
                </button>
              ) : (
                <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
                  Send this patient to cashier or billing to collect payment.
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-xl p-3 flex items-center gap-2" style={{ background: 'var(--accent-light)', border: '1px solid var(--border-light)' }}>
              <CheckCircle className="w-5 h-5" style={{ color: 'var(--color-success)' }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Balance settled</p>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>No outstanding charges on this account.</p>
              </div>
            </div>
          )}

          {gate && gate.blocking.length > 0 && (
            <div className="rounded-xl p-3" style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.25)' }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-warning-text)' }}>
                Checkout blocked — unresolved items
              </p>
              <ul className="space-y-1.5">
                {gate.blocking.map(condition => (
                  <li key={condition.key} className="text-[12px]" style={{ color: 'var(--text-primary)' }}>
                    <span className="font-semibold">{condition.label}</span>
                    {condition.detail && <span style={{ color: 'var(--text-secondary)' }}> — {condition.detail}</span>}
                    {condition.resolveHref && (
                      <Link href={condition.resolveHref} className="ml-1.5 font-semibold underline" style={{ color: 'var(--accent-primary)' }}>
                        Resolve
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
              <input
                type="text"
                value={overrideReason}
                onChange={e => setOverrideReason(e.target.value)}
                placeholder="Override reason (required to check out anyway)"
                className="mt-2.5 w-full rounded-lg px-3 py-2 text-[12px]"
                style={{ border: '1px solid var(--border-light)', background: 'var(--bg-card-solid)', color: 'var(--text-primary)' }}
              />
              <input
                type="text"
                value={overrideAuthorizedBy}
                onChange={e => setOverrideAuthorizedBy(e.target.value)}
                placeholder="Authorized by (name of the approving clinician/manager)"
                className="mt-2 w-full rounded-lg px-3 py-2 text-[12px]"
                style={{ border: '1px solid var(--border-light)', background: 'var(--bg-card-solid)', color: 'var(--text-primary)' }}
              />
            </div>
          )}

          {/* Discharge disposition — before this, every checkout reported as a
              routine discharge; referral hand-offs and walk-outs were
              unrepresentable in the record. */}
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              Disposition
            </span>
            <select
              value={disposition}
              onChange={e => setDisposition(e.target.value as typeof disposition)}
              className="mt-1 w-full rounded-lg px-3 py-2 text-[12px]"
              style={{ border: '1px solid var(--border-light)', background: 'var(--bg-card-solid)', color: 'var(--text-primary)' }}
            >
              <option value="discharged">Routine discharge</option>
              <option value="discharged_with_referral">Discharged with referral</option>
              <option value="dismissed_without_formal_checkout">Patient left without formal checkout</option>
            </select>
          </label>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4" style={{ borderTop: '1px solid var(--border-light)' }}>
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors hover:bg-black/5" style={{ color: 'var(--text-muted)' }}>
            Cancel
          </button>
          {(() => {
            const blocked = !!gate && gate.blocking.length > 0;
            const canSubmit = !completing
              && (!blocked || (overrideReason.trim().length > 0 && overrideAuthorizedBy.trim().length > 0));
            return (
              <button
                onClick={async () => {
                  setCompleting(true);
                  await onComplete(
                    target,
                    blocked ? { reason: overrideReason.trim(), authorizedBy: overrideAuthorizedBy.trim() } : undefined,
                    disposition,
                  );
                  setCompleting(false);
                }}
                disabled={!canSubmit}
                className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
                style={{ background: blocked ? 'var(--color-warning)' : 'var(--color-success)' }}
              >
                <CheckCircle className="w-4 h-4" />
                {completing ? 'Closing…' : blocked ? 'Override & check out' : 'Complete checkout'}
              </button>
            );
          })()}
        </div>
      </div>
    </Modal>
  );
}

// ── Appointment check-in modal: confirm the patient has arrived; on check-in
//    they're added to the live patient queue. ──
function CheckInModal({
  appt,
  onClose,
  onCheckIn,
  onUndoCheckIn,
  onViewPatient,
}: {
  appt: AppointmentDoc;
  onClose: () => void;
  onCheckIn: (appt: AppointmentDoc, attendanceType: 'new' | 'repeat') => Promise<void>;
  onUndoCheckIn: (appt: AppointmentDoc) => Promise<void>;
  onViewPatient: (patientId: string) => void;
}) {
  const { t } = useTranslation();
  const [checking, setChecking] = useState(false);
  const [reversing, setReversing] = useState(false);
  const alreadyIn = appt.status === 'checked_in' || appt.status === 'in_progress' || appt.status === 'completed';
  // Only a plain check-in (not yet in consult / completed) can be cleanly
  // reversed back to scheduled without stepping over later workflow state.
  const canReverseCheckIn = appt.status === 'checked_in';

  // Visit type (new vs re-attendance) — auto-derived from the patient's
  // history when the modal opens; the clerk can override before confirming.
  const [attendanceType, setAttendanceType] = useState<'new' | 'repeat'>('new');
  const attendanceTouchedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { deriveAttendanceType } = await import('@/lib/services/check-in-service');
        const derived = await deriveAttendanceType(appt.patientId);
        if (!cancelled && !attendanceTouchedRef.current) setAttendanceType(derived);
      } catch {
        if (!cancelled && !attendanceTouchedRef.current) setAttendanceType('new');
      }
    })();
    return () => { cancelled = true; };
  }, [appt.patientId]);

  return (
    <Modal onClose={onClose} width={440}>
      <div className="modal-content card-elevated" style={{ width: '100%' }}>
        {/* Header */}
        <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
            <div>
              <h2 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>{t('frontDesk.checkInTitle')}</h2>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{appt.patientName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg transition-colors hover:bg-black/5" aria-label="Close">
            <X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        {/* Body — appointment detail */}
        <div className="p-4 space-y-2.5">
          <div className="rounded-xl p-3 space-y-2" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
            <DetailRow icon={<Calendar className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />} label={t('frontDesk.colTime')} value={formatClockTime(appt.appointmentTime)} />
            <DetailRow icon={<ClipboardList className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />} label={t('frontDesk.colComplaint')} value={appt.reason || '—'} />
            <DetailRow icon={<MapPin className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />} label={t('frontDesk.department')} value={appt.department || '—'} />
          </div>
          {!alreadyIn && (
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1.5" style={{ color: 'var(--text-muted)' }}>
                {t('frontDesk.visitType')}
              </label>
              <div className="flex gap-2">
                {([['new', t('frontDesk.newVisit')], ['repeat', t('frontDesk.reAttendance')]] as const).map(([key, lbl]) => {
                  const on = attendanceType === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => { attendanceTouchedRef.current = true; setAttendanceType(key); }}
                      className="flex-1 py-2 rounded-lg text-[12px] font-semibold transition-all"
                      style={on
                        ? { background: 'var(--accent-light)', color: 'var(--accent-primary)', border: '1px solid var(--accent-primary)' }
                        : { background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}
                    >
                      {lbl}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {alreadyIn && (
            <div className="rounded-xl p-3 flex items-center gap-2" style={{ background: 'var(--accent-light)', border: '1px solid var(--border-light)' }}>
              <CheckCircle className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--color-success)' }} />
              <p className="text-[12px]" style={{ color: 'var(--text-primary)' }}>{t('frontDesk.alreadyInQueue')}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 p-4" style={{ borderTop: '1px solid var(--border-light)' }}>
          <button onClick={() => onViewPatient(appt.patientId)} className="rounded-lg px-3 py-2 text-sm font-semibold transition-colors hover:bg-black/5" style={{ color: 'var(--accent-primary)' }}>
            {t('frontDesk.viewProfile')}
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors hover:bg-black/5" style={{ color: 'var(--text-muted)' }}>
              {t('action.cancel')}
            </button>
            {/* Reverse a mistaken check-in — sends the appointment back to
                scheduled and drops it from the live queue. */}
            {canReverseCheckIn && (
              <button
                onClick={async () => { setReversing(true); try { await onUndoCheckIn(appt); } finally { setReversing(false); } }}
                disabled={reversing}
                className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-colors hover:bg-black/5 disabled:opacity-50"
                style={{ color: 'var(--text-muted)', border: '1px solid var(--border-light)' }}
              >
                <ArrowRightLeft className="w-4 h-4" />
                {reversing ? '…' : t('action.undo')}
              </button>
            )}
            {!alreadyIn && (
              <button
                onClick={async () => { setChecking(true); try { await onCheckIn(appt, attendanceType); } finally { setChecking(false); } }}
                disabled={checking}
                className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
                style={{ background: 'var(--color-success)' }}
              >
                <CheckCircle className="w-4 h-4" />
                {checking ? t('frontDesk.checkingIn') : t('frontDesk.checkIn')}
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex-shrink-0">{icon}</span>
      <span className="text-[11px] font-semibold uppercase tracking-wide flex-shrink-0" style={{ color: 'var(--text-muted)', minWidth: 78 }}>{label}</span>
      <span className="text-[12px] truncate" style={{ color: 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}
