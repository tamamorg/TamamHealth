'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useSync } from '@/lib/context';
import { useConfirm } from '@/components/ConfirmDialog';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { usePatients } from '@/lib/hooks/usePatients';
import { useUsers } from '@/lib/hooks/useUsers';
import { useAppointments } from '@/lib/hooks/useAppointments';
import { useTriage } from '@/lib/hooks/useTriage';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { AppointmentDoc, AppointmentStatus, EncounterDoc, TriageDoc } from '@/lib/db-types';
import { APPOINTMENT_STATUS_TONES, APPOINTMENT_PENDING_STATUSES, appointmentStatusOptionsForRole, APPOINTMENT_STATUS_GROUP_LABELS, type AppointmentStatusGroup } from '@/lib/appointment-status';
import { formatClockTime } from '@/lib/format-utils';
import { patientRegisteredAt, patientFullName } from '@/lib/patient-utils';
import { type AssignDoctorTarget } from '@/components/AssignDoctorModal';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { ClipboardList } from '@/components/icons/lucide';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { getRoleConfig } from '@/lib/permissions';
import EhrCareDashboard, { type EhrCareDashboardAction, type EhrCareDashboardMetric, type EhrCareDashboardRow } from '@/components/ehr/EhrCareDashboard';
import { type DayStatsItem } from '@/components/ehr/EhrDayStatsChart';
import { UserPlus, Plus } from '@/components/icons/lucide';
import { useSharedScreenMask } from '@/lib/settings/useRoleSetting';
import { ROOM_OPTIONS, isoDateKey, staleOpenVisits, type CheckoutTarget } from '@/lib/front-desk-utils';
import { pendingRequests } from '@/lib/appointment-requests';
import { buildDeskQueue } from './desk-queue-rules';
import { buildFrontDeskRows } from './desk-row-rules';
import { buildDeskMetrics, buildPendingSyncDocs, buildDeniedReasonById, buildAssignedUnbooked } from './desk-metrics';
import { useDeskBoardState } from './useDeskBoardState';
import { useDeskRegistration } from './useDeskRegistration';
import { useDeskActions } from './useDeskActions';
import DeskOverlays from './parts/DeskOverlays';
import type { QueueItem } from './desk-types';

export default function FrontDeskBoard() {
  const router = useRouter();
  const { currentUser } = useAuth();
  // Rows and detail cards format phone/location through the shared-screen
  // mask. The rows are memoised, so the flag is also a dependency below —
  // otherwise rows built before the switch flipped keep the full values.
  const maskIdentifiers = useSharedScreenMask();
  const scope = useDataScope();
  const { canConsult, canManageAppointmentSchedule, canCheckInAppointments, canAssignCareTeam } = usePermissions();
  // Reception schedules and checks in; a role that can do neither may look at
  // the ladder but not move a booking along it. The rungs offered are the
  // role's own (appointmentStatusOptionsForRole — the list the service
  // enforces): a clinician who opens this board can advance a visit but is
  // never offered Cancelled or No-show.
  const deskStatusChoices = useMemo(() => appointmentStatusOptionsForRole(currentUser?.role), [currentUser?.role]);
  const canSetAppointmentStatus = (canManageAppointmentSchedule || canCheckInAppointments) && deskStatusChoices.length > 0;
  // Same roles the chart's Assign-provider action uses, so routing a patient
  // means the same thing wherever it is done from.
  const { patients, loading: patientsLoading } = usePatients();
  const { users } = useUsers();
  const { appointments, updateStatus: updateAppointmentStatus, reschedule: rescheduleAppointment, loading: appointmentsLoading } = useAppointments();
  const { triages, update: updateTriage, loading: triagesLoading } = useTriage();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const { t } = useTranslation();
  const { rooms } = useSettings();
  // Reactive room list from facility settings; fall back to the static list.
  const roomOptions = rooms.length ? rooms : ROOM_OPTIONS;
  const {
    queueFilter, panelView, setPanelView, searchParams, queueSort,
    queueSearch, setQueueSearch, queueNowMs, today, boardDate, setBoardDate,
    viewingToday, handleTabChange,
  } = useDeskBoardState();

  const [assignTarget, setAssignTarget] = useState<AssignDoctorTarget | null>(null);
  // The appointment open in the shared edit form, if any.
  const [editAppointment, setEditAppointment] = useState<AppointmentDoc | null>(null);
  const [checkoutTarget, setCheckoutTarget] = useState<CheckoutTarget | null>(null);
  const [checkInTarget, setCheckInTarget] = useState<AppointmentDoc | null>(null);
  // A booking not yet in checks in through CheckInSlider; one already in opens
  // CheckInModal, which holds only its detail and Undo.
  const checkInNew = !!checkInTarget && !['checked_in', 'in_progress', 'completed'].includes(checkInTarget.status);
  // Every other pick from a status pill confirms in StatusChangeSlider first.
  const [statusTarget, setStatusTarget] = useState<
    { appt?: AppointmentDoc; triage?: TriageDoc; status: AppointmentStatus } | null
  >(null);
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
  // "Book appointment" — the same booking dialog the doctor module opens.
  const [bookingOpen, setBookingOpen] = useState(false);
  const [encounters, setEncounters] = useState<EncounterDoc[]>([]);
  const [nursingReviewIds, setNursingReviewIds] = useState<Set<string>>(new Set());
  // The end-of-day reconciliation list: open visits left over from a previous
  // day (a triaged patient who quietly left keeps an open encounter forever —
  // nothing else prompts anyone to close it). Opened from the Reception
  // panel's "Needs close-out" tile.
  const [closeoutOpen, setCloseoutOpen] = useState(false);
  // The records behind the "Pending sync" tile, and the patients a doctor
  // holds with no booking today — both opened from Reception rail tiles.
  const [pendingSyncOpen, setPendingSyncOpen] = useState(false);
  const [unbookedOpen, setUnbookedOpen] = useState(false);
  // Portal / online-booking requests waiting for reception to confirm.
  const [requestsOpen, setRequestsOpen] = useState(false);
  // Pre-selects the patient when booking is started from the unbooked list.
  const [bookingPatientId, setBookingPatientId] = useState<string | undefined>(undefined);
  const { syncStatus, syncNow } = useSync();
  const { registerOpen, setRegisterOpen, captureRegistrationDraft, openFullRegistration } =
    useDeskRegistration({ router, searchParams, showToast, t });

  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    let changes: { cancel: () => void } | null = null;
    const load = async () => {
      try {
        const { getAllEncounters } = await import('@/lib/services/encounter-service');
        const rows = await getAllEncounters({
          orgId: currentUser.orgId,
          hospitalId: currentUser?.hospitalId || currentUser.hospital?._id,
          role: currentUser.role,
        });
        if (!cancelled) setEncounters(rows);
        try {
          const { getHandoffQueue } = await import('@/modules/post-consult/services/handoff-service');
          const pending = await getHandoffQueue({ orgId: currentUser.orgId,
            hospitalId: currentUser.hospitalId || currentUser.hospital?._id,
            role: currentUser.role, userId: currentUser._id });
          if (!cancelled) setNursingReviewIds(new Set(pending.map(enc => enc._id)));
        } catch (err) {
          // A handoff read must not hide the reception encounter queue.
          if (!cancelled) setNursingReviewIds(new Set());
          console.warn('Failed to load front-desk nursing handoff status', err);
        }
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

  // Encounter documents keyed by their own _id — the queue only carries an
  // `encounterId`, so this is how a queue row recovers the encounter's own
  // `appointmentId` (see `findActiveAppointmentForPatient` above).
  const encounterById = useMemo(() => new Map(encounters.map(enc => [enc._id, enc])), [encounters]);

  // Open visits whose last movement was before today — the close-out list.
  const staleVisits = useMemo(() => staleOpenVisits(encounters, today), [encounters, today]);
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
      .filter(t => isoDateKey(t.triagedAt) === today)
      .sort((a, b) => {
        const pOrder: Record<string, number> = { RED: 0, YELLOW: 1, GREEN: 2 };
        return (pOrder[a.priority] ?? 3) - (pOrder[b.priority] ?? 3);
      }),
    [triages, today]
  );

  const queue = useMemo(() => buildDeskQueue({
    patients, hospitalName: currentUser?.hospitalName, viewingToday, encounters, today,
    boardDate, triages, todaysAppointments, nursingReviewIds, queueNowMs,
  }),
    // `queueNowMs` ticks every minute purely to recompute the wait labels
    // (buildQueueFromTriage reads the clock) — it is a dependency, not a value
    // read directly in the body above.
  [boardDate, currentUser?.hospitalName, encounters, nursingReviewIds, patients, queueNowMs, today, todaysAppointments, triages, viewingToday]);

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
   * (`resolveVisitDisplay`) every role dashboard files a visit under —
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
    for (const item of boardQueue) lanes[item.visitTab].push(item);
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

  const {
    syncNowBusy, runSyncNow, closeStaleVisitAsLwbs, assignableDoctors, assignableNurses,
    handleAssignDoctor, handleAssignNurse, handleSaveRoom, handleCompleteCheckout,
    handleNoShow, handleWalkInStatusChange, handleAppointmentStatusChange,
    applyAppointmentStatus, handleCancelAppointment, openReschedule, submitReschedule,
    handleUndoCheckIn, handleUndoCheckout,
  } = useDeskActions({
    confirm, t, currentUser, showToast, updateTriage, updateAppointmentStatus,
    rescheduleAppointment, scope, users, encounters, syncNow,
    cancelTarget, cancelReason, rescheduleTarget, rescheduleDate, rescheduleTime,
    setCheckoutTarget, setCheckInTarget, setNoShowTarget, setCancelReason, setCancelTarget,
    setStatusTarget, setRescheduleDate, setRescheduleTime, setRescheduleTarget, setReschedSaving,
  });

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

  // First entry is promoted to the header's primary pill — "Book appointment",
  // matching the doctor module's CTA and opening the same booking dialog.
  //
  // There is no "Check in" action here any more: a patient is checked in from
  // their appointment (the row's status picker, which opens the arrival
  // dialog), so the booking is the one place a visit is started from rather
  // than a second, parallel front door.
  const actions = useMemo<EhrCareDashboardAction[]>(() => ([
    { label: 'Book appointment', icon: Plus, onClick: () => { setBookingPatientId(undefined); setBookingOpen(true); }, tone: 'primary' as const },
    ...(canUseRoute('/patients') ? [{ label: t('frontDesk.registerNewPatient'), icon: UserPlus, onClick: () => setRegisterOpen(true) }] : []),
  ]), [canUseRoute, setRegisterOpen, t]);

  const frontDeskRows = useMemo<EhrCareDashboardRow[]>(() => buildFrontDeskRows({
      patients, visiblePendingAppointments, hospitalName: currentUser?.hospitalName, canSetAppointmentStatus,
      deskStatusChoices, handleAppointmentStatusChange, openReschedule, appointments,
      filteredQueue, todaysAppointments, encounterById, router, setCheckoutTarget,
      setAssignTarget, setStatusTarget, handleUndoCheckout, canConsult, triages, t,
      roomOptions, handleSaveRoom, canAssignCareTeam, assignableDoctors,
      assignableNurses, handleAssignDoctor, handleAssignNurse,
      filteredRegisteredPatients, panelView,
  }), [
    appointments,
    assignableDoctors,
    assignableNurses,
    canAssignCareTeam,
    canConsult,
    canSetAppointmentStatus,
    currentUser?.hospitalName,
    deskStatusChoices,
    encounterById,
    filteredQueue,
    filteredRegisteredPatients,
    handleAppointmentStatusChange,
    handleAssignDoctor,
    handleAssignNurse,
    handleSaveRoom,
    handleUndoCheckout,
    handleWalkInStatusChange,
    maskIdentifiers,
    openReschedule,
    patients,
    panelView,
    roomOptions,
    todaysAppointments,
    triages,
    router,
    t,
    visiblePendingAppointments,
  ]);

  const pendingSyncDocs = useMemo(() => buildPendingSyncDocs(patients, appointments, triages), [patients, appointments, triages]);
  const pendingSyncCount = pendingSyncDocs.length;

  // The server's own reason for any record it refused this session, by doc id
  // (sync-service keeps these in memory; see describeDenial).
  const deniedReasonById = useMemo(() => buildDeniedReasonById(syncStatus), [syncStatus]);

  // Patients a doctor holds (patient.assignedDoctor) who have no booking and
  // no visit today (see buildAssignedUnbooked).
  const assignedUnbooked = useMemo(() => buildAssignedUnbooked({
    viewingToday, todaysAppointments, encounters, today, triages, patients,
  }), [encounters, patients, today, todaysAppointments, triages, viewingToday]);

  const openRequests = useMemo(
    () => pendingRequests(appointments, today, currentUser?.hospitalId),
    [appointments, today, currentUser?.hospitalId],
  );

  const metrics = useMemo<EhrCareDashboardMetric[]>(() => buildDeskMetrics({
    boardQueue, openRequestsCount: openRequests.length, pendingSyncCount,
    assignedUnbookedCount: assignedUnbooked.length, staleVisitsCount: staleVisits.length, t,
    setRequestsOpen, setPendingSyncOpen, setUnbookedOpen, setCloseoutOpen,
  }), [assignedUnbooked.length, boardQueue, openRequests.length, pendingSyncCount, staleVisits, t]);

  // No subtitle line under the board title: the lane tabs and the Reception
  // status panel already carry the counts, so the "24 patients scheduled"
  // sentence only restated them.
  // True while any of the board's three sources — patients, appointments,
  // triage — is still on its first load. Before this, an empty `rows` list
  // (nothing has arrived from PouchDB yet) rendered the same "No appointments
  // still expected" / "No patients in queue" empty state as a genuinely quiet
  // day, so a clerk opening the board on a slow device saw it tell them there
  // was nothing to do.
  const boardLoading = patientsLoading || appointmentsLoading || triagesLoading;

  const centerCopy = useMemo(() => {
    if (boardLoading) {
      return { title: dateLabel, emptyTitle: 'Loading reception…', emptyActionLabel: '' };
    }
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
  }, [boardLoading, dateLabel, panelView, queueFilter, t]);

  if (!currentUser) return null;

  return (
    <>
      <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <EhrCareDashboard
          visitStatusPicker={false}
          title=""
          greetingName={currentUser.name || 'reception'}
          dateLabel={dateLabel}
          tabs={tabs}
          activeTab={queueFilter}
          onTabChange={handleTabChange}
          searchValue={queueSearch}
          searchPlaceholder={t('ui.searchPatientsReasonsDepartments')}
          onSearchChange={setQueueSearch}
          filters={[]}
          actions={actions}
          chartSeriesNames={['Active', 'Finished']}
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
          missionTitle={t('mission.frontDesk.title')}
          missionDescription={t('mission.frontDesk.body')}
          missionIcon={ClipboardList}
          showMissionCard
          // Reception rows already open the patient detail on click, so the
          // per-row pencil is redundant.
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

        <DeskOverlays
          bookingOpen={bookingOpen}
          setBookingOpen={setBookingOpen}
          boardDate={boardDate}
          bookingPatientId={bookingPatientId}
          setBookingPatientId={setBookingPatientId}
          closeoutOpen={closeoutOpen}
          setCloseoutOpen={setCloseoutOpen}
          staleVisits={staleVisits}
          closeStaleVisitAsLwbs={closeStaleVisitAsLwbs}
          router={router}
          t={t}
          requestsOpen={requestsOpen}
          setRequestsOpen={setRequestsOpen}
          appointments={appointments}
          today={today}
          currentUser={currentUser}
          setEditAppointment={setEditAppointment}
          updateAppointmentStatus={updateAppointmentStatus}
          unbookedOpen={unbookedOpen}
          setUnbookedOpen={setUnbookedOpen}
          assignedUnbooked={assignedUnbooked}
          pendingSyncOpen={pendingSyncOpen}
          setPendingSyncOpen={setPendingSyncOpen}
          pendingSyncDocs={pendingSyncDocs}
          deniedReasonById={deniedReasonById}
          runSyncNow={runSyncNow}
          syncNowBusy={syncNowBusy}
          editAppointment={editAppointment}
          patients={patients}
          assignTarget={assignTarget}
          setAssignTarget={setAssignTarget}
          checkoutTarget={checkoutTarget}
          setCheckoutTarget={setCheckoutTarget}
          handleCompleteCheckout={handleCompleteCheckout}
          canUseRoute={canUseRoute}
          registerOpen={registerOpen}
          setRegisterOpen={setRegisterOpen}
          openFullRegistration={openFullRegistration}
          captureRegistrationDraft={captureRegistrationDraft}
          setPanelView={setPanelView}
          rescheduleTarget={rescheduleTarget}
          setRescheduleTarget={setRescheduleTarget}
          reschedSaving={reschedSaving}
          rescheduleDate={rescheduleDate}
          setRescheduleDate={setRescheduleDate}
          rescheduleTime={rescheduleTime}
          setRescheduleTime={setRescheduleTime}
          submitReschedule={submitReschedule}
          noShowTarget={noShowTarget}
          setNoShowTarget={setNoShowTarget}
          handleNoShow={handleNoShow}
          cancelTarget={cancelTarget}
          setCancelTarget={setCancelTarget}
          handleCancelAppointment={handleCancelAppointment}
          cancelReason={cancelReason}
          setCancelReason={setCancelReason}
          checkInTarget={checkInTarget}
          setCheckInTarget={setCheckInTarget}
          checkInNew={checkInNew}
          statusTarget={statusTarget}
          setStatusTarget={setStatusTarget}
          applyAppointmentStatus={applyAppointmentStatus}
          handleWalkInStatusChange={handleWalkInStatusChange}
          handleUndoCheckIn={handleUndoCheckIn}
        />
      </main>
    </>
  );
}
