'use client';
import { formatDate, formatClockTime, humanizeStatus } from '@/lib/format-utils';
import { FOCUSED_ROW_STYLE } from '@/components/ehr/chart/sections/rowFocus';
import type { AppointmentDoc } from '@/lib/db-types';
import ChartSection from '@/components/ehr/chart/ChartSection';
import { ClipboardList } from '@/components/icons/lucide';
import { jubaDate } from '@/lib/time-juba';
import { appointmentsInView, type ApptView } from './appointment-buckets';
import type { Dispatch, SetStateAction } from 'react';

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
export default function PatientAppointmentsTab({ patientAppointments, apptSearch, apptPage, APPT_PAGE_SIZE, t, canBookAppointments, onBook, apptView, setApptView, setApptSearch, setApptPage, focusId }: {
  patientAppointments: AppointmentDoc[];
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
  const today = jubaDate();
  const inView = appointmentsInView(patientAppointments, apptView, today);
  const query = apptSearch.trim().toLowerCase();
  const filteredAppts = query ? inView.filter(appt => `${appt.reason || ''} ${appt.department || ''} ${appt.providerName || ''} ${appt.staffName || ''} ${appt.status} ${appt.appointmentDate}`.toLowerCase().includes(query)) : inView;
  const apptPageRows = filteredAppts.slice((apptPage - 1) * APPT_PAGE_SIZE, apptPage * APPT_PAGE_SIZE);

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
        <table className="tamam-table tamam-table--fixed">
          <colgroup>
            <col /><col /><col /><col /><col />
          </colgroup>
          <thead>
            <tr>
              <th>{t('chart.apptDate')}</th>
              <th>{t('chart.apptTime')}</th>
              <th>{t('chartMessages.careTeam')}</th>
              <th>{t('chart.apptContext')}</th>
              <th>{t('chart.apptStatus')}</th>
            </tr>
          </thead>
          <tbody>
            {filteredAppts.length === 0 && (
              <tr>
                <td colSpan={5} style={{ cursor: 'default', background: 'transparent' }}>
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
                <td className="font-mono">{formatDate(appt.appointmentDate)}</td>
                <td>{formatClockTime(appt.appointmentTime) || '—'}</td>
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
                <td><span className="badge badge-normal clinical-status-pill">{humanizeStatus(appt.status)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </ChartSection>
    </div>
  );
}
