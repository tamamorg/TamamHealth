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

export const STATUS_TOKENS: Record<LeaveRequestDoc['status'], { label: string; color: string; bg: string }> = {
  pending:   { label: 'Pending',   color: 'var(--color-warning-text)', bg: 'rgba(228, 168, 75, 0.16)' },
  approved:  { label: 'Approved',  color: 'var(--color-success-text)', bg: 'rgba(27, 158, 119, 0.12)' },
  rejected:  { label: 'Rejected',  color: 'var(--color-danger-500)', bg: 'rgba(196, 69, 54, 0.14)' },
  cancelled: { label: 'Cancelled', color: '#5A7370', bg: 'rgba(90, 115, 112, 0.14)' },
  taken:     { label: 'Taken',     color: 'var(--accent-primary)', bg: 'rgba(33, 145, 208, 0.14)' },
};

export const PAYROLL_STATUS_TOKENS: Record<PayrollEntryDoc['status'], { label: string; color: string; bg: string }> = {
  draft:    { label: 'Draft',    color: '#5A7370', bg: 'rgba(90, 115, 112, 0.14)' },
  approved: { label: 'Approved', color: 'var(--accent-primary)', bg: 'rgba(33, 145, 208, 0.14)' },
  paid:     { label: 'Paid',     color: 'var(--color-success-text)', bg: 'rgba(27, 158, 119, 0.14)' },
  reversed: { label: 'Reversed', color: 'var(--color-danger-500)', bg: 'rgba(196, 69, 54, 0.14)' },
};

export const SHIFT_TYPES: StaffScheduleDoc['shiftType'][] = ['morning', 'afternoon', 'night', 'on_call'];

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

export function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return (
    <th className={`${right ? 'text-right' : 'text-left'} px-4 py-2.5`} style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-light)', background: 'var(--bg-card-solid)' }}>
      <span className="text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">{children}</span>
    </th>
  );
}

/** Staff table cell — 40px square avatar + 14/800 name + muted subline.
 *  `capitalizeSub` for role sublines ("front desk" → "Front Desk"); off for
 *  usernames, which must keep their exact casing. */
export function StaffCell({ name, sub, capitalizeSub = false }: { name: string; sub?: string; capitalizeSub?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <div className="ehr-patient-icon">{staffInitials(name)}</div>
      <div className="min-w-0">
        <div className="text-[14px] truncate" style={{ color: 'var(--ehr-text, var(--text-primary))', fontWeight: 800 }}>{name}</div>
        {sub && <div className={`text-[11px] truncate ${capitalizeSub ? 'capitalize' : ''}`.trim()} style={{ color: 'var(--text-muted)' }}>{sub}</div>}
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

