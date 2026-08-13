'use client';

/**
 * Facility Management — operational overview for hospital managers / org
 * admins, rebuilt on the shared `EhrCareDashboard` shell so it matches the
 * HR dashboard's layout (mini-calendar + search + day-activity chart on the
 * left, a work queue in the center, KPI metrics + quick links on the right).
 *
 * The old version was dominated by a "Users & Inquiries" management table
 * (with its own reset-password/activate/deactivate/delete modal) that left a
 * large blank panel whenever a facility had few users. That management now
 * lives on the user-accounts page (/org-admin/users or /admin/users); this
 * screen only previews the data and deep-links out to where it is acted on.
 *
 * The center work queue carries two tabs so this is the one operational home
 * for a facility manager instead of two overlapping dashboards: "Inquiries"
 * (patient enquiries) and "Pending Leave" (leave requests awaiting a
 * decision, folded in from the HR landing dashboard at
 * `src/app/(dashboard)/dashboard/hr/page.tsx` — approve/reject here mirrors
 * that page's `decideLeave` wiring and approver gating).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  Activity, Wallet, UserCheck, Plus,
  AlertTriangle, RefreshCw, Phone, XCircle, Check, X,
} from '@/components/icons/lucide';
import { useAuth } from '@/lib/context';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useUsers } from '@/lib/hooks/useUsers';
import { usePatients } from '@/lib/hooks/usePatients';
import { useWards } from '@/lib/hooks/useWards';
import { useAppointments } from '@/lib/hooks/useAppointments';
import { useToast } from '@/components/Toast';
import EhrCareDashboard, { type EhrCareDashboardRow } from '@/components/ehr/EhrCareDashboard';
import EhrRailMenu, { type RailMenuItem } from '@/components/ehr/EhrRailMenu';
import { formatDateTitle, toIsoDate } from '@/components/ehr/EhrMiniCalendar';
import EmptyState from '@/components/EmptyState';
import AddInquiryDialog from '@/components/create-dialogs/AddInquiryDialog';
import RequestLeaveDialog from '@/components/create-dialogs/RequestLeaveDialog';
import CreateShiftDialog from '@/components/create-dialogs/CreateShiftDialog';
import AddPayrollEntryDialog from '@/components/create-dialogs/AddPayrollEntryDialog';
import { formatMoney } from '@/lib/format-utils';
import { jubaDate, jubaTime } from '@/lib/time-juba';
import { getRoleConfig } from '@/lib/permissions';
import { buildAddMenuEntries, usersHrefForRole } from '@/lib/people-nav';
import { ROLE_LABEL } from '@/lib/role-display';
import {
  ENQUIRY_STATUS_LABELS, ENQUIRY_STATUSES, deriveEnquiryStatus, enquiryType, enquiryAssignee,
  summariseEnquiries, getPatientEnquiries, type EnquiryStatus,
} from '@/lib/services/enquiry-service';
import type { MessageDoc, UserDoc, PatientDoc, StaffScheduleDoc } from '@/lib/db-types';
import type { LeaveRequestDoc } from '@/lib/db-types-hr';

// recharts (~80–100 KB) is deferred behind a dynamic boundary so it is fetched
// only when these charts render (KAN-66). ssr:false because recharts measures
// the DOM to size itself.
const CashFlowDonut = dynamic(() => import('./_FacilityCharts').then(m => m.CashFlowDonut), {
  ssr: false,
  loading: () => <div style={{ width: '100%', height: '100%' }} />,
});
const WeeklyActivityChart = dynamic(() => import('./_FacilityCharts').then(m => m.WeeklyActivityChart), {
  ssr: false,
  loading: () => <div style={{ width: '100%', height: 208 }} />,
});

const CHART_BLUE = '#2a78d6';   // appointments
const CHART_GREEN = 'var(--color-success)';  // new patients
const CASH_RECEIVED = '#0ca30c';
const CASH_PENDING = 'var(--color-warning)';
const CASH_PENDING_TEXT = 'var(--color-warning)'; // legible amber for text on light cards

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** JS getDay() (0=Sun..6=Sat) → our Mon-first index (0=Mon..6=Sun). */
function weekdayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

interface BillingSummary {
  totalRevenue: number;
  totalOutstanding: number;
  currency: string;
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

function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatClockTimeOrUndefined(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function enquiryStatusTone(status: EnquiryStatus): EhrCareDashboardRow['statusTone'] {
  switch (status) {
    case 'new': return 'warning';
    case 'contacted': return 'active';
    case 'appointment_scheduled': return 'ready';
    case 'closed': return 'done';
    default: return undefined;
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
  billing: { totalRevenue: number; totalOutstanding: number } | null;
}

export interface FacilityOverviewMetric {
  key: string;
  label: string;
  value: number | string;
  href: string;
  tone?: 'neutral' | 'warning' | 'danger' | 'success';
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
  cashFlow: { received: number; pending: number; totalInvoice: number };
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
    schedules, staffingGaps, availableProviderIds, availableBeds, billing, usersHref,
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

  const received = billing?.totalRevenue ?? 0;
  const pendingAmount = billing?.totalOutstanding ?? 0;

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
    cashFlow: { received, pending: pendingAmount, totalInvoice: received + pendingAmount },
  };
}

type ExtraKey = 'billing' | 'enquiries' | 'availability' | 'leave' | 'schedule' | 'gaps';
const EXTRA_LABELS: Record<ExtraKey, string> = {
  billing: 'billing', enquiries: 'inquiries', availability: 'staff availability',
  leave: 'leave requests', schedule: 'shift schedule', gaps: 'staffing gaps',
};

type QueueTab = 'inquiries' | 'leave' | 'staff';

/** The inquiry ladder, as the row pill's picker renders it. */
const ENQUIRY_STATUS_OPTIONS = ENQUIRY_STATUSES.map(value => ({ value, label: ENQUIRY_STATUS_LABELS[value] }));

/** A pending leave request's two outcomes, plus the rung it is already on so
 *  the picker opens showing the current state rather than a decision. */
const LEAVE_DECISION_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approve' },
  { value: 'rejected', label: 'Reject' },
];

/** Add-menu entries whose form opens on this page instead of navigating. The
 *  value is where the user lands once the record is written. */
const ADD_DIALOG_DESTINATIONS = {
  inquiry: '/inquiries',
  leave: '/hr/leave',
  shift: '/hr/schedule',
  payroll: '/hr/payroll',
} as const;
type AddDialogKey = keyof typeof ADD_DIALOG_DESTINATIONS;
const isAddDialogKey = (key: string): key is AddDialogKey => key in ADD_DIALOG_DESTINATIONS;

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

export default function FacilityManagementDashboard() {
  const { currentUser } = useAuth();
  const router = useRouter();
  const scope = useDataScope();
  const { showToast } = useToast();

  const { users, loading: usersLoading, error: usersError, reload: reloadUsers } = useUsers();
  const { patients, loading: patientsLoading } = usePatients();
  const { availableBeds, loading: wardsLoading } = useWards();
  const { appointments, loading: appointmentsLoading } = useAppointments();

  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [enquiries, setEnquiries] = useState<MessageDoc[]>([]);
  const [availableProviderIds, setAvailableProviderIds] = useState<Set<string>>(new Set());
  const [leave, setLeave] = useState<LeaveRequestDoc[]>([]);
  const [schedules, setSchedules] = useState<StaffScheduleDoc[]>([]);
  const [staffingGaps, setStaffingGaps] = useState<StaffingGap[]>([]);
  const [loadErrors, setLoadErrors] = useState<Set<ExtraKey>>(new Set());
  const [extraLoading, setExtraLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const hasLoadedExtraRef = useRef(false);
  // Shared by both queue tabs — each tab filters its own dataset by the same
  // text so switching tabs never leaves a stale, unrelated filter in place.
  const [queueSearch, setQueueSearch] = useState('');
  const [activeTab, setActiveTab] = useState<QueueTab>('inquiries');

  const today = jubaDate();
  const facilityId = currentUser?.hospitalId;

  // Billing, enquiries, provider availability, leave, and today's
  // schedule/staffing-gaps are all fetched together; each is tracked
  // independently in `loadErrors` so a single failure degrades only its own
  // card instead of the whole dashboard, and Retry re-runs all six.
  useEffect(() => {
    let cancelled = false;
    if (!hasLoadedExtraRef.current) setExtraLoading(true);

    const loadBilling = async () => {
      const { getBillingSummary } = await import('@/lib/services/billing-service');
      const s = await getBillingSummary(scope);
      return { totalRevenue: s.totalRevenue, totalOutstanding: s.totalOutstanding, currency: s.currency };
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

    (async () => {
      const failed = new Set<ExtraKey>();
      const [billingRes, enquiriesRes, availRes, leaveRes, schedRes, gapsRes] = await Promise.allSettled([
        loadBilling(),
        getPatientEnquiries(scope),
        loadAvailability(),
        loadLeave(),
        loadSchedules(),
        loadGaps(),
      ]);
      if (cancelled) return;
      if (billingRes.status === 'fulfilled') setBilling(billingRes.value); else failed.add('billing');
      if (enquiriesRes.status === 'fulfilled') setEnquiries(enquiriesRes.value); else failed.add('enquiries');
      if (availRes.status === 'fulfilled') setAvailableProviderIds(availRes.value); else failed.add('availability');
      if (leaveRes.status === 'fulfilled') setLeave(leaveRes.value); else failed.add('leave');
      if (schedRes.status === 'fulfilled') setSchedules(schedRes.value); else failed.add('schedule');
      if (gapsRes.status === 'fulfilled') setStaffingGaps(gapsRes.value); else failed.add('gaps');
      setLoadErrors(failed);
      hasLoadedExtraRef.current = true;
      setExtraLoading(false);
    })();

    return () => { cancelled = true; };
  }, [scope, today, facilityId, reloadToken]);

  const retryExtra = useCallback(() => setReloadToken(t => t + 1), []);
  const retryAll = useCallback(() => { reloadUsers(); retryExtra(); }, [reloadUsers, retryExtra]);

  const usersUnavailable = !!usersError && users.length === 0;

  // Every staff figure on this page links to the one staff list this role has.
  // The four roles that reach /facility-management all resolve to one; the
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
    billing,
  }), [today, queueSearch, users, usersUnavailable, patients, enquiries, leave, schedules, staffingGaps, availableProviderIds, staffListHref, availableBeds, billing]);

  // Weekly patient activity (real: registrations and kept appointments —
  // cancellations are excluded from both series, not charted separately).
  const weekly = useMemo(() => {
    const rows = WEEKDAYS.map(d => ({ day: d, newPatients: 0, appointments: 0 }));
    const start = new Date(); start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - weekdayIndex(start)); // Monday of this week
    const end = new Date(start); end.setDate(end.getDate() + 7);
    const inWeek = (iso?: string) => {
      if (!iso) return -1;
      const dt = new Date(iso);
      if (dt < start || dt >= end) return -1;
      return weekdayIndex(dt);
    };
    for (const p of patients) {
      const i = inWeek((p as { createdAt?: string }).createdAt);
      if (i >= 0) rows[i].newPatients += 1;
    }
    for (const a of appointments) {
      const i = inWeek(a.appointmentDate);
      if (i < 0) continue;
      if (a.status !== 'cancelled') rows[i].appointments += 1;
    }
    return rows;
  }, [patients, appointments]);

  const cashData = useMemo(() => [
    { name: 'Received', value: overview.cashFlow.received, color: CASH_RECEIVED },
    { name: 'Pending', value: overview.cashFlow.pending, color: CASH_PENDING },
  ].filter(d => d.value > 0), [overview.cashFlow]);

  // The global "Add" menu — permission-gated entries from people-nav. The three
  // records this dashboard can create open their dialog HERE, on the page the
  // user was already looking at, and only route to the destination once the
  // record exists; anything else (staff accounts) still navigates, because its
  // form lives on a page of its own.
  const [addDialog, setAddDialog] = useState<AddDialogKey | null>(null);
  const addMenuItems: RailMenuItem[] = useMemo(() => {
    if (!currentUser) return [];
    const allowedRoutes = getRoleConfig(currentUser.role).allowedRoutes;
    return buildAddMenuEntries({ role: currentUser.role, allowedRoutes }).map(entry => {
      const dialogKey = isAddDialogKey(entry.key) ? entry.key : null;
      return {
        key: entry.key,
        label: entry.label,
        onSelect: dialogKey ? () => setAddDialog(dialogKey) : () => router.push(entry.href),
      };
    });
  }, [currentUser, router]);

  const updateEnquiryStatusLocally = (id: string, status: EnquiryStatus) => {
    setEnquiries(prev => prev.map(m => (m._id === id ? { ...m, enquiryStatus: status } : m)));
  };

  // Quick triage from the dashboard's own queue — the row's status pill is a
  // picker, so any rung is one click away; full triage (reassignment, notes)
  // stays on /inquiries, which owns that surface.
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
  const markContacted = (id: string) => setEnquiryStatusAction(id, 'contacted');
  const closeEnquiry = (id: string) => setEnquiryStatusAction(id, 'closed');

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
      showToast(status === 'approved' ? 'Leave request approved.' : 'Leave request rejected.', 'success');
    } catch (err) {
      console.error('Failed to decide leave request', err);
      showToast('Could not update the leave request.', 'error');
    }
  };

  const renderLeaveDetail = (row: FacilityLeaveRow) => (
    <div className="ehr-visit-pop ehr-visit-pop--inline">
      {isLeaveApprover && row.status === 'pending' && (
        <div className="ehr-visit-pop-tabs">
          <div className="ehr-visit-pop-actions">
            <button
              type="button"
              className="ehr-visit-pop-icon is-primary"
              aria-label="Approve leave"
              title="Approve leave"
              onClick={() => decideLeaveAction(row.id, 'approved')}
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              type="button"
              className="ehr-visit-pop-icon"
              aria-label="Reject leave"
              title="Reject leave"
              onClick={() => decideLeaveAction(row.id, 'rejected')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
      <div className="ehr-visit-pop-body">
        <div className="ehr-visit-pop-row">
          {/* Not translated — matches this file's own hardcoded-string
              precedent (see markContacted/closeEnquiry toasts above) rather
              than adding an i18n key for a single detail-panel field. */}
          <span className="ehr-visit-pop-label">Reason</span>
          <div><p>{row.reason || 'No reason given'}</p></div>
        </div>
      </div>
    </div>
  );

  const renderInquiryDetail = (row: FacilityInquiryRow) => (
    <div className="ehr-visit-pop ehr-visit-pop--inline">
      {(row.status === 'new' || row.status === 'contacted') && (
        <div className="ehr-visit-pop-tabs">
          <div className="ehr-visit-pop-actions">
            {row.status === 'new' && (
              <button
                type="button"
                className="ehr-visit-pop-icon is-primary"
                aria-label="Mark contacted"
                title="Mark contacted"
                onClick={() => markContacted(row.id)}
              >
                <Phone className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              className="ehr-visit-pop-icon"
              aria-label="Close inquiry"
              title="Close inquiry"
              onClick={() => closeEnquiry(row.id)}
            >
              <XCircle className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
      <div className="ehr-visit-pop-body">
        <div className="ehr-visit-pop-row">
          <span className="ehr-visit-pop-label">Channel</span>
          <div><p>{row.channel}</p></div>
        </div>
        <div className="ehr-visit-pop-row">
          <span className="ehr-visit-pop-label">Assigned to</span>
          <div><p>{row.assignee || 'Unassigned'}</p></div>
        </div>
      </div>
    </div>
  );

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
    : activeTab === 'inquiries'
      ? (inquiriesFailed ? 'Retry' : 'View all')
      : (leaveFailed ? 'Retry' : 'View all');
  const onEmptyAction = activeTab === 'staff'
    ? (staffFailed ? retryAll : () => router.push(overview.activeStaff.href))
    : activeTab === 'inquiries'
      ? (inquiriesFailed ? retryExtra : () => router.push('/inquiries'))
      : (leaveFailed ? retryExtra : () => router.push('/hr/leave'));

  const initialLoading = usersLoading || patientsLoading || wardsLoading || appointmentsLoading || extraLoading;

  if (!currentUser) return null;

  if (initialLoading) {
    return (
      <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 320, color: 'var(--text-muted)' }}>
          <Activity size={44} style={{ marginRight: 8, animation: 'spin 1s linear infinite' }} />
          <span>Loading facility data…</span>
        </div>
      </main>
    );
  }

  return (
    <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {hasErrors && (
        <div
          className="flex items-center gap-3 rounded-xl px-4 py-3 mb-3"
          style={{ background: 'rgba(196,69,54,0.08)', border: '1px solid rgba(196,69,54,0.25)' }}
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-danger)' }} />
          <span className="text-[12.5px] flex-1" style={{ color: 'var(--text-primary)' }}>
            Couldn&apos;t load {failedLabels.join(', ')}. Some numbers on this page may be incomplete.
          </span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={retryAll}>
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      )}

      <EhrCareDashboard
        title="Facility Management"
        greetingName={currentUser.name}
        dateLabel={formatDateTitle(toIsoDate(new Date()))}
        centerTitle={CENTER_TITLES[activeTab]}
        // Active Staff is a third queue tab, not a rail metric: the roster a
        // manager works from reads like the other two lists.
        tabs={[
          { key: 'inquiries', label: 'Inquiries', count: overview.inquiryRows.length },
          { key: 'leave', label: 'Pending Leave', count: overview.pendingLeaveRows.length },
          { key: 'staff', label: 'Active Staff', count: overview.activeStaff.rows.length },
        ]}
        // Neither queue is a single day's schedule — an inquiry stays open
        // across days and a leave request stays pending across days — so the
        // calendar's selected day must not hide rows from either tab.
        filterRowsByDate={false}
        activeTab={activeTab}
        onTabChange={(tab) => setActiveTab(tab as QueueTab)}
        searchValue={queueSearch}
        searchPlaceholder={SEARCH_PLACEHOLDERS[activeTab]}
        onSearchChange={setQueueSearch}
        filters={[]}
        actions={[
          { label: 'View staff accounts', icon: UserCheck, onClick: () => router.push(staffListHref) },
        ]}
        rows={activeTab === 'staff'
          ? overview.activeStaff.rows.map((r): EhrCareDashboardRow => ({
              id: r.id,
              title: r.name,
              subtitle: r.role,
              statusLabel: r.shift ? 'On shift' : 'Available',
              statusTone: 'ready',
              careTeam: r.role,
              careTeamLabel: 'Role',
              location: r.department,
              locationLabel: 'Department',
              locationSecondary: r.shift || undefined,
            }))
          : activeTab === 'inquiries'
          ? overview.inquiryRows.map((r): EhrCareDashboardRow => ({
              id: r.id,
              title: r.name,
              subtitle: r.type,
              date: r.date,
              time: r.time,
              timeSecondary: r.date,
              status: r.status,
              statusLabel: r.statusLabel,
              statusTone: enquiryStatusTone(r.status),
              // The pill is the control: every rung of the inquiry ladder is
              // one pick away, instead of expanding the row for two buttons.
              statusValue: r.status,
              statusOptions: ENQUIRY_STATUS_OPTIONS,
              onStatusChange: (value: string) => setEnquiryStatusAction(r.id, value as EnquiryStatus),
              careTeam: r.assignee || 'Unassigned',
              careTeamLabel: 'Assigned to',
              location: r.channel,
              locationLabel: 'Channel',
              popupDetail: renderInquiryDetail(r),
            }))
          : overview.pendingLeaveRows.map((r): EhrCareDashboardRow => ({
              id: r.id,
              title: r.requesterName,
              subtitle: `${titleCase(r.leaveType)} · ${r.days}d · ${r.startDate} → ${r.endDate}`,
              compactMeta: `${r.days}d`,
              date: r.requestedAt.slice(0, 10),
              time: formatClockTimeOrUndefined(r.requestedAt),
              timeSecondary: r.requestedAt.slice(0, 10),
              status: r.status,
              statusLabel: titleCase(r.leaveType),
              statusSecondary: `${r.days} day${r.days === 1 ? '' : 's'}`,
              statusTone: 'warning',
              // Only an approver gets the picker; everyone else keeps a plain
              // pill, matching who the service will actually let decide.
              ...(isLeaveApprover && r.status === 'pending' ? {
                statusValue: r.status,
                statusOptions: LEAVE_DECISION_OPTIONS,
                onStatusChange: (value: string) => {
                  if (value === 'approved' || value === 'rejected') decideLeaveAction(r.id, value);
                },
              } : {}),
              careTeam: r.role ? titleCase(r.role) : undefined,
              careTeamLabel: 'Role',
              location: r.facility,
              locationSecondary: `${r.startDate} → ${r.endDate}`,
              locationLabel: 'Facility',
              popupDetail: renderLeaveDetail(r),
            }))}
        metrics={overview.metrics}
        metricsTitle="Facility Overview"
        emptyTitle={emptyTitle}
        emptyActionLabel={emptyActionLabel}
        onEmptyAction={onEmptyAction}
        chart={
          <div className="ehr-day-stats">
            <div className="ehr-day-stats-head">
              <h3>Weekly Patient Activity</h3>
            </div>
            <div style={{ marginTop: 8 }}>
              <WeeklyActivityChart
                data={weekly}
                chartType="bar"
                series={[
                  { key: 'appointments', name: 'Appointments', color: CHART_BLUE },
                  { key: 'newPatients', name: 'New Patients', color: CHART_GREEN },
                ]}
              />
            </div>
          </div>
        }
        // Add sits in the header beside Print (EhrCareDashboard `headerExtra`),
        // not in the rail: `actions` only carries {label,icon,onClick}, so a
        // dropdown needs the component slot.
        headerExtra={addMenuItems.length > 0 ? (
          <EhrRailMenu variant="primary" label="Add" icon={Plus} hideChevron ariaLabel="Add a new record" items={addMenuItems} />
        ) : undefined}
        // Cash Flow sits directly under the weekly activity chart —
        // `railContent` renders immediately after it.
        railContent={(
          <div className="dash-card overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <Wallet className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Cash Flow</span>
            </div>
            {loadErrors.has('billing') ? (
              <EmptyState
                icon={AlertTriangle}
                title="Couldn't load billing data"
                message="Billing figures failed to load. Try again."
                action={{ label: 'Retry', onClick: retryExtra }}
              />
            ) : (
              // Donut left, figures right. The ring carries the weight here —
              // the two amounts are captions on it, so they stay small enough
              // that the whole card reads in one glance.
              <div className="flex items-center gap-2.5 p-3">
                <div className="relative flex-shrink-0" style={{ width: 116, height: 116 }}>
                  <CashFlowDonut data={cashData} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-2">
                    <span className="text-[11px] font-bold leading-tight text-center" style={{ color: 'var(--text-primary)' }}>{formatMoney(overview.cashFlow.totalInvoice)}</span>
                    <span className="text-[8px] uppercase tracking-wide leading-tight" style={{ color: 'var(--text-muted)' }}>Total</span>
                  </div>
                </div>
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="rounded-lg px-2 py-1.5" style={{ background: 'rgba(12,163,12,0.10)', border: '1px solid rgba(12,163,12,0.28)' }}>
                    <p className="text-[8.5px] font-semibold uppercase tracking-wide leading-tight" style={{ color: 'var(--text-muted)' }}>Received</p>
                    <p className="text-[11px] font-bold truncate leading-tight mt-0.5" style={{ color: CASH_RECEIVED }}>{formatMoney(overview.cashFlow.received)}</p>
                  </div>
                  <div className="rounded-lg px-2 py-1.5" style={{ background: 'rgba(237,161,0,0.12)', border: '1px solid rgba(237,161,0,0.35)' }}>
                    <p className="text-[8.5px] font-semibold uppercase tracking-wide leading-tight" style={{ color: 'var(--text-muted)' }}>Pending</p>
                    <p className="text-[11px] font-bold truncate leading-tight mt-0.5" style={{ color: CASH_PENDING_TEXT }}>{formatMoney(overview.cashFlow.pending)}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      />

      {/* Create-in-place, then go. Each dialog writes the record from here and
          only then routes to the page that owns it, so the user never lands on
          an empty form somewhere else. */}
      {addDialog === 'inquiry' && (
        <AddInquiryDialog
          onClose={() => setAddDialog(null)}
          onCreated={created => {
            setEnquiries(prev => [created, ...prev]);
            setAddDialog(null);
            showToast('Inquiry logged.', 'success');
            router.push(ADD_DIALOG_DESTINATIONS.inquiry);
          }}
        />
      )}
      {addDialog === 'leave' && (
        <RequestLeaveDialog
          onClose={() => setAddDialog(null)}
          onCreated={() => {
            setAddDialog(null);
            retryExtra();
            router.push(ADD_DIALOG_DESTINATIONS.leave);
          }}
        />
      )}
      {addDialog === 'shift' && (
        <CreateShiftDialog
          onClose={() => setAddDialog(null)}
          defaultDate={today}
          onCreated={shiftDate => {
            setAddDialog(null);
            retryExtra();
            router.push(`${ADD_DIALOG_DESTINATIONS.shift}?date=${shiftDate}`);
          }}
        />
      )}
      {addDialog === 'payroll' && (
        <AddPayrollEntryDialog
          onClose={() => setAddDialog(null)}
          onCreated={() => {
            setAddDialog(null);
            router.push(ADD_DIALOG_DESTINATIONS.payroll);
          }}
        />
      )}
    </main>
  );
}
