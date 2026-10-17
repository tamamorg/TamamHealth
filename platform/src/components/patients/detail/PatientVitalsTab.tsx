'use client';
import type { VitalsTimelineEntry } from '@/lib/clinical/vitals';
import { formatDate } from '@/lib/format-utils';
import type { MedicalRecordDoc } from '@/lib/db-types';
import ChartSection from '@/components/ehr/chart/ChartSection';
import { VitalsTrends } from './lazy-panels';
import type { Dispatch, SetStateAction } from 'react';
export default function PatientVitalsTab({ vitalsView, canConsult, canRecordVitalEvents, setCorrectingVitalsRecord, setShowNurseVitals, setVitalsView, recordsWithTriageVitals, t, vitalsTimeline, records }: {
  vitalsView: "table" | "flowsheet";
  canConsult: boolean;
  canRecordVitalEvents: boolean;
  setCorrectingVitalsRecord: Dispatch<SetStateAction<MedicalRecordDoc | undefined>>;
  setShowNurseVitals: Dispatch<SetStateAction<boolean>>;
  setVitalsView: Dispatch<SetStateAction<"table" | "flowsheet">>;
  recordsWithTriageVitals: MedicalRecordDoc[];
  t: (key: string, vars?: Record<string, string | number> | undefined) => string;
  vitalsTimeline: VitalsTimelineEntry[];
  records: MedicalRecordDoc[];
}) {
  return (
            <ChartSection
              title={vitalsView === 'flowsheet' ? 'Vital sign flowsheet' : 'Vitals'}
              onAdd={(canConsult || canRecordVitalEvents) ? () => { setCorrectingVitalsRecord(undefined); setShowNurseVitals(true); } : undefined}
              addLabel="Record vitals"
              toggleSlot={(
                <div className="ehr-chart-subtabs" role="tablist" aria-label="Vitals view">
                  <button
                    type="button"
                    className={vitalsView === 'table' ? 'is-active' : ''}
                    onClick={() => setVitalsView('table')}
                    role="tab"
                    aria-selected={vitalsView === 'table'}
                  >
                    Vitals
                  </button>
                  <button
                    type="button"
                    className={vitalsView === 'flowsheet' ? 'is-active' : ''}
                    onClick={() => setVitalsView('flowsheet')}
                    role="tab"
                    aria-selected={vitalsView === 'flowsheet'}
                  >
                    Flowsheet
                  </button>
                </div>
              )}
            >
              {vitalsView === 'flowsheet' ? (
                <div className="p-5">
                  <VitalsTrends records={recordsWithTriageVitals} />
                </div>
              ) : (
                <div className="overflow-x-auto" style={{ maxHeight: '60vh', overflowY: 'auto', paddingInlineEnd: 4 }}>
                <table className="tamam-table" style={{ minWidth: 1140 }}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Source</th>
                      <th>Temp (°C)</th>
                      <th>BP (mmHg)</th>
                      <th>Pulse</th>
                      <th>{t('scribe.vitalRespRate')}</th>
                      <th>SpO₂</th>
                      <th>Weight (kg)</th>
                      <th>BMI</th>
                      <th>Facility</th>
                      <th>{t('chart.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vitalsTimeline.length === 0 && (
                      <tr>
                        <td colSpan={11} className="text-center text-sm py-8" style={{ color: 'var(--text-muted)' }}>
                          No vitals recorded yet for this patient.
                        </td>
                      </tr>
                    )}
                    {vitalsTimeline.map(entry => {
                      const nursingRecord = entry.source === 'Nursing'
                        ? records.find(record => record._id === entry.id && record.recordKind === 'nursing_vitals')
                        : undefined;
                      const hasBp = entry.systolic !== undefined && entry.diastolic !== undefined;
                      const sourceStyle = entry.source === 'Triage'
                        ? { background: 'var(--accent-light)', color: 'var(--accent-primary)' }
                        : entry.source === 'Nursing'
                          ? { background: 'rgba(166, 83, 0,0.12)', color: 'var(--accent-purple)' }
                          : { background: 'rgba(15, 160, 106,0.14)', color: 'var(--color-success)' };
                      return (
                        <tr key={entry.id}>
                          <td className="font-mono text-xs">{formatDate(entry.at)}</td>
                          <td><span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full" style={sourceStyle}>{entry.source}</span></td>
                          <td style={{ color: entry.temperature !== undefined && entry.temperature > 37.5 ? 'var(--color-danger-text)' : 'inherit', fontWeight: entry.temperature !== undefined && entry.temperature > 37.5 ? 600 : 400 }}>
                            {entry.temperature ?? '—'}
                          </td>
                          <td style={{ color: entry.systolic !== undefined && entry.systolic > 140 ? 'var(--color-danger-text)' : 'inherit', fontWeight: entry.systolic !== undefined && entry.systolic > 140 ? 600 : 400 }}>
                            {hasBp ? `${entry.systolic}/${entry.diastolic}` : '—'}
                          </td>
                          <td style={{ color: entry.pulse !== undefined && entry.pulse > 100 ? 'var(--color-danger-text)' : 'inherit' }}>{entry.pulse ?? '—'}</td>
                          <td>{entry.respiratoryRate ?? '—'}</td>
                          <td style={{ color: entry.oxygenSaturation !== undefined && entry.oxygenSaturation < 95 ? 'var(--color-danger-text)' : 'inherit' }}>
                            {entry.oxygenSaturation !== undefined ? `${entry.oxygenSaturation}%` : '—'}
                          </td>
                          <td>{entry.weight ?? '—'}</td>
                          <td>{entry.bmi ?? '—'}</td>
                          <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{(entry.facility || '').replace(' Hospital', '').replace(' Teaching', '') || '—'}</td>
                          <td>
                            {nursingRecord && (canConsult || canRecordVitalEvents) ? (
                              <button
                                type="button"
                                className="btn btn-xs btn-secondary"
                                onClick={() => { setCorrectingVitalsRecord(nursingRecord); setShowNurseVitals(true); }}
                                title={entry.corrected && entry.correctionReason ? entry.correctionReason : undefined}
                              >
                                {entry.corrected ? t('chart.correctAgain') : t('chart.correct')}
                              </button>
                            ) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              )}
            </ChartSection>
  );
}
