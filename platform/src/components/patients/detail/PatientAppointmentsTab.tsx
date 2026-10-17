'use client';
import { Calendar } from '@/components/icons/lucide';
import { formatDate, formatClockTime, humanizeStatus } from '@/lib/format-utils';
import { FOCUSED_ROW_STYLE } from '@/components/ehr/chart/sections/rowFocus';
import type { AppointmentDoc, PatientDoc } from '@/lib/db-types';
import ChartSection, { OmrsEmptyState } from '@/components/ehr/chart/ChartSection';
import type { Dispatch, SetStateAction } from 'react';
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
export default function PatientAppointmentsTab({ patientAppointments, apptTs, apptSearch, apptPage, APPT_PAGE_SIZE, t, canBookAppointments, router, patient, setApptSearch, setApptPage, focusId }: {
  patientAppointments: AppointmentDoc[];
  apptTs: (a: { appointmentDate: string; appointmentTime?: string | undefined; }) => number;
  apptSearch: string;
  apptPage: number;
  APPT_PAGE_SIZE: 8;
  t: (key: string, vars?: Record<string, string | number> | undefined) => string;
  canBookAppointments: boolean;
  router: AppRouterInstance;
  patient: PatientDoc;
  setApptSearch: Dispatch<SetStateAction<string>>;
  setApptPage: Dispatch<SetStateAction<number>>;
  focusId: string | undefined;
}) {
            const sortedAppts = [...patientAppointments].sort((a, b) => apptTs(b) - apptTs(a));
            const query = apptSearch.trim().toLowerCase();
            const filteredAppts = query ? sortedAppts.filter(appt => `${appt.reason || ''} ${appt.department || ''} ${appt.providerName || ''} ${appt.status} ${appt.appointmentDate}`.toLowerCase().includes(query)) : sortedAppts;
            const apptPageRows = filteredAppts.slice((apptPage - 1) * APPT_PAGE_SIZE, apptPage * APPT_PAGE_SIZE);
            return (
              <div className="space-y-2">
                <ChartSection
                  title="Appointments"
                  addLabel={t('appointments.bookAppointment')}
                  addIcon={<Calendar />}
                  onAdd={canBookAppointments ? () => router.push(`/appointments/new?patient=${encodeURIComponent(patient._id)}`) : undefined}
                  filterSlot={!canBookAppointments ? <button type="button" className="tamam-section-add" disabled title={t('appointments.schedulingRequired')}><Calendar />{t('appointments.bookAppointment')}</button> : undefined}
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
                          <th>Date</th>
                          <th>Time</th>
                          <th>{t('chartMessages.careTeam')}</th>
                          <th>Context</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedAppts.length === 0 && (
                          <tr>
                            <td colSpan={5} style={{ cursor: 'default', background: 'transparent' }}>
                              <OmrsEmptyState
                                itemLabel="appointments"
                                actionLabel={t('appointments.bookAppointment')}
                                onAction={canBookAppointments ? () => router.push(`/appointments/new?patient=${encodeURIComponent(patient._id)}`) : undefined}
                                disabledReason={canBookAppointments ? undefined : t('appointments.schedulingRequired')}
                              />
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
                              {/* The care team ON THIS APPOINTMENT. The second
                                  line used to print the patient's current
                                  assigning nurse against every row, including
                                  visits booked years earlier by someone else —
                                  a name that was never part of that booking.
                                  `staffName` is the appointment's own second
                                  staff member, and it is simply absent when the
                                  booking has none. */}
                              <div className="appointment-card-provider">
                                <strong>{appt.providerName || 'Doctor unassigned'}</strong>
                                {appt.staffName && <span>{appt.staffName}</span>}
                              </div>
                            </td>
                            <td>
                              <div className="appointment-card-provider">
                                <strong>{appt.reason || appt.department || 'Follow-up'}</strong>
                                <span>{[appt.department, appt.room].filter(Boolean).join(' · ') || 'Appointment'}</span>
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
