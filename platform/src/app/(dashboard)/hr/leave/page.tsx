'use client';

/**
 * Leave Requests — one of the four independent Staff & HR routes (see
 * ../hr-shared.tsx). Owns the leave queue and the request modal; approve /
 * reject mirror the facility dashboard's own decideLeave.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ClipboardList, Plus } from '@/components/icons/lucide';
import RowActionsMenu from '@/components/RowActionsMenu';
import RequestLeaveDialog from '@/components/create-dialogs/RequestLeaveDialog';
import EhrListHeader, { EhrListFilters } from '@/components/ehr/EhrListHeader';
import EmptyState from '@/components/EmptyState';
import Select from '@/components/Select';
import type { LeaveRequestDoc, LeaveStatus } from '@/lib/db-types-hr';
import {
  HrPageShell, LEAVE_STATUSES, STATUS_TOKENS, StaffCell, Th,
  parseLeaveStatusFromParams, useHrContext, useUrlParams,
} from '../hr-shared';

export default function HrLeavePage() {
  const { t, currentUser, isApprover, showToast } = useHrContext();
  const searchParams = useSearchParams();
  const updateUrlParams = useUrlParams('/hr/leave');

  const [leave, setLeave] = useState<LeaveRequestDoc[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<LeaveStatus | 'all'>(
    () => parseLeaveStatusFromParams(searchParams ?? new URLSearchParams()),
  );
  const [open, setOpen] = useState(false);

  const reload = useCallback(async () => {
    const { getAllLeaveRequests } = await import('@/lib/services/leave-service');
    setLeave(await getAllLeaveRequests());
  }, []);
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
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (!q) return true;
    return `${r.userName} ${r.role} ${r.leaveType} ${r.status}`.toLowerCase().includes(q);
  });

  return (
    <HrPageShell>
      <div className="dash-card overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }}>
        <EhrListHeader
          title="Leave requests"
          stats={[
            { label: 'Total', value: leave.length, color: 'var(--text-muted)' },
            { label: 'Pending', value: leave.filter(r => r.status === 'pending').length, color: '#B8741C' },
            { label: 'Approved', value: leave.filter(r => r.status === 'approved').length, color: 'var(--color-success)' },
            { label: 'Rejected', value: leave.filter(r => r.status === 'rejected').length, color: 'var(--color-danger)' },
          ]}
          search={{ value: search, onChange: setSearch, placeholder: 'Search leave requests…', ariaLabel: 'Search leave requests' }}
          actions={
            <>
              <EhrListFilters activeCount={statusFilter !== 'all' ? 1 : 0} onClear={() => setStatusFilterAndUrl('all')}>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.colStatus')}</label>
                  <Select
                    value={statusFilter}
                    onChange={e => setStatusFilterAndUrl(e.target.value as LeaveStatus | 'all')}
                    aria-label={t('hr.colStatus')}
                  >
                    <option value="all">All statuses</option>
                    {LEAVE_STATUSES.map(s => (
                      <option key={s} value={s}>{t(`hr.leaveStatus_${s}`)}</option>
                    ))}
                  </Select>
                </div>
              </EhrListFilters>
              <button type="button" className="listpage-icon-btn listpage-icon-btn-primary" onClick={() => setOpen(true)} title={t('hr.requestLeave')} aria-label={t('hr.requestLeave')}>
                <Plus className="w-4 h-4" color="#fff" />
              </button>
            </>
          }
        />
        <div className="show-scrollbar" style={{ overflowX: 'auto', overflowY: 'auto', flex: '1 1 0%', minHeight: 0 }}>
          <table className="w-full" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <Th>{t('hr.colStaff')}</Th>
                <Th>{t('hr.labelType')}</Th>
                <Th>Dates</Th>
                <Th right>Days</Th>
                <Th>{t('hr.colStatus')}</Th>
                {isApprover && <Th />}
              </tr>
            </thead>
            <tbody>
              {visibleLeave.map(r => {
                const tok = STATUS_TOKENS[r.status];
                return (
                  <tr key={r._id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td className="px-4 py-2.5"><StaffCell name={r.userName} sub={r.role.replace(/_/g, ' ')} /></td>
                    <td className="px-4 py-2.5">
                      <div className="text-[13px] capitalize" style={{ color: 'var(--ehr-muted, var(--text-secondary))' }}>{t(`hr.leaveType_${r.leaveType}`)}</div>
                      {r.reason && <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)', maxWidth: 220 }} title={r.reason}>“{r.reason}”</div>}
                    </td>
                    <td className="px-4 py-2.5 text-[13px] whitespace-nowrap" style={{ color: 'var(--ehr-muted, var(--text-secondary))' }}>{r.startDate} → {r.endDate}</td>
                    <td className="px-4 py-2.5 text-[13px] text-right tabular-nums" style={{ color: 'var(--ehr-muted, var(--text-secondary))' }}>{r.days}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-md whitespace-nowrap"
                        style={{ background: tok.bg, color: tok.color, border: `1px solid ${tok.color}40` }}
                        title={r.decisionNotes ? t('hr.noteLabel', { note: r.decisionNotes }) : undefined}
                      >
                        {t(`hr.leaveStatus_${r.status}`)}
                      </span>
                    </td>
                    {isApprover && (
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end">
                          {r.status === 'pending' && (
                            <RowActionsMenu
                              actions={[
                                { key: 'approve', label: t('hr.approve'), tone: 'success', onClick: () => decide(r._id, 'approved') },
                                { key: 'reject', label: t('hr.reject'), tone: 'danger', onClick: () => decide(r._id, 'rejected') },
                              ]}
                            />
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
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
