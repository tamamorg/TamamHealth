'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users, Plus, Calendar, Activity, Wallet, Check, X } from '@/components/icons/lucide';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useUsers } from '@/lib/hooks/useUsers';
import { useToast } from '@/components/Toast';
import EhrCareDashboard, { type EhrCareDashboardRow } from '@/components/ehr/EhrCareDashboard';
import { type DayStatsItem } from '@/components/ehr/EhrDayStatsChart';
import { formatDateTitle, toIsoDate } from '@/components/ehr/EhrMiniCalendar';
import type { LeaveRequestDoc } from '@/lib/db-types-hr';
import type { StaffScheduleDoc } from '@/lib/db-types';

/**
 * HR home — Records & people-ops landing page for HRIO and medical
 * superintendents. Surfaces today's roster status + the queue of
 * pending leave decisions so the day starts with action items, not
 * a wall of charts. Rendered on the shared EhrCareDashboard shell so
 * it matches the Clinical Officer / Lab / Radiology look.
 */
function formatClockTimeOrUndefined(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}
function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
export default function HRDashboardPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { users } = useUsers();
  const { showToast } = useToast();
  // Same approver role list as the full HR page's leave tab — who can act on
  // a pending leave request from this dashboard's queue.
  const isApprover = !!currentUser?.role && ['org_admin', 'medical_superintendent', 'hospital_manager', 'super_admin'].includes(currentUser.role);
  const [leave, setLeave] = useState<LeaveRequestDoc[]>([]);
  const [schedules, setSchedules] = useState<StaffScheduleDoc[]>([]);
  const [loading, setLoading] = useState(true);
  // Single work list (pending leave decisions) rendered as shell rows; the tab
  // is kept as state so the shared shell's tab bar stays interactive.
  const [leaveTab, setLeaveTab] = useState('pending');
  const [staffSearch, setStaffSearch] = useState('');

  const today = new Date().toISOString().slice(0, 10);
  const facilityId = currentUser?.hospitalId;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ getAllLeaveRequests }, { getSchedulesByDate }] = await Promise.all([
          import('@/lib/services/leave-service'),
          import('@/lib/services/staff-scheduling-service'),
        ]);
        const [l, s] = await Promise.all([
          getAllLeaveRequests(),
          getSchedulesByDate(today, facilityId),
        ]);
        if (cancelled) return;
        setLeave(l);
        setSchedules(s);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [today, facilityId]);

  const facilityUsers = useMemo(
    () => facilityId ? users.filter(u => u.hospitalId === facilityId) : users,
    [users, facilityId],
  );

  const pendingLeave = leave.filter(l => l.status === 'pending');
  const onLeaveToday = leave.filter(l =>
    l.status === 'approved' && l.startDate <= today && l.endDate >= today
  );
  const presentToday = facilityUsers.length - onLeaveToday.length;
  const onCallToday = schedules.filter(s => s.isOnCall).length;

  const dateLabel = formatDateTitle(toIsoDate(new Date()));

  // Day statistics rail: the visible work list is pending-only (that's the
  // point of the queue), so it can never show a Pending/Approved split on its
  // own. Built instead from the full `leave` array — pending requests plotted
  // at when they were submitted, approved ones at when the decision was made —
  // so the widget reflects the real decision pipeline instead of an
  // always-empty second series.
  const hrChartItems = useMemo<DayStatsItem[]>(() => leave.flatMap((r): DayStatsItem[] => {
    if (r.status === 'pending') {
      return [{ date: r.requestedAt.slice(0, 10), time: formatClockTimeOrUndefined(r.requestedAt), series: 0 }];
    }
    if (r.status === 'approved' && r.decidedAt) {
      return [{ date: r.decidedAt.slice(0, 10), time: formatClockTimeOrUndefined(r.decidedAt), series: 1 }];
    }
    return [];
  }), [leave]);

  // Search filters the pending-decisions work list by staff name / role / type.
  const query = staffSearch.trim().toLowerCase();
  const filteredPending = query
    ? pendingLeave.filter(r =>
        (r.userName || '').toLowerCase().includes(query) ||
        (r.role || '').toLowerCase().includes(query) ||
        (r.leaveType || '').toLowerCase().includes(query))
    : pendingLeave;

  // Approve/reject a pending leave request directly from the dashboard queue.
  // Mirrors the full HR page's `decideLeave` (src/app/(dashboard)/hr/page.tsx)
  // so this dashboard can act on the queue it surfaces, not just link out to it.
  const decideLeaveAction = async (id: string, status: 'approved' | 'rejected') => {
    if (!currentUser) return;
    try {
      const { decideLeave } = await import('@/lib/services/leave-service');
      const decidedAt = new Date().toISOString();
      await decideLeave(id, {
        status,
        decidedBy: currentUser._id,
        decidedByName: currentUser.name,
      });
      setLeave(prev => prev.map(l => l._id === id
        ? { ...l, status, decidedAt, decidedBy: currentUser._id, decidedByName: currentUser.name }
        : l));
      showToast(status === 'approved' ? t('hr.leaveApproved') : t('hr.leaveRejected'), 'success');
    } catch (err) {
      console.error('Failed to decide leave request', err);
      showToast(status === 'approved' ? t('hr.leaveApproveFailed') : t('hr.leaveRejectFailed'), 'error');
    }
  };

  // Per-row detail shown inline via `row.popupDetail` (EhrCareDashboard's
  // shared expand-in-place panel). Leave type, dates and role are already on
  // the row above (subtitle / care-team / status columns), so this only adds
  // what the row has no room for — the stated reason — plus the approve/
  // reject actions for approvers, as top-right icon buttons matching the
  // Clinical Officer visit panel (EhrVisitPopup).
  const renderLeaveDetail = (r: LeaveRequestDoc) => (
    <div className="ehr-visit-pop ehr-visit-pop--inline">
      {isApprover && r.status === 'pending' && (
        <div className="ehr-visit-pop-tabs">
          <div className="ehr-visit-pop-actions">
            <button
              type="button"
              className="ehr-visit-pop-icon is-primary"
              aria-label={t('hr.approve')}
              title={t('hr.approve')}
              onClick={() => decideLeaveAction(r._id, 'approved')}
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              type="button"
              className="ehr-visit-pop-icon"
              aria-label={t('hr.reject')}
              title={t('hr.reject')}
              onClick={() => decideLeaveAction(r._id, 'rejected')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
      <div className="ehr-visit-pop-body">
        <div className="ehr-visit-pop-row">
          {/* Not translated: this is the one field the row above has no room
              for, and no i18n key exists for it yet — match the demo-string
              precedent elsewhere on this page rather than add one everywhere. */}
          <span className="ehr-visit-pop-label">Reason</span>
          <div>
            <p>{r.reason || 'No reason given'}</p>
          </div>
        </div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 320, color: 'var(--text-muted)' }}>
          <Activity size={44} style={{ marginRight: 8, animation: 'spin 1s linear infinite' }} />
          <span>{t('hr.loadingData')}</span>
        </div>
      </main>
    );
  }

  return (
    <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <EhrCareDashboard
        title={t('hr.dashboardTitle')}
        greetingName={currentUser?.name}
        dateLabel={dateLabel}
        centerTitle={t('hr.pendingLeaveDecisions')}
        tabs={[
          { key: 'pending', label: t('hr.kpiPendingDecisions'), count: pendingLeave.length },
        ]}
        // A leave request stays pending across days; its row carries the date
        // it was REQUESTED, so day-scoping showed only requests filed today
        // while the tab counted every open one.
        filterRowsByDate={false}
        activeTab={leaveTab}
        onTabChange={setLeaveTab}
        searchValue={staffSearch}
        searchPlaceholder={t('topbar.searchPlaceholder')}
        onSearchChange={setStaffSearch}
        filters={[]}
        actions={[
          { label: t('hr.manageStaff'), icon: Users, onClick: () => router.push('/hr') },
          { label: t('hr.newLeaveRequest'), icon: Plus, onClick: () => router.push('/hr?tab=leave'), tone: 'primary' },
        ]}
        chartSeriesNames={['Pending', 'Approved']}
        chartItems={hrChartItems}
        rows={filteredPending.map((r): EhrCareDashboardRow => {
          const time = formatClockTimeOrUndefined(r.requestedAt);
          return {
            id: r._id,
            title: r.userName,
            subtitle: `${r.leaveType} · ${r.days}d · ${r.startDate} → ${r.endDate}`,
            compactMeta: `${r.days}d`,
            time,
            date: r.requestedAt.slice(0, 10),
            timeSecondary: r.requestedAt.slice(0, 10),
            careTeam: r.role ? titleCase(r.role) : undefined,
            careTeamLabel: 'Role',
            location: r.facilityName,
            locationSecondary: `${r.startDate} → ${r.endDate}`,
            locationLabel: 'Facility',
            status: r.status,
            statusLabel: titleCase(r.leaveType),
            statusSecondary: `${r.days} day${r.days === 1 ? '' : 's'}`,
            statusTone: 'warning',
            popupDetail: renderLeaveDetail(r),
          };
        })}
        metrics={[
          { label: t('hr.kpiActiveStaff'), value: facilityUsers.length },
          { label: t('hr.kpiPresentToday'), value: presentToday, tone: 'success' },
          { label: t('hr.kpiOnLeaveToday'), value: onLeaveToday.length, tone: onLeaveToday.length > 0 ? 'warning' : 'neutral' },
          { label: t('hr.kpiOnCallToday'), value: onCallToday },
        ]}
        metricsTitle={t('hr.dashboardTitle')}
        metricsActions={[
          { label: t('hr.scheduleShifts'), icon: Calendar, onClick: () => router.push('/hr?tab=schedule') },
          { label: t('hr.payrollRegister'), icon: Wallet, onClick: () => router.push('/hr?tab=payroll') },
        ]}
        emptyTitle={t('hr.noPendingLeave')}
        emptyActionLabel={t('hr.viewAll')}
        onEmptyAction={() => router.push('/hr?tab=leave')}
      />
    </main>
  );
}
