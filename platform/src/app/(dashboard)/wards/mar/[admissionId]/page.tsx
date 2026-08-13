'use client';

/**
 * MAR — Medication Administration Record.
 *
 * The classic time-grid view nurses use at the bedside on inpatient wards.
 * Rows are scheduled medications for one admission; columns are the
 * scheduled dose times for the selected day. Each cell is one dose: open
 * to record GIVEN / MISSED / REFUSED / HELD with a witness for controlled
 * substances. Append-only by design — the legal record of who gave what,
 * when, to whom.
 *
 * Schedule resolution is best-effort: the prescription's `frequency`
 * string is parsed into clock times. Anything we can't parse (e.g. PRN)
 * gets a single "as needed" column.
 */

import { useState, useMemo } from 'react';
import { formatRxSig } from '@/lib/format-utils';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Pill, CheckCircle2, X, AlertTriangle, ShieldAlert, Printer, BedDouble,
} from '@/components/icons/lucide';
import { useAuth } from '@/lib/context';
import { useWards } from '@/lib/hooks/useWards';
import { usePatients } from '@/lib/hooks/usePatients';
import { usePrescriptions } from '@/lib/hooks/usePrescriptions';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { PrescriptionDoc, MedicationAdministration } from '@/lib/db-types';

/**
 * Parse a free-text frequency string into scheduled clock times for one
 * 24-hour day. Best-effort — falls back to standard q-times for the most
 * common patterns and a single "PRN" slot when nothing matches.
 */
function scheduleForFrequency(freq: string): string[] {
  const f = (freq || '').toLowerCase().trim();
  if (!f) return [];

  if (f.includes('prn') || f.includes('as needed') || f.includes('as required')) return ['PRN'];
  if (f === 'od' || f === 'qd' || f.includes('once') || f.includes('daily')) return ['08:00'];
  if (f === 'bd' || f === 'bid' || f.includes('twice')) return ['08:00', '20:00'];
  if (f === 'tds' || f === 'tid' || f.includes('three times') || f.includes('thrice')) {
    return ['08:00', '14:00', '22:00'];
  }
  if (f === 'qds' || f === 'qid' || f.includes('four times')) {
    return ['06:00', '12:00', '18:00', '00:00'];
  }
  const qMatch = f.match(/q\s*(\d+)\s*h/);
  if (qMatch) {
    const interval = parseInt(qMatch[1], 10);
    if (interval > 0 && interval <= 24) {
      const times: string[] = [];
      for (let h = 0; h < 24; h += interval) {
        times.push(`${h.toString().padStart(2, '0')}:00`);
      }
      return times;
    }
  }
  return ['PRN'];
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildScheduledFor(day: string, time: string): string {
  if (time === 'PRN') return new Date().toISOString();
  return new Date(`${day}T${time}:00`).toISOString();
}

function findAdministration(
  rx: PrescriptionDoc,
  day: string,
  time: string,
): MedicationAdministration | undefined {
  const target = buildScheduledFor(day, time);
  return (rx.administrations || []).find(a => a.scheduledFor === target);
}

const STATUS_TINT: Record<MedicationAdministration['status'], { bg: string; color: string; ring: string; label: string }> = {
  given:     { bg: 'rgba(31, 157, 111,0.12)',  color: 'var(--color-success-text)',                ring: 'rgba(31, 157, 111,0.30)', label: 'Given' },
  missed:    { bg: 'rgba(196,69,54,0.12)',   color: 'var(--tamamhealth-red)', ring: 'rgba(196,69,54,0.30)',  label: 'Missed' },
  refused:   { bg: 'rgba(228,168,75,0.18)',  color: 'var(--color-warning)',   ring: 'rgba(228,168,75,0.32)', label: 'Refused' },
  held:      { bg: 'rgba(100,116,139,0.12)', color: '#475569',                ring: 'rgba(100,116,139,0.26)', label: 'Held' },
  corrected: { bg: 'rgba(124,58,237,0.12)',  color: '#6D28D9',                ring: 'rgba(124,58,237,0.26)', label: 'Corrected' },
};

const STATUS_LABEL_KEY: Record<MedicationAdministration['status'], string> = {
  given: 'mar.statusGiven',
  missed: 'mar.statusMissed',
  refused: 'mar.statusRefused',
  held: 'mar.statusHeld',
  corrected: 'mar.statusCorrected',
};

interface CellProps {
  rx: PrescriptionDoc;
  day: string;
  time: string;
  onRecord: (rx: PrescriptionDoc, scheduledFor: string) => void;
}

function MARCell({ rx, day, time, onRecord }: CellProps) {
  const { t } = useTranslation();
  const adm = findAdministration(rx, day, time);
  const scheduledFor = buildScheduledFor(day, time);

  if (adm) {
    const tint = STATUS_TINT[adm.status];
    return (
      <button
        onClick={() => onRecord(rx, scheduledFor)}
        className="w-full h-full p-1.5 text-left rounded-md transition-all"
        style={{
          background: tint.bg,
          color: tint.color,
          border: `1px solid ${tint.ring}`,
          minHeight: 52,
        }}
        title={t('mar.cellTooltip', { status: t(STATUS_LABEL_KEY[adm.status]), name: adm.administeredByName, time: new Date(adm.recordedAt).toLocaleTimeString() })}
      >
        <div className="text-[10.5px] font-bold uppercase" style={{ letterSpacing: '0.04em' }}>
          {t(STATUS_LABEL_KEY[adm.status])}
        </div>
        <div className="text-[10.5px] truncate" style={{ color: 'var(--text-muted)' }}>
          {adm.administeredByName}
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={() => onRecord(rx, scheduledFor)}
      className="w-full h-full rounded-md transition-all hover:bg-blue-50"
      style={{
        border: '1px dashed var(--border-medium)',
        color: 'var(--text-muted)',
        background: 'var(--bg-card-solid)',
        fontSize: 18,
        fontWeight: 600,
        minHeight: 52,
      }}
      aria-label={t('mar.recordAdministration')}
    >
      +
    </button>
  );
}

export default function MARPage() {
  const { t } = useTranslation();
  const params = useParams();
  const admissionId = params?.admissionId as string;
  const router = useRouter();
  const { currentUser } = useAuth();
  const { activeAdmissions } = useWards();
  const { patients } = usePatients();
  const { prescriptions, administer } = usePrescriptions();
  const { showToast } = useToast();

  const [day, setDay] = useState<string>(todayISO());
  const [modalRx, setModalRx] = useState<PrescriptionDoc | null>(null);
  const [modalScheduledFor, setModalScheduledFor] = useState<string>('');
  const [modalStatus, setModalStatus] = useState<MedicationAdministration['status']>('given');
  const [modalReason, setModalReason] = useState('');
  const [modalNotes, setModalNotes] = useState('');
  const [modalWitness, setModalWitness] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const admission = useMemo(
    () => activeAdmissions.find(a => a._id === admissionId),
    [activeAdmissions, admissionId],
  );

  const patient = useMemo(
    () => admission ? patients.find(p => p._id === admission.patientId) : undefined,
    [patients, admission],
  );

  const allergies = useMemo(
    () => (patient?.allergies || []).filter(a => a && a.toLowerCase() !== 'none known' && a.toLowerCase() !== 'none'),
    [patient],
  );

  const patientRx = useMemo(
    () => prescriptions.filter(rx =>
      rx.patientId === admission?.patientId &&
      (rx.admissionId === admissionId || (!rx.admissionId && rx.status === 'pending'))
    ),
    [prescriptions, admission, admissionId],
  );

  // Union of all scheduled times across active prescriptions, sorted
  const columns = useMemo(() => {
    const set = new Set<string>();
    for (const rx of patientRx) {
      for (const t of scheduleForFrequency(rx.frequency)) set.add(t);
    }
    const times = Array.from(set);
    const clock = times.filter(t => t !== 'PRN').sort();
    if (times.includes('PRN')) clock.push('PRN');
    return clock.length > 0 ? clock : ['08:00'];
  }, [patientRx]);

  const openModal = (rx: PrescriptionDoc, scheduledFor: string) => {
    const existing = (rx.administrations || []).find(a => a.scheduledFor === scheduledFor);
    setModalRx(rx);
    setModalScheduledFor(scheduledFor);
    setModalStatus(existing?.status || 'given');
    setModalReason(existing?.reason || '');
    setModalNotes(existing?.notes || '');
    setModalWitness(existing?.witnessName || '');
  };

  const closeModal = () => {
    setModalRx(null);
    setModalScheduledFor('');
    setModalStatus('given');
    setModalReason('');
    setModalNotes('');
    setModalWitness('');
  };

  const handleSubmit = async () => {
    if (!modalRx || !currentUser) return;
    try {
      setSubmitting(true);
      await administer({
        prescriptionId: modalRx._id,
        scheduledFor: modalScheduledFor,
        status: modalStatus,
        administeredBy: currentUser._id || currentUser.username,
        administeredByName: currentUser.name,
        witnessName: modalWitness.trim() || undefined,
        reason: modalReason.trim() || undefined,
        notes: modalNotes.trim() || undefined,
      });
      showToast(t('mar.administrationRecorded'), 'success');
      closeModal();
    } catch (err) {
      console.error(err);
      showToast(t('mar.administrationFailed'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (!admission) {
    return (
      <main className="page-container">
        <div className="card-elevated p-6 text-center">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {t('mar.admissionNotFound')}
          </p>
          <button onClick={() => router.push('/wards')} className="btn btn-primary mt-3">
            {t('mar.returnToWards')}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="page-container">
      {/* Page header card */}
        <div className="card-elevated p-5 flex items-start justify-between flex-wrap gap-4 mb-4">
          <div className="flex items-start gap-3 min-w-0">
            <button
              onClick={() => router.back()}
              aria-label={t('action.back')}
              className="mt-0.5 p-1.5 rounded hover:bg-gray-100 shrink-0"
            >
              <ArrowLeft className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
            </button>
            <div className="icon-box-lg">
              <Pill className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                {admission.patientName}
              </h1>
              <div className="mt-1 text-sm flex items-center flex-wrap gap-x-3 gap-y-1" style={{ color: 'var(--text-secondary)' }}>
                <span className="inline-flex items-center gap-1.5">
                  <BedDouble className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                  {admission.wardName}{admission.bedNumber ? ` · ${admission.bedNumber}` : ''}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                  {t('mar.attending', { name: admission.attendingPhysicianName })}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-bold uppercase" style={{
              color: 'var(--text-muted)', letterSpacing: '0.06em',
            }}>{t('mar.day')}</label>
            <input
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              style={{ minWidth: 160 }}
            />
            <button
              onClick={() => typeof window !== 'undefined' && window.print()}
              className="btn btn-secondary inline-flex items-center gap-1.5"
            >
              <Printer className="w-4 h-4" /> {t('action.print')}
            </button>
          </div>
        </div>

        {/* Safety banners */}
        {(allergies.length > 0 || admission.isolationRequired) && (
          <div className="space-y-2 mb-4">
            {allergies.length > 0 && (
              <div
                className="card-elevated px-4 py-3 flex items-start gap-3"
                style={{
                  background: 'rgba(196,69,54,0.05)',
                  borderColor: 'rgba(196,69,54,0.30)',
                }}
              >
                <div className="icon-box-sm shrink-0">
                  <ShieldAlert className="w-3.5 h-3.5" style={{ color: 'var(--tamamhealth-red)' }} />
                </div>
                <div>
                  <div className="text-[10.5px] font-bold uppercase" style={{
                    color: 'var(--tamamhealth-red)', letterSpacing: '0.06em',
                  }}>
                    {t('patient.allergies')}
                  </div>
                  <div className="text-sm font-semibold mt-0.5" style={{ color: 'var(--tamamhealth-red-text)' }}>
                    {allergies.join(', ')}
                  </div>
                </div>
              </div>
            )}
            {admission.isolationRequired && (
              <div
                className="card-elevated px-4 py-3 flex items-start gap-3"
                style={{
                  background: 'rgba(228,168,75,0.08)',
                  borderColor: 'rgba(228,168,75,0.30)',
                }}
              >
                <div className="icon-box-sm shrink-0">
                  <AlertTriangle className="w-3.5 h-3.5" style={{ color: 'var(--color-warning)' }} />
                </div>
                <div>
                  <div className="text-[10.5px] font-bold uppercase" style={{
                    color: 'var(--color-warning-text)', letterSpacing: '0.06em',
                  }}>
                    {t('mar.isolationRequired')}
                  </div>
                  <div className="text-sm font-medium mt-0.5">
                    {admission.isolationReason || t('mar.ppeBeforeEntry')}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* MAR grid */}
        {patientRx.length === 0 ? (
          <div className="card-elevated p-8 text-center" style={{ borderStyle: 'dashed' }}>
            <div className="icon-box-lg mx-auto">
              <Pill className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
            </div>
            <p className="text-sm font-semibold mt-3" style={{ color: 'var(--text-secondary)' }}>
              {t('mar.noPrescriptions')}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              {t('mar.noPrescriptionsHint')}
            </p>
          </div>
        ) : (
          <div className="card-elevated overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ borderCollapse: 'separate', borderSpacing: 0, minWidth: 760 }}>
                <thead>
                  <tr style={{ background: 'var(--overlay-subtle)' }}>
                    <th
                      className="text-left px-4 py-3 font-bold sticky left-0 z-10"
                      style={{
                        minWidth: 280,
                        borderBottom: '1px solid var(--border-light)',
                        color: 'var(--text-secondary)',
                        background: 'var(--overlay-subtle)',
                        fontSize: 11,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                      }}
                    >
                      {t('mar.colMedication')}
                    </th>
                    {columns.map(t => (
                      <th
                        key={t}
                        className="px-2 py-3 font-bold text-center"
                        style={{
                          minWidth: 100,
                          borderBottom: '1px solid var(--border-light)',
                          color: 'var(--text-secondary)',
                          fontSize: 11,
                          letterSpacing: '0.04em',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {t}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {patientRx.map((rx, idx) => (
                    <tr key={rx._id} style={{
                      background: idx % 2 === 0 ? 'transparent' : 'var(--overlay-subtle)',
                    }}>
                      <td
                        className="px-4 py-3 align-top sticky left-0 z-[5]"
                        style={{
                          background: idx % 2 === 0 ? 'var(--bg-card-solid)' : 'var(--overlay-subtle)',
                          borderBottom: '1px solid var(--border-light)',
                        }}
                      >
                        <div className="flex items-start gap-2">
                          <div className="icon-box-sm shrink-0">
                            <Pill className="w-3.5 h-3.5" style={{ color: 'var(--accent-hover)' }} />
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                              {rx.medication}
                            </div>
                            <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                              {formatRxSig({ ...rx, duration: undefined })}
                              {rx.duration && <> · {rx.duration}</>}
                            </div>
                            <div className="text-[10.5px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                              {t('mar.prescribedBy', { name: rx.prescribedBy })}
                            </div>
                          </div>
                        </div>
                      </td>
                      {columns.map(t => (
                        <td
                          key={t}
                          className="p-1.5 align-middle"
                          style={{ borderBottom: '1px solid var(--border-light)' }}
                        >
                          <MARCell rx={rx} day={day} time={t} onRecord={openModal} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
          {(['given', 'missed', 'refused', 'held'] as const).map(s => (
            <span key={s} className="inline-flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
              <span
                className="inline-block"
                style={{
                  width: 12, height: 12, borderRadius: 4,
                  background: STATUS_TINT[s].bg,
                  border: `1px solid ${STATUS_TINT[s].ring}`,
                }}
              />
              {t(STATUS_LABEL_KEY[s])}
            </span>
          ))}
          <span style={{ color: 'var(--text-muted)' }}>{t('mar.legendHint')}</span>
        </div>

        {/* Record-administration modal */}
        {modalRx && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(10,18,16,0.55)', backdropFilter: 'blur(2px)' }}
            onClick={closeModal}
          >
            <div
              className="w-full max-w-md card-elevated overflow-hidden"
              onClick={(e) => e.stopPropagation()}
              style={{ boxShadow: 'var(--card-shadow-xl)' }}
            >
              <header
                className="px-5 py-3 border-b flex items-start justify-between gap-3"
                style={{ borderColor: 'var(--border-light)', background: 'var(--overlay-subtle)' }}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="icon-box">
                    <Pill className="w-4 h-4" style={{ color: 'var(--accent-hover)' }} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10.5px] font-bold uppercase" style={{
                      color: 'var(--text-muted)', letterSpacing: '0.06em',
                    }}>{t('mar.administer')}</div>
                    <h3 className="text-base font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>
                      {modalRx.medication}
                    </h3>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {modalRx.dose} · {modalRx.route} · {t('mar.scheduled')}{' '}
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {new Date(modalScheduledFor).toLocaleString()}
                      </span>
                    </p>
                  </div>
                </div>
                <button onClick={closeModal} aria-label={t('action.close')} className="p-1 rounded hover:bg-gray-100 shrink-0">
                  <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                </button>
              </header>

              <div className="px-5 py-4 space-y-4">
                <div>
                  <label className="block text-[11px] font-bold uppercase mb-1.5" style={{
                    color: 'var(--text-muted)', letterSpacing: '0.06em',
                  }}>{t('mar.status')}</label>
                  <div className="grid grid-cols-4 gap-1.5 keep-cols">
                    {(['given', 'missed', 'refused', 'held'] as const).map(s => {
                      const tint = STATUS_TINT[s];
                      const on = modalStatus === s;
                      return (
                        <button
                          key={s}
                          onClick={() => setModalStatus(s)}
                          className="px-2 py-2 text-[11px] font-bold uppercase rounded transition-all"
                          style={{
                            background: on ? tint.bg : 'transparent',
                            color: on ? tint.color : 'var(--text-secondary)',
                            border: `1px solid ${on ? tint.ring : 'var(--border-light)'}`,
                            letterSpacing: '0.06em',
                          }}
                        >
                          {t(STATUS_LABEL_KEY[s])}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {modalStatus !== 'given' && (
                  <div>
                    <label className="block text-[11px] font-bold uppercase mb-1.5" style={{
                      color: 'var(--text-muted)', letterSpacing: '0.06em',
                    }}>
                      {t('mar.reason')} {modalStatus === 'refused' ? t('mar.reasonRefused') : modalStatus === 'held' ? t('mar.reasonHeld') : t('mar.reasonMissed')}
                    </label>
                    <input
                      type="text"
                      value={modalReason}
                      onChange={(e) => setModalReason(e.target.value)}
                      className="w-full"
                      placeholder={t('mar.required')}
                    />
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-bold uppercase mb-1.5" style={{
                    color: 'var(--text-muted)', letterSpacing: '0.06em',
                  }}>
                    {t('mar.witness')} <span style={{ color: 'var(--text-muted)', textTransform: 'none', letterSpacing: 0 }}>
                      {t('mar.witnessHint')}
                    </span>
                  </label>
                  <input
                    type="text"
                    value={modalWitness}
                    onChange={(e) => setModalWitness(e.target.value)}
                    className="w-full"
                    placeholder={t('mar.witnessName')}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase mb-1.5" style={{
                    color: 'var(--text-muted)', letterSpacing: '0.06em',
                  }}>{t('mar.notes')}</label>
                  <textarea
                    value={modalNotes}
                    onChange={(e) => setModalNotes(e.target.value)}
                    rows={2}
                    className="w-full"
                    placeholder={t('mar.notesPlaceholder')}
                  />
                </div>
              </div>

              <footer
                className="px-5 py-3 border-t flex items-center justify-between gap-2"
                style={{ borderColor: 'var(--border-light)', background: 'var(--overlay-subtle)' }}
              >
                <p className="text-[10.5px]" style={{ color: 'var(--text-muted)' }}>
                  {t('mar.recordedAs')} <strong style={{ color: 'var(--text-primary)' }}>{currentUser?.name}</strong>
                </p>
                <div className="flex items-center gap-2">
                  <button onClick={closeModal} className="btn btn-secondary">{t('action.cancel')}</button>
                  <button
                    onClick={handleSubmit}
                    disabled={submitting || (modalStatus !== 'given' && !modalReason.trim())}
                    className="btn btn-primary inline-flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {submitting ? t('mar.saving') : t('mar.record')}
                  </button>
                </div>
              </footer>
            </div>
          </div>
        )}
    </main>
  );
}
