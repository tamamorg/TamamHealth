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
import EhrListHeader, { EhrListHeaderButton } from '@/components/ehr/EhrListHeader';
import RowStatusSelect from '@/components/ehr/RowStatusSelect';
import EmptyState from '@/components/EmptyState';
import type { LeaveRequestDoc, LeaveStatus } from '@/lib/db-types-hr';
import { useDataScope } from '@/lib/hooks/useDataScope';
import {
  HrPageShell, STATUS_TOKENS, StaffIdentity, formatHrDate,
  parseLeaveStatusFromParams, statusPillStyle, useHrContext, useUrlParams,
} from '../hr-shared';

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

  return (
    <HrPageShell>
      <div className="card-elevated overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }} data-tour="hr-leave-list">
        <EhrListHeader
          title="Leave requests"
          count={leave.length}
          stats={[
            { label: 'Pending', value: leave.filter(r => r.status === 'pending').length, color: 'var(--color-warning-text)' },
            { label: 'Approved', value: leave.filter(r => r.status === 'approved').length, color: 'var(--color-success)' },
            { label: 'Rejected', value: leave.filter(r => r.status === 'rejected').length, color: 'var(--color-danger)' },
          ]}
          search={{ value: search, onChange: setSearch, placeholder: 'Search leave requests…', ariaLabel: 'Search leave requests' }}
          actions={
            <>
              <EhrListHeaderButton primary onClick={() => setOpen(true)} ariaLabel={t('hr.requestLeave')}>
                <Plus className="w-4 h-4" color="#fff" />
              </EhrListHeaderButton>
            </>
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
              <span>Dates</span>
              <span>Decision</span>
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
                  <StaffIdentity name={r.userName} sub={r.role.replace(/_/g, ' ')} capitalizeSub />

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
                      style={statusPillStyle(tok)}
                      options={isApprover && r.status === 'pending' ? [
                        { value: 'approved', label: t('hr.approve') },
                        { value: 'rejected', label: t('hr.reject') },
                      ] : []}
                      onSelect={next => decide(r._id, next as 'approved' | 'rejected')}
                    />
                    <small>Requested {formatHrDate(r.requestedAt, { month: 'short', day: 'numeric' })}</small>
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
