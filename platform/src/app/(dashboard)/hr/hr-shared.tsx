'use client';

/**
 * Shared pieces of the Staff & HR module.
 *
 * The HR areas used to be tabs inside one 1,200-line page behind a section
 * sidebar. They are now independent routes — /hr/leave, /hr/schedule,
 * /hr/payroll — reached from the module dropdown like every other page, so
 * each loads only its own data. The staff roster is deliberately absent: it
 * was the same list as the User Accounts page, which now owns it. What
 * genuinely belongs to all three (status tokens, the staff table cell, the
 * facility scoping) lives here; nothing else does.
 */

import { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { useUsers } from '@/lib/hooks/useUsers';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { avatarTint } from '@/lib/patient-utils';
import type { LeaveRequestDoc, LeaveStatus, LeaveType, PayrollEntryDoc } from '@/lib/db-types-hr';
import type { StaffScheduleDoc } from '@/lib/db-types';

export const LEAVE_TYPES: { id: LeaveType; label: string }[] = [
  { id: 'annual', label: 'Annual' },
  { id: 'sick', label: 'Sick' },
  { id: 'maternity', label: 'Maternity' },
  { id: 'paternity', label: 'Paternity' },
  { id: 'compassionate', label: 'Compassionate' },
  { id: 'study', label: 'Study' },
  { id: 'unpaid', label: 'Unpaid' },
];

export const LEAVE_STATUSES: LeaveStatus[] = ['pending', 'approved', 'rejected', 'cancelled', 'taken'];

/**
 * Status tints for the card-row pills. `border` is carried explicitly rather
 * than derived as `${color}40`: half these colours are `var(--…)` tokens, and
 * concatenating an alpha suffix onto a var() reference produces invalid CSS
 * (the border silently falls back to the pill's default hairline).
 */
export interface StatusToken { label: string; color: string; bg: string; border: string }

export const STATUS_TOKENS: Record<LeaveRequestDoc['status'], StatusToken> = {
  pending:   { label: 'Pending',   color: 'var(--color-warning-text)', bg: 'rgba(228, 168, 75, 0.16)', border: 'rgba(228, 168, 75, 0.45)' },
  approved:  { label: 'Approved',  color: 'var(--color-success-text)', bg: 'rgba(27, 158, 119, 0.12)', border: 'rgba(27, 158, 119, 0.40)' },
  rejected:  { label: 'Rejected',  color: 'var(--color-danger-500)', bg: 'rgba(196, 69, 54, 0.14)', border: 'rgba(196, 69, 54, 0.40)' },
  cancelled: { label: 'Cancelled', color: '#5A7370', bg: 'rgba(90, 115, 112, 0.14)', border: 'rgba(90, 115, 112, 0.40)' },
  taken:     { label: 'Taken',     color: 'var(--accent-primary)', bg: 'rgba(33, 145, 208, 0.14)', border: 'rgba(33, 145, 208, 0.40)' },
};

export const PAYROLL_STATUS_TOKENS: Record<PayrollEntryDoc['status'], StatusToken> = {
  draft:    { label: 'Draft',    color: '#5A7370', bg: 'rgba(90, 115, 112, 0.14)', border: 'rgba(90, 115, 112, 0.40)' },
  approved: { label: 'Approved', color: 'var(--accent-primary)', bg: 'rgba(33, 145, 208, 0.14)', border: 'rgba(33, 145, 208, 0.40)' },
  paid:     { label: 'Paid',     color: 'var(--color-success-text)', bg: 'rgba(27, 158, 119, 0.14)', border: 'rgba(27, 158, 119, 0.40)' },
  reversed: { label: 'Reversed', color: 'var(--color-danger-500)', bg: 'rgba(196, 69, 54, 0.14)', border: 'rgba(196, 69, 54, 0.40)' },
};

/** Shift lifecycle — `StaffScheduleDoc.status`, surfaced by the schedule list's
 *  Status column (the old table dropped it entirely). */
export const SCHEDULE_STATUS_TOKENS: Record<StaffScheduleDoc['status'], StatusToken> = {
  scheduled: { label: 'Scheduled', color: 'var(--accent-primary)', bg: 'rgba(33, 145, 208, 0.14)', border: 'rgba(33, 145, 208, 0.40)' },
  confirmed: { label: 'Confirmed', color: 'var(--color-success-text)', bg: 'rgba(27, 158, 119, 0.12)', border: 'rgba(27, 158, 119, 0.40)' },
  completed: { label: 'Completed', color: '#5A7370', bg: 'rgba(90, 115, 112, 0.14)', border: 'rgba(90, 115, 112, 0.40)' },
  absent:    { label: 'Absent',    color: 'var(--color-danger-500)', bg: 'rgba(196, 69, 54, 0.14)', border: 'rgba(196, 69, 54, 0.40)' },
  swapped:   { label: 'Swapped',   color: 'var(--color-warning-text)', bg: 'rgba(228, 168, 75, 0.16)', border: 'rgba(228, 168, 75, 0.45)' },
};

/** Tint a shared `.appointment-status-pill` with a status token — the pill
 *  keeps the list-wide metrics, only its colours change. */
export const statusPillStyle = (tok: StatusToken) => ({
  borderColor: tok.border,
  background: tok.bg,
  color: tok.color,
});

export const SHIFT_TYPES: StaffScheduleDoc['shiftType'][] = ['morning', 'afternoon', 'night', 'on_call'];

/** Per-shift accent, shared by the schedule list's shift chip and the header
 *  stat dots so a shift reads the same colour in both places. */
export const SHIFT_TOKENS: Record<StaffScheduleDoc['shiftType'], StatusToken> = {
  morning:   { label: 'Morning',   color: 'var(--color-success-text)', bg: 'rgba(27, 158, 119, 0.12)', border: 'rgba(27, 158, 119, 0.40)' },
  afternoon: { label: 'Afternoon', color: 'var(--color-warning-text)', bg: 'rgba(228, 168, 75, 0.16)', border: 'rgba(228, 168, 75, 0.45)' },
  night:     { label: 'Night',     color: 'var(--accent-hover)', bg: 'rgba(1, 86, 151, 0.12)', border: 'rgba(1, 86, 151, 0.35)' },
  on_call:   { label: 'On call',   color: 'var(--accent-primary)', bg: 'rgba(33, 145, 208, 0.14)', border: 'rgba(33, 145, 208, 0.40)' },
};

/**
 * Length of a shift as "8h" / "7h 30m". A night shift's end time is smaller
 * than its start (22:00 → 06:00), so the span wraps through midnight rather
 * than going negative.
 */
export function shiftDuration(start: string, end: string): string {
  const toMinutes = (value: string) => {
    const [h, m] = (value || '').split(':').map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
  };
  const from = toMinutes(start);
  const to = toMinutes(end);
  if (Number.isNaN(from) || Number.isNaN(to)) return '—';
  const minutes = ((to - from + 1440) % 1440) || 1440;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/** The HR areas, in nav order — the one list every route and the legacy
 *  `?tab=` redirect agree on. */
export const HR_SECTIONS = ['leave', 'schedule', 'payroll'] as const;
export type HrSection = (typeof HR_SECTIONS)[number];

/** Staffing-gap row shape returned by `getStaffingGaps` — duplicated here
 *  (rather than imported) because the service is loaded dynamically. */
export interface StaffingGap {
  shift: string;
  gap: number;
  requiredStaff: number;
  currentStaff: number;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Pure parser for the leave page's `?status=` (a `LeaveStatus`, not the
 *  roster active/inactive status — same query key, different page). */
export function parseLeaveStatusFromParams(params: URLSearchParams): LeaveStatus | 'all' {
  const status = params.get('status');
  return status && (LEAVE_STATUSES as string[]).includes(status) ? (status as LeaveStatus) : 'all';
}

/** Pure parser for the schedule page's `?date=YYYY-MM-DD`. Returns null when
 *  absent or malformed so the caller can fall back to today. */
export function parseScheduleDateFromParams(params: URLSearchParams): string | null {
  const date = params.get('date');
  return date && ISO_DATE_RE.test(date) ? date : null;
}

/**
 * Maps a legacy `/hr?tab=…` link onto its route. `?tab=roster` and anything
 * unrecognised return null — the roster is no longer an HR page, so the caller
 * sends those to the role's User Accounts page instead.
 */
export function sectionFromTabParam(tab: string | null | undefined): HrSection | null {
  return (HR_SECTIONS as readonly string[]).includes(tab || '') ? (tab as HrSection) : null;
}

export const staffInitials = (name: string) =>
  name.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';

/**
 * Date-only formatter for HR's `YYYY-MM-DD` fields. A bare date string parses
 * as UTC midnight, which renders as the PREVIOUS day anywhere west of
 * Greenwich, so anchor it to local midnight before formatting.
 */
export function formatHrDate(
  value?: string,
  opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' },
) {
  if (!value) return '—';
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, opts);
}

/**
 * Staff identity cell for the HR card-row lists — a tinted 40px avatar plus
 * the name/role stack, on the same `.ehr-appointment-identity` /
 * `.appointment-card-patient` classes the patient registry and User Accounts
 * rows use, so all of them share one type scale and one avatar treatment.
 *
 * `capitalizeSub` for role sublines ("front desk" → "Front Desk"); off for
 * usernames, which must keep their exact casing.
 */
export function StaffIdentity({ name, sub, capitalizeSub = false }: { name: string; sub?: string; capitalizeSub?: boolean }) {
  return (
    <div className="ehr-appointment-identity">
      <div className="ehr-patient-icon" style={avatarTint(name)}>{staffInitials(name)}</div>
      <div className="ehr-appointment-main appointment-card-patient">
        <strong>{name}</strong>
        {sub && <p className={capitalizeSub ? 'capitalize' : undefined}>{sub}</p>}
      </div>
    </div>
  );
}

/** Full-height page frame shared by the HR routes — the same card layout the
 *  tabbed page used, minus the section sidebar it no longer needs. */
export function HrPageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <section style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0, gap: 12 }}>
        {children}
      </section>
    </main>
  );
}

/**
 * Everything each HR route needs about who is looking and which facility they
 * are scoped to. Kept in one hook so the pages cannot drift on the approver
 * list or on how staff are narrowed to a facility.
 */
export function useHrContext() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { users } = useUsers();
  const { showToast } = useToast();
  const router = useRouter();

  const facilityId = currentUser?.hospitalId;
  const facilityName = currentUser?.hospitalName || t('hr.defaultFacility');
  const isApprover = !!currentUser?.role
    && ['org_admin', 'medical_superintendent', 'hospital_manager', 'super_admin'].includes(currentUser.role);

  const facilityUsers = useMemo(
    () => facilityId ? users.filter(u => u.hospitalId === facilityId) : users,
    [users, facilityId],
  );

  return { t, currentUser, users, facilityUsers, facilityId, facilityName, isApprover, showToast, router };
}

/**
 * Merge `updates` onto the current query string (deleting a key when its value
 * is null/empty) and replace history without a scroll jump. `basePath` is the
 * route doing the updating, so a filter change never bounces to another page.
 */
export function useUrlParams(basePath: string) {
  const router = useRouter();
  const searchParams = useSearchParams();
  return useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams?.toString() || '');
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') params.delete(key);
      else params.set(key, value);
    }
    const query = params.toString();
    router.replace(query ? `${basePath}?${query}` : basePath, { scroll: false });
  }, [searchParams, router, basePath]);
}

