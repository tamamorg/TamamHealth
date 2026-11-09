'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isNurseFamilyRole } from '@/lib/clinical-roles';
import { useDashboardRailDock } from '@/lib/hooks/useDashboardRailDock';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { AppointmentDoc, AppointmentStatus, EncounterDoc, FollowUpDoc } from '@/lib/db-types';
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
import type { ComponentType, ReactNode } from 'react';
import EhrMissionCard from '@/components/ehr/EhrMissionCard';
import EhrPanelTitle from '@/components/ehr/EhrPanelTitle';
import { DOC_WRITE_ROLES } from '@/lib/sync/write-permissions';
import { useTranslation } from '@/lib/i18n/useTranslation';
import StationActionPill from '@/components/ehr/StationActionPill';
import { initials, stateTint, AVATAR_TINT_NEUTRAL, abbreviateProviderName, shortenPersonName } from '@/lib/patient-utils';
import EhrStageDonut from '@/components/ehr/EhrStageDonut';
import {
  APPOINTMENT_STATUS_TONES, appointmentStatusLabel,
  APPOINTMENT_STATUS_GROUPS, APPOINTMENT_STATUS_GROUP_LABELS,
  type AppointmentStatusGroup,
} from '@/lib/appointment-status';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { isProviderRole } from '@/lib/clinical-roles';
import { canFinishVisit } from '@/lib/services/finish-visit-service';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { usePatients } from '@/lib/hooks/usePatients';
import { useWards } from '@/lib/hooks/useWards';
import { useEncounters } from '@/lib/hooks/useEncounters';
import { resolveOperationalVisitState } from '@/lib/clinical-flow/visit-state';
import { isTerminal } from '@/lib/clinical-flow/encounter-journey';
import Modal from '@/components/Modal';
import { DialogBody, DialogFrame, DialogHeader } from '@/components/overlay/Dialog';
import FormSlider from '@/components/overlay/FormSlider';
import { chartFormHref } from '@/components/ehr/chart/panels/role-form-access';
import CheckInSlider from '@/components/appointments/CheckInSlider';
import StatusChangeSlider from '@/components/appointments/StatusChangeSlider';
import { useVisitStatusChange } from '@/lib/hooks/useVisitStatusChange';
import { addDays, addMonths, formatMonthTitle, startOfMonth } from '@/components/ehr/EhrMiniCalendar';
import { parseIsoDate, toIsoDate } from '@/lib/date-utils';
import { jubaDate } from '@/lib/time-juba';
import type { DayStatsItem } from '@/components/ehr/EhrDayStatsChart';
import EhrVisitPopup, { EhrQueueMoveDialog } from '@/components/ehr/EhrVisitPopup';
import EhrVisitActionDialog, { type VisitActionKind } from '@/components/ehr/EhrVisitActionDialog';
import AppointmentStatusPillSelect from '@/components/appointments/AppointmentStatusPillSelect';
import BookAppointmentModal from '@/components/appointments/BookAppointmentModal';
import Select from '@/components/Select';
import PrintListDialog, { printableTime, type PrintListSection } from '@/components/PrintListDialog';
import ProgressFeedCard from '@/components/ehr/ProgressFeedCard';
import { useCreateNote } from '@/lib/clinical-notes/useCreateNote';
import EhrWorkItemProgress from '@/components/ehr/EhrWorkItemProgress';
import { useTriage } from '@/lib/hooks/useTriage';
import { useAppointments } from '@/lib/hooks/useAppointments';
import { useAuth } from '@/lib/context';
import { getRoleConfig } from '@/lib/permissions';
import { isPathAllowed } from '@/lib/role-routes';
import { type QueueEntry } from '@/lib/services/patient-queue-service';
import type { TriageDoc } from '@/lib/db-types';
import { withReturnTo } from '@/lib/navigation/return-to';
import { useRoleChoice, useRoleFlag, useSharedScreenMask } from '@/lib/settings/useRoleSetting';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { escapeHtml, openIsolatedHtmlWindow } from '@/lib/safe-html';
import { formatPhoneShared } from '@/lib/field-formats';
import { buildClinicalPrintDocument, printFields } from '@/lib/print-document';
import { describeError } from '@/lib/user-facing-error';
import { useUrlView } from '@/lib/navigation/use-url-view';

import {
  type WorklistPatient, type UnifiedPatientRow, type OutstandingEntry, type OutstandingItem,
  type ClinicalDashboardQueryPatch,
} from './worklist-types';
import {
  buildClinicalAppointmentHref,
  buildClinicalDashboardHref,
  buildActiveTriageByPatient,
  buildLatestTriageByPatient,
  buildQueueEntryByPatient,
  buildUnifiedPatientRows,
  clinicalDashboardDay,
  clinicalDashboardLane,
  computeRowQueueColumns,
  filterRoleOwnedAppointments,
  tallyByStatusGroup,
  typeLabel,
  uniquePatientIdByName,
  formatAppointmentDate,
  appointmentTimeRange,
  outstandingPillTone,
  outstandingTonePriority,
  stationPillClass,
} from './worklist-rules';
import { DetailRow } from './parts/DetailRow';
import { DayActivityChart } from './parts/DayActivityChart';

export * from './worklist-types';
export * from './worklist-rules';

/* The desk's ladder plus `requested`, which only the patient portal writes but
   a clinician may still be looking at. Order and labels come from the shared
   vocabulary so this dropdown and the front desk's offer the same thing. */

const statusLabel = appointmentStatusLabel;

export default function EhrClinicalDashboard({
  clinicianName,
  patients,
  appointments: propAppointments,
  outstanding,
  activityItems,
  activitySeriesNames,
  missionTitle,
  missionDescription,
  missionIcon,
  extraHeaderActions,
  laneLabels,
  acuityDonut,
  railCards,
  stationDetail,
  onStationOpen,
  railAction,
  canWriteNotes = true,
}: {
  clinicianName: string;
  patients: WorklistPatient[];
  /** Explicit role-filtered appointments. An empty array intentionally means
   * the signed-in clinician has no assigned schedule. */
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
  /**
   * The role's mission card, the rail's closing instruction. Defaults to the
   * clinician's "Close the loop"; the nurse workspace passes its own, since
   * signing notes and answering labs is not what a nursing day is made of.
   */
  missionTitle?: string;
  missionDescription?: string;
  missionIcon?: ComponentType<{ className?: string }>;
  /**
   * Role actions for the greeting row, after Print and before the nav
   * shortcuts — e.g. the nutrition workspace's stock list. The role's own
   * record-making work belongs in the chart, not here.
   */
  extraHeaderActions?: { key: string; label: string; icon: ComponentType<{ className?: string }>; run: () => void }[];
  /** A station's names for the three lane tabs ("To collect", "On the bench", "Resulted"). */
  laneLabels?: Partial<Record<AppointmentStatusGroup, string>>;
  /** The left rail's ring, in the station's terms; defaults to today by acuity. */
  acuityDonut?: { title: string; centerLabel: string; segments: { name: string; value: number; color: string }[] };
  /** Station cards for the right rail, under Outstanding items (stock, turnaround). */
  railCards?: ReactNode;
  /** The station's section at the top of a row's expanded panel. */
  stationDetail?: (patientId: string) => ReactNode;
  /** The station's main action, in the left column where Book appointment sits. */
  railAction?: { label: string; icon: typeof Plus; run: () => void };
  /** Opens one order in the station's slider; rows without it stay read-only pills. */
  onStationOpen?: (orderId: string, action?: string) => void;
  /** False for roles that do not write clinical notes (lab, pharmacy, radiology). */
  canWriteNotes?: boolean;
}) {
  const router = useRouter();
  // Sliders dock over the right panel on a dashboard (see the hook).
  const rightRailRef = useRef<HTMLElement>(null);
  useDashboardRailDock(rightRailRef);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useTranslation();
  const search = searchParams.toString();
  const { showToast } = useToast();
  const confirm = useConfirm();
  // "My queue" settings (design 11). Read live, so changing them in Settings
  // reorders this list without a reload.
  const queueSort = useRoleChoice('queue.sort', 'Longest wait first');
  const queueMineOnly = useRoleFlag('queue.mineOnly', true);
  // Subscribes the dashboard to the mask so formatPhoneShared re-renders with it.
  useSharedScreenMask();
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
  const { appointments: liveAppointments } = useAppointments();
  const appointments = useMemo(() => {
    if (liveAppointments.length === 0) return propAppointments;
    const liveById = new Map(liveAppointments.map(a => [a._id, a]));
    return propAppointments.map(a => liveById.get(a._id) || a);
  }, [propAppointments, liveAppointments]);
  // Facility day (same clock as check-in and the seeded bookings), not the device's.
  const todayIso = useMemo(() => jubaDate(), []);
  // A station row (lab, pharmacy, radiology, nutrition) is the station's work
  // item, not the visit — but the patient's visit today still moves from it,
  // within the station's rungs (In progress, Completed). The newest live
  // booking of the day per patient is the visit the station's pill moves.
  const todaysVisitByPatient = useMemo(() => {
    const map = new Map<string, AppointmentDoc>();
    for (const appointment of liveAppointments) {
      if (appointment.appointmentDate !== todayIso || !appointment.patientId) continue;
      if (['cancelled', 'no_show', 'rescheduled'].includes(appointment.status)) continue;
      const held = map.get(appointment.patientId);
      if (!held || (appointment.appointmentTime || '') > (held.appointmentTime || '')) map.set(appointment.patientId, appointment);
    }
    return map;
  }, [liveAppointments, todayIso]);
  const selectedDate = clinicalDashboardDay(search, todayIso);
  const worklistFilter = clinicalDashboardLane(search);
  const outstandingView = searchParams.get('outstanding');
  const previewAppointmentId = searchParams.get('appointment');
  const openAppointment = previewAppointmentId
    ? appointments.find(appointment => appointment._id === previewAppointmentId) ?? null
    : null;
  // In the URL so Back returns to the tab the user was on.
  const [view, setView] = useUrlView(['dashboard', 'calendar'] as const, 'dashboard');
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
  const [followUpToComplete, setFollowUpToComplete] = useState<OutstandingEntry | null>(null);
  const [followUpOutcome, setFollowUpOutcome] = useState<NonNullable<FollowUpDoc['outcome']>>('under_treatment');
  const [followUpNotes, setFollowUpNotes] = useState('');
  const [followUpSaving, setFollowUpSaving] = useState(false);

  // "Dispense" header action — searches the full patient register (not just
  // today's worklist), then opens that patient's prescriptions and dispensing
  // steps in a dialog over this page.
  const [findPatientOpen, setFindPatientOpen] = useState(false);
  const [findPatientQuery, setFindPatientQuery] = useState('');
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
    // Their prescriptions and the dispensing steps open in the patient's
    // chart, in its dispensing form — the chart is where one patient's work
    // happens, not a modal over the worklist.
    router.push(chartFormHref(patient._id, 'dispense'));
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
    const patientId = appointment.patientId || uniquePatientIdByName(patients, appointment.patientName);
    if (patientId) {
      router.push(`/patients/${patientId}`);
    } else {
      // Both the direct id and the name-match fallback failed — say so
      // instead of silently doing nothing.
      showToast(t('msg.noPatientRecordFoundFor', { patientName: appointment.patientName }), 'error');
    }
  };

  const openOutstandingEntry = (entry: OutstandingEntry) => {
    const appointment = appointments.find(a => a._id === entry.id);
    if (entry.openId && onStationOpen) { onStationOpen(entry.openId); return; }
    if (entry.href) { router.push(entry.href); return; }
    // No href — never let the click dead-end: open the matching appointment,
    // else the patient's chart (resolved by name), else say so out loud.
    if (appointment) { openAppointmentPreview(appointment); return; }
    const patientId = uniquePatientIdByName(patients, entry.title);
    if (patientId) { router.push(`/patients/${patientId}`); return; }
    showToast(t('msg.notOpenedTryAgain', { title: entry.title }), 'error');
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
        // Record the completion note in its own field — writing `notes` here
        // erased the original clinical instructions (audit §2.1 #14).
        completionNotes: followUpNotes.trim() || undefined,
      });
      if (!updated) throw new Error('Follow-up not updated. Try again.');
      showToast(t('msg.followUpCompleted'), 'success');
      setFollowUpToComplete(null);
    } catch {
      showToast(t('msg.followUpNotCompletedTry'), 'error');
    } finally {
      setFollowUpSaving(false);
    }
  };

  useEffect(() => {
    // Calendar view was removed — the dashboard is the only view for all users.
    setView('dashboard');
  }, [searchParams, setView]);

  const appointmentCounts = useMemo(() => {
    return appointments.reduce<Map<string, number>>((counts, appointment) => {
      if (locationFilter !== 'all' && appointment.facilityName !== locationFilter) return counts;
      counts.set(appointment.appointmentDate, (counts.get(appointment.appointmentDate) || 0) + 1);
      return counts;
    }, new Map());
  }, [appointments, locationFilter]);

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

  // Role ownership is enforced before appointments reach this shared view:
  // DoctorDashboardPage supplies the signed-in provider's book and
  // NurseHomeView supplies visits whose staffId is the signed-in nurse. Do not
  // infer another provider filter from providerName here. Appointments load
  // asynchronously; the old hidden name filter initialized to the nurse's
  // name, then rejected every newly loaded visit because those records carry
  // the doctor's name as providerName.
  //
  // Keep this location-scoped but NOT date-scoped — the day-activity chart
  // needs adjacent days too, for its two-day comparison.
  const filteredAppointments = useMemo(
    () => filterRoleOwnedAppointments(appointments, locationFilter),
    [appointments, locationFilter],
  );

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
  const dataScope = useDataScope();
  const { triages, update: updateTriageDoc } = useTriage();
  const { encounters } = useEncounters();
  const encounterByPatient = useMemo(() => {
    const map = new Map<string, EncounterDoc>();
    for (const encounter of encounters) {
      if (isTerminal(encounter.status)) continue;
      const held = map.get(encounter.patientId);
      if (!held || (encounter.updatedAt || encounter.createdAt || '').localeCompare(held.updatedAt || held.createdAt || '') > 0) {
        map.set(encounter.patientId, encounter);
      }
    }
    return map;
  }, [encounters]);
  const encounterByAppointment = useMemo(() => {
    const map = new Map<string, EncounterDoc>();
    for (const encounter of encounters) {
      if (!encounter.appointmentId) continue;
      const held = map.get(encounter.appointmentId);
      if (!held || (encounter.updatedAt || encounter.createdAt || '').localeCompare(held.updatedAt || held.createdAt || '') > 0) {
        map.set(encounter.appointmentId, encounter);
      }
    }
    return map;
  }, [encounters]);
  // Encounters with post-consultation nursing still open — the same handoff
  // queue the front desk reads, so both boards name the visit's stage alike.
  const [nursingReviewIds, setNursingReviewIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!currentUser?.orgId) return;
    let cancelled = false;
    void import('@/modules/post-consult/services/handoff-service')
      .then(m => m.getHandoffQueue({
        orgId: currentUser.orgId, hospitalId: currentUser.hospitalId || currentUser.hospital?._id,
        role: currentUser.role, userId: currentUser._id,
      }))
      .then(pending => { if (!cancelled) setNursingReviewIds(new Set(pending.map(enc => enc._id))); })
      .catch(() => { if (!cancelled) setNursingReviewIds(new Set()); });
    return () => { cancelled = true; };
  }, [currentUser?.orgId, currentUser?.hospitalId, currentUser?.hospital?._id, currentUser?.role, currentUser?._id, encounters]);
  const encounterForRow = (row: UnifiedPatientRow) => row.appointment
    ? encounterByAppointment.get(row.appointment._id) ?? null
    : row.patientId ? encounterByPatient.get(row.patientId) ?? null : null;
  const openAppointmentState = openAppointment
    ? resolveOperationalVisitState(openAppointment, encounterByAppointment.get(openAppointment._id))
    : null;
  // Same gate the chart's forms panel uses: triage capture is a route grant,
  // not a permission flag — doctors and the whole nurse family hold /triage.
  const canTriage = isPathAllowed(currentUser?.role || '', '/triage');
  // Nurse-family users read this worklist as ward admissions, rooming
  // arrivals and triaged walk-ins — never "patients assigned to you" — so the
  // empty state has to speak that language or an empty ward reads as a bug.
  const isNurseFamily = isNurseFamilyRole(currentUser?.role);

  /**
   * The greeting row's actions: what this dashboard is opened to press —
   * Dispense, Print, and the station's own (Supplies, Batch entry, Inventory).
   * The role's menu destinations are not repeated here; they are one press
   * away in the menu, and repeating them is what pushed the row into a More.
   */
  const headerActions = useMemo(() => [
    // A pharmacist presses it from the left column, where Book appointment sits.
    ...(canDispense && canBookAppointments ? [{
      key: 'dispense',
      label: 'Dispense',
      icon: Pill,
      run: () => { setFindPatientQuery(''); setFindPatientOpen(true); },
    }] : []),
    {
      key: 'print',
      label: 'Print',
      icon: Printer,
      run: () => setPrintOpen(true),
    },
    ...(extraHeaderActions ?? []),
  ], [canBookAppointments, canDispense, extraHeaderActions, setFindPatientQuery, setFindPatientOpen, setPrintOpen]);

  // The left column's one button: the station's own main action, else Dispense
  // for a role that cannot book.
  const columnAction = railAction ?? (canDispense && !canBookAppointments
    ? { label: 'Dispense', icon: Pill, run: () => { setFindPatientQuery(''); setFindPatientOpen(true); } }
    : undefined);


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
    encounterForRow(row),
    // Post-consult nursing keeps a visit In service for the desk and the nurses.
    // A provider's part ends when they finish (or sign): the nurse's review is
    // not theirs to wait on, so their board moves the visit to Finished.
    (() => { const enc = encounterForRow(row); return !isProviderRole(currentUser?.role) && !!enc && nursingReviewIds.has(enc._id); })(),
  );

  // Daybar filter pills — the shared three-lane vocabulary every role
  // dashboard uses: Scheduled (booked/assigned, patient not with us yet),
  // In Office (in the building: live queue entry, checked in, or in service),
  // Finished (visit closed — checked out, cancelled, no-show, rescheduled).
  const rowStatusGroup = (row: UnifiedPatientRow): AppointmentStatusGroup => {
    // A live queue entry means the patient is physically here even when the
    // appointment rung still says scheduled/arrived (walk-ins, triage). The
    // encounter's lane outranks both — it is what the status chip displays.
    if (row.patient?.station && !row.appointment) return row.patient.station.lane;
    const columns = rowQueueColumns(row);
    return columns.visitTab;
  };
  const groupCounts = tallyByStatusGroup(visiblePatientRows, rowStatusGroup);
  // Move, escalate, left-without-being-seen and return-to-desk all write the
  // triage record. A station role on this workspace (lab, pharmacy,
  // radiology, nutrition) holds no triage grant, so the write would save
  // locally and be refused at sync with nothing on screen.
  const canWriteTriage = !!currentUser?.role && (DOC_WRITE_ROLES.triage ?? []).includes(currentUser.role);
  const laneLabel = (group: AppointmentStatusGroup) => laneLabels?.[group] ?? APPOINTMENT_STATUS_GROUP_LABELS[group];
  const filteredPatientRows = visiblePatientRows.filter(row => rowStatusGroup(row) === worklistFilter);

  // The print dialog's choices: each lane as a pure text list, derived through
  // the same rowQueueColumns as the on-screen table so paper matches screen.
  // Built only while the dialog is open.
  const printSections: PrintListSection[] = printOpen ? APPOINTMENT_STATUS_GROUPS.map(group => ({
    key: group,
    label: laneLabel(group),
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
        time: printableTime(columns.waitText, columns.waitSubtext) || '—',
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
  // Triage opens as a slider over the worklist, not on its own page.
  // A status pill pick, waiting in its slider (CheckInSlider / StatusChangeSlider).
  const [statusPick, setStatusPick] = useState<{ appointment: AppointmentDoc; next: AppointmentStatus } | null>(null);
  const visitStatusChange = useVisitStatusChange();
  const [moveSaving, setMoveSaving] = useState(false);
  // The triage behind the open Move dialog — what decides whether the dialog
  // may offer Emergency care as a destination.
  const moveTriage = moveEntry ? triages.find(triage => triage._id === moveEntry.triageId) ?? null : null;

  // Doctor-side clinical dispositions (KAN-100 follow-through). Escalation and
  // LWBS were nurse-only — a doctor watching a patient deteriorate in their
  // own worklist had no way to record either. Both mirror the triage doc the
  // way the triage station does, so the (triage-derived) queues stay honest.
  //
  // Escalation is reached through the Move dialog's "Emergency care"
  // destination, not a button of its own: on the visit panel it sat beside
  // Move and read as a duplicate of that dialog's Emergency priority. A visit
  // with no queue entry (already in consultation) has no Move dialog, so the
  // panel's More menu offers the escalation directly there.
  //
  // Every exit confirms in EhrVisitActionDialog — the Move dialog's own kit —
  // rather than the browser's confirm()/prompt(): one shape for everything
  // under More, with the patient named and room to say why.
  const canEscalateVisit = (triage?: TriageDoc | null): triage is TriageDoc =>
    Boolean(triage?.encounterId && (triage.status === 'pending' || triage.status === 'seen'));

  const [visitAction, setVisitAction] = useState<{ kind: VisitActionKind; triage: TriageDoc } | null>(null);

  /** The audit line a queue change leaves on the triage record — the same
   *  shape the Move dialog writes, so the notes read as one trail. */
  const withQueueNote = (triage: TriageDoc, tag: string, text: string) => {
    const stamp = `${new Date().toISOString().slice(0, 16).replace('T', ' ')} ${currentUser?.name || ''}`.trim();
    return [triage.notes, `[${tag} ${stamp}] ${text}`].filter(Boolean).join('\n');
  };

  const escalateVisit = async (triage: TriageDoc, comment = '') => {
    if (!triage.encounterId) return;
    setMoveSaving(true);
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
      await escalateEncounterToEmergency(triage.encounterId, { actorId: currentUser?._id, reason: comment || undefined });
      const updates: Partial<TriageDoc> = { status: 'referred' };
      if (comment) updates.notes = withQueueNote(triage, 'Escalated', comment);
      await updateTriageDoc(triage._id, updates, { userId: currentUser?._id, username: currentUser?.name });
      showToast(t('msg.escalatedToEmergencyCare', { patientName: triage.patientName }), 'success');
      setMoveEntry(null);
      setVisitAction(null);
      setVisitRow(null);
    } catch (err) {
      showToast(describeError(err, t('msg.visitNotEscalatedTryAgain')), 'error');
    } finally {
      setMoveSaving(false);
    }
  };

  /** Close the visit as "left without being seen". The visit is over, but what
   *  is left of it is the desk's — the open bill, the rebooking — so the reason
   *  travels with the closure and reception is told through the same feed a
   *  returned visit uses (see `returnedToDeskItems`). */
  const markVisitLwbs = async (triage: TriageDoc, reason = '') => {
    setMoveSaving(true);
    try {
      // A triage-first patient (assessed without a desk check-in) has no
      // encounter — the triage record alone carries the departure then.
      if (triage.encounterId) {
        const { recordLeftWithoutBeingSeen } = await import('@/lib/services/encounter-service');
        await recordLeftWithoutBeingSeen(triage.encounterId, { actorId: currentUser?._id, reason: reason || undefined });
      }
      const updates: Partial<TriageDoc> = { status: 'lwbs' };
      if (reason) updates.notes = withQueueNote(triage, 'Left without being seen', reason);
      await updateTriageDoc(triage._id, updates, { userId: currentUser?._id, username: currentUser?.name });
      showToast(t('msg.recordedAsLeftWithoutBeing', { patientName: triage.patientName }), 'success');
      setVisitAction(null);
      setVisitRow(null);
    } catch (err) {
      showToast(describeError(err, t('msg.departureNotRecordedTryAgain')), 'error');
    } finally {
      setMoveSaving(false);
    }
  };

  /** Send an open visit back to reception without closing it — the patient
   *  stepped out, the handoff named the wrong provider, or the visit needs
   *  rebooking. The desk is notified through the returned-to-desk feed. */
  const returnVisitToDesk = async (triage: TriageDoc, reason = '') => {
    setMoveSaving(true);
    try {
      const { returnVisitToFrontDesk } = await import('@/lib/services/triage-handoff-service');
      if (!dataScope) throw new Error('Your account details are still loading. Wait a moment, then try again.');
      await returnVisitToFrontDesk({
        scope: dataScope,
        triageId: triage._id,
        patientId: triage.patientId,
        patientName: triage.patientName,
        reason: reason.trim() || undefined,
        actorId: currentUser?._id,
        actorName: currentUser?.name,
        actorRole: currentUser?.role,
      });
      showToast(t('msg.returnedToTheFrontDesk', { patientName: triage.patientName }), 'success');
      setVisitAction(null);
      setVisitRow(null);
    } catch (err) {
      showToast(describeError(err, t('msg.patientNotReturnedToThe')), 'error');
    } finally {
      setMoveSaving(false);
    }
  };

  const confirmVisitAction = (reason: string) => {
    if (!visitAction) return;
    const { kind, triage } = visitAction;
    if (kind === 'escalate') void escalateVisit(triage, reason);
    else if (kind === 'lwbs') void markVisitLwbs(triage, reason);
    else void returnVisitToDesk(triage, reason);
  };

  // "End assignment" moved to the patient chart's ⋯ header menu
  // (PatientDetailPage.handleEndAssignment): closing accountability for a
  // patient is a decision made looking at their record, not in passing from a
  // queue row.

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
      if (!updated) throw new Error('Triage handoff not updated. Try again.');
      showToast(t('msg.handoffAcknowledged', { patientName: triage.patientName }), 'success');
    } catch (err) {
      showToast(describeError(err, t('nurse.handoffAcknowledgeFailedToast')), 'error');
    }
  };

  // Call = take the patient now: record the handoff on the triage doc (the
  // row flips to "In service" for every station) and open the consultation.
  const callPatient = async (row: UnifiedPatientRow) => {
    if (!row.patientId || !currentUser || !canConsult) return;
    const assignedToViewer = row.appointment?.providerId === currentUser._id
      || row.patient?.assignedDoctor === currentUser._id
      || latestTriageByPatient.get(row.patientId)?.assignedProviderId === currentUser._id;
    if (!assignedToViewer) {
      showToast(t('msg.consultationNotStartedTheFront'), 'error');
      return;
    }
    const activeEncounter = encounterForRow(row);
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
        encounterId: activeEncounter?._id,
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
      const open = activeEncounter ?? await findOpenEncounterForPatient(row.patientId, currentUser?.hospitalId || '');
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

  // "Finish visit": the clinician's part is over. Lists unsigned notes first so
  // they can be signed; finishing anyway is allowed (signing gates nothing else)
  // and the notes stay in the signing inbox. The move itself is the one a signed
  // note already makes, so the checkout gates (money, nursing) are untouched.
  const finishVisitFor = async (row: UnifiedPatientRow) => {
    const encounter = encounterForRow(row);
    if (!encounter || !dataScope) return;
    const { unsignedNotesForVisit, finishVisit } = await import('@/lib/services/finish-visit-service');
    let unsigned: { id: string; label: string }[] = [];
    try { unsigned = await unsignedNotesForVisit(encounter, dataScope); } catch { /* the question below still asks */ }
    const first = unsigned[0];
    const proceed = await confirm({
      title: t('finishVisit.title', { name: row.name }),
      message: unsigned.length > 0
        ? t('finishVisit.unsigned', { items: unsigned.map(item => item.label).join(', ') })
        : t('finishVisit.message'),
      confirmLabel: unsigned.length > 0 ? t('finishVisit.finishAnyway') : t('finishVisit.finish'),
      ...(first ? {
        alternateLabel: t('finishVisit.signFirst'),
        onAlternate: () => router.push(`/notes/${first.id}`),
      } : {}),
      tone: 'warning',
    });
    if (!proceed) return;
    try {
      await finishVisit(encounter._id, { id: currentUser?._id, role: currentUser?.role });
      showToast(t('finishVisit.done', { name: row.name }), 'success');
      setVisitRow(null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('finishVisit.failed'), 'error');
    }
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
        showToast(t('msg.patientNotMovedTheTriage'), 'error');
        return;
      }
      showToast(t('msg.updatedInTheQueue', { patientName: moveEntry.patientName }), 'success');
      setMoveEntry(null);
    } finally {
      setMoveSaving(false);
    }
  };
  const dashboardReturnTo = search ? `${pathname}?${search}` : pathname;
  const openFullAppointmentHref = openAppointment
    ? buildClinicalAppointmentHref(openAppointment._id, dashboardReturnTo)
    : '/appointments';
  const printOpenAppointment = () => {
    if (!openAppointment) return;
    const appointment = openAppointment;
    const body = `
      <section class="section keep">
        <h2 class="section-title">${escapeHtml(t('print.visitDetails'))}</h2>
        ${printFields([
          { label: 'Reason for Visit', value: appointment.reason || typeLabel(appointment.appointmentType) },
          { label: 'Visit Type', value: typeLabel(appointment.appointmentType) },
          { label: 'Priority', value: typeLabel(appointment.priority) },
          { label: 'Department / Room', value: [appointment.department || 'OPD', appointment.room].filter(Boolean).join(' · ') },
          { label: 'Provider', value: appointment.providerName || clinicianName || 'Unassigned' },
          { label: 'Supporting Staff', value: appointment.staffName },
          { label: 'Time', value: appointmentTimeRange(appointment) },
          { label: 'Status', value: statusLabel(appointment.status) },
          { label: 'Booked By', value: appointment.bookedByName },
          { label: 'Source', value: appointment.source ? typeLabel(appointment.source) : 'Staff booking' },
          { label: 'Appointment ID', value: appointment._id },
        ])}
      </section>
      ${appointment.notes ? `<section class="section"><h2 class="section-title">${escapeHtml(t('print.bookingNotes'))}</h2><p class="notice">${escapeHtml(appointment.notes).replace(/\n/g, '<br>')}</p></section>` : ''}
      ${appointment.cancelledReason ? `<section class="section"><h2 class="section-title">Cancellation</h2><p class="notice"><strong>Reason:</strong> ${escapeHtml(appointment.cancelledReason)}${appointment.cancelledByName ? `<br><strong>Recorded by:</strong> ${escapeHtml(appointment.cancelledByName)}` : ''}</p></section>` : ''}`;
    const html = buildClinicalPrintDocument({
      title: appointment.patientName,
      documentLabel: 'Appointment Record',
      date: appointment.appointmentDate,
      facilityName: appointment.facilityName || currentUser?.hospitalName,
      metaTitle: 'Patient Information',
      meta: [
        { label: 'Patient Name', value: appointment.patientName },
        { label: 'Patient Phone', value: appointment.patientPhone ? formatPhoneShared(appointment.patientPhone) : '' },
      ],
      safeBodyHtml: body,
      footer: 'Appointment record for scheduling and care coordination. This is not a clinical encounter note.',
    });
    openIsolatedHtmlWindow(html, '', true);
  };
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
            <button type="button" className="appointment-detail-modal__close" onClick={closeAppointmentPreview} aria-label={t('ui.closeAppointmentDetails')}>
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
          status={openAppointmentState?.label || statusLabel(openAppointment.status)}
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
          <h3>{t('ui.doctorNextSteps')}</h3>
          <ul>
            <li><Check className="w-4 h-4" /> {t('ui.confirmThePatientIsReady')}</li>
            <li><Check className="w-4 h-4" /> {t('ui.reviewTheReasonForVisit')}</li>
            <li><Check className="w-4 h-4" /> {t('ui.startTheConsultationAndDocument')}</li>
          </ul>
        </div>
      </div>

      <div className="appointment-detail-modal__actions">
        {canConsult && openAppointment.patientId ? (
          <div className="appointment-detail-modal__split" ref={noteMenuRef}>
            <button
              type="button"
              className="btn btn-primary btn-sm appointment-detail-modal__split-main"
              title={t('noteEditor.createNote')}
              onClick={() => router.push(`/consultation?patientId=${encodeURIComponent(openAppointment.patientId)}`)}
            >
              <Stethoscope className="w-4 h-4" /> <span className="appointment-detail-modal__btn-label">{t('appointments.startConsultation')}</span>
            </button>
            <button
              type="button"
              className="appointment-detail-modal__split-toggle"
              aria-label={t('ui.moreClinicalNoteOptions')}
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
                  <Stethoscope size={14} /> {t('ui.startConsultation')}
                </button>
                <button type="button" onClick={() => { setDetailMenuOpen(null); openPatientRecord(openAppointment); }}>
                  <ClipboardList size={14} /> {t('payments.openPatientRecord')}
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
            {t('payments.openPatientRecord')}
          </button>
        )}
        <div className="appointment-detail-modal__split" ref={moreMenuRef}>
          <button
            type="button"
            className="appointment-detail-modal__more-toggle"
            title={t('ui.moreOptions')}
            aria-expanded={detailMenuOpen === 'more'}
            onClick={() => setDetailMenuOpen(current => (current === 'more' ? null : 'more'))}
          >
            <MoreVertical size={16} /> <span className="appointment-detail-modal__btn-label">{t('visitActions.more')}</span> {detailMenuOpen === 'more' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {detailMenuOpen === 'more' && (
            <div className="appointment-detail-modal__menu appointment-detail-modal__menu--right">
              <button
                type="button"
                onClick={() => { setDetailMenuOpen(null); router.push(openFullAppointmentHref); }}
              >
                <Calendar size={14} /> {t('facilityQueue.openFullPage')}
              </button>
              <button type="button" onClick={() => { setDetailMenuOpen(null); printOpenAppointment(); }}>
                <Printer size={14} /> {t('ui.printAppointment')}
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
          {columnAction && !canBookAppointments && (
            <div className="ehr-segmented ehr-segmented-single">
              <button type="button" className="active" aria-label={columnAction.label} onClick={columnAction.run}>
                <columnAction.icon className="w-4 h-4" />
                <span>{columnAction.label}</span>
              </button>
            </div>
          )}
          {canBookAppointments && (
            <div className="ehr-segmented ehr-segmented-single">
              {/* "Book appointment" at desktop, "Appointment" once the first
                  column narrows to the tablet rail — the long label is what
                  made this button crowd its own column. Both are rendered and
                  one is hidden by width, so the accessible name (aria-label)
                  never changes with the viewport. */}
              <button type="button" className="active" aria-label={t('ui.bookAppointment')} onClick={() => setBookingOpen(true)}>
                <Plus className="w-4 h-4" />
                <span className="ehr-label-full">{t('ui.bookAppointment')}</span>
                <span className="ehr-label-compact">{t('frontDesk.syncKind.appointment')}</span>
              </button>
            </div>
          )}
        </div>
        <div className="ehr-schedule-primary-controls ehr-clinical-dashboard-header-main">
          <div className="ehr-greeting-row">
            <div className="ehr-care-header-copy">
              {/* The design greets with the short name — "Welcome, Dr. Wani",
                  never the full legal name — over a small-caps role line. */}
              <p className="ehr-care-greeting">{t('ui.welcome')} {abbreviateProviderName(clinicianName)}</p>
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
        {/* The dashboard's own actions — no More, no menu shortcuts. */}
        <div className="ehr-schedule-actions">
          {headerActions.map(action => {
            const ActionIcon = action.icon;
            return (
              <button key={action.key} type="button" aria-label={action.label} onClick={action.run}>
                <ActionIcon className="w-4 h-4" /> {action.label}
              </button>
            );
          })}
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
              <Calendar size={15} /> {t('ui.goToToday')}
            </button>
            <div className="ehr-mini-calendar-title">
              <button
                type="button"
                onClick={() => setCalendarMonthOverride(current => ({
                  selectedDate,
                  month: addMonths(current?.selectedDate === selectedDate ? current.month : startOfMonth(parseIsoDate(selectedDate)), -1),
                }))}
                aria-label={t('ui.previousMonth')}
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
                aria-label={t('ui.nextMonth')}
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
            title={acuityDonut?.title ?? t('ui.todayByAcuity')}
            centerLabel={acuityDonut?.centerLabel ?? 'on list'}
            segments={acuityDonut?.segments ?? [
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
                    <ChevronLeft className="w-4 h-4" /> {t('boma.schedule')}
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
                      {t('facilityQueue.openFullPage')}
                    </button>
                  )}
                </div>
              </div>

              <div className="ehr-appointment-list">
                <div className="ehr-queue-scroll">
                  {/* Same table frame as the schedule board: sticky column head,
                      hairline rows, initials plate, status pill — an outstanding
                      list is a worklist and reads like one. The head stays
                      rendered through an empty list (the list's frame, not a
                      label for whichever rows happen to be loaded). */}
                  <div className="appointment-card-flow">
                    <div className="appointment-card-head" aria-hidden="true">
                      <span>{t('appointments.labelPatient')}</span>
                      <span>{t('adminUsers.activityWhen')}</span>
                      <span>{t('ui.item')}</span>
                      <span>{t('billing.activityColumn.status')}</span>
                      <span>{t('admin.colAction')}</span>
                    </div>
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
                          ? <button type="button" onClick={() => setAppointmentSearch('')}>{t('ui.clearSearch')}</button>
                          : <button type="button" onClick={() => navigateDashboardState({ outstanding: null })}>{t('ui.backToSchedule')}</button>}
                      </div>
                    )}
                    {visibleOutstandingEntries.map(entry => {
                      const pill = outstandingPillTone(entry.tone);
                      const pillClass = pill.key === 'red' ? 'status-no-show'
                        : pill.key === 'yellow' ? 'status-attention'
                        : 'status-checked-in';
                      return (
                        <div key={entry.id} className="ehr-appointment-group">
                          <div
                            data-triage={outstandingTonePriority(entry.tone)}
                            className="ehr-appointment-row appointment-card-row"
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
                            <div className="ehr-appointment-identity">
                              <div className="ehr-patient-icon" data-acuity={outstandingTonePriority(entry.tone)}>
                                {initials(entry.title)}
                              </div>
                              <div className="ehr-appointment-main appointment-card-patient">
                                <button
                                  type="button"
                                  className="print-visible ehr-row-name-link"
                                  onClick={event => { event.stopPropagation(); openOutstandingEntry(entry); }}
                                >
                                  {entry.title}
                                </button>
                              </div>
                            </div>

                            <div className="ehr-appointment-time">
                              <strong>{entry.meta || '—'}</strong>
                            </div>

                            <div className="ehr-appointment-department">
                              <strong>{entry.subtitle || activeOutstanding.label}</strong>
                              <span>{activeOutstanding.label}</span>
                            </div>

                            <div className="appointment-card-status appointment-card-status--start">
                              <span className={`appointment-status-pill ${pillClass}`}>{pill.label}</span>
                            </div>

                            <div className="appointment-card-status">
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
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
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
	                placeholder={t('ui.searchAppointments')}
	                aria-label={t('ui.searchTheDaySAppointments')}
	                value={appointmentSearch}
	                onChange={event => setAppointmentSearch(event.target.value)}
	              />
	              {appointmentSearch && (
	                <button type="button" className="ehr-queue-search-clear" aria-label={t('ui.clearSearch')} onClick={() => setAppointmentSearch('')}>
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
                  {laneLabel(group)} · <span className="ehr-day-tab-count">{groupCounts[group]}</span>
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
                    <span>{t('appointments.labelPatient')}</span>
                    <span>{t('noteEditor.time')}</span>
                    <span>{t('chartMessages.careTeam')}</span>
                    <span>{t('ui.context')}</span>
                    <span>{t('billing.activityColumn.status')}</span>
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
                        ? <button type="button" onClick={() => setAppointmentSearch('')}>{t('ui.clearSearch')}</button>
                        : isNurseFamily
                          ? <button type="button" onClick={() => router.push('/wards')}>{t('ui.openWardBoard')}</button>
                          : <button type="button" onClick={() => router.push('/patients')}>{t('ui.openPatientRegistry')}</button>}
                    </div>
                  )}
                  {visiblePatientRows.length > 0 && filteredPatientRows.length === 0 && (
                    <div className="ehr-empty-state">
                      <strong>{t('action.no')} {laneLabel(worklistFilter).toLowerCase()} patients</strong>
                      <span>{t('ui.nothingIsInThe')} {laneLabel(worklistFilter).toLowerCase()} {t('ui.laneRightNow')}</span>
                    </div>
                  )}
                  {filteredPatientRows.map((row) => {
                    const columns = rowQueueColumns(row);
                    const assignedToViewer = Boolean(currentUser && (
                      row.appointment?.providerId === currentUser._id
                      || row.patient?.assignedDoctor === currentUser._id
                      || columns.triage?.assignedProviderId === currentUser._id
                    ));
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
                        data-visit-tone={row.patient?.station && !row.appointment ? (row.patient.station.statusTone ?? 'ready') : columns.visitTone}
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
                            const tone = columns.visitTone;
                            const pillClass = tone === 'done' ? 'status-tone-green'
                              : tone === 'active' ? 'status-tone-purple'
                              : tone === 'ready' ? 'status-tone-blue'
                              : tone === 'danger' ? 'status-tone-red'
                              : tone === 'warning' ? 'status-attention'
                              : 'status-tone-slate';
                            return (
                              <AppointmentStatusPillSelect
                                status={visitStatus}
                                className={pillClass}
                                ariaLabel={`Status for ${row.name}`}
                                role={currentUser?.role}
                                // Every pick opens a slider: check-in asks the
                                // visit questions, any other rung confirms.
                                onChange={next => setStatusPick({ appointment: row.appointment!, next })}
                              />
                            );
                          })() : (() => {
                            // A walk-in has no booking on the row, but it has
                            // today's visit. Where the pill has no station work
                            // to open, it is that visit's status picker, so
                            // staff change a walk-in's status from the list as
                            // they do a booked patient's (2026-11-07). The
                            // pill keeps the stage text ("Awaiting lab
                            // results"); the choices are the visit's statuses,
                            // through the same role rules and confirm slider.
                            const walkInVisit = row.patientId ? todaysVisitByPatient.get(row.patientId) : undefined;
                            const stationWork = (row.patient?.station?.actions?.length ?? 0) > 0 || !!row.patient?.station?.openId;
                            if (walkInVisit && !stationWork) {
                              return (
                                <AppointmentStatusPillSelect
                                  status={walkInVisit.status}
                                  displayLabel={columns.statusText}
                                  className={stationPillClass(row.patient?.station?.statusTone ?? columns.visitTone)}
                                  ariaLabel={`Status for ${row.name}`}
                                  role={currentUser?.role}
                                  onChange={next => setStatusPick({ appointment: walkInVisit, next })}
                                />
                              );
                            }
                            return (<>
                            {/* One pill: the station's. It opens the order in the
                                slider; the visit's own status sits in the row's
                                panel, not stacked under this one. */}
                            <StationActionPill
                              label={columns.statusText}
                              className={stationPillClass(row.patient?.station?.statusTone)}
                              actions={row.patient?.station?.actions}
                              ariaLabel={`Next step for ${row.name}`}
                              onPick={row.patient?.station?.openId && onStationOpen
                                ? action => onStationOpen(row.patient!.station!.openId!, action)
                                : undefined}
                              onOpen={row.patient?.station?.openId && onStationOpen
                                ? () => onStationOpen(row.patient!.station!.openId!)
                                : undefined}
                            />
                          </>);
                          })()}
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
                            onCall={canConsult && assignedToViewer ? () => { setVisitRow(null); void callPatient(row); } : undefined}
                            onAcknowledge={columns.triage && canConsult && columns.triage.assignedProviderId === currentUser?._id
                              ? () => void acknowledgeTriage(columns.triage!)
                              : undefined}
                            onMove={columns.entry && canWriteTriage ? () => { setVisitRow(null); setMoveEntry(columns.entry); } : undefined}
                            onOpenChart={row.patientId ? () => router.push(row.patient?.station?.chartHref || `/patients/${row.patientId}`) : undefined}
                            stationBody={row.patientId ? (<>
                              {stationDetail?.(row.patientId)}
                              {/* Finished work carries no visit progress. */}
                              {row.patient?.station && row.patient.station.lane !== 'finished' && todaysVisitByPatient.has(row.patientId) && (() => {
                                const visit = todaysVisitByPatient.get(row.patientId!)!;
                                return (
                                  <div className="ehr-visit-pop-row">
                                    <span className="ehr-visit-pop-label">{t('dashboard.visitStatus')}</span>
                                    <AppointmentStatusPillSelect
                                      status={visit.status}
                                      className="status-scheduled"
                                      ariaLabel={`Visit status for ${row.name}`}
                                      role={currentUser?.role}
                                      onChange={next => setStatusPick({ appointment: visit, next })}
                                    />
                                  </div>
                                );
                              })()}
                            </>) : undefined}
                            onStartTriage={row.patientId && canTriage && (!columns.triage || columns.triage.status === 'pending' || columns.triage.status === 'seen')
                              ? () => { setVisitRow(null); router.push(chartFormHref(row.patientId!, 'triage-form')); }
                              : undefined}
                            onEscalate={canWriteTriage && canEscalateVisit(columns.triage)
                              ? () => setVisitAction({ kind: 'escalate', triage: columns.triage! })
                              : undefined}
                            onLwbs={canWriteTriage && columns.triage && (columns.triage.status === 'pending' || columns.triage.status === 'seen')
                              ? () => setVisitAction({ kind: 'lwbs', triage: columns.triage! })
                              : undefined}
                            onReturnToDesk={canWriteTriage && columns.triage
                              && (columns.triage.status === 'pending' || columns.triage.status === 'seen')
                              && columns.triage.handoffStatus !== 'returned_to_desk'
                              ? () => setVisitAction({ kind: 'return_to_desk', triage: columns.triage! })
                              : undefined}
                            onFinishVisit={canConsult && isProviderRole(currentUser?.role) && canFinishVisit(encounterForRow(row)?.status)
                              ? () => void finishVisitFor(row)
                              : undefined}
                            creatingNote={creatingNote}
                            onCreateNote={row.patientId && canWriteNotes ? (noteType) => {
                              void createNote({
                                noteType,
                                patientId: row.patientId!,
                                patientName: row.name,
                                mrn: row.patient?.id,
                                appointmentId: row.appointment?._id,
                                encounterId: encounterForRow(row)?._id,
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

          {statusPick && statusPick.next === 'checked_in'
            && !['checked_in', 'in_progress', 'completed'].includes(statusPick.appointment.status) && (
            <CheckInSlider appointment={statusPick.appointment} onClose={() => setStatusPick(null)} />
          )}
          {statusPick && !(statusPick.next === 'checked_in'
            && !['checked_in', 'in_progress', 'completed'].includes(statusPick.appointment.status)) && (
            <StatusChangeSlider
              patientName={statusPick.appointment.patientName}
              appointmentTime={statusPick.appointment.appointmentTime}
              from={statusPick.appointment.status}
              to={statusPick.next}
              onClose={() => setStatusPick(null)}
              // The one visit-status write path (useVisitStatusChange): the
              // same role rules, open-visit check and messages as every other
              // dashboard's pill.
              onConfirm={() => visitStatusChange.change(
                { appointmentId: statusPick.appointment._id, patientName: statusPick.appointment.patientName, status: statusPick.appointment.status },
                statusPick.next,
              )}
            />
          )}
          {moveEntry && (
            <EhrQueueMoveDialog
              entry={moveEntry}
              saving={moveSaving}
              onClose={() => setMoveEntry(null)}
              onMove={change => void handleMove(change)}
              onEscalate={canEscalateVisit(moveTriage)
                ? comment => void escalateVisit(moveTriage, comment)
                : undefined}
            />
          )}

          {visitAction && (
            <EhrVisitActionDialog
              kind={visitAction.kind}
              patientName={visitAction.triage.patientName}
              saving={moveSaving}
              onClose={() => setVisitAction(null)}
              onConfirm={confirmVisitAction}
            />
          )}

          {/* canDispense re-checked here (not just at the button that opens
              this) so leftover `findPatientOpen` state — e.g. a role switch
              mid-session — can't render the search itself for a non-pharmacist. */}
          {canDispense && findPatientOpen && (
            <Modal onClose={() => setFindPatientOpen(false)} width={480} labelledBy="find-patient-title">
              <DialogFrame>
                <DialogHeader titleId="find-patient-title" title={t('ui.dispenseToPatient')} onClose={() => setFindPatientOpen(false)} />
                <DialogBody className="space-y-4">
                <div className="ehr-find-patient-input">
                  <Search className="w-4 h-4" />
                  <input
                    ref={findPatientInputRef}
                    type="search"
                    placeholder={t('ui.searchByNameHospitalNumber')}
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
                  <p className="ehr-find-patient-hint">{t('ui.startTypingToFindThe')}</p>
                ) : findPatientResults.length === 0 ? (
                  <p className="ehr-find-patient-hint">{t('ui.noPatientsMatch')}{findPatientQuery.trim()}&rdquo;.</p>
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
                              <small>{[patient.hospitalNumber, patient.gender, patient.phone ? formatPhoneShared(patient.phone) : ''].filter(Boolean).join(' · ')}</small>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                </DialogBody>
              </DialogFrame>
            </Modal>
          )}

          {bookingOpen && (
            <BookAppointmentModal
              defaultDate={selectedDate}
              onClose={() => setBookingOpen(false)}
            />
          )}

          {followUpToComplete && (
            <FormSlider
              title={t('ui.completeFollowUp')}
              subtitle={<>{followUpToComplete.title} · {followUpToComplete.subtitle || 'Scheduled follow-up'}</>}
              width={480}
              onClose={() => { if (!followUpSaving) setFollowUpToComplete(null); }}
              footer={<>
                  <button type="button" className="btn btn-secondary" disabled={followUpSaving} onClick={() => setFollowUpToComplete(null)}>{t('action.cancel')}</button>
                  <button type="button" className="btn btn-primary" disabled={followUpSaving} onClick={() => void completeFollowUp()}>
                    {followUpSaving ? 'Saving…' : 'Complete follow-up'}
                  </button>
              </>}
            >
              <div className="space-y-4">
                <div className="space-y-3">
                  <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    {t('feedback.outcome')}
                    <Select value={followUpOutcome} onChange={event => setFollowUpOutcome(event.target.value as NonNullable<FollowUpDoc['outcome']>)} className="w-full mt-1">
                      <option value="recovered">{t('ui.recovered')}</option>
                      <option value="under_treatment">{t('ui.underTreatment')}</option>
                      <option value="referred">{t('nutrition.referred')}</option>
                      <option value="died">{t('ui.died')}</option>
                    </Select>
                  </label>
                  <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    {t('postConsult.link.notes')}
                    <textarea
                      value={followUpNotes}
                      onChange={event => setFollowUpNotes(event.target.value)}
                      rows={3}
                      className="w-full mt-1 p-2 rounded-lg text-sm"
                      placeholder={t('ui.recordWhatHappenedDuringThe')}
                    />
                  </label>
                </div>
              </div>
            </FormSlider>
          )}

          {printOpen && (
            <PrintListDialog
              title={t('ui.printWorklist')}
              subtitle={`${new Date(`${selectedDate}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} — ${clinicianName}`}
              sections={printSections}
              filename={`worklist-${selectedDate}`}
              onClose={() => setPrintOpen(false)}
            />
          )}

        </main>

        {view === 'dashboard' && railOpen && (
          <button type="button" className="ehr-rail-backdrop" aria-label={t('ui.closeOutstandingItemsPanel')} onClick={() => setRailOpen(false)} />
        )}
        {view === 'dashboard' && (
        <aside ref={rightRailRef} className={`ehr-right-rail ${railOpen ? 'is-open' : ''}`}>
          <button type="button" className="ehr-rail-close" aria-label={t('ui.closePanel')} onClick={() => setRailOpen(false)}>
            <X className="w-4 h-4" />
          </button>
          <section className="ehr-side-card ehr-outstanding-card">
            <div className="ehr-side-card-head">
              <ClipboardList className="w-5 h-5" />
              <EhrPanelTitle title={t('ui.outstandingItems')} />
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
          {railCards}
          <ProgressFeedCard />
          {/* The clinical mission card — the design closes the rail with the
              day's one instruction, same treatment as reception's "Keep the
              desk moving". */}
          <EhrMissionCard
            title={missionTitle ?? t('mission.clinician.title')}
            description={missionDescription ?? t('mission.clinician.body')}
            icon={missionIcon}
          />
        </aside>
        )}
      </section>
    </div>
  );
}
