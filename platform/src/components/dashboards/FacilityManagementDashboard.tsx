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
 *  • the three queue tabs (Inquiries / Pending Leave / Active Staff) with
 *    quick triage — a row opens a detail dialog carrying the inquiry status
 *    ladder and the approve/reject pair, mirroring /inquiries and /hr/leave;
 *  • the clickable Facility Overview metrics — now KPI tiles (staffing and
 *    census) plus a Today's Operations card (the day-scoped figures), both
 *    keeping the ?preview= deep-linked FacilityMetricPreviewDialog;
 *  • the Weekly Cash Flow chart (same deferred recharts import);
 *  • the Add menu and the staff-accounts shortcut, in the page-actions row.
 * Dropped deliberately: the mini-calendar and day filtering — both were
 * already inert here (`filterRowsByDate={false}`; neither queue is a single
 * day's schedule).
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
  AlertTriangle, RefreshCw, Loader2, X, } from '@/components/icons/lucide';
import { useAuth } from '@/lib/context';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useUsers } from '@/lib/hooks/useUsers';
import { usePatients } from '@/lib/hooks/usePatients';
import { useWards } from '@/lib/hooks/useWards';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { useToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import {
  SadbPage, SadbCard, SadbTabs, SadbSearch, SadbKpiTile, SadbKvRow,
  SadbChip, SadbQueueRow, SadbGridList, SadbGridRow, SadbHeadLink, type ChipTone,
} from '@/components/admin/sadb-ui';
import { toIsoDate } from '@/lib/date-utils';
import { formatMoney, titleCase } from '@/lib/format-utils';
import { jubaDate, jubaTime } from '@/lib/time-juba';
import { usersHrefForRole } from '@/lib/people-nav';
import { ROLE_LABEL } from '@/lib/role-display';
import {
  ENQUIRY_STATUS_LABELS, ENQUIRY_STATUSES, deriveEnquiryStatus, enquiryType, enquiryAssignee,
  summariseEnquiries, getPatientEnquiries, type EnquiryStatus,
} from '@/lib/services/enquiry-service';
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

function formatClockTimeOrUndefined(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

/** Inquiry ladder → the kit's chip tones. */
function enquiryChipTone(status: EnquiryStatus): ChipTone {
  switch (status) {
    case 'new': return 'yellow';
    case 'contacted': return 'blue';
    case 'appointment_scheduled': return 'green';
    case 'closed': return 'neutral';
    default: return 'neutral';
  }
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

function withFocus(href: string, key: string, value: string): string {
  const [path, query = ''] = href.split('?');
  const params = new URLSearchParams(query);
  params.set(key, value);
  return `${path}?${params.toString()}`;
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
          <button type="button" className="p-2 rounded-lg flex-shrink-0" onClick={onClose} aria-label="Close preview">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="py-5">
          <p className="sadb-kpi-value" style={{ fontSize: 30 }}>{metric.value}</p>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            This is the current scope-visible total. Open the full page to review and manage the underlying records.
          </p>
        </div>
        <div className="sadb-modal-actions" style={{ borderTop: '1px solid var(--border-light)', paddingTop: 14 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onOpen}>Open full page</button>
        </div>
      </div>
    </Modal>
  );
}

export interface FacilityInquiryRow {
  id: string;
  name: string;
  type: string;
  channel: string;
  date: string;
  time?: string;
  status: EnquiryStatus;
  statusLabel: string;
  assignee: string | null;
}

/** A row on the Active Staff queue tab — enabled accounts marked available
 *  today, shaped like the other two tabs' rows. */
export interface FacilityStaffRow {
  id: string;
  name: string;
  role: string;
  department: string;
  /** e.g. "Morning · 08:00–16:00", or null when today carries no schedule row. */
  shift: string | null;
}

export interface FacilityLeaveRow {
  id: string;
  requesterName: string;
  leaveType: string;
  days: number;
  startDate: string;
  endDate: string;
  role: string;
  facility: string;
  reason?: string;
  requestedAt: string;
  status: LeaveRequestDoc['status'];
}

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
  // One staff-state figure, not two: "active" (an enabled account) barely moved
  // off Total Staff, so the useful number is the intersection — enabled *and*
  // marked available today. It reads beside the queue heading rather than in the
  // Facility Overview rail, so the count a manager acts on sits with the work.
  const activeStaff = users.filter(u => u.isActive !== false && availableProviderIds.has(u._id));
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

  // Recent Inquiries: the idle view is a top-5 digest of the newest (callers
  // pass enquiries already newest-first); a search widens the window to 20
  // matches — same idle-digest/search-widens trade-off the old per-user table
  // on this dashboard used.
  const q = search.trim().toLowerCase();
  const matchesQuery = (m: MessageDoc) => {
    if (!q) return true;
    const haystack = `${m.patientName || ''} ${enquiryType(m)} ${enquiryAssignee(m) || ''}`.toLowerCase();
    return haystack.includes(q);
  };
  const filteredEnquiries = enquiries.filter(matchesQuery);
  const inquiryRows: FacilityInquiryRow[] = filteredEnquiries.slice(0, q ? 20 : 5).map(m => {
    const status = deriveEnquiryStatus(m);
    const at = m.sentAt || m.createdAt || '';
    return {
      id: m._id,
      name: m.patientName || 'Patient',
      type: enquiryType(m),
      channel: (m.channel || 'app').toUpperCase(),
      date: at.slice(0, 10),
      time: formatClockTimeOrUndefined(at),
      status,
      statusLabel: ENQUIRY_STATUS_LABELS[status],
      assignee: enquiryAssignee(m),
    };
  });

  // Pending Leave tab: same idle-digest-free, search-widens shape as HR's own
  // landing dashboard (`dashboard/hr/page.tsx`'s `filteredPending`) — no cap,
  // since a facility's pending-decision queue runs short by nature.
  const matchesLeaveQuery = (r: LeaveRequestDoc) => {
    if (!q) return true;
    const haystack = `${r.userName || ''} ${r.role || ''} ${r.leaveType || ''} ${r.facilityName || ''}`.toLowerCase();
    return haystack.includes(q);
  };
  const pendingLeaveRows: FacilityLeaveRow[] = pendingLeave.filter(matchesLeaveQuery).map(r => ({
    id: r._id,
    requesterName: r.userName,
    leaveType: r.leaveType,
    days: r.days,
    startDate: r.startDate,
    endDate: r.endDate,
    role: r.role,
    facility: r.facilityName,
    reason: r.reason,
    requestedAt: r.requestedAt,
    status: r.status,
  }));

  // Active Staff rows — the same `search` text as the other two tabs, matched
  // against the fields the row actually shows.
  const activeStaffRows: FacilityStaffRow[] = activeStaff
    .map(u => {
      const shift = schedules.find(s => s.userId === u._id);
      return {
        id: u._id,
        name: u.name,
        role: ROLE_LABEL[u.role] || u.role.replace(/_/g, ' '),
        department: u.department || u.hospitalName || 'General',
        shift: shift ? `${titleCase(shift.shiftType)} · ${shift.startTime}–${shift.endTime}` : null,
      };
    })
    .filter(r => !q || `${r.name} ${r.role} ${r.department}`.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    metrics,
    inquiryRows,
    inquiryMatchCount: filteredEnquiries.length,
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

type QueueTab = 'inquiries' | 'leave' | 'staff';

/** The inquiry ladder, as the detail dialog's picker renders it. */
const ENQUIRY_STATUS_OPTIONS = ENQUIRY_STATUSES.map(value => ({ value, label: ENQUIRY_STATUS_LABELS[value] }));

const CENTER_TITLES: Record<QueueTab, string> = {
  inquiries: 'Recent Inquiries',
  leave: 'Pending Leave',
  staff: 'Active Staff',
};

const SEARCH_PLACEHOLDERS: Record<QueueTab, string> = {
  inquiries: 'Search inquiries by name, type, or assignee…',
  leave: 'Search leave requests by name, role, or type…',
  staff: 'Search staff by name, role, or department…',
};

// Same approver role list as the full HR page's leave tab (src/app/(dashboard)/hr/page.tsx)
// and its own landing dashboard (dashboard/hr/page.tsx) — who can decide a
// pending leave request from this dashboard's queue.
const LEAVE_APPROVER_ROLES = new Set(['org_admin', 'medical_superintendent', 'hospital_manager', 'super_admin']);

/* Facility matrix columns: Facility · Type · Beds · Patients · Today's visits */
const FAC_GRID = 'minmax(200px, 1.7fr) minmax(130px, 1fr) minmax(70px, 0.6fr) minmax(90px, 0.7fr) minmax(90px, 0.7fr)';

/** Which queue row is open in the detail dialog. */
type QueueDetail =
  | { kind: 'inquiry'; id: string }
  | { kind: 'leave'; id: string }
  | { kind: 'staff'; id: string };

export default function FacilityManagementDashboard() {
  const { currentUser } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const previewOpenedHere = useRef(false);
  const scope = useDataScope();
  const { showToast } = useToast();

  const { users, loading: usersLoading, error: usersError, reload: reloadUsers } = useUsers();
  const { patients, loading: patientsLoading } = usePatients();
  const { availableBeds, loading: wardsLoading } = useWards();
  const { hospitals } = useHospitals();

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
  // Shared by both queue tabs — each tab filters its own dataset by the same
  // text so switching tabs never leaves a stale, unrelated filter in place.
  const [queueSearch, setQueueSearch] = useState('');
  const [activeTab, setActiveTab] = useState<QueueTab>('inquiries');
  // The queue detail dialog — where a row's quick actions live now that a
  // sadb queue row is a single button (no inline expansion).
  const [detail, setDetail] = useState<QueueDetail | null>(null);

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
    search: queueSearch,
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
  }), [today, queueSearch, users, usersUnavailable, patients, enquiries, leave, schedules, staffingGaps, availableProviderIds, staffListHref, availableBeds]);

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

  // The global "Add" menu — permission-gated entries from people-nav. The three
  const updateEnquiryStatusLocally = (id: string, status: EnquiryStatus) => {
    setEnquiries(prev => prev.map(m => (m._id === id ? { ...m, enquiryStatus: status } : m)));
  };

  // Quick triage from the dashboard's own queue — the detail dialog's status
  // picker puts any rung of the ladder one pick away; full triage
  // (reassignment, notes) stays on /inquiries, which owns that surface.
  const setEnquiryStatusAction = async (id: string, status: EnquiryStatus) => {
    try {
      const { setEnquiryStatus } = await import('@/lib/services/enquiry-service');
      await setEnquiryStatus(id, status);
      updateEnquiryStatusLocally(id, status);
      showToast(`Inquiry marked ${ENQUIRY_STATUS_LABELS[status].toLowerCase()}.`, 'success');
    } catch (err) {
      console.error('Failed to update inquiry status', err);
      showToast('Could not update the inquiry.', 'error');
    }
  };

  const isLeaveApprover = !!currentUser && LEAVE_APPROVER_ROLES.has(currentUser.role);

  // Approve/reject a pending leave request from the dashboard's own queue —
  // mirrors dashboard/hr/page.tsx's `decideLeaveAction`. `decideLeave` catches
  // its own "cannot approve your own leave" invariant internally and resolves
  // to `null` rather than rejecting, so both that case and a hard failure
  // (import/network) are surfaced as a toast, never an unhandled rejection.
  const decideLeaveLocally = (id: string, updated: LeaveRequestDoc) => {
    setLeave(prev => prev.map(l => (l._id === id ? updated : l)));
  };
  const decideLeaveAction = async (id: string, status: 'approved' | 'rejected') => {
    if (!currentUser) return;
    try {
      const { decideLeave } = await import('@/lib/services/leave-service');
      const updated = await decideLeave(id, {
        status,
        decidedBy: currentUser._id,
        decidedByName: currentUser.name,
      });
      if (!updated) {
        showToast("You can't decide your own leave request.", 'error');
        return;
      }
      decideLeaveLocally(id, updated);
      setDetail(null);
      showToast(status === 'approved' ? 'Leave request approved.' : 'Leave request rejected.', 'success');
    } catch (err) {
      console.error('Failed to decide leave request', err);
      showToast('Could not update the leave request.', 'error');
    }
  };

  const failedLabels = Array.from(loadErrors).map(k => EXTRA_LABELS[k]);
  if (usersError) failedLabels.push('staff accounts');
  const hasErrors = failedLabels.length > 0;

  const inquiriesFailed = loadErrors.has('enquiries');
  const leaveFailed = loadErrors.has('leave');
  const hasQuery = queueSearch.trim().length > 0;

  // Empty state, its action, and the search placeholder all follow the active
  // tab — each queue tab reads its own data source and its own failure mode.
  const staffFailed = overview.activeStaff.unavailable || loadErrors.has('availability');
  const emptyTitle = activeTab === 'staff'
    ? (staffFailed ? "Couldn't load staff" : hasQuery ? 'No staff match your search' : 'No staff available right now')
    : activeTab === 'inquiries'
      ? (inquiriesFailed ? "Couldn't load inquiries" : hasQuery ? 'No inquiries match your search' : 'No recent inquiries')
      : (leaveFailed ? "Couldn't load leave requests" : hasQuery ? 'No leave requests match your search' : 'No leave requests waiting on a decision');
  const emptyActionLabel = activeTab === 'staff'
    ? (staffFailed ? 'Retry' : 'View roster')
    : (activeTab === 'inquiries' ? inquiriesFailed : leaveFailed) ? 'Retry' : 'View all';
  const onEmptyAction = activeTab === 'staff'
    ? (staffFailed ? retryAll : () => router.push(overview.activeStaff.href))
    : activeTab === 'inquiries'
      ? (inquiriesFailed ? retryExtra : () => router.push('/inquiries'))
      : (leaveFailed ? retryExtra : () => router.push('/hr/leave'));

  const initialLoading = usersLoading || patientsLoading || wardsLoading || extraLoading;

  const metricByKey = (key: string) => overview.metrics.find(m => m.key === key);

  /* KPI tiles carry the census/staffing totals; the three day-scoped figures
     (shifts, unfilled, pending leave) read in the Today's Operations card so
     the tile row is one line, not two. */
  const TILE_KEYS = ['staff-total', 'doctors', 'nurses', 'patients', 'beds', 'inquiries-open'];

  const detailInquiry = detail?.kind === 'inquiry' ? overview.inquiryRows.find(r => r.id === detail.id) ?? null : null;
  const detailLeave = detail?.kind === 'leave' ? overview.pendingLeaveRows.find(r => r.id === detail.id) ?? null : null;
  const detailStaff = detail?.kind === 'staff' ? overview.activeStaff.rows.find(r => r.id === detail.id) ?? null : null;

  const unfilledShifts = metricByKey('shifts-unfilled')?.value ?? 0;
  const pendingLeaveCount = overview.pendingLeaveRows.length;

  const queueEmpty = activeTab === 'inquiries'
    ? overview.inquiryRows.length === 0
    : activeTab === 'leave'
      ? overview.pendingLeaveRows.length === 0
      : overview.activeStaff.rows.length === 0;

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
              chipTone={pendingLeaveCount > 0 ? 'yellow' : 'neutral'}
            />
            <SadbKvRow label="Staff available now" value={String(overview.activeStaff.count)} valueTone={overview.activeStaff.unavailable ? 'warn' : undefined} />
          </div>
        </SadbCard>
      </div>

      {/* ═══ Lower row: the work queue beside the facility matrix ═══
           Both lists grow with the data; stacked full-width they ran the
           page into a long scroll. Capped and side by side, each scrolls
           inside its own card and the dashboard ends with the viewport. */}
      <div className="sadb-lower-row">
        {/* ═══ Work queue — inquiries · pending leave · active staff ═══ */}
        <SadbCard
          className={hospitals.length > 0 ? undefined : 'is-wide'}
          title={CENTER_TITLES[activeTab]}
          meta={activeTab === 'inquiries'
            ? `${overview.inquiryRows.length} of ${overview.inquiryMatchCount}`
            : activeTab === 'leave'
              ? `${overview.pendingLeaveRows.length} pending`
              : `${overview.activeStaff.rows.length} available`}
          action={
            <SadbTabs
              tabs={[
                { key: 'inquiries', label: 'Inquiries', count: overview.inquiryRows.length },
                { key: 'leave', label: 'Pending Leave', count: overview.pendingLeaveRows.length },
                { key: 'staff', label: 'Active Staff', count: overview.activeStaff.rows.length },
              ]}
              active={activeTab}
              onChange={tab => setActiveTab(tab as QueueTab)}
              ariaLabel="Work queue views"
            />
          }
        >
          <div className="sadb-search-row" style={{ paddingBottom: 12 }}>
            <SadbSearch value={queueSearch} onChange={setQueueSearch} placeholder={SEARCH_PLACEHOLDERS[activeTab]} />
          </div>

          <div className="sadb-card-scroll">
            {queueEmpty ? (
              <div className="sadb-empty" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className="flex-1">{emptyTitle}</span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={onEmptyAction}>{emptyActionLabel}</button>
              </div>
            ) : activeTab === 'inquiries' ? (
              overview.inquiryRows.map(r => (
                <SadbQueueRow
                  key={r.id}
                  chip={r.statusLabel}
                  chipTone={enquiryChipTone(r.status)}
                  title={r.name}
                  sub={`${r.type} · ${r.channel} · ${r.assignee || 'Unassigned'}`}
                  when={r.time ? `${r.date} ${r.time}` : r.date}
                  onClick={() => setDetail({ kind: 'inquiry', id: r.id })}
                />
              ))
            ) : activeTab === 'leave' ? (
              overview.pendingLeaveRows.map(r => (
                <SadbQueueRow
                  key={r.id}
                  chip={titleCase(r.leaveType)}
                  chipTone="yellow"
                  title={r.requesterName}
                  sub={`${r.days} day${r.days === 1 ? '' : 's'} · ${r.startDate} → ${r.endDate} · ${r.facility}`}
                  when={r.requestedAt.slice(0, 10)}
                  onClick={() => setDetail({ kind: 'leave', id: r.id })}
                />
              ))
            ) : (
              overview.activeStaff.rows.map(r => (
                <SadbQueueRow
                  key={r.id}
                  chip={r.shift ? 'On shift' : 'Available'}
                  chipTone={r.shift ? 'green' : 'blue'}
                  title={r.name}
                  sub={`${r.role} · ${r.department}`}
                  when={r.shift || undefined}
                  onClick={() => setDetail({ kind: 'staff', id: r.id })}
                />
              ))
            )}
          </div>
        </SadbCard>

        {/* ═══ Facility matrix — the org's registered facilities ═══ */}
        {hospitals.length > 0 && (
          <SadbCard
            title="Facilities"
            meta={`${hospitals.length}`}
            action={<SadbHeadLink onClick={() => router.push('/hospitals')}>Directory</SadbHeadLink>}
          >
            <div className="sadb-card-scroll">
              <SadbGridList
                template={FAC_GRID}
                minWidth={640}
                head={['Facility', 'Type', 'Beds', 'Patients', "Today's visits"]}
              >
                {hospitals.map((h: HospitalDoc) => (
                  <SadbGridRow key={h._id} template={FAC_GRID} onClick={() => router.push(`/hospitals/${h._id}/manage`)}>
                    <span className="min-w-0">
                      <span className="sadb-tenant-name truncate">{h.name}</span>
                    </span>
                    <span>
                      <SadbChip tone={h.facilityType === 'phcc' || h.facilityType === 'phcu' ? 'neutral' : 'blue'}>
                        {facilityLabel(h.facilityType)}
                      </SadbChip>
                    </span>
                    <span className="sadb-tenant-num">{h.totalBeds || 0}</span>
                    <span className="sadb-tenant-num">{h.patientCount || 0}</span>
                    <span className="sadb-tenant-num">{h.todayVisits || 0}</span>
                  </SadbGridRow>
                ))}
              </SadbGridList>
            </div>
          </SadbCard>
        )}
      </div>

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

      {/* ═══ Queue detail dialog — the row's quick actions ═══ */}
      {detailInquiry && (
        <Modal onClose={() => setDetail(null)} width={440} labelledBy="fm-inquiry-title">
          <div className="sadb-modal">
            <div className="sadb-modal-copy">
              <h2 id="fm-inquiry-title" className="sadb-modal-title">{detailInquiry.name}</h2>
              <p className="sadb-modal-sub">{detailInquiry.type} · {detailInquiry.channel}</p>
            </div>
            <div className="rounded-lg overflow-hidden mb-3" style={{ border: '1px solid var(--border-light)' }}>
              <SadbKvRow label="Status" chip={detailInquiry.statusLabel} chipTone={enquiryChipTone(detailInquiry.status)} />
              <SadbKvRow label="Assigned to" value={detailInquiry.assignee || 'Unassigned'} />
              <SadbKvRow label="Received" value={detailInquiry.time ? `${detailInquiry.date} ${detailInquiry.time}` : detailInquiry.date} />
            </div>
            {/* The picker is the control: every rung of the inquiry ladder is
                one pick away, mirroring the ladder /inquiries owns. */}
            <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-muted)' }}>Set status</label>
            <Select
              value={detailInquiry.status}
              onChange={e => setEnquiryStatusAction(detailInquiry.id, e.target.value as EnquiryStatus)}
              style={{ width: '100%' }}
            >
              {ENQUIRY_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <div className="sadb-modal-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDetail(null)}>Close</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => router.push(`/inquiries?inquiry=${encodeURIComponent(detailInquiry.id)}`)}>
                Open full page
              </button>
            </div>
          </div>
        </Modal>
      )}

      {detailLeave && (
        <Modal onClose={() => setDetail(null)} width={440} labelledBy="fm-leave-title">
          <div className="sadb-modal">
            <div className="sadb-modal-copy">
              <h2 id="fm-leave-title" className="sadb-modal-title">{detailLeave.requesterName}</h2>
              <p className="sadb-modal-sub">{titleCase(detailLeave.leaveType)} · {detailLeave.days} day{detailLeave.days === 1 ? '' : 's'}</p>
            </div>
            <div className="rounded-lg overflow-hidden mb-3" style={{ border: '1px solid var(--border-light)' }}>
              <SadbKvRow label="Dates" value={`${detailLeave.startDate} → ${detailLeave.endDate}`} />
              <SadbKvRow label="Role" value={detailLeave.role ? titleCase(detailLeave.role) : '—'} />
              <SadbKvRow label="Facility" value={detailLeave.facility} />
              <SadbKvRow label="Reason" value={detailLeave.reason || 'No reason given'} />
            </div>
            <div className="sadb-modal-actions" style={isLeaveApprover && detailLeave.status === 'pending' ? { justifyContent: 'space-between' } : undefined}>
              {isLeaveApprover && detailLeave.status === 'pending' && (
                <span className="flex gap-2">
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => decideLeaveAction(detailLeave.id, 'approved')}>
                    Approve
                  </button>
                  <button type="button" className="sadb-action-btn is-danger" onClick={() => decideLeaveAction(detailLeave.id, 'rejected')}>
                    Reject
                  </button>
                </span>
              )}
              <span className="flex gap-2">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDetail(null)}>Close</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => router.push(`/hr/leave?request=${encodeURIComponent(detailLeave.id)}`)}>
                  Open full page
                </button>
              </span>
            </div>
          </div>
        </Modal>
      )}

      {detailStaff && (
        <Modal onClose={() => setDetail(null)} width={420} labelledBy="fm-staff-title">
          <div className="sadb-modal">
            <div className="sadb-modal-copy">
              <h2 id="fm-staff-title" className="sadb-modal-title">{detailStaff.name}</h2>
              <p className="sadb-modal-sub">{detailStaff.role} · {detailStaff.department}</p>
            </div>
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-light)' }}>
              <SadbKvRow label="Availability" value={detailStaff.shift || 'Available without a scheduled shift'} />
            </div>
            <div className="sadb-modal-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDetail(null)}>Close</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => router.push(withFocus(staffListHref, 'user', detailStaff.id))}>
                Open full page
              </button>
            </div>
          </div>
        </Modal>
      )}

    </SadbPage>
  );
}
