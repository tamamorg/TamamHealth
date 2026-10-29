'use client';
import { formatDate, formatClockTime, humanizeStatus } from '@/lib/format-utils';
import { FOCUSED_ROW_STYLE } from '@/components/ehr/chart/sections/rowFocus';
import type { AppointmentDoc } from '@/lib/db-types';
import ChartSection from '@/components/ehr/chart/ChartSection';
import { ClipboardList } from '@/components/icons/lucide';
import { jubaDate } from '@/lib/time-juba';
import { appointmentsInView, type ApptView } from './appointment-buckets';
import type { Dispatch, SetStateAction } from 'react';
import { useColumnSort } from '@/components/table/useColumnSort';
import { useState } from 'react';
import RowActionsMenu from '@/components/RowActionsMenu';
import AppointmentEditModal from '@/components/appointments/AppointmentEditModal';
import { useConfirmPrompt } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/context';
import { describeError } from '@/lib/user-facing-error';
import { APPOINTMENT_STATUS_TONES, canRoleMoveAppointment } from '@/lib/appointment-status';
import type { AppointmentStatus } from '@/lib/db-types';

/** Cancellable from the chart: booked, not yet arrived. Once the patient is
 *  here a walk-in triage rides on the visit, and the front-desk board is
 *  where that is unwound with it. A closed visit is not cancelled at all. */
const CANCELLABLE: ReadonlySet<AppointmentStatus> = new Set<AppointmentStatus>(['requested', 'scheduled', 'reminder_sent', 'confirmed']);
import type { PatientDoc } from '@/lib/db-types';

/** The chart's badge family, picked by the status's place in the visit. */
const TONE_BADGE: Record<string, string> = {
  scheduled: 'tamam-panel-badge tamam-panel-badge--active',
  ready: 'tamam-panel-badge tamam-panel-badge--active',
  active: 'tamam-panel-badge tamam-panel-badge--active',
  done: 'tamam-panel-badge tamam-panel-badge--done',
  warning: 'tamam-panel-badge tamam-panel-badge--pending',
  danger: 'tamam-panel-badge tamam-panel-badge--muted',
};

const VIEWS: { id: ApptView; labelKey: string }[] = [
  { id: 'upcoming', labelKey: 'chart.apptUpcoming' },
  { id: 'today', labelKey: 'chart.apptToday' },
  { id: 'past', labelKey: 'chart.apptPast' },
];

/**
 * The chart's Appointments tab, O3 style: Upcoming / Today / Past switcher and
 * "Add +", which opens the Create new appointment workspace beside the chart
 * (BookAppointmentPanel) rather than leaving the chart for /appointments/new.
 */
export default function PatientAppointmentsTab({ patient, patientAppointments, onAppointmentsChanged, apptSearch, apptPage, APPT_PAGE_SIZE, t, canBookAppointments, onBook, apptView, setApptView, setApptSearch, setApptPage, focusId }: {
  patient?: PatientDoc;
  patientAppointments: AppointmentDoc[];
  /** Re-read the list after a row action writes (the hook does not subscribe). */
  onAppointmentsChanged?: () => void;
  apptTs?: (a: { appointmentDate: string; appointmentTime?: string | undefined; }) => number;
  apptSearch: string;
  apptPage: number;
  APPT_PAGE_SIZE: 8;
  t: (key: string, vars?: Record<string, string | number> | undefined) => string;
  canBookAppointments: boolean;
  onBook: () => void;
  apptView: ApptView;
  setApptView: (view: ApptView) => void;
  setApptSearch: Dispatch<SetStateAction<string>>;
  setApptPage: Dispatch<SetStateAction<number>>;
  focusId: string | undefined;
}) {
  const columnSort = useColumnSort<AppointmentDoc>();
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const confirmPrompt = useConfirmPrompt();
  const [editing, setEditing] = useState<AppointmentDoc | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // The front-desk cancel, reason asked first. The service enforces the same
  // role rule, so the menu only offers it to whoever may take it.
  const cancelAppointment = async (appt: AppointmentDoc) => {
    const reason = await confirmPrompt({
      title: t('chart.apptCancelTitle'),
      inputLabel: t('chart.apptCancelReason'),
      inputRequired: true,
      confirmLabel: t('chart.apptCancel'),
      tone: 'danger',
    });
    if (!reason?.trim()) return;
    setBusyId(appt._id);
    try {
      const { updateAppointmentStatus } = await import('@/lib/services/appointment-service');
      const saved = await updateAppointmentStatus(appt._id, 'cancelled', {
        cancelledReason: reason.trim(),
        cancelledByName: currentUser?.name || currentUser?.username,
        actorId: currentUser?._id,
        actorName: currentUser?.name || currentUser?.username,
        actorRole: currentUser?.role,
      });
      if (!saved) throw new Error('Change not saved. Try again.');
      showToast(t('msg.appointmentCancelled', { patientName: appt.patientName }), 'success');
      onAppointmentsChanged?.();
    } catch (err) {
      showToast(describeError(err, t('chart.apptCancelFailed')), 'error');
    } finally {
      setBusyId(null);
    }
  };
  const today = jubaDate();
  const inView = appointmentsInView(patientAppointments, apptView, today);
  const query = apptSearch.trim().toLowerCase();
  const filteredAppts = query ? inView.filter(appt => `${appt.reason || ''} ${appt.department || ''} ${appt.providerName || ''} ${appt.staffName || ''} ${appt.status} ${appt.appointmentDate}`.toLowerCase().includes(query)) : inView;
  const sorted = columnSort.sort(filteredAppts);
  const apptPageRows = sorted.slice((apptPage - 1) * APPT_PAGE_SIZE, apptPage * APPT_PAGE_SIZE);

  const switcher = (
    <div className="tamam-appt-switcher" role="tablist" aria-label={t('chart.apptViews')}>
      {VIEWS.map(view => (
        <button
          key={view.id}
          type="button"
          role="tab"
          aria-selected={apptView === view.id}
          className={apptView === view.id ? 'is-selected' : ''}
          onClick={() => { setApptView(view.id); setApptPage(1); }}
        >
          {t(view.labelKey)}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-2">
      <ChartSection
        title={t('chart.apptTitle')}
        addLabel={t('chart.apptAdd')}
        onAdd={canBookAppointments ? onBook : undefined}
        filterSlot={switcher}
        toggleSlot={!canBookAppointments ? <button type="button" className="tamam-section-add" disabled title={t('appointments.schedulingRequired')}>{t('chart.apptAdd')}</button> : undefined}
        searchValue={apptSearch}
        onSearchChange={value => { setApptSearch(value); setApptPage(1); }}
        pagination={{ page: apptPage, pageSize: APPT_PAGE_SIZE, total: filteredAppts.length, onPageChange: setApptPage }}
      >
        <table data-sort="data" className="tamam-table tamam-table--fixed">
          <colgroup>
            <col /><col /><col /><col /><col /><col />
          </colgroup>
          <thead>
            <tr>
              <th {...columnSort.headerProps(0, a => a.appointmentDate)}>{t('chart.apptDate')}</th>
              <th {...columnSort.headerProps(1, a => a.appointmentTime || '')}>{t('chart.apptTime')}</th>
              <th {...columnSort.headerProps(2, a => a.providerName || '')}>{t('chartMessages.careTeam')}</th>
              <th {...columnSort.headerProps(3, a => a.reason || a.department || '')}>{t('chart.apptContext')}</th>
              <th {...columnSort.headerProps(4, a => humanizeStatus(a.status))}>{t('chart.apptStatus')}</th>
              <th className="tamam-col-actions">{t('chart.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {filteredAppts.length === 0 && (
              <tr>
                <td colSpan={6} style={{ cursor: 'default', background: 'transparent' }}>
                  <div className="tamam-empty-state">
                    <ClipboardList />
                    <p>{t(`chart.apptEmpty.${apptView}`)}</p>
                  </div>
                </td>
              </tr>
            )}
            {apptPageRows.map(appt => (
              <tr
                key={appt._id}
                id={`appointment-row-${appt._id}`}
                style={appt._id === focusId ? FOCUSED_ROW_STYLE : undefined}
              >
                <td className="tamam-num">{formatDate(appt.appointmentDate)}</td>
                <td className="tamam-num">{formatClockTime(appt.appointmentTime) || '—'}</td>
                <td>
                  {/* The care team ON THIS APPOINTMENT: its provider and its
                      own second staff member — never the patient's current
                      nurse, who may not have been part of this booking. */}
                  <div className="appointment-card-provider">
                    <strong>{appt.providerName || t('chart.apptNoDoctor')}</strong>
                    {appt.staffName && <span>{appt.staffName}</span>}
                  </div>
                </td>
                <td>
                  <div className="appointment-card-provider">
                    <strong>{appt.reason || appt.department || t('chart.apptFollowUp')}</strong>
                    <span>{[appt.department, appt.room].filter(Boolean).join(' · ') || t('chart.apptGeneric')}</span>
                  </div>
                </td>
                <td><span className={TONE_BADGE[APPOINTMENT_STATUS_TONES[appt.status]] || TONE_BADGE.scheduled}>{humanizeStatus(appt.status)}</span></td>
                <td>
                  <RowActionsMenu
                    ariaLabel={t('chart.apptRowActions', { date: formatDate(appt.appointmentDate) })}
                    actions={[
                      // The editor gates its own fields: only the front desk
                      // can move the date, time or department.
                      ...(canBookAppointments ? [
                        { key: 'edit', label: t('chart.apptEdit'), onClick: () => setEditing(appt) },
                      ] : []),
                      ...(currentUser?.role && CANCELLABLE.has(appt.status) && canRoleMoveAppointment(currentUser.role, appt.status, 'cancelled') ? [
                        { key: 'cancel', label: t('chart.apptCancel'), tone: 'danger' as const, disabled: busyId === appt._id, onClick: () => void cancelAppointment(appt) },
                      ] : []),
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ChartSection>
      {editing && (
        <AppointmentEditModal
          appointment={editing}
          appointments={patientAppointments}
          patient={patient}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onAppointmentsChanged?.(); }}
        />
      )}
    </div>
  );
}
