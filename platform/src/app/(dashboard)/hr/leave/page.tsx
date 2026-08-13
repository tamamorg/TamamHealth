'use client';

/**
 * Leave Requests — one of the four independent Staff & HR routes (see
 * ../hr-shared.tsx). Owns the leave queue and the request modal; approve /
 * reject mirror the facility dashboard's own decideLeave.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ClipboardList, Plus, X } from '@/components/icons/lucide';
import Modal from '@/components/Modal';
import RowActionsMenu from '@/components/RowActionsMenu';
import EhrListHeader, { EhrListFilters } from '@/components/ehr/EhrListHeader';
import EmptyState from '@/components/EmptyState';
import Select from '@/components/Select';
import type { LeaveRequestDoc, LeaveStatus, LeaveType } from '@/lib/db-types-hr';
import {
  HrPageShell, LEAVE_STATUSES, LEAVE_TYPES, STATUS_TOKENS, StaffCell, Th,
  parseLeaveStatusFromParams, useHrContext, useUrlParams,
} from '../hr-shared';

export default function HrLeavePage() {
  const { t, currentUser, users, facilityId, facilityName, isApprover, showToast } = useHrContext();
  const searchParams = useSearchParams();
  const updateUrlParams = useUrlParams('/hr/leave');

  const [leave, setLeave] = useState<LeaveRequestDoc[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<LeaveStatus | 'all'>(
    () => parseLeaveStatusFromParams(searchParams ?? new URLSearchParams()),
  );
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    userId: '', leaveType: 'annual' as LeaveType,
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    reason: '',
  });

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

  const handleRequestLeave = async () => {
    if (!form.userId) { showToast(t('hr.selectStaffMember'), 'error'); return; }
    if (form.endDate < form.startDate) { showToast(t('hr.endDateAfterStart'), 'error'); return; }
    const user = users.find(u => u._id === form.userId);
    if (!user) return;
    try {
      const { requestLeave } = await import('@/lib/services/leave-service');
      await requestLeave({
        userId: user._id, userName: user.name, role: user.role,
        facilityId: user.hospitalId || facilityId || '',
        facilityName: user.hospitalName || facilityName,
        leaveType: form.leaveType,
        startDate: form.startDate, endDate: form.endDate,
        reason: form.reason.trim() || undefined,
        orgId: user.orgId,
      });
      showToast(t('hr.leaveSubmittedFor', { name: user.name }), 'success');
      setOpen(false);
      setForm({ userId: '', leaveType: 'annual', startDate: new Date().toISOString().slice(0, 10), endDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10), reason: '' });
      reload();
    } catch (err) {
      console.error(err);
      showToast(t('hr.leaveSubmitFailed'), 'error');
    }
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
        <Modal onClose={() => setOpen(false)}>
          <div className="modal-content card-elevated p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold">{t('hr.requestLeave')}</h3>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }} title="Close" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelStaffRequired')}</label>
                <Select value={form.userId} onChange={e => setForm({ ...form, userId: e.target.value })}>
                  <option value="">{t('hr.selectStaffOption')}</option>
                  {(isApprover ? users : users.filter(u => u._id === currentUser?._id)).map(u => (
                    <option key={u._id} value={u._id}>{u.name} ({u.role.replace(/_/g, ' ')})</option>
                  ))}
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelType')}</label>
                  <Select value={form.leaveType} onChange={e => setForm({ ...form, leaveType: e.target.value as LeaveType })}>
                    {LEAVE_TYPES.map(lt => <option key={lt.id} value={lt.id}>{t(`hr.leaveType_${lt.id}`)}</option>)}
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelStart')}</label>
                  <input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelEnd')}</label>
                  <input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelReason')}</label>
                <textarea rows={2} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder={t('hr.optional')} />
              </div>
            </div>
            <hr className="section-divider" />
            <div className="flex gap-2 mt-2">
              <button onClick={() => setOpen(false)} className="btn btn-secondary flex-1">{t('hr.cancel')}</button>
              <button onClick={handleRequestLeave} className="btn btn-primary flex-1">{t('hr.submit')}</button>
            </div>
          </div>
        </Modal>
      )}
    </HrPageShell>
  );
}
