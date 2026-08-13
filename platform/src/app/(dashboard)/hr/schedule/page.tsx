'use client';

/**
 * Shift Schedule — one of the four independent Staff & HR routes (see
 * ../hr-shared.tsx). Owns one day's roster of shifts plus the staffing-gap
 * banner that `?gaps=1` deep-links to.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, CalendarClock, Plus, Trash2 } from '@/components/icons/lucide';
import RowActionsMenu from '@/components/RowActionsMenu';
import CreateShiftDialog from '@/components/create-dialogs/CreateShiftDialog';
import EhrListHeader from '@/components/ehr/EhrListHeader';
import EmptyState from '@/components/EmptyState';
import type { StaffScheduleDoc } from '@/lib/db-types';
import {
  HrPageShell, SHIFT_TYPES, StaffCell, Th, parseScheduleDateFromParams,
  useHrContext, useUrlParams, type StaffingGap,
} from '../hr-shared';

export default function HrSchedulePage() {
  const { t, facilityId, showToast } = useHrContext();
  const searchParams = useSearchParams();
  const updateUrlParams = useUrlParams('/hr/schedule');

  const [schedules, setSchedules] = useState<StaffScheduleDoc[]>([]);
  const [staffingGaps, setStaffingGaps] = useState<StaffingGap[]>([]);
  const [date, setDate] = useState(
    () => parseScheduleDateFromParams(searchParams ?? new URLSearchParams()) || new Date().toISOString().slice(0, 10),
  );
  const [open, setOpen] = useState(false);

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
        <CreateShiftDialog
          onClose={() => setOpen(false)}
          defaultDate={date}
          onCreated={shiftDate => {
            setOpen(false);
            // Jump to the day the shift actually landed on, so a shift booked
            // for another date is visible rather than silently filtered out.
            if (shiftDate !== date) setDateAndUrl(shiftDate); else reload();
          }}
        />
      )}
    </HrPageShell>
  );
}
