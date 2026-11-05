'use client';

/**
 * Facility Management — the org-admin console dashboard, rebuilt 2026-08-21
 * on the shared admin console kit (sadb-*) to mirror /admin's anatomy:
 * a KPI tile row, an operational row (patient flow, cash, today), and the
 * org's facility matrix as a grid list. Until then it rode the clinical `EhrCareDashboard`
 * shell (mini-calendar + queue + rail), which made the org admin's landing
 * page read as a care station while every other admin page read as a
 * console. The clinical shell itself is untouched — eight role dashboards
 * still compose it.
 *
 * Everything the old shell did is still here, re-homed:
 *  • the clickable Facility Overview metrics — now KPI tiles (staffing and
 *    census) plus a Today's Operations card (the day-scoped figures). A tile
 *    opens the page that owns its figure directly (2026-11-04: the preview
 *    popup that used to stand in between was removed, as on /admin);
 *  • the week's cash — as a ring with its total in the middle and the two
 *    amounts beside it (2026-08-24), which is the super-admin readiness
 *    card's anatomy and its layout classes. Seven columns of stacked bars
 *    spent the row's widest card saying less than "how much, and how much of
 *    it landed", and that width now draws Patient Flow: admissions vs
 *    outpatient encounters, the two ends of the same day's work, which
 *    nothing on this page reported before;
 *  • the Add menu and the staff-accounts shortcut, in the page-actions row.
 * Dropped deliberately: the mini-calendar and day filtering — both were
 * already inert here (`filterRowsByDate={false}`; neither queue is a single
 * day's schedule).
 *
 * The three queue tabs (Inquiries / Pending Leave / Active Staff) left this
 * page on 2026-08-24 for a Work Queue page of their own, and that page was
 * deleted on 2026-11-04: it repeated /inquiries and /hr/leave in full. As
 * the dashboard's last card it had spent a screen of whitespace saying "No
 * recent inquiries". The dashboard keeps the counts
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

import { defaultCurrency } from '@/lib/country/country-pack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  Loader2,} from '@/components/icons/lucide';
import { useAuth } from '@/lib/context';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { summariseIssues } from '@/modules/communication/client';
import { useUsers } from '@/lib/hooks/useUsers';
import { usePatients } from '@/lib/hooks/usePatients';
import { useWards } from '@/lib/hooks/useWards';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { useFacilityCensus } from '@/lib/hooks/useFacilityCensus';
import { censusFor } from '@/lib/services/facility-census';
import {
  SadbPage, SadbCard, SadbKpiTile, SadbKvRow, trendBetween, type SadbTrendValue,
  SadbGridList, SadbGridRow, SadbHeadLink, SadbSearch, SadbChip,
} from '@/components/admin/sadb-ui';
import DashboardCreateActions from '@/components/dashboard/DashboardCreateActions';
import { addDaysIso } from '@/lib/date-utils';
import { formatMoney, titleCase } from '@/lib/format-utils';
import { ChartLoadingState } from '@/components/ChartCard';
import { jubaDate, jubaDateRangeUtc, jubaTime, jubaWeekStart } from '@/lib/time-juba';
import { usersHrefForRole } from '@/lib/people-nav';
import { summariseEnquiries, getPatientEnquiries } from '@/lib/services/enquiry-service';
import {
  activeStaffOf, buildInquiryRows, buildPendingLeaveRows, buildStaffRows,
  INQUIRY_DIGEST_LIMIT, INQUIRY_SEARCH_LIMIT,
  type FacilityInquiryRow, type FacilityLeaveRow, type FacilityStaffRow,
} from '@/lib/facility-work-queue';
import type { MessageDoc, UserDoc, PatientDoc, StaffScheduleDoc, HospitalDoc } from '@/lib/db-types';
import type { LeaveRequestDoc } from '@/lib/db-types-hr';
import { useTranslation } from '@/lib/i18n/useTranslation';

// recharts (~80–100 KB) is deferred behind a dynamic boundary so it is fetched
// only when this chart renders (KAN-66). ssr:false because recharts measures
// the DOM to size itself.
const WeeklyActivityChart = dynamic(() => import('./_FacilityCharts').then(m => m.WeeklyActivityChart), {
  ssr: false,
  loading: () => <ChartLoadingState height={208} />,
});
const CashFlowDonut = dynamic(() => import('./_FacilityCharts').then(m => m.CashFlowDonut), {
  ssr: false,
  loading: () => <ChartLoadingState height={132} fill />,
});

// The billing workspace's own cash ring draws these two, so received/pending
// read in the same two colours everywhere in the product.
const CASH_RECEIVED = '#0fa06a';
const CASH_PENDING = 'var(--color-warning)';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Inpatient/outpatient keep the CVD-validated blue/orange pair the clinical
 *  dashboards' day-activity chart uses (`--viz-inpatient` / `--viz-outpatient`
 *  on .ehr-day-stats, the same two hex values), so the split means the same
 *  thing to a reader who has seen it on a ward board. */
const FLOW_INPATIENT = 'var(--chart-2)';
const FLOW_OUTPATIENT = 'var(--chart-5)';

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

/** One day's arrivals, split by where the patient went. */
interface DailyFlow {
  date: string;
  inpatient: number;
  outpatient: number;
}

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
    { key: 'staff-total', label: 'Total staff', value: staffCount(users.length), href: usersHref, tone: staffTone },
    { key: 'doctors', label: 'Total doctors', value: staffCount(doctors.length), href: usersHref, tone: staffTone },
    { key: 'nurses', label: 'Total nurses', value: staffCount(nurses.length), href: usersHref, tone: staffTone },
    { key: 'patients', label: 'Total patients', value: patients.length, href: '/patients' },
    { key: 'beds', label: 'Available beds', value: availableBeds, href: '/wards' },
    { key: 'inquiries-open', label: 'Open inquiries', value: enquirySummary.open, href: '/inquiries?status=new', tone: enquirySummary.open > 0 ? 'warning' : undefined },
    { key: 'leave-pending', label: 'Pending leave', value: pendingLeave.length, href: '/hr/leave?status=pending', tone: pendingLeave.length > 0 ? 'warning' : undefined },
    { key: 'shifts-today', label: "Today's Shifts", value: schedules.length, href: `/hr/schedule?date=${today}` },
    // "Unfilled" = short against a configured per-shift minimum, not a vacant
    // position record — this data model has no such record (see getStaffingGaps).
    { key: 'shifts-unfilled', label: 'Unfilled shifts', value: unfilledShifts, href: '/hr/schedule?gaps=1', tone: unfilledShifts > 0 ? 'danger' : undefined },
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

const METRIC_LABEL_KEY: Record<string, string> = {
  'staff-total': 'facilityMgmt.totalStaff', doctors: 'facilityMgmt.totalDoctors', nurses: 'facilityMgmt.totalNurses',
  patients: 'facilityMgmt.totalPatients', beds: 'facilityMgmt.availableBeds',
};

type ExtraKey = 'billing' | 'flow' | 'enquiries' | 'availability' | 'leave' | 'schedule' | 'gaps';

/* The facility matrix uses equal tracks from the first field through Status.
   A horizontal scroll is preferable to squeezing six operational fields
   into unreadable slivers on a narrow viewport. */
const FAC_GRID = 'repeat(6, minmax(140px, 1fr))';

/** Facility tier → its own hue, so the column is scannable rather than a
 *  stack of identical blue pills. Tinted `fmfac-tier-*` chips (globals.css)
 *  rather than the kit's chip tones: green/yellow/red carry alarm meaning in
 *  this console, and a facility's tier is not an alarm. */
const TIER_CLASS: Record<string, string> = {
  national_referral: 'fmfac-tier--national',
  state_hospital: 'fmfac-tier--state',
  county_hospital: 'fmfac-tier--county',
  phcc: 'fmfac-tier--phcc',
  phcu: 'fmfac-tier--phcu',
};

export default function FacilityManagementDashboard() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const router = useRouter();
  const scope = useDataScope();

  /* Staff issue reports, for the "Open issues" tile. /inquiries is the
     reported-issues inbox for management roles (PR #196), so the tile that
     links there counts issues, not patient inquiries. */
  const [issueReports, setIssueReports] = useState<MessageDoc[]>([]);
  const [issuesLoaded, setIssuesLoaded] = useState(false);
  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    import('@/modules/communication/services/issue-report-service')
      .then(({ getIssueReports }) => getIssueReports(scope))
      .then(rows => { if (!cancelled) setIssueReports(rows); })
      .catch(() => { /* the tile reads 0 rather than blocking the dashboard */ })
      .finally(() => { if (!cancelled) setIssuesLoaded(true); });
    return () => { cancelled = true; };
  }, [scope]);
  const issueSummary = useMemo(() => summariseIssues(issueReports), [issueReports]);

  const { users, loading: usersLoading, error: usersError } = useUsers();
  const { patients, loading: patientsLoading } = usePatients();
  const { availableBeds, totalBeds: wardBedTotal, occupancyRate: wardOccupancy, loading: wardsLoading } = useWards();
  const { hospitals } = useHospitals();
  // Real counts — HospitalDoc.patientCount/todayVisits are write-once-zero
  // registry fields nothing recomputes (2026-08 hardcoded-data sweep).
  const { census: facilityCensus } = useFacilityCensus();

  const [cash, setCash] = useState<{ currency: string; days: DailyCash[] }>({ currency: defaultCurrency(), days: [] });
  const [facilitySearch, setFacilitySearch] = useState('');
  const [flow, setFlow] = useState<DailyFlow[]>([]);
  const [enquiries, setEnquiries] = useState<MessageDoc[]>([]);
  const [availableProviderIds, setAvailableProviderIds] = useState<Set<string>>(new Set());
  const [leave, setLeave] = useState<LeaveRequestDoc[]>([]);
  const [schedules, setSchedules] = useState<StaffScheduleDoc[]>([]);
  const [staffingGaps, setStaffingGaps] = useState<StaffingGap[]>([]);
  const [extraLoading, setExtraLoading] = useState(true);
  const hasLoadedExtraRef = useRef(false);

  const today = jubaDate();
  const facilityId = currentUser?.hospitalId;
  const weekStart = useMemo(() => jubaWeekStart(), []);
  const weekEnd = useMemo(() => addDaysIso(weekStart, 7), [weekStart]);
  const weekRange = useMemo(() => jubaDateRangeUtc(weekStart, weekEnd), [weekEnd, weekStart]);

  // Billing, patient flow, enquiries, provider availability, leave, and
  // today's schedule/staffing-gaps are all fetched together, each settled
  // independently so a single failure degrades only its own card instead of
  // the whole dashboard.
  useEffect(() => {
    if (!scope) return;
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
      return { currency: bills[0]?.currency || defaultCurrency(), days: Array.from(byDate.values()) };
    };
    /* Arrivals per day, split by disposition. Counted from the records
       themselves rather than any stored total, and reduced to a row per day
       here so the page holds a week of counts instead of every encounter. */
    const loadFlow = async (): Promise<DailyFlow[]> => {
      const { getEncountersInRange } = await import('@/lib/services/encounter-service');
      const encounters = await getEncountersInRange(weekRange, scope);
      const byDate = new Map<string, DailyFlow>();
      const row = (date: string): DailyFlow => {
        let r = byDate.get(date);
        if (!r) { r = { date, inpatient: 0, outpatient: 0 }; byDate.set(date, r); }
        return r;
      };
      for (const e of encounters) {
        const at = e.startedAt || e.createdAt;
        if (!at) continue;
        if (e.status === 'admitted') row(jubaDate(at)).inpatient++;
        else row(jubaDate(at)).outpatient++;
      }
      return Array.from(byDate.values());
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
      loadFlow(),
      getPatientEnquiries(scope),
      loadAvailability(),
      loadLeave(),
      loadSchedules(),
      loadGaps(),
    ]);

    (async () => {
      let results = await runAll();
      if (cancelled) return;

      // One automatic second attempt before any card falls back to its
      // empty state.
      //
      // Each of the seven loaders begins with a dynamic `import()`, so a
      // single chunk that fails to arrive rejects all seven at once. That is
      // one transient network fault, not six broken subsystems, and on the
      // connections this app is built for it is routine. Retrying turns it
      // into a slightly slower load instead of six empty cards.
      if (results.some(r => r.status === 'rejected')) {
        await new Promise(resolve => setTimeout(resolve, 700));
        if (cancelled) return;
        results = await runAll();
        if (cancelled) return;
      }
      const [billingRes, flowRes, enquiriesRes, availRes, leaveRes, schedRes, gapsRes] = results;
      if (billingRes.status === 'fulfilled') setCash(billingRes.value);
      if (flowRes.status === 'fulfilled') setFlow(flowRes.value);
      if (enquiriesRes.status === 'fulfilled') setEnquiries(enquiriesRes.value);
      if (availRes.status === 'fulfilled') setAvailableProviderIds(availRes.value);
      if (leaveRes.status === 'fulfilled') setLeave(leaveRes.value);
      if (schedRes.status === 'fulfilled') setSchedules(schedRes.value);
      if (gapsRes.status === 'fulfilled') setStaffingGaps(gapsRes.value);

      // `allSettled` swallows the reason, and anything shared underneath
      // these seven takes them all down together — six identical symptoms and
      // no cause. Log what actually rejected.
      for (const [key, res] of [
        ['billing', billingRes], ['flow', flowRes], ['enquiries', enquiriesRes],
        ['availability', availRes], ['leave', leaveRes], ['schedule', schedRes],
        ['gaps', gapsRes],
      ] as [ExtraKey, PromiseSettledResult<unknown>][]) {
        if (res.status === 'rejected') console.error(`[facility-dashboard] ${key} failed to load:`, res.reason);
      }
      hasLoadedExtraRef.current = true;
      setExtraLoading(false);
    })();

    return () => { cancelled = true; };
  }, [scope, today, facilityId, weekRange]);

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

  /* Trends where the records carry a date to compare: patients registered
     and inquiries received this week against the week before. Staff, beds
     and the totals carry no history here, so they get no trend rather than
     an invented one. */
  const weekTrend = useCallback((items: Array<{ createdAt?: string }>) => {
    const nowMs = Date.now();
    let thisWeek = 0;
    let lastWeek = 0;
    for (const item of items) {
      const at = item.createdAt ? new Date(item.createdAt).getTime() : NaN;
      if (at >= nowMs - 7 * 86400000) thisWeek++;
      else if (at >= nowMs - 14 * 86400000) lastWeek++;
    }
    return { direction: trendBetween(thisWeek, lastWeek), label: t('facilityMgmt.trendWeek', { thisWeek, lastWeek }) };
  }, [t]);
  /* What each figure is made of, on the tile under the number (every
     management KPI carries one). Derived from the same records as the
     figures; a figure with nothing honest to add keeps none. */
  const tileDetails = useMemo<Record<string, string | undefined>>(() => {
    const num = (v: number | string | undefined) => (typeof v === 'number' ? v : Number.NaN);
    const staff = num(overview.metrics.find(m => m.key === 'staff-total')?.value);
    const share = (key: string) => {
      const n = num(overview.metrics.find(m => m.key === key)?.value);
      return Number.isFinite(n) && staff > 0 ? t('facilityMgmt.shareOfStaff', { percent: Math.round((n / staff) * 100) }) : undefined;
    };
    return {
      'staff-total': t('facilityMgmt.availableNow', { count: overview.activeStaff.count }),
      doctors: share('doctors'),
      nurses: share('nurses'),
      patients: t(hospitals.length === 1 ? 'facilityMgmt.acrossFacilitiesOne' : 'facilityMgmt.acrossFacilities', { count: hospitals.length }),
      beds: wardBedTotal > 0 ? t('facilityMgmt.bedsDetail', { total: wardBedTotal, occupied: wardOccupancy }) : undefined,
      issues: t('facilityMgmt.issuesTotal', { count: issueSummary.total }),
    };
  }, [overview, hospitals.length, wardBedTotal, wardOccupancy, issueSummary.total, t]);

  // No trend until its data is in: an empty list read as "0 this week vs 0
  // last", which looks like a real, flat week.
  const tileTrends = useMemo<Record<string, SadbTrendValue | undefined>>(() => ({
    patients: patientsLoading ? undefined : weekTrend(patients),
    // More issues arriving is more work waiting: up is not good news here.
    issues: issuesLoaded ? { ...weekTrend(issueReports), good: 'down' } : undefined,
  }), [weekTrend, patients, patientsLoading, issueReports, issuesLoaded]);

  /* This week, Monday-first, on the CLINICAL calendar: both cards below read
     the same seven days, and a visit at 23:00 in Juba belongs to that day
     wherever the browser happens to be. Days are matched as date strings —
     `new Date('2026-08-12')` is UTC midnight, which lands on the previous day
     for anyone west of Greenwich. */
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart, i));
  }, [weekStart]);

  /* Arrivals per day, admitted vs other outpatient encounters. Inpatient is the first
     series so it draws on the baseline: it is the smaller figure and the one
     a manager tracks day to day, and a stacked segment is only comparable
     across days when it sits on the axis. */
  const weeklyFlow = useMemo(
    () => weekDays.map((iso, i) => {
      const day = flow.find(f => f.date === iso);
      return { day: WEEKDAYS[i], inpatient: day?.inpatient || 0, outpatient: day?.outpatient || 0 };
    }),
    [weekDays, flow],
  );

  const flowSeries = useMemo(() => [
    { key: 'inpatient', name: t('encounters.inpatient'), color: FLOW_INPATIENT },
    { key: 'outpatient', name: t('encounters.outpatient'), color: FLOW_OUTPATIENT },
  ], [t]);

  /* The week's money as one total and its two parts — what the ring and its
     two figures are drawn from. Seven columns of two stacked bars said less
     about a week's billing than "how much, and how much of it landed", and
     cost the row's widest card to say it. */
  const cashWeek = useMemo(() => {
    let received = 0;
    let pending = 0;
    for (const day of cash.days) {
      if (!weekDays.includes(day.date)) continue;
      received += day.received;
      pending += day.pending;
    }
    return { received, pending, total: received + pending };
  }, [cash.days, weekDays]);

  /* A ring of nothing is a grey ring, not two zero-width slices — the donut
     draws its own empty state when every slice is filtered out. */
  const cashSlices = useMemo(() => [
    { name: t('billing.ovReceived'), value: cashWeek.received, color: CASH_RECEIVED },
    { name: t('billing.ovPending'), value: cashWeek.pending, color: CASH_PENDING },
  ].filter(slice => slice.value > 0), [cashWeek, t]);

  const initialLoading = usersLoading || patientsLoading || wardsLoading || extraLoading;

  const metricByKey = (key: string) => overview.metrics.find(m => m.key === key);

  /* KPI tiles carry the census/staffing totals; the three day-scoped figures
     (shifts, unfilled, pending leave) read in the Today's Operations card so
     the tile row is one line, not two. */
  const TILE_KEYS = ['staff-total', 'doctors', 'nurses', 'patients', 'beds'];
  const issuesTile = { key: 'issues', label: t('facilityMgmt.openIssues'), href: '/inquiries' };

  const unfilledShifts = metricByKey('shifts-unfilled')?.value ?? 0;
  // The unfiltered count — this page no longer carries the queue's search box.
  const pendingLeaveCount = metricByKey('leave-pending')?.value ?? 0;

  // Written-out facility tier ("National Referral", "Phcc" stays "PHCC").
  const facilityLabel = useCallback((ft: string) => {
    const keys: Record<string, string> = {
      national_referral: 'hospitals.typeNationalReferral', state_hospital: 'hospitals.typeStateHospital',
      county_hospital: 'hospitals.typeCountyHospital', phcc: 'hospitals.typePhcc', phcu: 'hospitals.typePhcu',
    };
    return keys[ft] ? t(keys[ft]) : titleCase(ft.replace(/_/g, ' '));
  }, [t]);

  const facilityStatus = useCallback((hospital: HospitalDoc) => hospital.isActive === false
    ? t('facilityMgmt.retired')
    : (() => {
        const st = hospital.operationalStatus ?? 'functional';
        const keys: Record<string, string> = {
          functional: 'myFacility.statusFunctional', partially_functional: 'myFacility.statusPartiallyFunctional',
          non_functional: 'myFacility.statusNonFunctional', closed: 'myFacility.statusClosed',
        };
        return keys[st] ? t(keys[st]) : titleCase(st.replace(/_/g, ' '));
      })(), [t]);

  const visibleFacilities = useMemo(() => {
    const terms = facilitySearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return hospitals;
    return hospitals.filter(hospital => {
      const haystack = [
        hospital.name,
        facilityLabel(hospital.facilityType),
        hospital.town,
        hospital.county,
        hospital.state,
        hospital.totalBeds,
        facilityStatus(hospital),
      ].filter(value => value !== undefined && value !== null).join(' ').toLowerCase();
      return terms.every(term => haystack.includes(term));
    });
  }, [facilityLabel, facilitySearch, facilityStatus, hospitals]);

  if (!currentUser) return null;

  if (initialLoading) {
    return (
      <SadbPage roles={['org_admin', 'hospital_manager', 'super_admin']}>
        <p className="sadb-empty" aria-live="polite">
          <Loader2 className="w-4 h-4 inline-block me-2 animate-spin" style={{ verticalAlign: -3 }} />
          {t('ui.loadingFacilityData')}
        </p>
      </SadbPage>
    );
  }

  return (
    <SadbPage
      roles={['org_admin', 'hospital_manager', 'super_admin']}
      /* No greeting row (removed 2026-11-04 at the user's request): the page
         opens on its figures, and the create actions sit beside the search of
         the Facilities list they add to. */
    >

      {/* ═══ KPI tiles — census & staffing totals, each opening its full page ═══ */}
      <div className="sadb-kpi-row">
        {TILE_KEYS.map(key => {
          const m = metricByKey(key);
          if (!m) return null;
          return (
            <SadbKpiTile
              key={m.key}
              label={t(METRIC_LABEL_KEY[m.key] ?? m.key)}
              value={m.value}
              delta={tileDetails[m.key]}
              deltaTone={m.tone === 'warning' || m.tone === 'danger' ? 'warn' : undefined}
              trend={tileTrends[m.key]}
              // Straight to the page that owns the figure: no preview stop.
              onClick={() => router.push(m.href)}
            />
          );
        })}
        <SadbKpiTile
          key={issuesTile.key}
          label={issuesTile.label}
          value={issueSummary.open}
          delta={tileDetails.issues}
          deltaTone={issueSummary.open > 0 ? 'warn' : undefined}
          trend={tileTrends.issues}
          onClick={() => router.push(issuesTile.href)}
        />
      </div>

      {/* ═══ Operational row: patient flow · cash · today ═══
           No `items-start`: the three cards are one row of the dashboard and
           read together, so they end on the same line. The chart sets the
           height — it has a fixed one — and the ring and the operations list
           spread to fill rather than stopping halfway down beside it. */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr_1fr] gap-3.5">
        {/* The week's arrivals: how many came, and how many stayed. Admissions
            and outpatient encounters are the two ends of the same day's work,
            and nothing on this page said either until now. */}
        <SadbCard title={t('ui.patientFlow')} tabletTitle={t('facilityMgmt.tabletPatients')} meta={t('facilityMgmt.thisWeek')}>
          <div className="px-3 pt-3 pb-1">
            <WeeklyActivityChart data={weeklyFlow} chartType="bar" series={flowSeries} />
          </div>
        </SadbCard>

        {/* Cash as a ring with its total in the middle and the two amounts
            beside it — the super-admin console's readiness anatomy, on its
            layout classes. `fmcash-*` only sizes it: on /admin that body IS
            the card, here it shares a row with a 208px chart, so it has
            height to spend and centres itself in it rather than sitting in
            the card's top corner. */}
        <SadbCard title={t('ui.cashFlow')} tabletTitle={t('facilityMgmt.tabletCash')} meta={t('facilityMgmt.currencyThisWeek', { currency: cash.currency })}>
          <div className="sadb-readiness-body fmcash-body">
            <div className="fmcash-ring">
              <CashFlowDonut data={cashSlices} />
              <div className="fmcash-center">
                <b>{formatMoney(cashWeek.total, { currency: cash.currency })}</b>
                <span>{t('claims.colBilled')}</span>
              </div>
            </div>
            <div className="sadb-readiness-signals fmcash-signals">
              <div className="sadb-signal sadb-signal--green">
                <b>{formatMoney(cashWeek.received, { currency: cash.currency })}</b>
                <span>{t('facilityQueue.detailReceived')}</span>
              </div>
              <div className="sadb-signal sadb-signal--yellow">
                <b>{formatMoney(cashWeek.pending, { currency: cash.currency })}</b>
                <span>{t('postConsult.status.pending')}</span>
              </div>
            </div>
          </div>
        </SadbCard>

        <SadbCard
          title={t('ui.todaySOperations')}
          tabletTitle={t('facilityMgmt.tabletOperations')}
          action={<SadbHeadLink onClick={() => router.push(`/hr/schedule?date=${today}`)}>{t('boma.schedule')}</SadbHeadLink>}
        >
          <div className="sadb-kv-fill">
            <SadbKvRow label={t('ui.todaySShifts')} value={String(metricByKey('shifts-today')?.value ?? 0)} />
            <SadbKvRow
              label={t('ui.unfilledShifts')}
              chip={String(unfilledShifts)}
              chipTone={typeof unfilledShifts === 'number' && unfilledShifts > 0 ? 'red' : 'green'}
            />
            <SadbKvRow
              label={t('facilityQueue.kpiPending')}
              chip={String(pendingLeaveCount)}
              chipTone={typeof pendingLeaveCount === 'number' && pendingLeaveCount > 0 ? 'yellow' : 'neutral'}
            />
            <SadbKvRow label={t('facilityQueue.kpiAvailable')} value={String(overview.activeStaff.count)} valueTone={overview.activeStaff.unavailable ? 'warn' : undefined} />
          </div>
        </SadbCard>
      </div>

      {/* ═══ The org's registered facilities ═══
           The work queue used to sit beside this list; it moved out on
           2026-08-24 (and was deleted 2026-11-04), so the matrix takes the
           whole row rather than keeping half of it warm for a card that is no
           longer here. It stays inside `sadb-lower-row` for that row's height
           cap: the list grows with the data, and uncapped it runs the page
           into a scroll no dashboard should have.
           The card is NOT gated on there being facilities: an org with none
           registered yet still sees the list's frame (search + column head)
           with the empty message under it, so the screen keeps its shape and
           "Add facility" has somewhere visible to land — see the
           list-header-always-visible rule. */}
      <div className="sadb-lower-row">
        <SadbCard
          className="is-wide"
          title={t('government.colFacilities')}
          meta={`${hospitals.length}`}
        >
          <div className="sadb-search-row sadb-search-row--table-aligned">
            <SadbSearch
              value={facilitySearch}
              onChange={setFacilitySearch}
              placeholder={t('ui.searchFacilityTypeLocationOr')}
              ariaLabel={t('facilityMgmt.searchFacilities')}
            />
            {/* The create actions beside the search of the list they add to
                (the dashboard's greeting row that carried them is gone). */}
            <DashboardCreateActions variant="ghost" />
          </div>
          <div className="sadb-card-scroll">
            <SadbGridList
              template={FAC_GRID}
              minWidth={840}
              head={[t('hospitals.colFacility'), t('hospitals.colType'), t('hospitals.colLocation'), t('dashboard.beds'), t('government.colPatients'), t('hospitals.colStatus')]}
              alignEndLast
              empty={facilitySearch
                ? t('facilityMgmt.noMatch')
                : t('facilityMgmt.noneYet')}
            >
              {visibleFacilities.map((h: HospitalDoc) => (
                <SadbGridRow key={h._id} template={FAC_GRID} onClick={() => router.push(`/admin/facilities/${h._id}`)}>
                  <span className="min-w-0">
                    <span className="sadb-tenant-name truncate">{h.name}</span>
                  </span>
                  <span>
                    <span className={`fmfac-tier ${TIER_CLASS[h.facilityType] ?? ''}`.trim()}>
                      {facilityLabel(h.facilityType)}
                    </span>
                  </span>
                  <span className="truncate">{[h.town, h.county, h.state].filter(Boolean).join(', ') || '—'}</span>
                  <span className="sadb-tenant-num">{h.totalBeds ?? 0}</span>
                  <span className="sadb-tenant-num">{facilityCensus ? censusFor(facilityCensus, h._id).patients : '…'}</span>
                  <span style={{ textAlign: 'end' }}>
                    <SadbChip tone={h.isActive === false || ['non_functional', 'closed'].includes(h.operationalStatus ?? '')
                      ? 'red'
                      : h.operationalStatus === 'partially_functional' ? 'yellow' : 'green'}>
                      {facilityStatus(h)}
                    </SadbChip>
                  </span>
                </SadbGridRow>
              ))}
            </SadbGridList>
          </div>
        </SadbCard>
      </div>


    </SadbPage>
  );
}
