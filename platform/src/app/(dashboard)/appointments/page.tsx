'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import AppointmentEditModal from '@/components/appointments/AppointmentEditModal';
import BookAppointmentModal from '@/components/appointments/BookAppointmentModal';
import {
  APPOINTMENT_STATUS_LABELS, APPOINTMENT_STATUS_COLORS, APPOINTMENT_STATUS_I18N_KEYS,
  APPOINTMENT_STATUS_FLOW, APPOINTMENT_STATUS_EXITS,
  appointmentMatchesStatusFilter, appointmentStatusFilterKey,
} from '@/lib/appointment-status';
import { useRouter } from 'next/navigation';
import { getDefaultDashboard } from '@/lib/role-routes';
import {
  Calendar, Plus, User, RefreshCw,
  Video, Stethoscope, Syringe, HeartPulse, FlaskConical,
  X, UserPlus, ChevronLeft, ChevronRight,
  Download, Search,
} from '@/components/icons/lucide';
import EhrMiniCalendar, { parseIsoDate, startOfMonth } from '@/components/ehr/EhrMiniCalendar';
import { calendarPeriodLabel, countInPeriod } from './_calendar-period';
import { useAppointments } from '@/lib/hooks/useAppointments';
import { usePatients } from '@/lib/hooks/usePatients';
import { patientFullName } from '@/lib/patient-utils';
import { useApp } from '@/lib/context';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { AppointmentType, AppointmentPriority, AppointmentStatus, FacilityLevel } from '@/lib/db-types';
import dynamic from 'next/dynamic';
import PortalModal from '@/components/Modal';
import { jubaDate, jubaTime } from '@/lib/time-juba';
import Select from '@/components/Select';

// react-big-calendar (and its CSS) is a heavy client-only library. Split it out
// of the route's initial bundle so it loads only when the calendar view renders.

const AppointmentsCalendar = dynamic(() => import('./_AppointmentsCalendar'), {
  ssr: false,
  loading: () => <div style={{ height: '100%', minHeight: 560 }} />,
});

/* ─── Config ─── */
const appointmentTypes: { value: AppointmentType; label: string; icon: typeof Calendar; color: string; bg: string }[] = [
  { value: 'general',      label: 'General Consultation', icon: Stethoscope,   color: 'var(--accent-primary)', bg: 'rgba(33,145,208,0.10)' },
  { value: 'follow_up',    label: 'Follow-Up',            icon: RefreshCw,     color: 'var(--accent-hover)', bg: 'rgba(1,86,151,0.10)' },
  { value: 'specialist',   label: 'Specialist',           icon: User,          color: 'var(--accent-hover)', bg: 'rgba(3,105,161,0.10)' },
  { value: 'anc',          label: 'Antenatal Care',       icon: HeartPulse,    color: 'var(--color-success-text)', bg: 'rgba(4,120,87,0.10)' },
  { value: 'immunization', label: 'Immunization',         icon: Syringe,       color: 'var(--color-success-text)', bg: 'rgba(5,150,105,0.10)' },
  { value: 'lab',          label: 'Laboratory',           icon: FlaskConical,  color: 'var(--accent-primary)', bg: 'rgba(8,145,178,0.10)' },
  { value: 'telehealth',   label: 'Telehealth',           icon: Video,         color: 'var(--accent-hover)', bg: 'rgba(14,116,144,0.10)' },
  { value: 'surgical',     label: 'Surgical',             icon: Stethoscope,   color: 'var(--color-danger-text)', bg: 'rgba(220,38,38,0.10)' },
  { value: 'dental',       label: 'Dental',               icon: Stethoscope,   color: 'var(--accent-hover)', bg: 'rgba(29,78,216,0.10)' },
  { value: 'mental_health',label: 'Mental Health',        icon: HeartPulse,    color: 'var(--color-warning-text)', bg: 'rgba(217,119,6,0.10)' },
  { value: 'walk_in',      label: 'Walk-In',              icon: UserPlus,      color: 'var(--accent-primary)', bg: 'rgba(33,145,208,0.10)' },
];

// Fallback list when the facility hasn't set its departments in Facility Settings.
const FALLBACK_DEPARTMENTS = [
  'Internal Medicine', 'Pediatrics', 'Obstetrics & Gynecology', 'Surgery',
  'Emergency', 'Cardiology', 'Orthopedics', 'Ophthalmology', 'Neurology',
  'Dermatology', 'ENT', 'Outpatient', 'Dental', 'Mental Health', 'Maternity',
];

// Colours and labels both come from the shared vocabulary, so this list and
// the chart's status dropdown can no longer disagree about what a status is
// called (it used to say "In Progress" where the chart said "Roomed").
const statusConfig = Object.fromEntries(
  (Object.keys(APPOINTMENT_STATUS_LABELS) as AppointmentStatus[]).map(status => [
    status,
    { ...APPOINTMENT_STATUS_COLORS[status], label: APPOINTMENT_STATUS_LABELS[status] },
  ]),
) as Record<AppointmentStatus, { color: string; bg: string; label: string }>;

const priorityConfig: Record<AppointmentPriority, { color: string; label: string }> = {
  routine: { color: 'var(--color-success)', label: 'Routine' },
  urgent: { color: 'var(--color-warning)', label: 'Urgent' },
  emergency: { color: 'var(--color-danger)', label: 'Emergency' },
};

const CAL_VIEW_TABS: { key: 'day' | 'week' | 'month'; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

/* ─── Page ─── */
export default function AppointmentsPage() {
  const { appointments, create } = useAppointments();
  const { patients } = usePatients();
  const { currentUser, globalSearch } = useApp();
  const { canBookAppointments, canExportAppointments } = usePermissions();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const { departments: facilityDepartments } = useSettings();
  const departments = facilityDepartments.length ? facilityDepartments : FALLBACK_DEPARTMENTS;

  // Translated label lookups for module-level config (which can't call t()).
  const statusLabelKey = APPOINTMENT_STATUS_I18N_KEYS;

  // The day — today and tomorrow — is what a desk opens on. Month is a
  // planning view, and landing in it meant scanning a grid of dots to find
  // the shift you are actually working.
  const [calView, setCalView] = useState<'month' | 'week' | 'day'>('day');
  // The day the calendar is parked on. Empty means "today" in Africa/Juba;
  // the calendar's own navigation writes it as it moves month to month.
  const [focusDate, setFocusDate] = useState('');
  // Appointment opened in the click-to-view detail dialog — from a calendar
  // event, or from a ?appointment= deep link.
  const [eventApt, setEventApt] = useState<typeof appointments[0] | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const router = useRouter();
  const [showWalkIn, setShowWalkIn] = useState(false);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  // Deep link: TopBar "+ → Schedule appointment" routes here with ?new=1 to
  // open the booking form straight away. Read on the client to avoid needing a
  // Suspense boundary around useSearchParams, then strip the param.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('new') === '1') {
      if (canBookAppointments) setShowNewForm(true);
      params.delete('new');
      const qs = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }
  }, [canBookAppointments]);

  // Deep link: a patient chart's "Appointments" quick action / front-desk
  // checkout routes here with ?patientId= to land already filtered to that
  // patient's appointments. Kept separate from the ?new=1 effect above since
  // it depends on `patients` having loaded (retries via the dep array instead
  // of running once on mount).
  const patientIdParamRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined' || patientIdParamRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const patientId = params.get('patientId');
    if (!patientId) return;
    const patient = patients.find(p => p._id === patientId);
    if (!patient) return;
    patientIdParamRef.current = true;
    setSearch(patientFullName(patient));
    params.delete('patientId');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }, [patients]);

  // Deep link: dashboard/consultation "Open schedule" pushes ?appointment= so
  // the specific appointment's detail popup opens directly instead of the
  // bare calendar. Depends on `appointments` having loaded.
  const appointmentParamRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined' || appointmentParamRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const appointmentId = params.get('appointment');
    if (!appointmentId) return;
    const match = appointments.find(a => a._id === appointmentId);
    if (!match) return;
    appointmentParamRef.current = true;
    setEventApt(match);
    params.delete('appointment');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }, [appointments]);

  // Keyboard ← → to step through appointments while the detail modal is open.
  useEffect(() => {
    if (!eventApt) return;
    const sorted = [...appointments].sort((a, b) =>
      `${a.appointmentDate}${a.appointmentTime}`.localeCompare(`${b.appointmentDate}${b.appointmentTime}`)
    );
    const idx = sorted.findIndex(a => a._id === eventApt._id);
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && idx > 0) setEventApt(sorted[idx - 1]);
      if (e.key === 'ArrowRight' && idx < sorted.length - 1) setEventApt(sorted[idx + 1]);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [eventApt, appointments]);

  // The day the grid is centred on. With nothing picked it is "today" in
  // Africa/Juba, so the initial focus matches the facility's timezone rather
  // than whatever the viewer's browser is set to.
  const calDate = useMemo(() => new Date(`${focusDate || jubaDate()}T12:00:00`), [focusDate]);
  const setCalDate = useCallback((d: Date) => {
    setFocusDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }, []);

  // The day the booking dialog opens on — set by the calendar slot the clerk
  // clicked, otherwise today. `BookAppointmentModal` owns every other field of
  // a booking; this page only says which day the click landed on.
  const [formDate, setFormDate] = useState(jubaDate());
  const [submitting, setSubmitting] = useState(false);

  // Walk-in form
  const [wiPatient, setWiPatient] = useState('');
  const [wiReason, setWiReason] = useState('');
  const [wiDepartment, setWiDepartment] = useState('Outpatient');
  const [wiPriority, setWiPriority] = useState<AppointmentPriority>('routine');
  const [wiNotes, setWiNotes] = useState('');

  // Deep link: registration's "Register & check in" routes here with ?walkIn=
  // so the clerk lands on the walk-in dialog with the patient they just created
  // already selected. Checking a patient in is an action on an appointment now
  // that the standalone Check-In module is gone, and a just-registered patient
  // standing at the desk has none — so the walk-in booking IS their check-in.
  // Lives here rather than beside the other deep links because it writes the
  // walk-in form state declared just above. Waits for `patients` to load.
  const walkInParamRef = useRef(false);
  /**
   * True while the open walk-in dialog is the tail of "Register & check in".
   * That journey ends when the patient is checked in, not on the booking grid,
   * so it returns to the dashboard — whereas a clerk who opened the same dialog
   * from this page is working through a list and stays where they are.
   */
  const walkInFromRegistrationRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined' || walkInParamRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const walkInId = params.get('walkIn');
    if (!walkInId) return;
    if (!patients.some(p => p._id === walkInId)) return;
    walkInParamRef.current = true;
    if (canBookAppointments) {
      setWiPatient(walkInId);
      setShowWalkIn(true);
      walkInFromRegistrationRef.current = true;
    }
    params.delete('walkIn');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }, [patients, canBookAppointments]);

  // Africa/Juba "today" — NOT a UTC slice, which would roll to the next day
  // after ~21:00 local and put the date picker / highlights a day ahead.
  const today = jubaDate();

  // Appointments → react-big-calendar events. Each event keeps the full
  // appointment on `resource` so clicking can open the existing detail/edit flow.
  /**
   * The rail's status filter and the day bar's search are the calendar's only
   * scope — `filterStatus` and `search`, the same pair the rail counts are
   * built from. The table this page used to carry filtered on a second,
   * separate pair, so the two views of one dataset could disagree about how
   * many appointments a given Thursday held; with the table gone there is one
   * filter, one search, and the view only widens the *range* (a week or a
   * month instead of two days), never the contents.
   */
  const calendarEvents = useMemo(() => {
    let list = appointments;
    if (filterStatus === 'pending_approval') {
      list = list.filter(a => a.status === 'scheduled' && a.appointmentDate >= today);
    } else if (filterStatus !== 'all') {
      list = list.filter(a => appointmentMatchesStatusFilter(a.status, filterStatus));
    }
    const q = `${search} ${globalSearch}`.toLowerCase().trim();
    if (q) list = list.filter(a =>
      a.patientName.toLowerCase().includes(q) ||
      a.providerName.toLowerCase().includes(q) ||
      a.department.toLowerCase().includes(q) ||
      a.reason.toLowerCase().includes(q)
    );
    return list.map(a => {
      const start = new Date(`${a.appointmentDate}T${(a.appointmentTime || '00:00')}:00`);
      const end = new Date(start.getTime() + (a.duration || 30) * 60000);
      return {
        id: a._id,
        title: `${a.patientName}${a.reason ? ' · ' + a.reason : ''}`,
        start,
        end,
        resource: a,
      };
    });
  }, [appointments, filterStatus, search, globalSearch, today]);

  // The day bar's own number. `calendarEvents` is every appointment matching
  // the filter, across every month — printing that beside "Aug 20 – 21" put a
  // period and a total in one line and invited them to be read as one fact.
  const visibleCount = useMemo(
    () => countInPeriod(calendarEvents, calView, calDate),
    [calendarEvents, calView, calDate],
  );

  // The days the rail marks: one entry per booking the calendar is currently
  // showing, so the rail never promises a day that reads empty when you land
  // on it (`EhrMiniCalendar` counts them itself).
  const eventDates = useMemo(
    () => calendarEvents.map(event => event.resource.appointmentDate),
    [calendarEvents],
  );

  /**
   * The month the rail is showing. It pages on its own — look ahead to March
   * without moving the day you are working — but follows the grid whenever
   * that moves to another month. Adjusted during render rather than in an
   * effect, which would paint the old month for a frame first.
   */
  const anchorDate = focusDate || today;
  const [railMonth, setRailMonth] = useState(() => startOfMonth(parseIsoDate(anchorDate)));
  const [railAnchor, setRailAnchor] = useState(anchorDate);
  if (railAnchor !== anchorDate) {
    setRailAnchor(anchorDate);
    const anchorMonth = startOfMonth(parseIsoDate(anchorDate));
    if (anchorMonth.getTime() !== railMonth.getTime()) setRailMonth(anchorMonth);
  }

  // Same scope as the calendar (the search) but WITHOUT the status filter, so
  // each rail count says how many appointments that status holds in what is
  // currently being looked at rather than how many the filter left behind.
  const statusBaseList = useMemo(() => {
    let list = appointments;
    const q = `${search} ${globalSearch}`.toLowerCase().trim();
    if (q) list = list.filter(a =>
      a.patientName.toLowerCase().includes(q) ||
      a.providerName.toLowerCase().includes(q) ||
      a.department.toLowerCase().includes(q) ||
      a.reason.toLowerCase().includes(q)
    );
    return list;
  }, [appointments, search, globalSearch]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: statusBaseList.length };
    // Counted into the same bucket the filter selects, so a chip's count is
    // exactly the number of rows picking it returns: one "Scheduled" chip
    // covering scheduled + reminder_sent + confirmed, and `arrived` counted
    // under its own chip rather than swelling "Checked In".
    for (const a of statusBaseList) {
      const k = appointmentStatusFilterKey(a.status);
      counts[k] = (counts[k] || 0) + 1;
    }
    return counts;
  }, [statusBaseList]);

  const statusTabs = useMemo(() => {
    const base = [{ key: 'all', label: t('appointments.allStatus'), count: statusCounts.all }];
    const fromStatuses = (['requested', ...APPOINTMENT_STATUS_FLOW, ...APPOINTMENT_STATUS_EXITS] as AppointmentStatus[])
      .filter(k => (statusCounts[k] || 0) > 0 || filterStatus === k)
      .map(k => ({ key: k, label: t(statusLabelKey[k]), count: statusCounts[k] || 0 }));
    return [...base, ...fromStatuses];
  }, [statusCounts, filterStatus, t, statusLabelKey]);

  // Pending approvals
  const pendingApprovals = useMemo(() => appointments.filter(a => a.status === 'scheduled' && a.appointmentDate >= today), [appointments, today]);

  /**
   * Dismissing the dialog also drops the "came from registration" hand-off:
   * the clerk chose not to check this patient in, so the next walk-in they
   * open from this page must not inherit a redirect they never triggered.
   */
  const closeWalkIn = () => {
    walkInFromRegistrationRef.current = false;
    setShowWalkIn(false);
  };

  const handleWalkIn = async () => {
    if (!wiPatient || !wiReason) { showToast(t('appointments.toastFillRequiredShort'), 'error'); return; }
    const patient = patients.find(p => p._id === wiPatient);
    if (!patient) { showToast(t('appointments.toastSelectValidPatientShort'), 'error'); return; }
    setSubmitting(true);
    try {
      const created = await create({
        patientId: patient._id, patientName: `${patient.firstName} ${patient.surname}`,
        // The desk registering a walk-in is not their clinician; the queue
        // assigns one. `bookedBy` below already records who took them in.
        patientPhone: patient.phone || undefined, providerId: '',
        providerName: '', facilityId: currentUser?.hospitalId || '',
        facilityName: currentUser?.hospitalName || '', facilityLevel: 'payam' as FacilityLevel,
        appointmentDate: today, appointmentTime: jubaTime(),
        duration: 30, appointmentType: 'walk_in', priority: wiPriority,
        department: wiDepartment, reason: wiReason, notes: wiNotes || undefined,
        status: 'checked_in', reminderSent: false, isRecurring: false,
        bookedBy: currentUser?._id || '', bookedByName: currentUser?.name || '', state: '',
        orgId: currentUser?.orgId,
      });
      // A walk-in booking is written `checked_in` — the patient is already at
      // the desk — so it has to open the visit thread too. Writing the status
      // alone leaves them with no encounter for triage, rooming, the
      // clinician's note or the checkout gate to join — the same gap
      // `AppointmentEditModal` closes for a scheduled patient by routing
      // Checked In through `checkInAppointment`. Best-effort: the booking is
      // what puts them in the
      // queue, so an encounter failure must not lose the registration.
      try {
        const { findOpenEncounterForPatient, createArrivalEncounter } = await import('@/lib/services/encounter-service');
        const { deriveAttendanceType } = await import('@/lib/services/check-in-service');
        const facilityId = currentUser?.hospitalId || '';
        const existing = await findOpenEncounterForPatient(patient._id, facilityId);
        if (!existing) {
          await createArrivalEncounter({
            patientId: patient._id,
            patientName: `${patient.firstName} ${patient.surname}`,
            hospitalNumber: patient.hospitalNumber,
            hospitalId: facilityId,
            hospitalName: currentUser?.hospitalName || '',
            orgId: currentUser?.orgId,
            arrivalChannel: 'walk_in',
            appointmentId: created?._id,
            attendanceType: await deriveAttendanceType(patient._id),
            actorId: currentUser?._id,
          });
        }
      } catch {
        // encounter creation is best-effort; the walk-in booking still stands
      }
      showToast(t('appointments.toastWalkInRegistered'), 'success'); setShowWalkIn(false);
      setWiPatient(''); setWiReason(''); setWiNotes(''); setWiDepartment('Outpatient'); setWiPriority('routine');
      // Registration handed off here to finish the check-in; with the patient
      // now in the queue that errand is done, so hand the user back to their
      // own dashboard rather than leaving them on the booking grid they never
      // asked for. Per-role, because /dashboard is not everyone's home.
      if (walkInFromRegistrationRef.current) {
        walkInFromRegistrationRef.current = false;
        router.push(getDefaultDashboard(currentUser?.role || ''));
      }
    } catch (err) { showToast(err instanceof Error ? err.message : t('appointments.toastFailed'), 'error'); }
    finally { setSubmitting(false); }
  };

  const patientById = useMemo(() => {
    const map = new Map<string, typeof patients[0]>();
    for (const p of patients) map.set(p._id, p);
    return map;
  }, [patients]);

  /**
   * CSV of exactly what the calendar holds — the same status filter and the
   * same search, in date and time order. The month the calendar happens to be
   * parked on does not narrow it: the export is the filtered book, not the one
   * page of it currently on screen.
   */
  const handleDownloadCsv = useCallback(() => {
    const header = ['Patient name', 'Identifier', 'Location', 'Service type', 'Appointment time', 'Visit start time', 'Status'];
    const rows = [...calendarEvents]
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .map(({ resource: a }) => [
        a.patientName,
        patientById.get(a.patientId)?.hospitalNumber || '',
        a.department,
        appointmentTypes.find(ti => ti.value === a.appointmentType)?.label || a.appointmentType,
        `${a.appointmentDate} ${a.appointmentTime}`,
        a.checkedInAt ? new Date(a.checkedInAt).toLocaleString('en-US') : '',
        t(statusLabelKey[a.status]),
      ]);
    const csv = [header, ...rows]
      .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `appointments-${today}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [calendarEvents, patientById, today, t, statusLabelKey]);

  /**
   * One appointment editor, everywhere. Clicking a calendar event opens this
   * in a dialog; `onDone` closes it, so an action that navigates away or opens
   * another dialog doesn't leave this hanging open behind it.
   *
   * This used to be a bespoke facts grid over a strip of a dozen status
   * buttons — a second way to read and change a booking that drifted from the
   * editor the front desk uses. `AppointmentEditModal` is that editor: Details,
   * Provider & staff, Status & billing, saving status through
   * `updateAppointmentStatus` so the timestamps and history are stamped rather
   * than written past.
   */
  const renderAppointmentDetail = (apt: typeof appointments[0], onDone: () => void) => (
    <AppointmentEditModal
      inline
      appointment={apt}
      appointments={appointments}
      patient={patientById.get(apt.patientId)}
      onClose={onDone}
    />
  );

  return (
    <main className="page-container page-enter">
      {/* The dashboard's own shell, class for class: header row, then the
          workspace grid with the rail on the left. The module used to carry a
          layout of its own, which is why it never quite lined up with the
          station a clerk arrives from. */}
      <div className="ehr-schedule-shell">
        <section className="ehr-schedule-header ehr-clinical-dashboard-header">
          <div className="ehr-clinical-dashboard-tabs">
            {canBookAppointments && (
              <div className="ehr-segmented ehr-segmented-single">
                <button
                  type="button"
                  className="active"
                  title="Create new appointment"
                  aria-label="Create new appointment"
                  onClick={() => setShowNewForm(true)}
                >
                  <Plus className="w-4 h-4" /> {t('appointments.bookAppointment')}
                </button>
              </div>
            )}
          </div>

          <div className="ehr-schedule-primary-controls ehr-clinical-dashboard-header-main">
            <div className="ehr-greeting-row">
              <div className="ehr-care-header-copy">
                <p className="ehr-care-greeting">Appointments</p>
                <p className="ehr-care-greeting-sub">
                  {currentUser?.hospitalName ? `${currentUser.hospitalName} · Schedule` : 'Facility schedule'}
                </p>
              </div>
            </div>
          </div>

          <div className="ehr-schedule-actions">
            {canExportAppointments && (
              <button type="button" aria-label="Download appointments (CSV)" onClick={handleDownloadCsv}>
                <Download className="w-4 h-4" /> Download
              </button>
            )}
          </div>
        </section>

        <section className="ehr-workspace-grid is-calendar">
          <aside className="ehr-left-rail">
            {/* The station's calendar, not a second one written for this page:
                same card, same 42-cell grid, same dots on the days that hold
                something. */}
            <EhrMiniCalendar
              month={railMonth}
              selectedDate={anchorDate}
              today={today}
              eventDates={eventDates}
              onMonthChange={setRailMonth}
              onDateSelect={setFocusDate}
            />

            {/* The rail's filter group, as on every station: the label of a
                status and how many the day holds. It is the colour key for the
                grid and the filter over it at once. */}
            <div className="ehr-filter-group">
              {/* Bookings still waiting to be approved lead the group when
                  there are any — the one status that is a queue of work rather
                  than a state of the day. */}
              {pendingApprovals.length > 0 && (
                <button
                  type="button"
                  className={`ehr-care-filter ${filterStatus === 'pending_approval' ? 'active' : ''}`}
                  aria-pressed={filterStatus === 'pending_approval'}
                  onClick={() => setFilterStatus('pending_approval')}
                >
                  <span>{t('appointments.pendingApproval')}</span>
                  <b>{pendingApprovals.length}</b>
                </button>
              )}
              {statusTabs.map(tab => (
                <button
                  key={tab.key}
                  type="button"
                  className={`ehr-care-filter ${filterStatus === tab.key ? 'active' : ''}`}
                  aria-pressed={filterStatus === tab.key}
                  onClick={() => setFilterStatus(tab.key)}
                >
                  <span>{tab.label}</span>
                  <b>{tab.count}</b>
                </button>
              ))}
            </div>
          </aside>

          <section className="ehr-center-panel">
            {/* title · search · view tabs — the station day bar, unchanged. */}
            <div className="ehr-daybar">
              <div>
                <h2>{calendarPeriodLabel(calView, calDate)}</h2>
                <p className="ehr-care-subtitle">
                  {visibleCount === 1 ? '1 appointment' : `${visibleCount} appointments`}
                </p>
              </div>

              <div className="ehr-queue-search">
                <Search className="ehr-queue-search-icon w-4 h-4" />
                <input
                  type="search"
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder={t('appointments.searchPlaceholder')}
                  aria-label={t('appointments.searchPlaceholder')}
                />
                {search && (
                  <button
                    type="button"
                    className="ehr-queue-search-clear"
                    aria-label="Clear search"
                    onClick={() => setSearch('')}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="ehr-day-tabs">
                {CAL_VIEW_TABS.map(tab => (
                  <button
                    key={tab.key}
                    type="button"
                    className={calView === tab.key ? 'active' : ''}
                    onClick={() => setCalView(tab.key)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ═══ Calendar (react-big-calendar) — the only appointments view ═══ */}
            <div
              className={`rbc-tamam${calView === 'day' ? ' is-twoday' : ''}`}
              style={{ flex: 1, minHeight: 0, padding: '12px 14px 14px' }}
            >
              <AppointmentsCalendar
                events={calendarEvents}
                calView={calView}
                calDate={calDate}
                today={today}
                statusConfig={statusConfig}
                priorityConfig={priorityConfig}
                onNavigate={(d) => setCalDate(d)}
                onView={(v) => setCalView(v)}
                onSelectEvent={(apt) => setEventApt(apt)}
                onSelectSlot={(slot) => {
                  if (!canBookAppointments) return;
                  const d = slot.start;
                  setFormDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
                  setShowNewForm(true);
                }}
              />
            </div>
          </section>
        </section>
      </div>

        {/* ═══ Modals ═══ */}

        {/* Book Appointment — the shared dialog, so the desk books from the
            same form (and the same real availability) as every other surface.
            This page used to carry a second copy of it, which is how the two
            drifted apart. The reschedule panel below still uses the page's own
            form state; only the new-booking dialog moved. */}
        {showNewForm && canBookAppointments && (
          <BookAppointmentModal
            /* The day popup and the calendar both pre-set `formDate` before
               opening this, so that stays the way a chosen day reaches the
               form. `useAppointments` re-reads on its own PouchDB
               subscription, so there is nothing to refresh by hand. */
            defaultDate={formDate}
            onClose={() => { setShowNewForm(false); setFormDate(jubaDate()); }}
          />
        )}

        {/* Walk-In */}
        {showWalkIn && canBookAppointments && (
          <Modal onClose={closeWalkIn} title={t('appointments.registerWalkIn')} icon={<UserPlus size={34} style={{ color: 'var(--accent-primary)' }} />}>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              {t('appointments.walkInIntro')}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label>{t('appointments.labelPatient')}</label>
                <Select value={wiPatient} onChange={e => setWiPatient(e.target.value)}>
                  <option value="">{t('appointments.selectPatient')}</option>
                  {patients.map(p => <option key={p._id} value={p._id}>{p.firstName} {p.surname}</option>)}
                </Select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', alignItems: 'stretch', gap: 12 }}>
                <div><label>{t('appointments.labelDepartment')}</label><Select value={wiDepartment} onChange={e => setWiDepartment(e.target.value)}>{departments.map(d => <option key={d} value={d}>{d}</option>)}</Select></div>
                <div><label>{t('appointments.labelPriority')}</label><Select value={wiPriority} onChange={e => setWiPriority(e.target.value as AppointmentPriority)}><option value="routine">{t('appointments.priorityRoutine')}</option><option value="urgent">{t('appointments.priorityUrgent')}</option><option value="emergency">{t('appointments.priorityEmergency')}</option></Select></div>
              </div>
              <div><label>{t('appointments.labelReasonForVisit')}</label><textarea value={wiReason} onChange={e => setWiReason(e.target.value)} rows={2} placeholder={t('appointments.reasonForVisitPlaceholder')} /></div>
              <div><label>{t('appointments.labelNotes')}</label><textarea value={wiNotes} onChange={e => setWiNotes(e.target.value)} rows={2} placeholder={t('appointments.walkInNotesPlaceholder')} /></div>
              <ModalActions onCancel={closeWalkIn} onConfirm={handleWalkIn} confirmLabel={submitting ? t('appointments.registering') : t('appointments.registerWalkIn')} cancelLabel={t('action.cancel')} confirmColor="var(--accent-primary)" disabled={submitting} />
            </div>
          </Modal>
        )}

        {/* Appointment detail — opens when an event on the calendar is clicked.
            Sorted list enables prev/next navigation without closing the modal. */}
        {eventApt && (() => {
          const sorted = [...appointments].sort((a, b) =>
            `${a.appointmentDate}${a.appointmentTime}`.localeCompare(`${b.appointmentDate}${b.appointmentTime}`)
          );
          const idx = sorted.findIndex(a => a._id === eventApt._id);
          const hasPrev = idx > 0;
          const hasNext = idx < sorted.length - 1;
          return (
            <Modal
              onClose={() => setEventApt(null)}
              title={eventApt.patientName}
              size="md"
              nav={
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginInlineEnd: 4 }}>
                    {idx + 1} / {sorted.length}
                  </span>
                  <button
                    onClick={() => setEventApt(sorted[idx - 1])}
                    disabled={!hasPrev}
                    aria-label="Previous appointment"
                    style={{
                      width: 30, height: 30, borderRadius: 8, border: '1px solid var(--glass-border)',
                      background: hasPrev ? 'var(--bg-card-solid)' : 'transparent',
                      color: hasPrev ? 'var(--text-secondary)' : 'var(--text-muted)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: hasPrev ? 'pointer' : 'default', opacity: hasPrev ? 1 : 0.35,
                    }}
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <button
                    onClick={() => setEventApt(sorted[idx + 1])}
                    disabled={!hasNext}
                    aria-label="Next appointment"
                    style={{
                      width: 30, height: 30, borderRadius: 8, border: '1px solid var(--glass-border)',
                      background: hasNext ? 'var(--bg-card-solid)' : 'transparent',
                      color: hasNext ? 'var(--text-secondary)' : 'var(--text-muted)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: hasNext ? 'pointer' : 'default', opacity: hasNext ? 1 : 0.35,
                    }}
                  >
                    <ChevronRight size={15} />
                  </button>
                </div>
              }
            >
              {/* The booking's own editor, rendered inline inside the dialog
                  so it reads the same here as everywhere else it is opened. */}
              <div className="ehr-row-detail ehr-row-detail--dialog">
                {renderAppointmentDetail(eventApt, () => setEventApt(null))}
              </div>
            </Modal>
          );
        })()}

    </main>
  );
}

/* ─── Reusable Components ─── */

function Modal({ children, onClose, title, titleColor, icon, size = 'md', nav, variant = 'dialog' }: {
  children: React.ReactNode; onClose: () => void; title: string; titleColor?: string;
  icon?: React.ReactNode; size?: 'sm' | 'md' | 'lg'; nav?: React.ReactNode; variant?: 'dialog' | 'drawer';
}) {
  const sizeClass = size === 'sm' ? 'modal-panel--sm' : size === 'lg' ? 'modal-panel--lg' : 'modal-panel--md';
  const width = size === 'sm' ? 400 : size === 'lg' ? 720 : 560;
  return (
    <PortalModal onClose={onClose} width={width} variant={variant}>
      <div className={`modal-panel ${sizeClass}`} style={{ maxHeight: variant === 'drawer' ? '100vh' : 'calc(100vh - 32px)', height: variant === 'drawer' ? '100%' : undefined, overflowY: 'auto', width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            {icon}
            <h2 className="truncate" style={{ fontSize: 18, fontWeight: 700, color: titleColor || 'var(--text-primary)' }}>{title}</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {nav}
            <button onClick={onClose} aria-label="Close" style={{
              background: 'var(--overlay-subtle)', border: 'none', cursor: 'pointer',
              width: 32, height: 32, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-muted)', transition: 'background 0.15s',
            }}><X size={16} /></button>
          </div>
        </div>
        {children}
      </div>
    </PortalModal>
  );
}

function ModalActions({ onCancel, onConfirm, confirmLabel, confirmColor, cancelLabel, disabled }: {
  onCancel: () => void; onConfirm: () => void; confirmLabel: string;
  confirmColor?: string; cancelLabel?: string; disabled?: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
      <button onClick={onCancel} className="btn btn-secondary" style={{ flex: 1 }}>{cancelLabel || 'Cancel'}</button>
      <button onClick={onConfirm} disabled={disabled} className="btn btn-primary" style={{
        flex: 1, background: confirmColor || undefined,
        opacity: disabled ? 0.6 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
      }}>{confirmLabel}</button>
    </div>
  );
}
