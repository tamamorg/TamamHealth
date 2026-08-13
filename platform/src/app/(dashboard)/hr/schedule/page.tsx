'use client';

/**
 * Shift Schedule — one of the four independent Staff & HR routes (see
 * ../hr-shared.tsx). Owns one day's roster of shifts plus the staffing-gap
 * banner that `?gaps=1` deep-links to.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, CalendarClock, Plus, Trash2, X } from '@/components/icons/lucide';
import Modal from '@/components/Modal';
import RowActionsMenu from '@/components/RowActionsMenu';
import EhrListHeader from '@/components/ehr/EhrListHeader';
import EmptyState from '@/components/EmptyState';
import Select from '@/components/Select';
import type { StaffScheduleDoc } from '@/lib/db-types';
import {
  HrPageShell, SHIFT_TYPES, StaffCell, Th, parseScheduleDateFromParams,
  useHrContext, useUrlParams, type StaffingGap,
} from '../hr-shared';

export default function HrSchedulePage() {
  const { t, users, facilityUsers, facilityId, facilityName, showToast } = useHrContext();
  const searchParams = useSearchParams();
  const updateUrlParams = useUrlParams('/hr/schedule');

  const [schedules, setSchedules] = useState<StaffScheduleDoc[]>([]);
  const [staffingGaps, setStaffingGaps] = useState<StaffingGap[]>([]);
  const [date, setDate] = useState(
    () => parseScheduleDateFromParams(searchParams ?? new URLSearchParams()) || new Date().toISOString().slice(0, 10),
  );
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    userId: '',
    shiftType: 'morning' as StaffScheduleDoc['shiftType'],
    shiftDate: new Date().toISOString().slice(0, 10),
    startTime: '08:00',
    endTime: '16:00',
    department: '',
    isOnCall: false,
    notes: '',
  });

  // `?gaps=1` — highlight and scroll to the staffing-gap banner.
  const gapsParam = searchParams?.get('gaps') === '1';
  const gapsRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    const { getSchedulesByDate, getStaffingGaps } = await import('@/lib/services/staff-scheduling-service');
    const [list, gaps] = await Promise.all([
      getSchedulesByDate(date, facilityId),
      getStaffingGaps(date, facilityId),
    ]);
    setSchedules(list);
    setStaffingGaps(gaps);
  }, [date, facilityId]);
  useEffect(() => { reload(); }, [reload]);

  // URL is the source of truth for the day being viewed.
  useEffect(() => {
    const next = parseScheduleDateFromParams(searchParams ?? new URLSearchParams());
    if (next) setDate(next);
  }, [searchParams]);

  // `?new=1` — open the create modal on arrival, then strip the param.
  useEffect(() => {
    if (searchParams?.get('new') !== '1') return;
    setOpen(true);
    updateUrlParams({ new: null });
  }, [searchParams, updateUrlParams]);

  useEffect(() => {
    if (gapsParam) gapsRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [gapsParam, staffingGaps]);

  const setDateAndUrl = (next: string) => {
    setDate(next);
    updateUrlParams({ date: next });
  };

  const handleAddShift = async () => {
    const user = users.find(u => u._id === form.userId);
    if (!user) { showToast(t('hr.selectStaffMember'), 'error'); return; }
    try {
      const { createSchedule } = await import('@/lib/services/staff-scheduling-service');
      await createSchedule({
        userId: user._id, userName: user.name, role: user.role,
        facilityId: user.hospitalId || facilityId || '',
        facilityName: user.hospitalName || facilityName,
        shiftType: form.shiftType,
        shiftDate: form.shiftDate,
        startTime: form.startTime,
        endTime: form.endTime,
        department: form.department || undefined,
        isOnCall: form.isOnCall,
        notes: form.notes || undefined,
        status: 'scheduled',
        orgId: user.orgId,
      });
      showToast(t('hr.shiftScheduledFor', { name: user.name, shift: form.shiftType }), 'success');
      setOpen(false);
      setForm({ ...form, userId: '', notes: '' });
      reload();
    } catch (err) {
      console.error(err);
      showToast(t('hr.scheduleCreateFailed'), 'error');
    }
  };

  const removeShift = async (id: string) => {
    try {
      const { deleteSchedule } = await import('@/lib/services/staff-scheduling-service');
      await deleteSchedule(id);
      reload();
    } catch {
      showToast(t('hr.shiftRemoveFailed'), 'error');
    }
  };

  return (
    <HrPageShell>
      <div className="dash-card overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }}>
        <EhrListHeader
          title="Shift schedule"
          stats={[
            { label: 'Shifts', value: schedules.length, color: 'var(--text-muted)' },
            { label: t('hr.shiftType_morning'), value: schedules.filter(s => s.shiftType === 'morning').length, color: 'var(--color-success)' },
            { label: t('hr.shiftType_afternoon'), value: schedules.filter(s => s.shiftType === 'afternoon').length, color: '#B8741C' },
            { label: t('hr.shiftType_night'), value: schedules.filter(s => s.shiftType === 'night').length, color: '#015697' },
            { label: t('hr.shiftType_on_call'), value: schedules.filter(s => s.shiftType === 'on_call').length, color: '#2191D0' },
          ]}
          actions={
            <>
              <input
                type="date"
                value={date}
                onChange={e => setDateAndUrl(e.target.value)}
                aria-label={t('hr.date')}
                className="listpage-toolbar-date"
                style={{ flex: 1, minWidth: 0 }}
              />
              <button type="button" className="listpage-icon-btn listpage-icon-btn-primary" onClick={() => setOpen(true)} title={t('hr.scheduleShift')} aria-label={t('hr.scheduleShift')}>
                <Plus className="w-4 h-4" color="#fff" />
              </button>
            </>
          }
        />
        {/* Staffing-gap indicators — a shortfall against the configured
            minimum per shift type, not a list of specific vacant shifts
            (this data model has no unassigned-shift record). */}
        {staffingGaps.length > 0 && (
          <div
            ref={gapsRef}
            className="mx-4 mt-3 mb-1 p-3 rounded-xl flex flex-wrap items-center gap-3"
            style={{
              background: 'rgba(196, 69, 54, 0.06)',
              border: gapsParam ? '2px solid var(--color-danger-500)' : '1px solid rgba(196, 69, 54, 0.25)',
            }}
          >
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-danger-text)' }}>
              <AlertTriangle className="w-4 h-4" />
              Staffing shortfall
            </span>
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Below the configured minimum for {date}.
            </span>
            <div className="flex flex-wrap gap-2 ml-auto">
              {staffingGaps.map(g => (
                <span
                  key={g.shift}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-lg whitespace-nowrap"
                  style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                >
                  <span className="capitalize">{t(`hr.shiftType_${g.shift}`)}</span>
                  <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>{g.currentStaff}/{g.requiredStaff}</span>
                  <span className="tabular-nums font-bold" style={{ color: 'var(--color-danger-text)' }}>(−{g.gap})</span>
                </span>
              ))}
            </div>
          </div>
        )}
        {staffingGaps.length === 0 && gapsParam && (
          <div
            ref={gapsRef}
            className="mx-4 mt-3 mb-1 p-3 rounded-xl text-[11px] font-semibold"
            style={{ background: 'rgba(27, 158, 119, 0.08)', border: '1px solid rgba(27, 158, 119, 0.3)', color: 'var(--color-success-text)' }}
          >
            Fully staffed — every shift type meets its configured minimum for {date}.
          </div>
        )}
        <div className="show-scrollbar" style={{ overflowX: 'auto', overflowY: 'auto', flex: '1 1 0%', minHeight: 0 }}>
          <table className="w-full" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <Th>{t('hr.colStaff')}</Th>
                <Th>{t('hr.labelShift')}</Th>
                <Th>Time</Th>
                <Th>{t('hr.labelDepartment')}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {SHIFT_TYPES.flatMap(shift => schedules.filter(s => s.shiftType === shift)).map(s => {
                const shiftColor = s.shiftType === 'morning' ? 'var(--color-success-text)' : s.shiftType === 'afternoon' ? '#B8741C' : s.shiftType === 'night' ? '#015697' : 'var(--accent-primary)';
                return (
                  <tr key={s._id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td className="px-4 py-2.5"><StaffCell name={s.userName} sub={s.role.replace(/_/g, ' ')} /></td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-[13px] capitalize" style={{ color: 'var(--ehr-muted, var(--text-secondary))' }}>
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: shiftColor }} />
                        {t(`hr.shiftType_${s.shiftType}`)}
                        {s.isOnCall && <span className="ml-1 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: 'rgba(59, 130, 246, 0.16)', color: 'var(--accent-primary)' }}>{t('hr.onCall')}</span>}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[13px] whitespace-nowrap tabular-nums" style={{ color: 'var(--ehr-muted, var(--text-secondary))' }}>{s.startTime}–{s.endTime}</td>
                    <td className="px-4 py-2.5 text-[13px]" style={{ color: 'var(--ehr-muted, var(--text-secondary))' }}>{s.department || '—'}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end">
                        <RowActionsMenu
                          actions={[
                            { key: 'remove', label: t('hr.removeShift'), tone: 'danger', icon: <Trash2 className="w-4 h-4" />, onClick: () => removeShift(s._id) },
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {schedules.length === 0 && (
            <EmptyState
              icon={CalendarClock}
              title="No shifts scheduled"
              message={`${t('hr.noShiftsScheduled', { date })} ${t('hr.scheduleShift')} ${t('hr.aboveToAddOne')}`}
              action={{ label: 'Create shift', onClick: () => setOpen(true) }}
            />
          )}
        </div>
      </div>

      {open && (
        <Modal onClose={() => setOpen(false)}>
          <div className="modal-content card-elevated p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold">{t('hr.scheduleShift')}</h3>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }} title="Close" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelStaffRequired')}</label>
                <Select value={form.userId} onChange={e => setForm({ ...form, userId: e.target.value })}>
                  <option value="">{t('hr.selectStaffOption')}</option>
                  {facilityUsers.map(u => (
                    <option key={u._id} value={u._id}>{u.name} ({u.role.replace(/_/g, ' ')})</option>
                  ))}
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelShift')}</label>
                  <Select value={form.shiftType} onChange={e => setForm({ ...form, shiftType: e.target.value as StaffScheduleDoc['shiftType'] })}>
                    {SHIFT_TYPES.map(s => <option key={s} value={s} className="capitalize">{t(`hr.shiftType_${s}`)}</option>)}
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.date')}</label>
                  <input type="date" value={form.shiftDate} onChange={e => setForm({ ...form, shiftDate: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelStart')}</label>
                  <input type="time" value={form.startTime} onChange={e => setForm({ ...form, startTime: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelEnd')}</label>
                  <input type="time" value={form.endTime} onChange={e => setForm({ ...form, endTime: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelDepartment')}</label>
                <input value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} placeholder={t('hr.departmentPlaceholder')} />
              </div>
              <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-primary)' }}>
                <input type="checkbox" checked={form.isOnCall} onChange={e => setForm({ ...form, isOnCall: e.target.checked })} />
                {t('hr.onCallShift')}
              </label>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelNotes')}</label>
                <textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
            <hr className="section-divider" />
            <div className="flex gap-2 mt-2">
              <button onClick={() => setOpen(false)} className="btn btn-secondary flex-1">{t('hr.cancel')}</button>
              <button onClick={handleAddShift} className="btn btn-primary flex-1">{t('hr.saveShift')}</button>
            </div>
          </div>
        </Modal>
      )}
    </HrPageShell>
  );
}
