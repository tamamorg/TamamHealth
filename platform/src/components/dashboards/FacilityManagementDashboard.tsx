'use client';

/**
 * Facility Management — the org-admin console dashboard, rebuilt 2026-08-21
 * on the shared admin console kit (sadb-*) to mirror /admin's anatomy:
 * a KPI tile row, an operational row (weekly cash flow + today's
 * operations), the work queue as a tabbed sadb card, and the org's facility
 * matrix as a grid list. Until then it rode the clinical `EhrCareDashboard`
 * shell (mini-calendar + queue + rail), which made the org admin's landing
 * page read as a care station while every other admin page read as a
 * console. The clinical shell itself is untouched — eight role dashboards
 * still compose it.
 *
 * Everything the old shell did is still here, re-homed:
 *  • the clickable Facility Overview metrics — now KPI tiles (staffing and
 *    census) plus a Today's Operations card (the day-scoped figures), both
 *    keeping the ?preview= deep-linked FacilityMetricPreviewDialog;
 *  • the Weekly Cash Flow chart (same deferred recharts import);
 *  • the Add menu and the staff-accounts shortcut, in the page-actions row.
 * Dropped deliberately: the mini-calendar and day filtering — both were
 * already inert here (`filterRowsByDate={false}`; neither queue is a single
 * day's schedule).
 *
 * The three queue tabs (Inquiries / Pending Leave / Active Staff) left this
 * page on 2026-08-24 for /facility-management/queue — a work queue is a
 * surface you WORK, and as the dashboard's last card it spent a screen of
 * whitespace saying "No recent inquiries". The dashboard keeps the counts
 * (KPI tiles and Today's Operations); the rows, the search and the triage
 * dialogs live on the queue's own page. `buildFacilityOverview` still returns
 * the rows — it is the tested combiner both surfaces are defined against.
 *
 * The user-management table that predated all of this stays gone: accounts
 * are managed on /org-admin/users (or /admin/users); this screen previews
 * and deep-links. Do not reintroduce a stat surface without data behind it —
 * every number here is computed from loaded records (the all-zero KPI band
 * of the deleted /org-admin Org Overview is the cautionary tale).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  AlertTriangle, RefreshCw, Loader2, X, Maximize2,} from '@/components/icons/lucide';
import { useAuth } from '@/lib/context';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useUsers } from '@/lib/hooks/useUsers';
import { usePatients } from '@/lib/hooks/usePatients';
import { useWards } from '@/lib/hooks/useWards';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { useFacilityCensus } from '@/lib/hooks/useFacilityCensus';
import { censusFor } from '@/lib/services/facility-census';
import Modal from '@/components/Modal';
import {
  SadbPage, SadbCard, SadbKpiTile, SadbKvRow,
  SadbChip, SadbGridList, SadbGridRow, SadbHeadLink,
} from '@/components/admin/sadb-ui';
import { toIsoDate } from '@/lib/date-utils';
import { formatMoney, titleCase } from '@/lib/format-utils';
import { jubaDate, jubaTime } from '@/lib/time-juba';
import { usersHrefForRole } from '@/lib/people-nav';
import { summariseEnquiries, getPatientEnquiries } from '@/lib/services/enquiry-service';
import {
  activeStaffOf, buildInquiryRows, buildPendingLeaveRows, buildStaffRows,
  INQUIRY_DIGEST_LIMIT, INQUIRY_SEARCH_LIMIT,
  type FacilityInquiryRow, type FacilityLeaveRow, type FacilityStaffRow,
} from '@/lib/facility-work-queue';
import type { MessageDoc, UserDoc, PatientDoc, StaffScheduleDoc, HospitalDoc } from '@/lib/db-types';
import type { LeaveRequestDoc } from '@/lib/db-types-hr';

// recharts (~80–100 KB) is deferred behind a dynamic boundary so it is fetched
// only when this chart renders (KAN-66). ssr:false because recharts measures
// the DOM to size itself.
const WeeklyActivityChart = dynamic(() => import('./_FacilityCharts').then(m => m.WeeklyActivityChart), {
  ssr: false,
  loading: () => <div style={{ width: '100%', height: 208 }} />,
});

// Kept from the Cash Flow donut this chart replaced, so received/pending read
// in the same two colours everywhere in the product.
const CASH_RECEIVED = '#0fa06a';
const CASH_PENDING = 'var(--color-warning)';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** JS getDay() (0=Sun..6=Sat) → our Mon-first index (0=Mon..6=Sun). */
function weekdayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/** Money axis in a narrow rail: full figures (SSP 1,250,000) blow the tick
 *  column out, so ticks go compact and the tooltip keeps the exact amount. */
function compactAmount(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

/** Money billed on one day, split by what has actually been collected.
 *  Cancelled/waived/draft bills are excluded — nothing is owed on them, so
 *  charting their balance would invent revenue that will never arrive. */
interface DailyCash {
  date: string;
  received: number;
  pending: number;
}
const CHARGEABLE_BILL_STATUSES = new Set([
  'pending', 'partial', 'paid', 'insurance_pending', 'insurance_approved',
]);

/** Staffing-gap row shape returned by `getStaffingGaps` — duplicated here
 *  (rather than imported) because the service is loaded dynamically, same
 *  precedent as the HR page's own `StaffingGap` type. */
interface StaffingGap {
  shift: string;
  gap: number;
  requiredStaff: number;
  currentStaff: number;
}

const DOCTOR_ROLES = new Set(['doctor', 'clinical_officer', 'clinician']);
const NURSE_ROLES = new Set(['nurse', 'midwife']);

export interface FacilityOverviewInput {
  /** jubaDate() — passed in rather than read from the clock so this stays testable. */
  today: string;
  /** Free-text filter applied only to the Recent Inquiries preview. */
  search: string;
  users: UserDoc[];
  /** True once the users fetch has failed AND there is nothing cached to show —
   *  the users-dependent metrics/panels must read as "unknown", never as a
   *  quiet zero (the /api/users 500 case). */
  usersUnavailable: boolean;
  patients: PatientDoc[];
  /** Every scope-visible patient enquiry, not pre-sliced — this combiner does
   *  both the metric total and the recent/search preview slicing. */
  enquiries: MessageDoc[];
  leave: LeaveRequestDoc[];
  /** Today's schedules only (already filtered by getSchedulesByDate). */
  schedules: StaffScheduleDoc[];
  staffingGaps: StaffingGap[];
  availableProviderIds: Set<string>;
  /** Where this role reads the staff list. The HR module's "Staff Roster" was
   *  the same roster as the accounts page, so every staff figure links here. */
  usersHref: string;
  availableBeds: number;
}

export interface FacilityOverviewMetric {
  key: string;
  label: string;
  value: number | string;
  href: string;
  tone?: 'neutral' | 'warning' | 'danger' | 'success';
}

function FacilityMetricPreviewDialog({ metric, onClose, onOpen }: {
  metric: FacilityOverviewMetric;
  onClose: () => void;
  onOpen: () => void;
}) {
  const titleId = 'facility-metric-preview-title';
  return (
    <Modal onClose={onClose} width={460} labelledBy={titleId}>
      <div className="sadb-modal">
        <div className="flex items-start justify-between gap-4">
          <div className="sadb-modal-copy" style={{ marginBottom: 0 }}>
            <p className="sadb-card-meta">Facility overview</p>
            <h2 id={titleId} className="sadb-modal-title mt-1">{metric.label}</h2>
          </div>
          {/* Expand and close, once each. This card used to offer both again in
              a footer row, so two buttons at the bottom restated two buttons at
              the top and the reader had to compare them to be sure. */}
          <span className="flex items-center gap-1 flex-shrink-0">
            <button type="button" className="p-2 rounded-lg" onClick={onOpen} aria-label="Open full page" title="Open full page" data-action="preview-expand">
              <Maximize2 className="w-4 h-4" />
            </button>
            <button type="button" className="p-2 rounded-lg" onClick={onClose} aria-label="Close preview">
              <X className="w-4 h-4" />
            </button>
          </span>
        </div>
        <div className="py-5">
          <p className="sadb-kpi-value" style={{ fontSize: 30 }}>{metric.value}</p>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            This is the current scope-visible total. Open the full page to review and manage the underlying records.
          </p>
        </div>
      </div>
    </Modal>
  );
}

/* Row shapes and their builders are shared with the queue's own page — see
   lib/facility-work-queue.ts. Re-exported here because this module's
   `FacilityOverview` is their published contract (and its test suite's). */
export type { FacilityInquiryRow, FacilityLeaveRow, FacilityStaffRow };

export interface FacilityOverview {
  metrics: FacilityOverviewMetric[];
  inquiryRows: FacilityInquiryRow[];
  /** Total matches behind `inquiryRows` (which is capped at 5 idle / 20 while
   *  searching) — kept distinct so a caller can tell "5 of 5" from "5 of 40". */
  inquiryMatchCount: number;
  /** Pending leave requests (status === 'pending'), filtered by the same
   *  `search` text as the inquiries preview — the Pending Leave tab's queue. */
  pendingLeaveRows: FacilityLeaveRow[];
  /** Enabled accounts marked available today: the queue tab's rows, its pill
   *  count, and the roster link that reproduces it. `count` is '—' when the
   *  users fetch failed. */
  activeStaff: {
    rows: FacilityStaffRow[];
    count: number | string;
    href: string;
    unavailable: boolean;
  };
}

/**
 * Pure combiner behind FacilityManagementDashboard — every input is an
 * already-resolved, already-scoped value, so this only exercises the
 * assembling logic (counts, hrefs, row shaping), never data fetching or
 * tenancy filtering. Mirrors the house pattern in
 * `src/__tests__/components/doctor/worklist.test.ts` (assembleDoctorWorklist).
 */
export function buildFacilityOverview(input: FacilityOverviewInput): FacilityOverview {
  const {
    today, search, users, usersUnavailable, patients, enquiries, leave,
    schedules, staffingGaps, availableProviderIds, availableBeds, usersHref,
  } = input;

  const doctors = users.filter(u => DOCTOR_ROLES.has(u.role));
  const nurses = users.filter(u => NURSE_ROLES.has(u.role));
  const activeStaff = activeStaffOf(users, availableProviderIds);
  const pendingLeave = leave.filter(l => l.status === 'pending');
  const unfilledShifts = staffingGaps.reduce((sum, g) => sum + g.gap, 0);
  const enquirySummary = summariseEnquiries(enquiries);

  // Degraded /api/users path: read as "unknown" (—), never as a real zero.
  const staffCount = (n: number): number | string => (usersUnavailable ? '—' : n);
  const staffTone = usersUnavailable ? ('warning' as const) : undefined;

  const metrics: FacilityOverviewMetric[] = [
    { key: 'staff-total', label: 'Total Staff', value: staffCount(users.length), href: usersHref, tone: staffTone },
    { key: 'doctors', label: 'Total Doctors', value: staffCount(doctors.length), href: usersHref, tone: staffTone },
    { key: 'nurses', label: 'Total Nurses', value: staffCount(nurses.length), href: usersHref, tone: staffTone },
    { key: 'patients', label: 'Total Patients', value: patients.length, href: '/patients' },
    { key: 'beds', label: 'Available Beds', value: availableBeds, href: '/wards' },
    { key: 'inquiries-open', label: 'Open Inquiries', value: enquirySummary.open, href: '/inquiries?status=new', tone: enquirySummary.open > 0 ? 'warning' : undefined },
    { key: 'leave-pending', label: 'Pending Leave', value: pendingLeave.length, href: '/hr/leave?status=pending', tone: pendingLeave.length > 0 ? 'warning' : undefined },
    { key: 'shifts-today', label: "Today's Shifts", value: schedules.length, href: `/hr/schedule?date=${today}` },
    // "Unfilled" = short against a configured per-shift minimum, not a vacant
    // position record — this data model has no such record (see getStaffingGaps).
    { key: 'shifts-unfilled', label: 'Unfilled Shifts', value: unfilledShifts, href: '/hr/schedule?gaps=1', tone: unfilledShifts > 0 ? 'danger' : undefined },
  ];

  // The three queues, shaped by the shared builders the queue page uses. Here
  // they are a digest — top 5, widening to 20 on a search; there they are the
  // whole queue.
  const { rows: inquiryRows, matchCount: inquiryMatchCount } = buildInquiryRows(
    enquiries, search, search.trim() ? INQUIRY_SEARCH_LIMIT : INQUIRY_DIGEST_LIMIT,
  );
  const pendingLeaveRows = buildPendingLeaveRows(leave, search);
  const activeStaffRows = buildStaffRows(activeStaff, schedules, search);

  return {
    metrics,
    inquiryRows,
    inquiryMatchCount,
    pendingLeaveRows,
    activeStaff: {
      rows: activeStaffRows,
      count: staffCount(activeStaff.length),
      href: usersHref,
      unavailable: usersUnavailable,
    },
  };
}

type ExtraKey = 'billing' | 'enquiries' | 'availability' | 'leave' | 'schedule' | 'gaps';
const EXTRA_LABELS: Record<ExtraKey, string> = {
  billing: 'billing', enquiries: 'inquiries', availability: 'staff availability',
  leave: 'leave requests', schedule: 'shift schedule', gaps: 'staffing gaps',
};

/* Facility matrix columns: Facility · Type · Beds · Patients · Today's visits */
const FAC_GRID = 'minmax(200px, 1.7fr) minmax(130px, 1fr) minmax(70px, 0.6fr) minmax(90px, 0.7fr) minmax(90px, 0.7fr)';

export default function FacilityManagementDashboard() {
  const { currentUser } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const previewOpenedHere = useRef(false);
  const scope = useDataScope();

  const { users, loading: usersLoading, error: usersError, reload: reloadUsers } = useUsers();
  const { patients, loading: patientsLoading } = usePatients();
  const { availableBeds, loading: wardsLoading } = useWards();
  const { hospitals } = useHospitals();
  // Real counts — HospitalDoc.patientCount/todayVisits are write-once-zero
  // registry fields nothing recomputes (2026-08 hardcoded-data sweep).
  const { census: facilityCensus } = useFacilityCensus();

  const [cash, setCash] = useState<{ currency: string; days: DailyCash[] }>({ currency: 'SSP', days: [] });
  const [enquiries, setEnquiries] = useState<MessageDoc[]>([]);
  const [availableProviderIds, setAvailableProviderIds] = useState<Set<string>>(new Set());
  const [leave, setLeave] = useState<LeaveRequestDoc[]>([]);
  const [schedules, setSchedules] = useState<StaffScheduleDoc[]>([]);
  const [staffingGaps, setStaffingGaps] = useState<StaffingGap[]>([]);
  const [loadErrors, setLoadErrors] = useState<Set<ExtraKey>>(new Set());
  const [extraLoading, setExtraLoading] = useState(true);
  // Distinct from `extraLoading`, which only covers the FIRST load (it gates
  // the whole-page spinner). A retry re-runs the same six fetches with the
  // page already painted, and without its own flag the Retry button sat there
  // looking inert for the whole round trip.
  const [retrying, setRetrying] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const hasLoadedExtraRef = useRef(false);

  const today = jubaDate();
  const facilityId = currentUser?.hospitalId;

  // Billing, enquiries, provider availability, leave, and today's
  // schedule/staffing-gaps are all fetched together; each is tracked
  // independently in `loadErrors` so a single failure degrades only its own
  // card instead of the whole dashboard, and Retry re-runs all six.
  useEffect(() => {
    let cancelled = false;
    if (!hasLoadedExtraRef.current) setExtraLoading(true);

    // Received/pending per day, off the bills themselves: `amountPaid` is
    // already net of reversed payments and `balanceDue` is what is still owed,
    // so both sides of a day's cash come from one pass over the bill list.
    // Both are keyed on `encounterDate` — one date semantics, so a day's two
    // bars always sum to what that day billed.
    const loadCash = async () => {
      const { getAllBills } = await import('@/lib/services/billing-service');
      const bills = await getAllBills(scope);
      const byDate = new Map<string, DailyCash>();
      for (const b of bills) {
        if (!CHARGEABLE_BILL_STATUSES.has(b.status)) continue;
        const date = (b.encounterDate || '').slice(0, 10);
        if (!date) continue;
        const row = byDate.get(date) || { date, received: 0, pending: 0 };
        row.received += Math.max(0, b.amountPaid || 0);
        row.pending += Math.max(0, b.balanceDue || 0);
        byDate.set(date, row);
      }
      return { currency: bills[0]?.currency || 'SSP', days: Array.from(byDate.values()) };
    };
    const loadAvailability = async () => {
      // Recurrence-aware: a clinic that runs every Monday has no row dated
      // today, so matching on `a.date === today` would show every provider as
      // unavailable the moment availability became a weekly pattern.
      const { getAllAvailability, appliesOnDate } = await import('@/lib/services/availability-service');
      const av = await getAllAvailability(scope);
      const now = jubaTime();
      return new Set(
        av.filter(a => appliesOnDate(a, today) && a.startTime <= now && a.endTime >= now).map(a => a.providerId),
      );
    };
    const loadLeave = async () => {
      const { getAllLeaveRequests } = await import('@/lib/services/leave-service');
      return getAllLeaveRequests(scope);
    };
    const loadSchedules = async () => {
      const { getSchedulesByDate } = await import('@/lib/services/staff-scheduling-service');
      return getSchedulesByDate(today, facilityId);
    };
    const loadGaps = async () => {
      const { getStaffingGaps } = await import('@/lib/services/staff-scheduling-service');
      return getStaffingGaps(today, facilityId);
    };

    const runAll = () => Promise.allSettled([
      loadCash(),
      getPatientEnquiries(scope),
      loadAvailability(),
      loadLeave(),
      loadSchedules(),
      loadGaps(),
    ]);

    (async () => {
      const failed = new Set<ExtraKey>();
      if (hasLoadedExtraRef.current) setRetrying(true);
      let results = await runAll();
      if (cancelled) return;

      // One automatic second attempt before showing anyone a red banner.
      //
      // Each of the six loaders begins with a dynamic `import()`, so a single
      // chunk that fails to arrive rejects all six at once — which is why the
      // banner reads "Couldn't load billing, inquiries, staff availability,
      // leave requests, shift schedule, staffing gaps" rather than naming one
      // thing. That is one transient network fault, not six broken subsystems,
      // and on the connections this app is built for it is routine. Retrying
      // turns it into a slightly slower load instead of an alarm.
      if (results.some(r => r.status === 'rejected')) {
        await new Promise(resolve => setTimeout(resolve, 700));
        if (cancelled) return;
        results = await runAll();
        if (cancelled) return;
      }
      const [billingRes, enquiriesRes, availRes, leaveRes, schedRes, gapsRes] = results;
      if (billingRes.status === 'fulfilled') setCash(billingRes.value); else failed.add('billing');
      if (enquiriesRes.status === 'fulfilled') setEnquiries(enquiriesRes.value); else failed.add('enquiries');
      if (availRes.status === 'fulfilled') setAvailableProviderIds(availRes.value); else failed.add('availability');
      if (leaveRes.status === 'fulfilled') setLeave(leaveRes.value); else failed.add('leave');
      if (schedRes.status === 'fulfilled') setSchedules(schedRes.value); else failed.add('schedule');
      if (gapsRes.status === 'fulfilled') setStaffingGaps(gapsRes.value); else failed.add('gaps');

      // `allSettled` swallows the reason, and this banner names six subsystems
      // at once whenever anything shared underneath them breaks — six identical
      // symptoms and no cause. Log what actually rejected.
      for (const [key, res] of [
        ['billing', billingRes], ['enquiries', enquiriesRes], ['availability', availRes],
        ['leave', leaveRes], ['schedule', schedRes], ['gaps', gapsRes],
      ] as [ExtraKey, PromiseSettledResult<unknown>][]) {
        if (res.status === 'rejected') console.error(`[facility-dashboard] ${key} failed to load:`, res.reason);
      }
      setLoadErrors(failed);
      hasLoadedExtraRef.current = true;
      setExtraLoading(false);
      setRetrying(false);
    })();

    return () => { cancelled = true; };
  }, [scope, today, facilityId, reloadToken]);

  const retryExtra = useCallback(() => setReloadToken(t => t + 1), []);
  const retryAll = useCallback(() => { reloadUsers(); retryExtra(); }, [reloadUsers, retryExtra]);

  const usersUnavailable = !!usersError && users.length === 0;

  // Every staff figure on this page links to the one staff list this role has.
  // The roles that reach /facility-management all resolve to one; the
  // fallback only guards the type, and lands on the page they are already on.
  const staffListHref = usersHrefForRole(currentUser?.role || '') || '/facility-management';

  const overview = useMemo(() => buildFacilityOverview({
    today,
    // No queue on this page any more, so nothing to filter by: the rows the
    // combiner still returns feed only its counts.
    search: '',
    users,
    usersUnavailable,
    patients,
    enquiries,
    leave,
    schedules,
    staffingGaps,
    availableProviderIds,
    usersHref: staffListHref,
    availableBeds,
  }), [today, users, usersUnavailable, patients, enquiries, leave, schedules, staffingGaps, availableProviderIds, staffListHref, availableBeds]);

  const metricPreview = overview.metrics.find(metric => metric.key === searchParams.get('preview')) || null;

  const openMetricPreview = useCallback((key: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('preview', key);
    previewOpenedHere.current = true;
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router, searchParams]);

  const closeMetricPreview = useCallback(() => {
    if (previewOpenedHere.current) {
      previewOpenedHere.current = false;
      router.back();
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.delete('preview');
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false });
  }, [pathname, router, searchParams]);

  // This week's cash, Monday-first. Days are matched on the local calendar date
  // string rather than by parsing to Date: `encounterDate` is date-only, and
  // `new Date('2026-08-12')` is UTC midnight, which lands on the previous day
  // for anyone west of Greenwich.
  const weekly = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - weekdayIndex(start)); // Monday of this week
    return WEEKDAYS.map((label, i) => {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const iso = toIsoDate(d);
      const day = cash.days.find(c => c.date === iso);
      return { day: label, received: day?.received || 0, pending: day?.pending || 0 };
    });
  }, [cash.days]);

  const cashSeries = useMemo(() => {
    const money = {
      axisFormat: compactAmount,
      tooltipFormat: (v: number) => formatMoney(v, { currency: cash.currency }),
    };
    return [
      { key: 'received', name: 'Received', color: CASH_RECEIVED, ...money },
      { key: 'pending', name: 'Pending', color: CASH_PENDING, ...money },
    ];
  }, [cash.currency]);

  const failedLabels = Array.from(loadErrors).map(k => EXTRA_LABELS[k]);
  if (usersError) failedLabels.push('staff accounts');
  const hasErrors = failedLabels.length > 0;

  const initialLoading = usersLoading || patientsLoading || wardsLoading || extraLoading;

  const metricByKey = (key: string) => overview.metrics.find(m => m.key === key);

  /* KPI tiles carry the census/staffing totals; the three day-scoped figures
     (shifts, unfilled, pending leave) read in the Today's Operations card so
     the tile row is one line, not two. */
  const TILE_KEYS = ['staff-total', 'doctors', 'nurses', 'patients', 'beds', 'inquiries-open'];

  const unfilledShifts = metricByKey('shifts-unfilled')?.value ?? 0;
  // The unfiltered count — this page no longer carries the queue's search box.
  const pendingLeaveCount = metricByKey('leave-pending')?.value ?? 0;

  // Written-out facility tier ("National Referral", "Phcc" stays "PHCC").
  const facilityLabel = (ft: string) =>
    ft === 'phcc' || ft === 'phcu' ? ft.toUpperCase() : titleCase(ft.replace(/_/g, ' '));

  if (!currentUser) return null;

  if (initialLoading) {
    return (
      <SadbPage roles={['org_admin', 'hospital_manager', 'super_admin']}>
        <p className="sadb-empty" aria-live="polite">
          <Loader2 className="w-4 h-4 inline-block me-2 animate-spin" style={{ verticalAlign: -3 }} />
          Loading facility data…
        </p>
      </SadbPage>
    );
  }

  return (
    <SadbPage roles={['org_admin', 'hospital_manager', 'super_admin']}>
      {/* No panel header. "Facility Management" now rides in the app header
          under the organization's name, and the two record actions that sat
          here — the staff roster and Add — moved to the rail beside it, so
          they are reachable from every page of the console rather than only
          this one. The page opens straight into its numbers. */}

      {/* While a retry is in flight the strip reports THAT, not the stale
          failure: pressing Retry and seeing the same red banner sit there is
          indistinguishable from the button being broken. */}
      {(hasErrors || retrying) && (
        <div
          className="sadb-card"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: '10px 14px', borderColor: retrying ? undefined : 'rgba(158, 27, 20, 0.35)' }}
          aria-live="polite"
        >
          {retrying ? (
            <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin" style={{ color: 'var(--accent-primary)' }} />
          ) : (
            <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-danger-800)' }} />
          )}
          <span className="text-[12.5px] flex-1" style={{ color: 'var(--text-primary)' }}>
            {retrying
              ? `Reloading ${failedLabels.length > 0 ? failedLabels.join(', ') : 'this page'}…`
              : <>Couldn&apos;t load {failedLabels.join(', ')}. Some numbers on this page may be incomplete.</>}
          </span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={retryAll} disabled={retrying}>
            <RefreshCw className={`w-3.5 h-3.5${retrying ? ' animate-spin' : ''}`} />
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}

      {/* ═══ KPI tiles — census & staffing totals, each opening its preview ═══ */}
      <div className="sadb-kpi-row">
        {TILE_KEYS.map(key => {
          const m = metricByKey(key);
          if (!m) return null;
          return (
            <SadbKpiTile
              key={m.key}
              label={m.label}
              value={m.value}
              delta={m.tone === 'warning' || m.tone === 'danger' ? 'Needs attention' : undefined}
              deltaTone={m.tone === 'warning' || m.tone === 'danger' ? 'warn' : undefined}
              onClick={() => openMetricPreview(m.key)}
            />
          );
        })}
      </div>

      {/* ═══ Operational row: cash flow + today's operations ═══ */}
      {/* No `items-start`: the two cards are one row of the dashboard and read
          as a pair, so they end on the same line. The chart sets the height —
          it has a fixed one — and the operations list spreads its four rows to
          fill rather than stopping halfway down beside it. */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-3.5">
        <SadbCard title="Weekly Cash Flow" meta={cash.currency}>
          <div className="px-3 pt-3 pb-1">
            <WeeklyActivityChart data={weekly} chartType="bar" series={cashSeries} />
          </div>
        </SadbCard>

        <SadbCard
          title="Today's Operations"
          action={<SadbHeadLink onClick={() => router.push(`/hr/schedule?date=${today}`)}>Schedule</SadbHeadLink>}
        >
          <div className="sadb-kv-fill">
            <SadbKvRow label="Today's shifts" value={String(metricByKey('shifts-today')?.value ?? 0)} />
            <SadbKvRow
              label="Unfilled shifts"
              chip={String(unfilledShifts)}
              chipTone={typeof unfilledShifts === 'number' && unfilledShifts > 0 ? 'red' : 'green'}
            />
            <SadbKvRow
              label="Pending leave"
              chip={String(pendingLeaveCount)}
              chipTone={typeof pendingLeaveCount === 'number' && pendingLeaveCount > 0 ? 'yellow' : 'neutral'}
            />
            <SadbKvRow label="Staff available now" value={String(overview.activeStaff.count)} valueTone={overview.activeStaff.unavailable ? 'warn' : undefined} />
          </div>
        </SadbCard>
      </div>

      {/* ═══ The org's registered facilities ═══
           The work queue used to sit beside this list; it moved to
           /facility-management/queue on 2026-08-24, so the matrix takes the
           whole row rather than keeping half of it warm for a card that is no
           longer here. It stays inside `sadb-lower-row` for that row's height
           cap: the list grows with the data, and uncapped it runs the page
           into a scroll no dashboard should have. */}
      {hospitals.length > 0 && (
        <div className="sadb-lower-row">
          <SadbCard
            className="is-wide"
            title="Facilities"
            meta={`${hospitals.length}`}
            action={<SadbHeadLink onClick={() => router.push('/facility-management/queue')}>Work queue</SadbHeadLink>}
          >
            <div className="sadb-card-scroll">
              <SadbGridList
                template={FAC_GRID}
                minWidth={640}
                head={['Facility', 'Type', 'Beds', 'Patients', "Today's visits"]}
              >
                {hospitals.map((h: HospitalDoc) => (
                  <SadbGridRow key={h._id} template={FAC_GRID} onClick={() => router.push(`/admin/facilities/${h._id}`)}>
                    <span className="min-w-0">
                      <span className="sadb-tenant-name truncate">{h.name}</span>
                    </span>
                    <span>
                      <SadbChip tone={h.facilityType === 'phcc' || h.facilityType === 'phcu' ? 'neutral' : 'blue'}>
                        {facilityLabel(h.facilityType)}
                      </SadbChip>
                    </span>
                    <span className="sadb-tenant-num">{h.totalBeds || 0}</span>
                    <span className="sadb-tenant-num">{facilityCensus ? censusFor(facilityCensus, h._id).patients : '…'}</span>
                    <span className="sadb-tenant-num">{facilityCensus ? censusFor(facilityCensus, h._id).todayVisits : '…'}</span>
                  </SadbGridRow>
                ))}
              </SadbGridList>
            </div>
          </SadbCard>
        </div>
      )}

      {metricPreview && (
        <FacilityMetricPreviewDialog
          metric={metricPreview}
          onClose={closeMetricPreview}
          onOpen={() => {
            previewOpenedHere.current = false;
            router.push(metricPreview.href);
          }}
        />
      )}

    </SadbPage>
  );
}
