'use client';

/**
 * Shift Schedule — one of the four independent Staff & HR routes (see
 * ../hr-shared.tsx). Owns one day's roster of shifts plus the staffing-gap
 * banner that `?gaps=1` deep-links to.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CalendarClock, Plus } from '@/components/icons/lucide';
import CreateShiftDialog from '@/components/create-dialogs/CreateShiftDialog';
import EhrListHeader from '@/components/ehr/EhrListHeader';
import RowStatusSelect from '@/components/ehr/RowStatusSelect';
import EmptyState from '@/components/EmptyState';
import InlineBanner from '@/components/overlay/InlineBanner';
import FacilityKpiBand from '@/components/dashboards/FacilityKpiBand';
import type { StaffScheduleDoc } from '@/lib/db-types';
import { todayIso } from '@/lib/date-utils';
import {
  HrPageShell, SCHEDULE_STATUS_TOKENS, SHIFT_TOKENS, SHIFT_TYPES, StaffIdentity,
  formatHrDate, parseScheduleDateFromParams, shiftDuration, statusPillStyle,
  useHrContext, useUrlParams, type StaffingGap,
} from '../hr-shared';
import { roleLabel } from '@/lib/role-display';

// Columns: Staff · Shift · Time · Department · Status — five, matching the
// patient registry exactly, so the template comes from `.appointment-card-flow`
// and is never restated here.

/** Sentinel for the one row action that isn't a status move. */
const REMOVE_SHIFT = '__remove';

/** Lifecycle rungs offered by a row's status pill, in ladder order. */
const SCHEDULE_STATUS_OPTIONS: StaffScheduleDoc['status'][] = ['scheduled', 'confirmed', 'completed', 'absent', 'swapped'];

export default function HrSchedulePage() {
  const { t, facilityId, showToast } = useHrContext();
  const searchParams = useSearchParams();
  const updateUrlParams = useUrlParams('/hr/schedule');

  const [schedules, setSchedules] = useState<StaffScheduleDoc[]>([]);
  const [staffingGaps, setStaffingGaps] = useState<StaffingGap[]>([]);
  const [date, setDate] = useState(
    () => parseScheduleDateFromParams(searchParams ?? new URLSearchParams()) || todayIso(),
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

  const setShiftStatus = async (id: string, status: StaffScheduleDoc['status']) => {
    try {
      const { updateSchedule } = await import('@/lib/services/staff-scheduling-service');
      await updateSchedule(id, { status });
      reload();
    } catch {
      showToast(t('hr.shiftStatusFailed'), 'error');
    }
  };

  const shiftCount = (type: string) => schedules.filter(s => s.shiftType === type).length;
  const shortBy = staffingGaps.reduce((n, g) => n + g.gap, 0);

  return (
    <HrPageShell>
      <FacilityKpiBand tiles={[
        { key: 'shifts', label: 'Shifts', value: schedules.length, detail: SHIFT_TYPES.map(type => `${shiftCount(type)} ${t(`hr.shiftType_${type}`).toLowerCase()}`).join(' · ') },
        { key: 'confirmed', label: 'Confirmed', value: schedules.filter(s => s.status === 'confirmed' || s.status === 'completed').length, detail: `Out of ${schedules.length} on ${date}` },
        { key: 'oncall', label: 'On call', value: schedules.filter(s => s.isOnCall).length, detail: 'Staff covering on call' },
        { key: 'gap', label: 'Short staffed', value: shortBy, detail: staffingGaps.length ? `Below minimum on ${staffingGaps.length} of ${SHIFT_TYPES.length} shift types` : 'Every shift type meets its minimum', warn: staffingGaps.length > 0 },
      ]} />
      <div className="card-elevated overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }} data-tour="hr-schedule-list">
        <EhrListHeader
          title="Shift schedule"
          count={schedules.length}
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
              <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
                <Plus className="w-4 h-4" /> {t('hr.scheduleShift')}
              </button>
            </>
          }
        />
        {/* Staffing-gap indicators — a shortfall against the configured
            minimum per shift type, not a list of specific vacant shifts
            (this data model has no unassigned-shift record). */}
        {staffingGaps.length > 0 && (
          <div ref={gapsRef} className="mx-4 mt-3 mb-1" style={gapsParam ? { outline: '2px solid var(--color-danger-500)', outlineOffset: 2 } : undefined}>
            <InlineBanner tone="warning" title="Staffing shortfall">
              {staffingGaps.map(g => { const name = t(`hr.shiftType_${g.shift}`); return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${g.currentStaff} of ${g.requiredStaff} (short by ${g.gap})`; }).join(' · ')}
            </InlineBanner>
          </div>
        )}
        {staffingGaps.length === 0 && gapsParam && (
          <div ref={gapsRef} className="mx-4 mt-3 mb-1">
            <InlineBanner tone="success">
              Fully staffed. Every shift type meets its minimum for {date}.
            </InlineBanner>
          </div>
        )}
        {/* The patient registry's list, exactly: the same surface + flow
            wrappers, so the column template, 14px gutters and 16px side inset
            all come from `.appointment-card-flow` rather than being restated
            here. Five columns and no actions gutter — the row's actions live
            in its status pill. */}
        <div className="appointment-card-surface patients-list-surface">
          <div className="appointment-card-flow">
            {/* The column head is the roster's frame, not a label for the rows
                that happen to be loaded: it stays put on an empty day, so the
                list never collapses into a bare message. */}
            <div className="appointment-card-head" aria-hidden="true">
              <span>{t('hr.colStaff')}</span>
              <span>{t('hr.labelShift')}</span>
              <span>Time</span>
              <span>{t('hr.labelDepartment')}</span>
              <span>{t('hr.colStatus')}</span>
            </div>
            {schedules.length === 0 && (
              <EmptyState
                icon={CalendarClock}
                title="No shifts scheduled"
                message={`${t('hr.noShiftsScheduled', { date })} ${t('hr.scheduleShift')} ${t('hr.aboveToAddOne')}`}
                action={{ label: 'Create shift', onClick: () => setOpen(true) }}
              />
            )}
            {SHIFT_TYPES.flatMap(shift => schedules.filter(s => s.shiftType === shift)).map(s => {
              const shiftTok = SHIFT_TOKENS[s.shiftType];
              const statusTok = SCHEDULE_STATUS_TOKENS[s.status] ?? SCHEDULE_STATUS_TOKENS.scheduled;
              return (
                <div key={s._id} className="ehr-appointment-row appointment-card-row" style={{ cursor: 'default' }}>
                  <StaffIdentity name={s.userName} sub={roleLabel(s.role)} capitalizeSub />

                  {/* Shift — a tinted chip, so the shift's colour reads at a
                      glance the way it did as a dot, at the pill metrics every
                      other list column already uses. */}
                  <div className="ehr-appointment-department appointment-card-department">
                    <span className="appointment-status-pill capitalize" style={statusPillStyle(shiftTok)}>
                      {t(`hr.shiftType_${s.shiftType}`)}
                    </span>
                  </div>

                  {/* Time — the window, with its length underneath. */}
                  <div className="ehr-appointment-time">
                    <strong className="tabular-nums">{s.startTime}–{s.endTime}</strong>
                    <span>{shiftDuration(s.startTime, s.endTime)}{s.isOnCall ? ` · ${t('hr.onCall')}` : ''}</span>
                  </div>

                  <div className="appointment-card-provider">
                    <strong>{s.department || 'No department'}</strong>
                    <span title={s.notes || undefined}>{s.notes || t('hr.labelDepartment')}</span>
                  </div>

                  {/* The pill moves the shift along its lifecycle; removing it
                      is the one action that isn't a state, so it sits in its
                      own group at the foot of the same menu. */}
                  <div className="appointment-card-status">
                    <RowStatusSelect
                      label={statusTok.label}
                      value={s.status}
                      ariaLabel={`Shift status for ${s.userName}`}
                      subject={s.userName}
                      style={statusPillStyle(statusTok)}
                      options={[
                        ...SCHEDULE_STATUS_OPTIONS
                          .filter(status => status !== s.status)
                          .map(status => ({ value: status, label: SCHEDULE_STATUS_TOKENS[status].label })),
                        { value: REMOVE_SHIFT, label: t('hr.removeShift'), group: t('hr.labelShift') },
                      ]}
                      onSelect={next => {
                        if (next === REMOVE_SHIFT) removeShift(s._id);
                        else setShiftStatus(s._id, next as StaffScheduleDoc['status']);
                      }}
                    />
                    <small>{formatHrDate(s.shiftDate, { month: 'short', day: 'numeric' })}</small>
                  </div>
                </div>
              );
            })}
          </div>
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
