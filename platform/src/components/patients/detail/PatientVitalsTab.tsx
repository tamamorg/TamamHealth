'use client';
import { assessVitalsForDisplay, type VitalDisplayFlag, type VitalDisplayLevel, type VitalsTimelineEntry } from '@/lib/clinical/vitals';
import type { ReactNode } from 'react';
import './vitals-table.css';
import { formatDate } from '@/lib/format-utils';
import type { MedicalRecordDoc } from '@/lib/db-types';
import ChartSection from '@/components/ehr/chart/ChartSection';
import { List, LineChart } from '@/components/icons/lucide';
import RowActionsMenu from '@/components/RowActionsMenu';
import { useConfirmPrompt } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/context';
import { usePathname, useRouter } from 'next/navigation';
import { describeError } from '@/lib/user-facing-error';
import { VitalsTrends } from './lazy-panels';
import type { Dispatch, SetStateAction } from 'react';

const LEVEL_RANK: Record<VitalDisplayLevel, number> = { abnormal: 1, high_risk: 2, critical: 3 };

/** BP is one cell fed by two readings: it takes the worse of the two. */
function worst(...flags: Array<VitalDisplayFlag | undefined>): VitalDisplayFlag | undefined {
  const found = flags.filter((flag): flag is VitalDisplayFlag => Boolean(flag));
  if (found.length === 0) return undefined;
  const top = found.reduce((a, b) => (LEVEL_RANK[b.level] > LEVEL_RANK[a.level] ? b : a));
  return { ...top, message: found.map(flag => flag.message).join(' ') };
}

/** One reading in the table. Out of range, it says so three ways, none of
 *  them colour alone: a tint (red critical / high risk, amber outside
 *  normal), an arrow for the direction (doubled when critical), and the
 *  reason on hover and to a screen reader. The same assessment as the vitals
 *  band at the top of the chart, so the two never disagree. */
function Reading({ value, flag }: { value: ReactNode; flag?: VitalDisplayFlag }) {
  if (!flag) return <>{value}</>;
  const glyph = flag.direction === 'high' ? '↑' : '↓';
  return (
    <span className="tamam-vflag" data-level={flag.level} title={flag.message}>
      {value}
      <span className="tamam-vflag-arrow" aria-hidden>{flag.level === 'critical' ? glyph + glyph : glyph}</span>
      <span className="tamam-vflag-sr">{flag.message}</span>
    </span>
  );
}
export default function PatientVitalsTab({ patientAgeYears, isPregnant, vitalsView, canConsult, canRecordVitalEvents, setCorrectingVitalsRecord, setShowNurseVitals, setVitalsView, recordsWithTriageVitals, t, vitalsTimeline, records, onVitalsChanged }: {
  /** FRACTIONAL years, for the paediatric bands; omitted → adult ranges. */
  patientAgeYears?: number;
  /** Active pregnancy: IITT's blood-pressure rule is a pregnancy rule. */
  isPregnant?: boolean;
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
  onVitalsChanged?: () => void;
}) {
  const { currentUser } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { showToast } = useToast();
  const confirmPrompt = useConfirmPrompt();

  const removeReading = async (record: MedicalRecordDoc) => {
    const reason = await confirmPrompt({
      title: t('chart.vitalsDeleteTitle'),
      message: t('chart.vitalsDeleteMessage'),
      inputLabel: t('chart.vitalsDeleteReason'),
      confirmLabel: t('chart.vitalsDelete'),
      tone: 'danger',
    });
    if (!reason?.trim()) return;
    try {
      const { recordNursingVitals } = await import('@/lib/services/medical-record-service');
      await recordNursingVitals({
        patientId: record.patientId,
        patientName: '',
        hospitalId: record.hospitalId,
        hospitalName: record.hospitalName,
        orgId: record.orgId,
        encounterId: record.encounterId,
        recordedById: currentUser?._id,
        recordedByName: currentUser?.name,
        correctsRecordId: record._id,
        correctionReason: `${t('chart.enteredInError')}: ${reason.trim()}`,
        vitals: {},
      });
      showToast(t('chart.vitalsDeleted'), 'success');
      onVitalsChanged?.();
    } catch (error) {
      showToast(describeError(error, t('chart.vitalsNotDeleted')), 'error');
    }
  };

  return (
            <ChartSection
              title={vitalsView === 'flowsheet' ? 'Vital sign flowsheet' : 'Vitals'}
              onAdd={(canConsult || canRecordVitalEvents) ? () => { setCorrectingVitalsRecord(undefined); setShowNurseVitals(true); } : undefined}
              addLabel="Record vitals"
              toggleSlot={(
                <div className="tamam-icon-toggle" role="tablist" aria-label="Vitals view">
                  <button
                    type="button"
                    className={vitalsView === 'table' ? 'is-active' : ''}
                    onClick={() => setVitalsView('table')}
                    role="tab"
                    aria-selected={vitalsView === 'table'}
                    aria-label="Table view"
                    title="Table view"
                  >
                    <List aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={vitalsView === 'flowsheet' ? 'is-active' : ''}
                    onClick={() => setVitalsView('flowsheet')}
                    role="tab"
                    aria-selected={vitalsView === 'flowsheet'}
                    aria-label="Chart view"
                    title="Chart view"
                  >
                    <LineChart aria-hidden />
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
                <table className="tamam-table" style={{ minWidth: 960 }}>
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
                      const flags = assessVitalsForDisplay(entry, patientAgeYears, { isPregnant });
                      const sourceStyle = entry.source === 'Triage'
                        ? { background: 'var(--accent-light)', color: 'var(--accent-primary)' }
                        : entry.source === 'Nursing'
                          ? { background: 'rgba(166, 83, 0,0.12)', color: 'var(--accent-purple)' }
                          : { background: 'rgba(15, 160, 106,0.14)', color: 'var(--color-success)' };
                      return (
                        <tr key={entry.id}>
                          <td>{formatDate(entry.at)}</td>
                          <td><span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full" style={sourceStyle}>{entry.source}</span></td>
                          <td className="tamam-num"><Reading value={entry.temperature ?? '—'} flag={flags.temperature} /></td>
                          <td className="tamam-num"><Reading value={hasBp ? `${entry.systolic}/${entry.diastolic}` : '—'} flag={worst(flags.systolic, flags.diastolic)} /></td>
                          <td className="tamam-num"><Reading value={entry.pulse ?? '—'} flag={flags.pulse} /></td>
                          <td className="tamam-num"><Reading value={entry.respiratoryRate ?? '—'} flag={flags.respiratoryRate} /></td>
                          <td className="tamam-num"><Reading value={entry.oxygenSaturation !== undefined ? `${entry.oxygenSaturation}%` : '—'} flag={flags.oxygenSaturation} /></td>
                          <td className="tamam-num">{entry.weight ?? '—'}</td>
                          <td className="tamam-num">{entry.bmi ?? '—'}</td>
                          <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{(entry.facility || '').replace(' Hospital', '').replace(' Teaching', '') || '—'}</td>
                          <td>
                            {/* Edit opens the correction form; Delete marks the
                                reading entered in error (a correction with no
                                values — it supersedes the original, which is
                                kept for the audit trail, never destroyed).
                                Only nursing readings: consult and triage vitals
                                belong to their own notes and forms. */}
                            {nursingRecord && (canConsult || canRecordVitalEvents) ? (
                              <RowActionsMenu
                                ariaLabel={t('chart.vitalsRowActions')}
                                actions={[
                                  { key: 'edit', label: t('chart.vitalsEdit'), onClick: () => { setCorrectingVitalsRecord(nursingRecord); setShowNurseVitals(true); } },
                                  { key: 'delete', label: t('chart.vitalsDelete'), tone: 'danger', onClick: () => { void removeReading(nursingRecord); } },
                                ]}
                              />
                            ) : (
                              // Consult and triage readings are corrected in
                              // their own note or form; the row still offers
                              // the way there, so every row has its menu.
                              <RowActionsMenu
                                ariaLabel={t('chart.vitalsRowActions')}
                                actions={[
                                  { key: 'open', label: t('chart.vitalsOpenSource'), onClick: () => router.push(`${pathname}?tab=history&focus=${encodeURIComponent(entry.id)}`) },
                                ]}
                              />
                            )}
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
