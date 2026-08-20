'use client';

import { Children, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { shortenPersonName, abbreviateProviderName } from '@/lib/patient-utils';
import { ClipboardList, Printer, Search, Stethoscope, Video, X, type LucideIcon } from '@/components/icons/lucide';
import ProgressFeedCard from '@/components/ehr/ProgressFeedCard';
import PrintListDialog, { type PrintListSection } from '@/components/PrintListDialog';
import EhrMiniCalendar, { formatDateTitle, parseIsoDate, startOfMonth, toIsoDate } from '@/components/ehr/EhrMiniCalendar';
import { EhrWeekActivityChart, type DayStatsItem } from '@/components/ehr/EhrDayStatsChart';
import EhrStageDonut from '@/components/ehr/EhrStageDonut';
import { PRIORITY_META } from '@/lib/clinical/triage-display';
import { initials, stateTint } from '@/lib/patient-utils';
import { formatAppointmentTimeUntil, titleCase } from '@/lib/format-utils';
import { useAppointments } from '@/lib/hooks/useAppointments';
import { useAuth } from '@/lib/context';
import { getRoleConfig } from '@/lib/permissions';
import { uniqueAllowedNavItems, getPageHeaderNavItems } from '@/components/ehr/ehr-navigation';
import {
  APPOINTMENT_STATUS_TONES, APPOINTMENT_STATUS_LABELS, APPOINTMENT_STATUS_GROUPS,
  APPOINTMENT_STATUS_DESCRIPTIONS, appointmentStatusGroup, appointmentStatusLabel,
  canonicalAppointmentStatus, type AppointmentStatusGroup,
} from '@/lib/appointment-status';
import { toIsoDate as visitIsoDate } from '@/components/ehr/EhrMiniCalendar';
import type { AppointmentStatus } from '@/lib/db-types';
import { readCareDashboardUrl, updateCareDashboardSearch } from '@/lib/navigation/care-dashboard-url';

const EHR_CARE_PREVIEW_HISTORY_KEY = '__tamamEhrCarePreview';

export type EhrCareDashboardAction = {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  /** Stable selector used by guided tours to reveal an action-owned panel. */
  tourTarget?: string;
  active?: boolean;
  tone?: 'primary' | 'orange' | 'neutral' | 'warning' | 'success';
};

export type EhrCareDashboardTab = {
  key: string;
  label: string;
  count?: number;
};

export type EhrCareDashboardFilter = {
  label: string;
  value: number | string;
  active?: boolean;
  onClick?: () => void;
};

export type EhrCareDashboardMetric = {
  label: string;
  value: number | string;
  tone?: 'neutral' | 'warning' | 'danger' | 'success';
  active?: boolean;
  href?: string;
  onClick?: () => void;
};

export type EhrCareDashboardRow = {
  id: string;
  title: string;
  subtitle: string;
  /** The patient's photo. When set the avatar shows the portrait; without one
   *  it falls back to initials — never a stand-in face, since the avatar is an
   *  identification cue. */
  photoUrl?: string;
  /** Opening this row navigates somewhere instead of showing the detail popup.
   *  Used where the work itself lives on another screen — a lab order opens the
   *  bench workflow in the patient's chart rather than a read-only summary. */
  onOpen?: () => void;
  /** The patient this row is about. When set, their NAME opens the chart while
   *  the rest of the row still expands the detail — the two things a queue row
   *  is asked to do, without one stealing the other's click. */
  patientId?: string;
  /** First line in the Wait column, usually the slot time or the time the
   *  patient entered the queue. Omit for rows with no time and the column reads
   *  "—". */
  time?: string;
  timeSecondary?: string;
  /** Full ISO timestamp behind `time`. Drives the status-pill cue and lets a
   *  visit on another day show its date instead of a bare clock time. */
  timeAt?: string;
  meta?: string;
  compactMeta?: string;
  careTeam?: string;
  careTeamSecondary?: string;
  careTeamLabel?: string;
  location?: string;
  locationSecondary?: string;
  locationLabel?: string;
  status?: string;
  statusSecondary?: string;
  statusLabel?: string;
  statusTone?: 'scheduled' | 'ready' | 'active' | 'done' | 'warning' | 'danger';
  /**
   * Set these together and the status pill becomes a picker, so a booking can
   * be moved along the ladder from the row being read instead of only from the
   * appointment editor.
   *
   * The row's own click (expand) is stopped over the control, and a page is
   * free to route a chosen status somewhere else — the front desk sends
   * check-in, no-show and cancel to their confirmation dialogs rather than
   * writing them straight — so a stray pick cannot quietly close a visit.
   */
  statusValue?: string;
  statusOptions?: { value: string; label: string }[];
  onStatusChange?: (value: string) => void;
  /**
   * Opts a row out of the shared visit ladder taking over its status pill.
   * Radiology's Pending/In Progress/Complete and nutrition's SAM/MAM/At Risk
   * are the station's whole reason for the screen — a same-day visit must not
   * paint over them. A locked row keeps its own status/statusTone as the pill
   * and gets the visit's status folded into the secondary line instead, so
   * both readings stay visible.
   */
  lockStatus?: boolean;
  priority?: string;
  room?: string;
  // No row-level `onClick`: the shell owns what a row click does (expand, or
  // navigate via `onOpen`). The prop used to exist and was never read, so two
  // dashboards quietly wired handlers that could not fire.
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  /** Further row actions beyond the primary/secondary pair (e.g. the front
   *  desk's "Reschedule" / "No show"), rendered after them in the row popup. */
  extraActions?: { label: string; onClick: () => void; tone?: 'secondary' | 'danger' }[];
  /** Destination for the complete record or workflow represented by this
   *  preview. When supplied, every detail variant—including custom
   *  `popupDetail` content—gets the same full-page action. */
  detailHref?: string;
  /** Visible label for `detailHref`. Callers may localize this label; the
   *  shared fallback keeps the contract usable for existing English screens. */
  detailLabel?: string;
  detail?: ReactNode;
  popupDetail?: ReactNode;
  date?: string;
  /** Which "Day statistics" series this row belongs to — index into the
   *  dashboard's `chartSeriesNames`. Omit and the rail infers it from
   *  `statusTone` (done → second series, everything else → first). */
  chartSeries?: 0 | 1;
};

/** Rows from a handful of consumers (front desk, nurse) carry a real triage
 *  acuity code on `priority`; everyone else uses `priority` as a free-text
 *  label. Only the former gets the shared clinician priority pill — this is
 *  what tells the two apart. */
function isTriageCode(value?: string): value is 'RED' | 'YELLOW' | 'GREEN' {
  return value === 'RED' || value === 'YELLOW' || value === 'GREEN';
}

function inferredChartSeries(row: EhrCareDashboardRow): 0 | 1 {
  if (row.chartSeries === 0 || row.chartSeries === 1) return row.chartSeries;
  const statusText = `${row.status || ''} ${row.statusLabel || ''}`.toLowerCase();
  if (/\b(done|complete|completed|resulted|reported|dispensed|approved|normal|checked out)\b/.test(statusText)) {
    return 1;
  }
  return row.statusTone === 'done' ? 1 : 0;
}

function detailPair(primary?: string, secondary?: string) {
  return [primary, secondary].filter(Boolean).join(' · ') || undefined;
}

function clockMinutes(value?: string): number | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  if (minutes > 59) return null;
  if (match[3] === 'AM') hours = hours === 12 ? 0 : hours;
  if (match[3] === 'PM') hours = hours === 12 ? 12 : hours + 12;
  return hours <= 23 ? hours * 60 + minutes : null;
}

function compareDashboardRows(a: EhrCareDashboardRow, b: EhrCareDashboardRow): number {
  const dateA = a.date || '9999-12-31';
  const dateB = b.date || '9999-12-31';
  if (dateA !== dateB) return dateA.localeCompare(dateB);

  const timestampA = a.timeAt ? new Date(a.timeAt).getTime() : Number.NaN;
  const timestampB = b.timeAt ? new Date(b.timeAt).getTime() : Number.NaN;
  const timeA = clockMinutes(a.time) ?? (Number.isFinite(timestampA) ? timestampA : Number.POSITIVE_INFINITY);
  const timeB = clockMinutes(b.time) ?? (Number.isFinite(timestampB) ? timestampB : Number.POSITIVE_INFINITY);
  if (timeA !== timeB) return timeA - timeB;

  return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id);
}

/**
 * Stable `data-tour` anchors
 * -------------------------
 * The regions below carry `data-tour` attributes that the guided tour targets
 * (`src/lib/tour/journey-tours.ts`). They are NOT styling hooks — they exist so
 * a tour step can spotlight the thing it is describing instead of falling back
 * to a centred card floating over the page.
 *
 * Because this shell backs every role dashboard, one anchor here serves every
 * role. Renaming or removing one silently degrades those tours to floating
 * cards, so `journey-tours.test.ts` asserts each anchor still has a match here.
 */
export default function EhrCareDashboard({
  title,
  greetingName,
  greetingSubtitle,
  dateLabel,
  tabs,
  activeTab,
  onTabChange,
  searchValue,
  searchPlaceholder,
  onSearchChange,
  filters,
  actions,
  actionStrip,
  headerExtra,
  rows,
  metrics,
  metricsActions,
  showCalendar = true,
  filterRowsByDate = true,
  selectedDate: controlledSelectedDate,
  onSelectedDateChange,
  railContent,
  chart,
  chartTitle = 'Day activity',
  chartSeriesNames = ['Open', 'Completed'],
  chartItems,
  showChart = true,
  showStageDonut = true,
  calendarEventDates,
  metricsTitle = 'Today',
  missionTitle,
  missionDescription,
  footerContent,
  centerTitle,
  centerSubtitle,
  emptyTitle = 'No active work',
  emptyActionLabel,
  onEmptyAction,
  showActionStrip = false,
  showMissionCard = true,
  hideRowList = false,
  showRowOpenAction = true,
  autoOpenRowId,
  children,
}: {
  title: string;
  eyebrow?: string;
  greetingName?: string;
  /** Small-caps role line under the greeting ("Front Desk · Reception"). */
  greetingSubtitle?: string;
  dateLabel: string;
  tabs: EhrCareDashboardTab[];
  activeTab: string;
  onTabChange: (tab: string) => void;
  searchValue?: string;
  searchPlaceholder?: string;
  onSearchChange?: (value: string) => void;
  filters: EhrCareDashboardFilter[];
  actions: EhrCareDashboardAction[];
  /** Quick-navigation strip shown under the work list, matching the
   *  Clinical Officer dashboard's clinical strip. Kept separate from header
   *  `actions` so nothing is duplicated between the header and the strip. */
  actionStrip?: EhrCareDashboardAction[];
  /** Rendered in the header action row, beside Print. Use for controls that
   *  are not plain buttons (e.g. a dropdown menu). */
  headerExtra?: ReactNode;
  rows: EhrCareDashboardRow[];
  metrics: EhrCareDashboardMetric[];
  /** Icon + label shortcuts rendered at the bottom of the metrics ("Today")
   *  card — e.g. "View Referrals", "Appointments". Same shape as `actions`,
   *  just placed in the sidebar instead of the header/rail. */
  metricsActions?: EhrCareDashboardAction[];
  showCalendar?: boolean;
  /**
   * Controlled calendar selection. When provided (with `onSelectedDateChange`),
   * the page owns the selected day — it can rebuild rows, tab counts and the
   * header copy for that date — and the mini-calendar/week-chart selections
   * report through the callback. Omit both for the internal-state behaviour.
   */
  selectedDate?: string;
  onSelectedDateChange?: (iso: string) => void;
  /**
   * Whether the mini-calendar's selected day scopes the row list to that day.
   * True by default — the front desk and other appointment-shaped dashboards
   * are inherently a day's schedule. Stations whose work (a lab order, an
   * imaging study, a screening) stays open across days set this to false, so
   * a carried-over row doesn't vanish from the queue while its tab count
   * still includes it — the calendar keeps highlighting dates but stops
   * hiding rows.
   */
  filterRowsByDate?: boolean;
  /** Extra left-rail card(s) rendered between the day chart and the filter
   *  group — e.g. the nurse dashboard's ward-occupancy card. */
  railContent?: ReactNode;
  /** Explicit left-rail chart. When omitted, the shared "Day statistics"
   *  widget is plotted from this dashboard's own rows. */
  chart?: ReactNode;
  chartTitle?: string;
  /** The two series this station's work splits into, e.g.
   *  ['Dispensed', 'Pending'] for pharmacy. Keeps the widget identical across
   *  roles while the labels stay meaningful to each one. */
  chartSeriesNames?: [string, string];
  /** Work plotted on the week chart. Defaults to the visible rows — right for a
   *  station whose rows already span days. A dashboard whose list is scoped to
   *  one day passes its whole week here instead. */
  chartItems?: DayStatsItem[];
  showChart?: boolean;
  /** The rail donut. Off for stations whose tabs are not stages. */
  showStageDonut?: boolean;
  calendarEventDates?: string[];
  metricsTitle?: string;
  missionTitle?: string;
  missionDescription?: string;
  footerContent?: ReactNode;
  centerTitle?: string;
  centerSubtitle?: string;
  emptyTitle?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  showActionStrip?: boolean;
  showMissionCard?: boolean;
  /** When the `children` workflow already renders its own patient list
   *  (e.g. the nurse stations' Ward/Triage/MAR workflows), set this to skip
   *  the generic row list so the workflow fills the center panel top-to-bottom
   *  instead of sitting below a duplicate list. */
  hideRowList?: boolean;
  /** Trailing pencil button on each row. Dashboards whose rows already open
   *  their own detail on click (reception) turn it off — the row *is* the
   *  affordance, so a per-row icon is just noise. */
  showRowOpenAction?: boolean;
  /** Opens a row detail popup from an external deep link, once per row id. */
  autoOpenRowId?: string | null;
  children?: ReactNode;
}) {
  const router = useRouter();
  const { currentUser } = useAuth();

  // Navigations promoted into this station's header, the same rung the
  // clinical dashboard promotes (see getPageHeaderNavItems). Every station
  // renders through this shell, so pharmacy, lab, radiology, nutrition, HR,
  // state, facility management and the front desk all gain the same row —
  // and the module menu drops what the rail already shows.
  const quickNavItems = useMemo(() => {
    const roleConfig = currentUser ? getRoleConfig(currentUser.role) : null;
    if (!roleConfig) return [];
    const navItems = uniqueAllowedNavItems(roleConfig.navItems || [], roleConfig.allowedRoutes || []);
    return getPageHeaderNavItems(navItems, currentUser?.role, roleConfig.defaultDashboard || '/dashboard');
  }, [currentUser]);

  // ── One status reading for every station ────────────────────────────────
  // Lab, pharmacy, radiology, nutrition and reception all render their rows
  // through this component, so a patient's visit status reads the same wherever
  // they are seen. It is a READING only: the pill was once a picker, which made
  // a list you were scrolling into a control that could move a booking, and
  // duplicated the appointment editor's Status & billing tab without its reason
  // prompts. The editor is the single place a booking changes, for every role.
  //
  // A row whose patient has no visit today keeps its own pill text.
  const { appointments } = useAppointments();
  const visitByPatient = useMemo(() => {
    const today = visitIsoDate(new Date());
    const map = new Map<string, { id: string; status: AppointmentStatus }>();
    for (const appointment of appointments || []) {
      if (appointment.appointmentDate !== today || !appointment.patientId) continue;
      if (!map.has(appointment.patientId)) {
        map.set(appointment.patientId, { id: appointment._id, status: appointment.status });
      }
    }
    return map;
  }, [appointments]);

  const todayIso = useMemo(() => toIsoDate(new Date()), []);
  // The calendar main-view toggle was removed — the dashboard is the only view
  // for all users. Typed as the union so the (now-inert) calendar branches below
  // still compile; the mini-calendar sidebar (showCalendar) is unaffected.
  const effectiveView = 'dashboard' as 'dashboard' | 'calendar';
  // Selected day: controlled by the page when it passes `selectedDate` (so it
  // can rebuild its data for that day), internal state otherwise.
  const [internalSelectedDate, setInternalSelectedDate] = useState(todayIso);
  const selectedDate = controlledSelectedDate ?? internalSelectedDate;
  const [urlStateReady, setUrlStateReady] = useState(false);
  // Row details expand in place rather than opening a dialog: the queue stays
  // on screen, so a clinician can read one patient's visit without losing the
  // list they are working down.
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [urlPreviewId, setUrlPreviewId] = useState<string | null>(null);
  const writeDashboardUrl = useCallback((
    patch: Parameters<typeof updateCareDashboardSearch>[1],
    mode: 'push' | 'replace',
    previewMarker?: string | null,
  ) => {
    const search = updateCareDashboardSearch(window.location.search, patch);
    const href = `${window.location.pathname}${search}${window.location.hash}`;
    const currentState = window.history.state && typeof window.history.state === 'object'
      ? window.history.state as Record<string, unknown>
      : {};
    const nextState = {
      ...currentState,
      [EHR_CARE_PREVIEW_HISTORY_KEY]: previewMarker === undefined
        ? currentState[EHR_CARE_PREVIEW_HISTORY_KEY] ?? null
        : previewMarker,
    };
    if (mode === 'push') window.history.pushState(nextState, '', href);
    else window.history.replaceState(nextState, '', href);
  }, []);
  const selectDate = useCallback((iso: string) => {
    onSelectedDateChange?.(iso);
    if (controlledSelectedDate === undefined) setInternalSelectedDate(iso);
    setExpandedRowId(null);
    setUrlPreviewId(null);
    writeDashboardUrl({ day: iso, preview: null }, 'replace', null);
  }, [controlledSelectedDate, onSelectedDateChange, writeDashboardUrl]);
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date()));
  // Clicking a row opens a right-side detail slider where the actions live,
  // keeping the row itself clean (avatar · time · name).
  const [detailTab, setDetailTab] = useState<'visit' | 'financial'>('visit');
  const lastAutoOpenRowId = useRef<string | null>(null);
  const closeDetail = useCallback((preserveHistory = false) => {
    const currentPreview = readCareDashboardUrl(window.location.search).preview;
    const historyPreview = window.history.state?.[EHR_CARE_PREVIEW_HISTORY_KEY];

    setExpandedRowId(null);
    setUrlPreviewId(null);
    if (!currentPreview) return;

    // A preview opened from this dashboard owns one history entry. Pop that
    // entry so browser Back and the visible Close action have identical
    // semantics. A directly loaded/deep-linked preview has no prior dashboard
    // entry, so it is closed in place instead.
    if (!preserveHistory && historyPreview === currentPreview) {
      window.history.back();
      return;
    }
    writeDashboardUrl({ preview: null }, 'replace', null);
  }, [writeDashboardUrl]);
  const openDetail = useCallback((row: EhrCareDashboardRow, mode?: 'push' | 'replace') => {
    if (row.onOpen) { row.onOpen(); return; }
    if (expandedRowId === row.id || urlPreviewId === row.id) {
      closeDetail();
      return;
    }
    setDetailTab('visit');
    setExpandedRowId(row.id);
    setUrlPreviewId(row.id);
    const currentPreview = readCareDashboardUrl(window.location.search).preview;
    const navigationMode = mode ?? (currentPreview ? 'replace' : 'push');
    const ownedPreview = window.history.state?.[EHR_CARE_PREVIEW_HISTORY_KEY];
    writeDashboardUrl(
      { preview: row.id },
      navigationMode,
      navigationMode === 'push' || ownedPreview ? row.id : null,
    );
  }, [closeDetail, expandedRowId, urlPreviewId, writeDashboardUrl]);
  const rowEventDates = useMemo(() => rows.map(row => row.date).filter((date): date is string => Boolean(date)), [rows]);
  const eventDates = calendarEventDates || rowEventDates;
  // The left rail runs the same "Day statistics" widget as the Clinical Officer
  // dashboard, plotted from this dashboard's own rows so each role sees its own
  // work. Rows carry `time`/`date` (falling back to today) and `chartSeries`;
  // when a page doesn't classify its rows, finished work (statusTone 'done')
  // forms the second series and everything still open forms the first.
  const rowChartItems = useMemo<DayStatsItem[]>(() => rows.map(row => ({
    date: row.date,
    time: row.time,
    series: inferredChartSeries(row),
  })), [rows]);
  // A day-scoped station (the front desk's list is one day's schedule) has only
  // that day in `rows`, so a week chart drawn from them is a single bar with six
  // empty columns beside it — the widget looked broken while the mini-calendar
  // right above it dotted the whole month. Those dashboards pass their own week
  // of work here; everyone whose rows already span days keeps the default.
  const weekChartItems = chartItems ?? rowChartItems;
  const visibleRows = useMemo(() => {
    // The mini-calendar remains active in dashboard mode. Selecting a day
    // must change the worklist itself, not only the calendar highlight — but
    // only for dashboards whose work is itself day-scoped (`filterRowsByDate`).
    // A station's carried-over order or screening must stay in the queue no
    // matter which day is selected; its tab/filter counts are never
    // date-scoped, so filtering the rows here without it would silently
    // disagree with them.
    const scopedRows = !filterRowsByDate || !showCalendar || rowEventDates.length === 0
      ? rows
      : rows.filter(row => row.date === selectedDate);
    return scopedRows.slice().sort(compareDashboardRows);
  }, [filterRowsByDate, rowEventDates.length, rows, selectedDate, showCalendar]);
  // URL previews are derived while rows load: the query can arrive before the
  // async worklist without requiring a state-setting synchronization effect.
  const effectiveExpandedRowId = expandedRowId
    ?? (urlPreviewId && visibleRows.some(row => row.id === urlPreviewId) ? urlPreviewId : null);

  // A row must sit in the lane its own status pill names. The front desk filed
  // by "does a triage record exist" instead of the visit's rung, so bookings
  // still on Scheduled were listed — and counted — under In Office. Any
  // dashboard whose tabs are keyed by AppointmentStatusGroup gets the check.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    if (!APPOINTMENT_STATUS_GROUPS.includes(activeTab as AppointmentStatusGroup)) return;
    const misfiled = visibleRows.filter(row => {
      const status = row.status as AppointmentStatus | undefined;
      if (!status || !(status in APPOINTMENT_STATUS_LABELS)) return false;
      return appointmentStatusGroup(status) !== activeTab;
    });
    if (misfiled.length > 0) {
      console.warn(
        `[EhrCareDashboard] ${misfiled.length} row(s) in the "${activeTab}" lane carry a status belonging to another lane ` +
        `(e.g. ${misfiled[0].title}: "${misfiled[0].status}"). File rows with appointmentStatusGroup() so the pill and the lane agree.`,
      );
    }
  }, [activeTab, visibleRows]);

  // A lane tab must never advertise more work than the list beneath it shows.
  // Day-scoping here silently dropped rows the page had already counted (the
  // front desk read "In Office · 25" over three rows), so the mismatch is
  // called out in development rather than shipped. A page whose list is not a
  // single day's work should pass `filterRowsByDate={false}`; one that is
  // should count from the same day-scoped set it builds rows from.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const active = tabs.find(tab => tab.key === activeTab);
    if (!active || typeof active.count !== 'number') return;
    if (active.count > visibleRows.length && rows.length > visibleRows.length) {
      console.warn(
        `[EhrCareDashboard] "${active.label}" counts ${active.count} but only ${visibleRows.length} of ${rows.length} rows render on ${selectedDate}. ` +
        'Count from the same date-scoped set as the rows, or set filterRowsByDate={false}.',
      );
    }
  }, [tabs, activeTab, visibleRows.length, rows.length, selectedDate]);
  // Live clock behind each row's time column: the status-pill cue and the
  // same-day/other-day date choice read it. Starts null so the
  // server-rendered markup and the first client
  // render match. Ticks once a minute rather than every second — every
  // reader is minute-scale in what it actually shows: the 30-minute
  // "is-soon" tone threshold, the past/future flip, and the same-day/
  // other-day date choice. The one sub-minute reader, formatAppointmentTimeUntil's
  // "in Ns" text, only shows that precision inside a ≤60s window before/after
  // `timeAt`, which isn't worth a second ticking clock (and the full row
  // re-render it drives) across every station built on this shell.
  const hasCountdown = useMemo(() => visibleRows.some(row => !!row.timeAt), [visibleRows]);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    if (!hasCountdown) { setNow(null); return; }
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, [hasCountdown]);
  // Read URL state after hydration and on browser Back/Forward. Keeping this
  // out of the render initializer avoids server/client markup differences.
  useEffect(() => {
    const applyUrlState = () => {
      const state = readCareDashboardUrl(window.location.search);
      if (state.day && state.day !== selectedDate) {
        onSelectedDateChange?.(state.day);
        if (controlledSelectedDate === undefined) setInternalSelectedDate(state.day);
        setCalendarMonth(startOfMonth(parseIsoDate(state.day)));
      }
      setUrlPreviewId(state.preview);
      // Popstate may switch directly between two preview entries. The URL is
      // authoritative after that navigation, so discard any event-owned row.
      setExpandedRowId(null);
      setUrlStateReady(true);
    };

    applyUrlState();
    window.addEventListener('popstate', applyUrlState);
    return () => window.removeEventListener('popstate', applyUrlState);
  }, [controlledSelectedDate, onSelectedDateChange, selectedDate]);

  // Controlled dashboards can change their clinical day outside the shared
  // calendar. Mirror that change once URL hydration has completed; URL-driven
  // changes are already equal and therefore do not loop.
  useEffect(() => {
    if (!urlStateReady) return;
    if (readCareDashboardUrl(window.location.search).day === selectedDate) return;
    writeDashboardUrl({ day: selectedDate }, 'replace');
  }, [selectedDate, urlStateReady, writeDashboardUrl]);

  // An expanded row that scrolls out of the filtered list closes itself, so a
  // panel never lingers over a patient the list no longer shows.
  useEffect(() => {
    if (!expandedRowId) return;
    if (!visibleRows.some(row => row.id === expandedRowId)) closeDetail(true);
  }, [closeDetail, expandedRowId, visibleRows]);
  useEffect(() => {
    if (!autoOpenRowId || lastAutoOpenRowId.current === autoOpenRowId) return;
    const row = visibleRows.find(item => item.id === autoOpenRowId);
    if (!row) return;
    lastAutoOpenRowId.current = autoOpenRowId;
    openDetail(row, 'replace');
  }, [autoOpenRowId, openDetail, visibleRows]);
  const selectedDateLabel = showCalendar ? formatDateTitle(selectedDate) : dateLabel;
  /* Donut segments = the queue's own tabs, minus the "all" tab that is their
     sum. Reading the tabs rather than counting rows again is what keeps the
     ring honest: a tab and its slice can only ever show the same figure. */
  const stageSegments = useMemo(
    () => tabs
      .filter(tab => typeof tab.count === 'number' && tab.key !== 'all' && tab.key !== 'everything')
      .map(tab => ({ name: tab.label, value: tab.count as number })),
    [tabs],
  );
  // The dashboard's primary action (first entry) is promoted to the header's
  // top-left slot as the Clinical Officer-style "+" CTA; every other action
  // renders in the right-hand header row (wrapping when needed) — including
  // panel toggles that swap what occupies the center.
  const primaryAction = actions[0];
  const headerTitle = greetingName ? `Welcome, ${abbreviateProviderName(greetingName)}` : title;

  // Every station header carries a Print action: the shared choose-what /
  // choose-format dialog over the board's current rows, never window.print()'s
  // whole-dashboard dump. A page that supplies its own "Print" action (the
  // nurse station prints its two registers) keeps it — no double button.
  const [printOpen, setPrintOpen] = useState(false);
  const headerActions: EhrCareDashboardAction[] = [
    ...actions.slice(1),
    ...(actions.some(action => action.label === 'Print') ? [] : [
      { label: 'Print', icon: Printer, onClick: () => setPrintOpen(true), tone: 'neutral' as const },
    ]),
  ];

  // The printable list = the board as currently shown (active lane, selected
  // day), derived from the same row fields as the on-screen columns. Relative
  // countdowns are left off — they go stale the moment paper leaves the tray.
  const activeTabLabel = tabs.find(tab => tab.key === activeTab)?.label || title;
  const printSections: PrintListSection[] = printOpen ? [{
    key: 'board',
    label: activeTabLabel,
    columns: [
      { key: 'patient', label: 'Patient' },
      { key: 'details', label: 'Details' },
      { key: 'time', label: 'Time' },
      { key: 'careTeam', label: 'Care team' },
      { key: 'context', label: 'Context' },
      { key: 'status', label: 'Status' },
    ],
    rows: visibleRows.map(row => ({
      patient: row.title,
      details: row.subtitle || '',
      time: [row.time || row.date || '—', row.timeSecondary].filter(Boolean).join(' · '),
      careTeam: [row.careTeam || row.compactMeta || row.meta || '', row.careTeamSecondary].filter(Boolean).join(' · '),
      context: row.location || row.room || row.meta || '',
      status: [row.statusLabel || (row.status ? titleCase(row.status) : ''), row.statusSecondary].filter(Boolean).join(' · '),
    })),
  }] : [];

  return (
    <div className="ehr-schedule-shell ehr-care-dashboard">
      <section className="ehr-schedule-header ehr-clinical-dashboard-header ehr-care-dashboard-header">
        <div className="ehr-clinical-dashboard-tabs">
          {primaryAction && (
            // `station-primary-action` is a tour anchor. The primary action is
            // promoted out of `station-actions` into this slot, so a dashboard
            // passing exactly one action leaves `station-actions` rendered but
            // empty and zero-sized — a tour step pointing there would attach to
            // nothing visible.
            <div className="ehr-segmented ehr-segmented-single" data-tour="station-primary-action">
              <button type="button" className="active" aria-label={primaryAction.label} data-tour={primaryAction.tourTarget} onClick={primaryAction.onClick}>
                <primaryAction.icon className="w-4 h-4" /> {primaryAction.label}
              </button>
            </div>
          )}
        </div>

        <div className="ehr-schedule-primary-controls ehr-clinical-dashboard-header-main">
          <div className="ehr-greeting-row">
            <div className="ehr-care-header-copy">
              <p className="ehr-care-greeting">{headerTitle}</p>
              {/* The design's small-caps role line — "Front Desk · Reception".
                  Stations that don't pass one keep the bare greeting. */}
              {greetingSubtitle && <p className="ehr-care-greeting-sub">{greetingSubtitle}</p>}
            </div>
          </div>
        </div>

        <div className="ehr-schedule-actions" data-tour="station-actions">
          {/* Slot for a real component next to the plain action buttons —
              `actions` only carries {label, icon, onClick}, so a dropdown (the
              facility dashboard's "Add" menu) had nowhere to live in the
              header and was exiled to the left rail. Rendered first so it sits
              alongside Print rather than after it. */}
          {headerExtra}
          {quickNavItems.map(item => {
            const ItemIcon = item.icon;
            return (
              <button key={item.href} type="button" aria-label={item.label} onClick={() => router.push(item.href)}>
                <ItemIcon className="w-4 h-4" />{item.label}
              </button>
            );
          })}
          {headerActions.map(action => (
            <button key={action.label} type="button" className={action.tone === 'orange' ? 'orange' : action.tone === 'primary' || action.active ? 'primary' : ''} data-tour={action.tourTarget} onClick={action.onClick}>
              <action.icon className="w-4 h-4" />{action.label}
            </button>
          ))}
        </div>
      </section>

      <div className={`ehr-workspace-grid ${effectiveView === 'calendar' ? 'is-calendar' : 'is-dashboard'}`}>
        <aside className="ehr-left-rail">
          {showCalendar && (
            <EhrMiniCalendar
              month={calendarMonth}
              selectedDate={selectedDate}
              today={todayIso}
              eventDates={eventDates}
              onMonthChange={setCalendarMonth}
              onDateSelect={selectDate}
            />
          )}
          {/* The design's rail runs chart, then donut: the week's shape, then
              today's split. The donut's segments are the queue's own tab
              counts, so the ring and the tabs are the same number twice. */}
          {showChart && (chart ?? (
            <EhrWeekActivityChart
              items={weekChartItems}
              seriesNames={chartSeriesNames}
              selectedDate={selectedDate}
              todayIso={todayIso}
              title={chartTitle}
              onSelectDate={iso => {
                selectDate(iso);
                setCalendarMonth(startOfMonth(parseIsoDate(iso)));
              }}
            />
          ))}
          {showStageDonut && stageSegments.length > 0 && (
            <EhrStageDonut segments={stageSegments} />
          )}
          {railContent}
          {filters.length > 0 && (
            <div className="ehr-filter-group">
              {filters.map(filter => (
                <button
                  key={filter.label}
                  type="button"
                  className={`ehr-care-filter ${filter.active ? 'active' : ''}`}
                  onClick={filter.onClick}
                >
                  <span>{filter.label}</span>
                  <b>{filter.value}</b>
                </button>
              ))}
            </div>
          )}
        </aside>

        <section className="ehr-center-panel" data-tour="station-queue">
          <div className="ehr-daybar">
            <div>
              <h2>{centerTitle || selectedDateLabel}</h2>
              {/* Only a subtitle a station actually asked for. There used to be
                  an "N active items" fallback here, which restated the count
                  already on every tab beside it — the clinical dashboard
                  dropped it and the rest of the stations follow. */}
              {centerSubtitle && <p className="ehr-care-subtitle">{centerSubtitle}</p>}
            </div>
            {/* The design puts the search over the table it filters, not in
                the rail beside it: the field belongs to the queue, and a
                search in the far column left the user hunting for what had
                changed. Centre column of the header's `title | search | tabs`
                row. */}
            {onSearchChange && (
              <div className="ehr-queue-search" data-tour="rail-search">
                <Search className="ehr-queue-search-icon w-4 h-4" />
                <input
                  type="search"
                  value={searchValue || ''}
                  onChange={(event) => onSearchChange(event.target.value)}
                  placeholder={searchPlaceholder || 'Search'}
                  aria-label={searchPlaceholder || 'Search'}
                />
                {searchValue && (
                  <button
                    type="button"
                    className="ehr-queue-search-clear"
                    aria-label="Clear search"
                    onClick={() => onSearchChange('')}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
            <div className="ehr-day-tabs" data-tour="station-tabs">
              {tabs.map(tab => (
                <button
                  key={tab.key}
                  type="button"
                  data-tour-tab={tab.key}
                  className={activeTab === tab.key ? 'active' : ''}
                  onClick={() => onTabChange(tab.key)}
                >
                  {tab.label}{typeof tab.count === 'number' ? ` · ${tab.count}` : ''}
                </button>
              ))}
            </div>
          </div>

          {!hideRowList && (
          <div className="ehr-appointment-list ehr-care-list ehr-care-list--no-actions">
              <div className="ehr-queue-scroll">
                {/* Exactly the appointments-page table: PATIENT / TIME /
                    CARE TEAM / DEPARTMENT / STATUS, reusing its classes so
                    every user's patient list reads identically. */}
                <div className="appointment-card-flow">
                  {/* The column head is the list's frame, not a label for the
                      rows that happen to be loaded: it stays put through an
                      empty day or a filter that matches nothing, so the table
                      never collapses into a bare message. */}
                  <div className="appointment-card-head" aria-hidden="true">
                    <span>Patient</span>
                    <span>Time</span>
                    <span>Care team</span>
                    <span>Context</span>
                    <span>Status</span>
                  </div>
                  {visibleRows.length === 0 && (
                    <div className="ehr-empty-state">
                      <ClipboardList className="w-8 h-8" />
                      <strong>{emptyTitle}</strong>
                      {emptyActionLabel && onEmptyAction && (
                        <button type="button" onClick={onEmptyAction}>{emptyActionLabel}</button>
                      )}
                    </div>
                  )}
                  {visibleRows.map(row => {
                    // A real triage acuity code colors the avatar (the
                    // appointments table conveys priority the same way);
                    // everyone else's tone falls back on statusTone.
                    const priorityCode = isTriageCode(row.priority) ? row.priority : null;
                    const avatarAcuity = priorityCode
                      ?? (row.statusTone === 'danger' ? 'RED' : row.statusTone === 'warning' ? 'YELLOW' : 'GREEN');
                    const sourceText = row.careTeam || row.compactMeta || row.meta || '';
                    const sourceSubtext = row.careTeamSecondary || row.careTeamLabel || 'Care team';
                    const contextText = row.location || row.room || row.meta || '';
                    const contextSubtext = row.locationSecondary || row.locationLabel || (row.room ? 'Room' : 'Location');
                    const statusText = row.statusLabel || (row.status ? titleCase(row.status) : '');
                    const activate = () => openDetail(row);
                    const isExpanded = effectiveExpandedRowId === row.id;
                    const countdown = (() => {
                      if (!now || !row.timeAt) return null;
                      const target = new Date(row.timeAt);
                      if (Number.isNaN(target.getTime())) return null;
                      const label = formatAppointmentTimeUntil(target, now);
                      if (!label) return null;
                      const minutesAway = (target.getTime() - now.getTime()) / 60000;
                      const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
                      const usesDate = dayKey(target) !== dayKey(now);
                      const tone = minutesAway < 0 ? 'is-past' : minutesAway <= 30 ? 'is-soon' : '';
                      return { label, tone, usesDate };
                    })();
                    // The Time column reads as one column: every row that has a
                    // clock time shows that clock time on the first line, so a
                    // day's list is scannable straight down the minute digits.
                    // A date only takes the first line for a row that has no
                    // time of day at all.
                    const displayTime = row.time || (countdown?.usesDate ? countdown.label : row.date) || '—';
                    // Second line: how far off the visit is — "in 45m", "2h ago"
                    // — or, for another day's visit, that day's date.
                    const timeSubtext = countdown && countdown.label !== displayTime
                      ? countdown.label
                      : row.timeSecondary || '';
    // Status pill tone reuses the appointment pill classes.
                    //
                    // The pill is a PICKER when the page supplies options and a
                    // handler: reception moves a booking along the ladder from
                    // the row it is reading rather than expanding into the
                    // editor for a one-step change. The earlier worry — a stray
                    // click closing a visit — is handled where it belongs: the
                    // row's own click is stopped over the control, and the page
                    // routes the statuses that need a confirmation (check-in,
                    // no-show, cancel) to their dialogs instead of writing them.
                    //
                    // Rows whose state is derived rather than set (a walk-in's
                    // stage comes from triage) simply pass no options and keep
                    // a plain pill.
                    const visit = row.patientId ? visitByPatient.get(row.patientId) : undefined;
                    const ladderOwnsRow = !!visit && !row.lockStatus;
                    const statusControl = {
                      text: ladderOwnsRow ? appointmentStatusLabel(visit!.status) : '',
                      value: row.statusValue,
                      options: row.statusOptions,
                      onChange: row.onStatusChange,
                    };
                    // Pill colour follows whichever state owns the pill's text:
                    // the visit's tone when the ladder owns it, the row's own
                    // tone otherwise. The two used to be wired independently, so
                    // a critical lab result could carry the ladder's "Checked
                    // In" text in the order's own red danger colour.
                    const effectiveStatusTone = ladderOwnsRow ? APPOINTMENT_STATUS_TONES[visit!.status] : row.statusTone;
                    const statusPillClass = effectiveStatusTone === 'done' ? 'status-completed'
                      : effectiveStatusTone === 'active' ? 'status-checked-in'
                      : effectiveStatusTone === 'ready' ? 'status-confirmed'
                      : effectiveStatusTone === 'danger' ? 'status-no-show'
                      : effectiveStatusTone === 'warning' ? 'status-attention'
                      // 'scheduled' used to fall through to no class, so a booked
                      // row was the one pill in the list with no tint — the
                      // Scheduled tab's picker looked unlike every other tab's.
                      : effectiveStatusTone === 'scheduled' ? 'status-scheduled'
                      : '';
                    // Under-pill cue: acuity when known, else the countdown.
                    const cue = priorityCode
                      ? PRIORITY_META[priorityCode].label
                      : countdown?.label || '';
                    // A locked row keeps the station's own pill, so the visit —
                    // real information, just not this pill's business — reads on
                    // the line underneath instead of overwriting it.
                    const lockedVisitSecondary = (row.lockStatus && visit) ? appointmentStatusLabel(visit.status) : undefined;
                    const secondaryLine = lockedVisitSecondary
                      ? (detailPair(row.statusSecondary, lockedVisitSecondary) || cue)
                      : (row.statusSecondary || cue);
                    return (
                      <div key={row.id} className={isExpanded ? 'ehr-appointment-group is-expanded' : 'ehr-appointment-group'}>
                        <div
                          className="ehr-appointment-row appointment-card-row"
                          data-triage={priorityCode || undefined}
                          role="button"
                          tabIndex={0}
                          aria-expanded={row.onOpen ? undefined : isExpanded}
                          onClick={activate}
                          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } }}
                        >
                          <div className="ehr-appointment-identity">
                            {/* No caret ahead of the avatar: the doctor
                                dashboard's rows expand the same way without
                                one, and every role's worklist should read as
                                the same control. The row itself is the
                                affordance — `aria-expanded` still tells
                                assistive tech what it does. */}
                            {/* Photo when the record has one (the acuity tint
                                still rings it); tinted initials otherwise. */}
                            <div className="ehr-patient-icon" style={stateTint(avatarAcuity)}>
                              {row.photoUrl
                                // eslint-disable-next-line @next/next/no-img-element
                                ? <img src={row.photoUrl} alt="" className="ehr-patient-icon-photo" />
                                : initials(row.title)}
                            </div>
                            <div className="ehr-appointment-main appointment-card-patient">
                              <span className="ehr-row-name">
                                {/* The name is the way into the chart; the rest of
                                    the row expands the details underneath. */}
                                <button
                                  type="button"
                                  className={row.patientId ? 'print-visible ehr-row-name-link' : 'print-visible'}
                                  title={row.patientId ? `Open ${row.title}'s chart` : undefined}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (row.patientId) router.push(`/patients/${row.patientId}`);
                                    else activate();
                                  }}
                                >
                                  {/* Two words on the row — first and last. */}
                                  {shortenPersonName(row.title)}
                                </button>
                              </span>
                              <p>{row.subtitle}</p>
                            </div>
                          </div>

                          <div className="ehr-appointment-time">
                            <strong>{displayTime}</strong>
                            {timeSubtext && <span className={countdown?.tone || ''}>{timeSubtext}</span>}
                          </div>

                          <div className="appointment-card-provider">
                            {/* Staff names show first + last (title kept). */}
                            <strong>{abbreviateProviderName(sourceText) || 'Unassigned'}</strong>
                            <span>{abbreviateProviderName(sourceSubtext)}</span>
                          </div>

                          <div className="ehr-appointment-department">
                            <strong>{contextText || '—'}</strong>
                            <span>{contextText ? contextSubtext : ''}</span>
                          </div>

                          {/* `data-priority` tints the acuity line under the
                              pill — Emergency red, Urgent amber, Routine green
                              — so the row's urgency reads at a glance instead
                              of sitting in the same grey as a department name.
                              The pill itself stays keyed to the STATUS, which
                              is what its picker sets. */}
                          <div className="appointment-card-status" data-priority={priorityCode || undefined}>
                            {statusControl.options?.length && statusControl.onChange ? (
                              <span
                                className={`appointment-status-pill appointment-status-pill--select ${statusPillClass}`.trim()}
                                // The row expands on click; picking a status
                                // must not also open the panel underneath.
                                onClick={event => event.stopPropagation()}
                                onPointerDown={event => event.stopPropagation()}
                                onMouseDown={event => event.stopPropagation()}
                                onKeyDown={event => event.stopPropagation()}
                              >
                                {statusControl.text || statusText || '—'}
                                {/* Deliberately the native control, not the
                                    searchable Select: this is a short, fixed
                                    ladder the user reads in one glance, and a
                                    filter box over seven known rungs is noise
                                    in front of the thing they came to click. */}
                                <select
                                  value={statusControl.value ? canonicalAppointmentStatus(statusControl.value as AppointmentStatus) : ''}
                                  aria-label={`Status for ${row.title}`}
                                  title={APPOINTMENT_STATUS_DESCRIPTIONS[statusControl.value as AppointmentStatus] || undefined}
                                  onClick={event => event.stopPropagation()}
                                  onPointerDown={event => event.stopPropagation()}
                                  onMouseDown={event => event.stopPropagation()}
                                  onChange={event => statusControl.onChange?.(event.target.value)}
                                >
                                  {statusControl.options.map(option => (
                                    <option
                                      key={option.value}
                                      value={option.value}
                                      title={APPOINTMENT_STATUS_DESCRIPTIONS[option.value as AppointmentStatus] || undefined}
                                    >
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </span>
                            ) : (
                              <span className={`appointment-status-pill ${statusPillClass}`.trim()}>
                                {statusControl.text || statusText || '—'}
                              </span>
                            )}
                            <small>{secondaryLine}</small>
                          </div>
                        </div>
                        {row.detail}
                        {isExpanded && !row.onOpen && (
                          <EhrRowDetail
                            row={row}
                            detailTab={detailTab}
                            onCollapse={closeDetail}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
          </div>
          )}

          {footerContent && (
            <div className="ehr-care-footer">
              {footerContent}
            </div>
          )}

          {/* Children.toArray drops null/false conditionals, so a dashboard
              whose panels are all closed doesn't render an empty card. */}
          {Children.toArray(children).length > 0 && (
            <div data-tour="station-body" className={`ehr-worklist-panel ehr-care-workflow ${hideRowList ? 'ehr-care-workflow--bare' : ''} ${effectiveView === 'calendar' ? 'is-calendar' : ''}`}>
              {children}
            </div>
          )}
        </section>

        {effectiveView === 'dashboard' && (
        <aside className="ehr-right-rail" data-tour="side-cards">
          <div className="ehr-side-card">
            <div className="ehr-side-card-head">
              <ClipboardList className="w-5 h-5" />
              <h2>{metricsTitle}</h2>
            </div>
            {metrics.map(metric => (
              <EhrCareDashboardMetricItem
                key={metric.label}
                metric={metric}
                onNavigate={href => router.push(href)}
              />
            ))}
            {metricsActions?.map(action => (
              <button
                key={action.label}
                type="button"
                className="ehr-side-card-icon-row"
                onClick={action.onClick}
              >
                <span>
                  <action.icon className="w-4 h-4" />
                  {action.label}
                </span>
              </button>
            ))}
          </div>
          {/* "Who moved where, just now" — the station equivalent of the
              clinician's "Awaiting review". Rendered here so every dashboard
              built on this shell gets it without wiring it seven times; the
              card picks its own title and slice from the signed-in role and
              renders nothing for roles that have no feed configured. Sits
              BELOW the metrics: counts are the anchor a station reads first,
              the feed is what it scans afterwards. */}
          <ProgressFeedCard />

          {showMissionCard && missionTitle && missionDescription && (
            <div className="ehr-side-card ehr-mission-card">
              <div className="ehr-side-card-head ehr-mission-head">
                <Stethoscope className="w-5 h-5" />
                <h2>{missionTitle}</h2>
              </div>
              <p>{missionDescription}</p>
            </div>
          )}
        </aside>
        )}
      </div>

      {printOpen && (
        <PrintListDialog
          // Some pages (front desk) pass an empty title and lead with the
          // greeting alone — fall back to "worklist" so the dialog and the
          // printed page are never headed just "Print".
          title={`Print ${title.trim() || 'worklist'}`}
          subtitle={`${selectedDateLabel}${greetingName ? ` — ${greetingName}` : ''}`}
          sections={printSections}
          filename={`${title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'worklist'}-${selectedDate}`}
          onClose={() => setPrintOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * The row's details, expanded in place under it.
 *
 * Same content the slide-over used to carry — visit fields, work-item
 * progress, the row's actions — but inline, so the queue above it stays
 * readable and a second row can be opened without dismissing the first.
 */
/**
 * Lets `popupDetail` content close the row it lives in.
 *
 * `expandedRowId` is this component's own state, so a caller building the
 * detail node had no handle on it — the front desk passed
 * `onClose={() => undefined}` and its inline appointment editor simply stayed
 * open after saving, toast and all. Content reads the collapse from context
 * instead, which resolves where it RENDERS rather than where it was created.
 */
const RowCollapseContext = createContext<() => void>(() => {});

/** Close the expanded row this content is rendered inside. */
export function useRowCollapse(): () => void {
  return useContext(RowCollapseContext);
}

export function EhrRowDetail({
  row,
  detailTab,
  onCollapse,
}: {
  row: EhrCareDashboardRow;
  detailTab: 'visit' | 'financial';
  onCollapse: () => void;
}) {
  const fields = (detailTab === 'visit'
    ? [
        { label: 'Time', value: detailPair(row.time || row.compactMeta, row.timeSecondary) },
        { label: 'Reason', value: row.subtitle },
        // Raw triage codes (YELLOW/RED/GREEN) read like debug output — surface
        // the clinical label instead.
        { label: 'Priority', value: isTriageCode(row.priority) ? PRIORITY_META[row.priority].label : row.priority },
        { label: 'Status', value: detailPair(row.statusLabel || (row.status ? titleCase(row.status) : undefined), row.statusSecondary) },
        { label: 'Room', value: row.room },
        { label: row.careTeamLabel || 'Care team', value: row.careTeamSecondary ? `${row.careTeam || 'Unassigned'} · ${row.careTeamSecondary}` : row.careTeam },
        { label: row.locationLabel || 'Context', value: detailPair(row.location, row.locationSecondary) },
        { label: 'Details', value: row.meta },
      ]
    : [
        // The Financial tab is intentionally not offered: no role's data layer
        // feeds it yet, so every field rendered the same placeholder no matter
        // who opened it. The branch stays so wiring real billing data back in
        // is a small diff, not a rebuild.
        { label: 'Balance', value: '—' },
        { label: 'Charge', value: 'Not started' },
        { label: 'Payment Responsibility', value: 'Not recorded' },
        { label: 'Insurance', value: 'Not recorded' },
        { label: 'Claim Status', value: 'Not started' },
      ]
  ).filter((item): item is { label: string; value: string } => Boolean(item.value));

  return (
    <div className="ehr-row-detail" role="region" aria-label={`${row.title} details`}>
      {row.popupDetail ? (
        <RowCollapseContext.Provider value={onCollapse}>
          <div className="ehr-row-detail__custom">{row.popupDetail}</div>
        </RowCollapseContext.Provider>
      ) : (
        <div className="ehr-row-detail__body">
          {fields.map(item => (
            <div className="appointment-detail-row" key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </div>
      )}

      {(!row.popupDetail || row.detailHref) && (
      <div className="ehr-row-detail__actions">
        {!row.popupDetail && row.actionLabel && row.onAction && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => { row.onAction?.(); onCollapse(); }}>
            {row.actionLabel}
          </button>
        )}
        {!row.popupDetail && row.secondaryActionLabel && row.onSecondaryAction && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { row.onSecondaryAction?.(); onCollapse(); }}>
            {row.secondaryActionLabel}
          </button>
        )}
        {!row.popupDetail && (row.extraActions ?? []).map(action => (
          <button
            key={action.label}
            type="button"
            className="btn btn-secondary btn-sm"
            style={action.tone === 'danger' ? { color: 'var(--color-danger-text)', borderColor: 'var(--color-danger)' } : undefined}
            onClick={() => { action.onClick(); onCollapse(); }}
          >
            {action.label}
          </button>
        ))}
        {row.detailHref && (
          <Link href={row.detailHref} className="btn btn-secondary btn-sm">
            {row.detailLabel || 'Open full page'}
          </Link>
        )}
      </div>
      )}
    </div>
  );
}

/**
 * A metric is only an enabled control when it has an action. Keeping an inert
 * metric as a disabled button preserves the established rail geometry while
 * removing it from keyboard navigation and the accessibility action model.
 */
export function EhrCareDashboardMetricItem({
  metric,
  onNavigate,
}: {
  metric: EhrCareDashboardMetric;
  onNavigate: (href: string) => void;
}) {
  const onClick = metric.onClick || (metric.href ? () => onNavigate(metric.href as string) : undefined);

  return (
    <button
      type="button"
      disabled={!onClick}
      // `success` was missing here, so a metric asking for it fell through to
      // the neutral grey — a healthy count looked inert.
      className={`${metric.tone && metric.tone !== 'neutral' ? metric.tone : ''} ${metric.active ? 'active' : ''}`.trim()}
      onClick={onClick}
    >
      <span>{metric.label}</span>
      <b>{metric.value}</b>
    </button>
  );
}
