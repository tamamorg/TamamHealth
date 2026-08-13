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
  Activity, Users, BedDouble, Wallet, UserCheck,
  CalendarClock, AlertTriangle, RefreshCw, Phone, XCircle, Check, X,
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
import { formatMoney } from '@/lib/format-utils';
import { jubaDate, jubaTime } from '@/lib/time-juba';
import { getRoleConfig } from '@/lib/permissions';
import { buildAddMenuEntries } from '@/lib/people-nav';
import { ROLE_LABEL } from '@/lib/role-display';
import {
  ENQUIRY_STATUS_LABELS, deriveEnquiryStatus, enquiryType, enquiryAssignee, summariseEnquiries,
  getPatientEnquiries, type EnquiryStatus,
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
const CHART_GREEN = '#199e70';  // new patients
const CHART_RED = '#e34948';    // canceled
const CASH_RECEIVED = '#0ca30c';
const CASH_PENDING = '#eda100';
const CASH_PENDING_TEXT = '#a16207'; // legible amber for text on light cards

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

export interface FacilityAvailabilityRow {
  id: string;
  name: string;
  role: string;
  department: string;
  /** e.g. "Morning · 08:00–16:00", or null when today carries no schedule row for them. */
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
  availabilityRows: FacilityAvailabilityRow[];
  /** Pending leave requests (status === 'pending'), filtered by the same
   *  `search` text as the inquiries preview — the Pending Leave tab's queue. */
  pendingLeaveRows: FacilityLeaveRow[];
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
    schedules, staffingGaps, availableProviderIds, availableBeds, billing,
  } = input;

  const doctors = users.filter(u => DOCTOR_ROLES.has(u.role));
  const nurses = users.filter(u => NURSE_ROLES.has(u.role));
  const activeStaff = users.filter(u => u.isActive !== false);
  const availableStaff = users.filter(u => availableProviderIds.has(u._id));
  const pendingLeave = leave.filter(l => l.status === 'pending');
  const unfilledShifts = staffingGaps.reduce((sum, g) => sum + g.gap, 0);
  const enquirySummary = summariseEnquiries(enquiries);

  // Degraded /api/users path: read as "unknown" (—), never as a real zero.
  const staffCount = (n: number): number | string => (usersUnavailable ? '—' : n);
  const staffTone = usersUnavailable ? ('warning' as const) : undefined;

  const metrics: FacilityOverviewMetric[] = [
    { key: 'staff-total', label: 'Total Staff', value: staffCount(users.length), href: '/hr?tab=roster', tone: staffTone },
    { key: 'staff-active', label: 'Active Staff', value: staffCount(activeStaff.length), href: '/hr?tab=roster&status=active', tone: staffTone },
    { key: 'staff-available', label: 'Available Staff', value: staffCount(availableStaff.length), href: '/hr?tab=roster&availability=available', tone: staffTone },
    { key: 'doctors', label: 'Total Doctors', value: staffCount(doctors.length), href: '/hr?tab=roster&role=doctor', tone: staffTone },
    { key: 'nurses', label: 'Total Nurses', value: staffCount(nurses.length), href: '/hr?tab=roster&role=nurse', tone: staffTone },
    { key: 'patients', label: 'Total Patients', value: patients.length, href: '/patients' },
    { key: 'beds', label: 'Available Beds', value: availableBeds, href: '/wards' },
    { key: 'inquiries-open', label: 'Open Inquiries', value: enquirySummary.open, href: '/inquiries?status=new', tone: enquirySummary.open > 0 ? 'warning' : undefined },
    { key: 'leave-pending', label: 'Pending Leave', value: pendingLeave.length, href: '/hr?tab=leave&status=pending', tone: pendingLeave.length > 0 ? 'warning' : undefined },
    { key: 'shifts-today', label: "Today's Shifts", value: schedules.length, href: `/hr?tab=schedule&date=${today}` },
    // "Unfilled" = short against a configured per-shift minimum, not a vacant
    // position record — this data model has no such record (see getStaffingGaps).
    { key: 'shifts-unfilled', label: 'Unfilled Shifts', value: unfilledShifts, href: '/hr?tab=schedule&gaps=1', tone: unfilledShifts > 0 ? 'danger' : undefined },
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

  const availabilityRows: FacilityAvailabilityRow[] = users
    .filter(u => u.isActive !== false && availableProviderIds.has(u._id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 5)
    .map(u => {
      const shift = schedules.find(s => s.userId === u._id);
      return {
        id: u._id,
        name: u.name,
        role: ROLE_LABEL[u.role] || u.role,
        department: u.department || u.hospitalName || 'General',
        shift: shift ? `${titleCase(shift.shiftType)} · ${shift.startTime}–${shift.endTime}` : null,
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

  const received = billing?.totalRevenue ?? 0;
  const pendingAmount = billing?.totalOutstanding ?? 0;

  return {
    metrics,
    inquiryRows,
    inquiryMatchCount: filteredEnquiries.length,
    availabilityRows,
    pendingLeaveRows,
    cashFlow: { received, pending: pendingAmount, totalInvoice: received + pendingAmount },
  };
}

type ExtraKey = 'billing' | 'enquiries' | 'availability' | 'leave' | 'schedule' | 'gaps';
const EXTRA_LABELS: Record<ExtraKey, string> = {
  billing: 'billing', enquiries: 'inquiries', availability: 'staff availability',
  leave: 'leave requests', schedule: 'shift schedule', gaps: 'staffing gaps',
};

type QueueTab = 'inquiries' | 'leave';

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
    availableBeds,
    billing,
  }), [today, queueSearch, users, usersUnavailable, patients, enquiries, leave, schedules, staffingGaps, availableProviderIds, availableBeds, billing]);

  // Weekly patient activity (real: registrations, appointments, cancellations).
  const weekly = useMemo(() => {
    const rows = WEEKDAYS.map(d => ({ day: d, newPatients: 0, appointments: 0, canceled: 0 }));
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
      if (a.status === 'cancelled') rows[i].canceled += 1;
      else rows[i].appointments += 1;
    }
    return rows;
  }, [patients, appointments]);

  const cashData = useMemo(() => [
    { name: 'Received', value: overview.cashFlow.received, color: CASH_RECEIVED },
    { name: 'Pending', value: overview.cashFlow.pending, color: CASH_PENDING },
  ].filter(d => d.value > 0), [overview.cashFlow]);

  // The global "Add" menu — permission-gated entries from people-nav, mapped
  // onto navigation. Hidden entirely (empty array) when this role has none.
  const addMenuItems: RailMenuItem[] = useMemo(() => {
    if (!currentUser) return [];
    const allowedRoutes = getRoleConfig(currentUser.role).allowedRoutes;
    return buildAddMenuEntries({ role: currentUser.role, allowedRoutes }).map(entry => ({
      key: entry.key,
      label: entry.label,
      icon: entry.icon,
      description: entry.description,
      onSelect: () => router.push(entry.href),
    }));
  }, [currentUser, router]);

  const updateEnquiryStatusLocally = (id: string, status: EnquiryStatus) => {
    setEnquiries(prev => prev.map(m => (m._id === id ? { ...m, enquiryStatus: status } : m)));
  };

  // Quick triage actions from the dashboard's own queue — full triage
  // (reassignment, notes) stays on /inquiries, which owns that surface.
  const markContacted = async (id: string) => {
    try {
      const { setEnquiryStatus } = await import('@/lib/services/enquiry-service');
      await setEnquiryStatus(id, 'contacted');
      updateEnquiryStatusLocally(id, 'contacted');
      showToast('Marked as contacted.', 'success');
    } catch (err) {
      console.error('Failed to update inquiry status', err);
      showToast('Could not update the inquiry.', 'error');
    }
  };
  const closeEnquiry = async (id: string) => {
    try {
      const { setEnquiryStatus } = await import('@/lib/services/enquiry-service');
      await setEnquiryStatus(id, 'closed');
      updateEnquiryStatusLocally(id, 'closed');
      showToast('Inquiry closed.', 'success');
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
  const emptyTitle = activeTab === 'inquiries'
    ? (inquiriesFailed ? "Couldn't load inquiries" : hasQuery ? 'No inquiries match your search' : 'No recent inquiries')
    : (leaveFailed ? "Couldn't load leave requests" : hasQuery ? 'No leave requests match your search' : 'No leave requests waiting on a decision');
  const emptyActionLabel = activeTab === 'inquiries'
    ? (inquiriesFailed ? 'Retry' : 'View all')
    : (leaveFailed ? 'Retry' : 'View all');
  const onEmptyAction = activeTab === 'inquiries'
    ? (inquiriesFailed ? retryExtra : () => router.push('/inquiries'))
    : (leaveFailed ? retryExtra : () => router.push('/hr?tab=leave'));

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
        centerTitle={activeTab === 'inquiries' ? 'Recent Inquiries' : 'Pending Leave'}
        tabs={[
          { key: 'inquiries', label: 'Inquiries', count: overview.inquiryRows.length },
          { key: 'leave', label: 'Pending Leave', count: overview.pendingLeaveRows.length },
        ]}
        // Neither queue is a single day's schedule — an inquiry stays open
        // across days and a leave request stays pending across days — so the
        // calendar's selected day must not hide rows from either tab.
        filterRowsByDate={false}
        activeTab={activeTab}
        onTabChange={(tab) => setActiveTab(tab as QueueTab)}
        searchValue={queueSearch}
        searchPlaceholder={activeTab === 'inquiries'
          ? 'Search inquiries by name, type, or assignee…'
          : 'Search leave requests by name, role, or type…'}
        onSearchChange={setQueueSearch}
        filters={[]}
        actions={[
          { label: 'Find staff availability', icon: UserCheck, onClick: () => router.push('/hr?tab=roster&availability=available') },
        ]}
        rows={activeTab === 'inquiries'
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
              careTeam: r.role ? titleCase(r.role) : undefined,
              careTeamLabel: 'Role',
              location: r.facility,
              locationSecondary: `${r.startDate} → ${r.endDate}`,
              locationLabel: 'Facility',
              popupDetail: renderLeaveDetail(r),
            }))}
        metrics={overview.metrics}
        metricsTitle="Facility Overview"
        metricsActions={[
          { label: 'Manage Roster', icon: Users, onClick: () => router.push('/hr?tab=roster') },
          { label: 'Schedule Shifts', icon: CalendarClock, onClick: () => router.push('/hr?tab=schedule') },
          { label: 'View Wards', icon: BedDouble, onClick: () => router.push('/wards') },
        ]}
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
                  { key: 'canceled', name: 'Canceled', color: CHART_RED },
                ]}
              />
            </div>
          </div>
        }
        // Add sits in the header beside Print (EhrCareDashboard `headerExtra`),
        // not in the rail: `actions` only carries {label,icon,onClick}, so a
        // dropdown needs the component slot.
        headerExtra={addMenuItems.length > 0 ? (
          <EhrRailMenu variant="primary" label="Add" ariaLabel="Add a new record" items={addMenuItems} menuTitle="Add" />
        ) : undefined}
        // Cash Flow and Staff Availability sit directly under the weekly
        // activity chart — `railContent` renders immediately after it.
        railContent={(
          <>
            {/* Cash Flow */}
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
                // Stacked, not side-by-side: the rail is far narrower than the
                // three-column grid this card used to sit in.
                <div className="flex flex-col items-center gap-3 p-4">
                  <div className="relative flex-shrink-0" style={{ width: 124, height: 124 }}>
                    <CashFlowDonut data={cashData} />
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{formatMoney(overview.cashFlow.totalInvoice)}</span>
                      <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Total invoice</span>
                    </div>
                  </div>
                  <div className="w-full space-y-2">
                    <div className="rounded-xl p-2.5" style={{ background: 'rgba(12,163,12,0.10)', border: '1px solid rgba(12,163,12,0.28)' }}>
                      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Received Amount</p>
                      <p className="text-base font-bold" style={{ color: CASH_RECEIVED }}>{formatMoney(overview.cashFlow.received)}</p>
                    </div>
                    <div className="rounded-xl p-2.5" style={{ background: 'rgba(237,161,0,0.12)', border: '1px solid rgba(237,161,0,0.35)' }}>
                      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Pending Amount</p>
                      <p className="text-base font-bold" style={{ color: CASH_PENDING_TEXT }}>{formatMoney(overview.cashFlow.pending)}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Staff Availability */}
            <div className="dash-card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
                <div className="flex items-center gap-2">
                  <UserCheck className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Staff Availability</span>
                </div>
                <button
                  onClick={() => router.push('/hr?tab=roster&availability=available')}
                  className="text-[12px] font-medium"
                  style={{ color: 'var(--accent-primary)' }}
                  title="View all available staff"
                  aria-label="View all available staff"
                >
                  View all
                </button>
              </div>
              {usersUnavailable ? (
                <EmptyState
                  icon={AlertTriangle}
                  title="Couldn't load staff data"
                  message="Staff records failed to load. Try again."
                  action={{ label: 'Retry', onClick: () => reloadUsers() }}
                />
              ) : overview.availabilityRows.length === 0 ? (
                <EmptyState
                  title="No staff available right now"
                  message="Nobody on the roster is currently marked available."
                  action={{ label: 'View roster', onClick: () => router.push('/hr?tab=roster') }}
                />
              ) : (
                <div className="p-2">
                  {overview.availabilityRows.map(row => (
                    <div key={row.id} className="flex items-center gap-3 px-3 py-2.5" style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0" style={{ background: 'var(--accent-primary)' }}>
                        {(row.name || '?').split(' ').map(s => s[0]).slice(0, 2).join('')}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>{row.name}</div>
                        <div className="text-[10.5px] truncate" style={{ color: 'var(--text-muted)' }}>{row.role} · {row.department}</div>
                      </div>
                      <span className="text-[11px] font-semibold text-right" style={{ color: 'var(--color-success)' }}>
                        {row.shift || 'Available'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      />
    </main>
  );
}
