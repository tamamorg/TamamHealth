'use client';

/**
 * Leave Requests — one of the four independent Staff & HR routes (see
 * ../hr-shared.tsx). Owns the leave queue and the request modal; approve /
 * reject mirror the facility dashboard's own decideLeave.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ClipboardList, Plus } from '@/components/icons/lucide';
import RequestLeaveDialog from '@/components/create-dialogs/RequestLeaveDialog';
import EhrListHeader from '@/components/ehr/EhrListHeader';
import RowStatusSelect from '@/components/ehr/RowStatusSelect';
import EmptyState from '@/components/EmptyState';
import FacilityKpiBand, { weekOverWeek } from '@/components/dashboards/FacilityKpiBand';
import { todayIso } from '@/lib/date-utils';
import type { LeaveRequestDoc, LeaveStatus } from '@/lib/db-types-hr';
import { useDataScope } from '@/lib/hooks/useDataScope';
import {
  HrPageShell, STATUS_TOKENS, StaffIdentity, formatHrDate,
  parseLeaveStatusFromParams, statusPillStyle, useHrContext, useUrlParams,
} from '../hr-shared';
import { roleLabel } from '@/lib/role-display';

// Columns: Staff · Leave type · Dates · Decision · Status — five, matching the
// patient registry exactly, so the template comes from `.appointment-card-flow`
// and is never restated here.

const dayCount = (days: number) => `${days} ${days === 1 ? 'day' : 'days'}`;

export default function HrLeavePage() {
  const { t, currentUser, isApprover, showToast } = useHrContext();
  const searchParams = useSearchParams();
  const updateUrlParams = useUrlParams('/hr/leave');
  const scope = useDataScope();

  const [leave, setLeave] = useState<LeaveRequestDoc[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<LeaveStatus | 'all'>(
    () => parseLeaveStatusFromParams(searchParams ?? new URLSearchParams()),
  );
  const [open, setOpen] = useState(false);
  const focusedRequestId = searchParams?.get('request') || null;

  const reload = useCallback(async () => {
    if (!scope) {
      setLeave([]);
      return;
    }
    const { getAllLeaveRequests } = await import('@/lib/services/leave-service');
    setLeave(await getAllLeaveRequests(scope));
  }, [scope]);
  useEffect(() => { reload(); }, [reload]);

  // URL is the source of truth for the status filter.
  useEffect(() => {
    setStatusFilter(parseLeaveStatusFromParams(searchParams ?? new URLSearchParams()));
  }, [searchParams]);

  // `?new=1` — open the request modal on arrival, then strip the param so a
  // refresh doesn't reopen it.
  useEffect(() => {
    if (searchParams?.get('new') !== '1') return;
    setOpen(true);
    updateUrlParams({ new: null });
  }, [searchParams, updateUrlParams]);

  const setStatusFilterAndUrl = (status: LeaveStatus | 'all') => {
    setStatusFilter(status);
    updateUrlParams({ status: status === 'all' ? null : status });
  };

  const decide = async (id: string, status: 'approved' | 'rejected') => {
    if (!currentUser) return;
    try {
      const { decideLeave } = await import('@/lib/services/leave-service');
      await decideLeave(id, {
        status,
        decidedBy: currentUser._id || currentUser.username || 'unknown',
        decidedByName: currentUser.name,
      });
      showToast(status === 'approved' ? t('hr.leaveApproved') : t('hr.leaveRejected'), 'success');
      reload();
    } catch (err) {
      console.error(err);
      showToast(status === 'approved' ? t('hr.leaveApproveFailed') : t('hr.leaveRejectFailed'), 'error');
    }
  };

  // The requester withdrawing their own pending request (cancelLeave); the
  // pill's own confirm step asks first.
  const cancelOwn = async (id: string) => {
    if (!currentUser) return;
    try {
      const { cancelLeave } = await import('@/lib/services/leave-service');
      const saved = await cancelLeave(id, { id: currentUser._id || currentUser.username || 'unknown', name: currentUser.name });
      if (!saved || saved.status !== 'cancelled') throw new Error('not cancelled');
      showToast(t('hr.leaveCancelled'), 'success');
      reload();
    } catch (err) {
      console.error(err);
      showToast(t('hr.leaveCancelFailed'), 'error');
    }
  };

  const q = search.trim().toLowerCase();
  const visibleLeave = leave.filter(r => {
    if (focusedRequestId) return r._id === focusedRequestId;
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (!q) return true;
    return `${r.userName} ${r.role} ${r.leaveType} ${r.status}`.toLowerCase().includes(q);
  });

  useEffect(() => {
    if (!focusedRequestId || leave.length === 0) return;
    const row = document.getElementById(`leave-request-${focusedRequestId}`);
    row?.scrollIntoView({ block: 'nearest' });
    row?.focus({ preventScroll: true });
  }, [focusedRequestId, leave.length]);

  const today = todayIso();
  const pending = leave.filter(r => r.status === 'pending');
  const approved = leave.filter(r => r.status === 'approved' || r.status === 'taken');
  const awayToday = leave.filter(r => r.status === 'approved' && r.startDate <= today && r.endDate >= today);

  return (
    <HrPageShell>
      <FacilityKpiBand tiles={[
        { key: 'pending', label: t('hr.kpiLeavePending'), value: pending.length, detail: pending.length ? t('hr.kpiLeavePendingDetail', { days: pending.reduce((n, r) => n + r.days, 0) }) : t('hr.kpiLeaveNonePending'), warn: pending.length > 0, trend: weekOverWeek(leave, r => r.requestedAt, t('hr.kpiLeaveRequested'), 'up', t) },
        { key: 'approved', label: t('hr.kpiLeaveApproved'), value: approved.length, detail: t('hr.kpiLeaveTaken', { count: leave.filter(r => r.status === 'taken').length }) },
        { key: 'rejected', label: t('hr.kpiLeaveRejected'), value: leave.filter(r => r.status === 'rejected').length, detail: t('hr.kpiLeaveOutOf', { count: leave.length }) },
        { key: 'away', label: t('hr.kpiLeaveAway'), value: awayToday.length, detail: awayToday.length ? (awayToday.length > 2 ? t('hr.kpiLeaveAwayMore', { names: awayToday.map(r => r.userName).slice(0, 2).join(', '), count: awayToday.length - 2 }) : awayToday.map(r => r.userName).join(', ')) : t('hr.kpiLeaveNoneAway') },
      ]} />
      <div className="card-elevated overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }} data-tour="hr-leave-list">
        <EhrListHeader
          title={t('ui.leaveRequests')}
          count={leave.length}
          search={{ value: search, onChange: setSearch, placeholder: 'Search leave requests…', ariaLabel: 'Search leave requests' }}
          actions={
            <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
              <Plus className="w-4 h-4" /> {t('hr.requestLeave')}
            </button>
          }
        />
        {/* The patient registry's list, exactly: the same surface + flow
            wrappers, so the column template, 14px gutters and 16px side inset
            all come from `.appointment-card-flow` rather than being restated
            here. Five columns and no actions gutter — the row's actions live
            in its status pill. */}
        <div className="appointment-card-surface patients-list-surface">
          <div className="appointment-card-flow">
            {/* The column head is the queue's frame, not a label for the rows
                that happen to be loaded: it stays put when a filter matches
                nothing, so the list never collapses into a bare message. */}
            <div className="appointment-card-head" aria-hidden="true">
              <span>{t('hr.colStaff')}</span>
              <span>{t('hr.labelType')}</span>
              <span>{t('facilityQueue.detailDates')}</span>
              <span>{t('ui.decision')}</span>
              <span>{t('hr.colStatus')}</span>
            </div>
            {visibleLeave.length === 0 && (
              <EmptyState
                icon={ClipboardList}
                title={leave.length === 0 ? 'No leave requests yet' : 'No matching leave requests'}
                message={
                  leave.length === 0
                    ? `${t('hr.noLeaveRequestsYet')} ${t('hr.requestLeave')} ${t('hr.above')}`
                    : search
                      ? `No leave requests match "${search}".`
                      : 'No leave requests match the selected status.'
                }
                action={
                  leave.length === 0
                    ? { label: t('hr.requestLeave'), onClick: () => setOpen(true) }
                    : { label: 'Clear filters', onClick: () => { setSearch(''); setStatusFilterAndUrl('all'); } }
                }
              />
            )}
            {visibleLeave.map(r => {
              const tok = STATUS_TOKENS[r.status];
              return (
                <div
                  key={r._id}
                  id={`leave-request-${r._id}`}
                  tabIndex={focusedRequestId === r._id ? 0 : undefined}
                  aria-current={focusedRequestId === r._id ? 'true' : undefined}
                  className="ehr-appointment-row appointment-card-row"
                  style={{
                    cursor: 'default',
                    background: focusedRequestId === r._id ? 'var(--overlay-subtle)' : undefined,
                    outline: focusedRequestId === r._id ? '2px solid var(--accent-primary)' : undefined,
                    outlineOffset: focusedRequestId === r._id ? -2 : undefined,
                  }}
                >
                  <StaffIdentity name={r.userName} sub={roleLabel(r.role)} capitalizeSub />

                  {/* Leave type — value + the requester's own words. */}
                  <div className="appointment-card-provider">
                    <strong className="capitalize">{t(`hr.leaveType_${r.leaveType}`)}</strong>
                    <span title={r.reason || undefined}>{r.reason ? `“${r.reason}”` : 'No reason given'}</span>
                  </div>

                  {/* Dates — the span, with its length underneath. */}
                  <div className="ehr-appointment-time">
                    <strong>{formatHrDate(r.startDate, { month: 'short', day: 'numeric' })} → {formatHrDate(r.endDate)}</strong>
                    <span>{dayCount(r.days)}</span>
                  </div>

                  {/* Decision — who ruled on it, and any note they left. */}
                  <div className="appointment-card-provider">
                    <strong>{r.decidedByName || 'Awaiting decision'}</strong>
                    <span title={r.decisionNotes || undefined}>
                      {r.decisionNotes
                        ? t('hr.noteLabel', { note: r.decisionNotes })
                        : r.decidedAt ? `Decided ${formatHrDate(r.decidedAt)}` : 'Pending review'}
                    </span>
                  </div>

                  {/* Approve/reject are this row's only actions and they are
                      both status moves, so the pill carries them. A viewer who
                      can't decide, or a request already decided, gets the
                      plain read-only pill. */}
                  <div className="appointment-card-status">
                    <RowStatusSelect
                      label={t(`hr.leaveStatus_${r.status}`)}
                      value={r.status}
                      ariaLabel={`Leave status for ${r.userName}`}
                      subject={r.userName}
                      style={statusPillStyle(tok)}
                      options={r.status === 'pending' ? [
                        ...(isApprover ? [
                          { value: 'approved', label: t('hr.approve') },
                          { value: 'rejected', label: t('hr.reject') },
                        ] : []),
                        ...(currentUser && r.userId === currentUser._id ? [{ value: 'cancelled', label: t('hr.cancelRequest') }] : []),
                      ] : []}
                      onSelect={next => (next === 'cancelled' ? cancelOwn(r._id) : decide(r._id, next as 'approved' | 'rejected'))}
                    />
                    <small>{t('appointments.statusRequested')} {formatHrDate(r.requestedAt, { month: 'short', day: 'numeric' })}</small>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {open && (
        <RequestLeaveDialog
          onClose={() => setOpen(false)}
          onCreated={() => { setOpen(false); reload(); }}
        />
      )}
    </HrPageShell>
  );
}
