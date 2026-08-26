'use client';

/**
 * Immunizations tab content — the patient's dose history, recorded IN the
 * chart. Backed by the same `useImmunizations(patientId)` hook and
 * `immunization-service` the standalone /immunizations module writes through,
 * so a dose given here shows up in coverage reporting and the defaulter
 * tracker unchanged.
 *
 * "Add" used to push the clinician out to /immunizations, losing the chart
 * they were working in and making them find the patient again — the only chart
 * section that answered its own Add by leaving. This mirrors the
 * ProceduresSection / ProgramsSection read+add pattern instead.
 */

import { useMemo, useState } from 'react';
import ChartSection, { OmrsEmptyState } from '../ChartSection';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import { X } from '@/components/icons/lucide';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/context';
import { useImmunizations } from '@/lib/hooks/useImmunizations';
import { VACCINE_NAMES } from '@/lib/services/immunization-service';
import { formatDate, humanizeStatus } from '@/lib/format-utils';
import { toIsoDate } from '@/lib/date-utils';
import type { ImmunizationDoc, PatientDoc } from '@/lib/db-types';
import { useTranslation } from '@/lib/i18n/useTranslation';

const SITES: ImmunizationDoc['site'][] = ['left arm', 'right arm', 'left thigh', 'right thigh', 'oral'];

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  completed: { bg: 'rgba(15, 160, 106,0.14)', color: 'var(--color-success)' },
  scheduled: { bg: 'var(--accent-light)', color: 'var(--accent-primary)' },
  overdue: { bg: 'rgba(224, 49, 39,0.14)', color: 'var(--color-danger)' },
  missed: { bg: 'rgba(253, 217, 95,0.16)', color: 'var(--color-warning)' },
};

interface ImmunizationsSectionProps {
  patient: PatientDoc;
  patientName: string;
  /** Giving a vaccine is a clinical act — same gate the other write sections use. */
  canRecord: boolean;
  /** Facility name for the dose record, resolved by the chart page. */
  facilityName?: string;
}

export default function ImmunizationsSection({ patient, patientName, canRecord, facilityName }: ImmunizationsSectionProps) {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const { immunizations, register, update, enterInError } = useImmunizations(patient._id);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ImmunizationDoc | null>(null);
  const [errorTarget, setErrorTarget] = useState<ImmunizationDoc | null>(null);
  const [errorReason, setErrorReason] = useState('');
  const [vaccine, setVaccine] = useState<string>(VACCINE_NAMES[0]);
  const [doseNumber, setDoseNumber] = useState('1');
  const [dateGiven, setDateGiven] = useState(() => toIsoDate(new Date()));
  const [nextDueDate, setNextDueDate] = useState('');
  const [site, setSite] = useState<ImmunizationDoc['site']>('left arm');
  const [batchNumber, setBatchNumber] = useState('');
  const [adverseReaction, setAdverseReaction] = useState(false);
  const [adverseDetails, setAdverseDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');

  const rows = useMemo(
    () => [...immunizations].sort(
      (a, b) => new Date(b.dateGiven || b.nextDueDate).getTime() - new Date(a.dateGiven || a.nextDueDate).getTime(),
    ),
    [immunizations],
  );
  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? rows.filter(im => `${im.vaccine} ${im.status} ${im.site || ''} ${im.batchNumber || ''} ${im.dateGiven || ''}`.toLowerCase().includes(query)) : rows;
  }, [rows, search]);

  const resetForm = () => {
    setVaccine(VACCINE_NAMES[0]);
    setDoseNumber('1');
    setDateGiven(toIsoDate(new Date()));
    setNextDueDate('');
    setSite('left arm');
    setBatchNumber('');
    setAdverseReaction(false);
    setAdverseDetails('');
    setEditing(null);
    setAdding(false);
  };

  const startEdit = (record: ImmunizationDoc) => {
    setEditing(record);
    setVaccine(record.vaccine);
    setDoseNumber(String(record.doseNumber));
    setDateGiven(record.dateGiven);
    setNextDueDate(record.nextDueDate || '');
    setSite(record.site);
    setBatchNumber(record.batchNumber || '');
    setAdverseReaction(record.adverseReaction);
    setAdverseDetails(record.adverseReactionDetails || '');
    setAdding(true);
  };

  const handleSubmit = async () => {
    const dose = parseInt(doseNumber, 10);
    if (!Number.isFinite(dose) || dose < 1) { showToast('Enter a dose number', 'error'); return; }
    if (!dateGiven) { showToast('Pick the date the dose was given', 'error'); return; }
    // The record carries a batch number for recall: an adverse-event
    // investigation traces the lot, and a dose with no lot can't be traced.
    if (!batchNumber.trim()) { showToast('Record the vaccine batch number', 'error'); return; }
    try {
      setSubmitting(true);
      const doseData = {
        vaccine,
        doseNumber: dose,
        dateGiven,
        nextDueDate: nextDueDate || '',
        batchNumber: batchNumber.trim(),
        site,
        adverseReaction,
        adverseReactionDetails: adverseReaction ? adverseDetails.trim() || undefined : undefined,
      };
      if (editing) {
        const saved = await update(editing._id, doseData);
        if (!saved) throw new Error('Update failed');
      } else await register({
        patientId: patient._id,
        patientName,
        gender: (patient.gender as 'Male' | 'Female') || 'Female',
        dateOfBirth: patient.dateOfBirth || '',
        ...doseData,
        facilityId: currentUser?.hospitalId || patient.registrationHospital || '',
        facilityName: facilityName || currentUser?.hospitalName || '',
        state: patient.state || '',
        administeredBy: currentUser?.name || currentUser?.username || 'Care team',
        status: 'completed',
        orgId: currentUser?.orgId,
      });
      showToast(editing ? t('chart.immunizationCorrected') : 'Immunization recorded', 'success');
      resetForm();
    } catch (err) {
      console.error(err);
      showToast('Could not record this immunization. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const markEnteredInError = async () => {
    if (!errorTarget || errorReason.trim().length < 3) {
      showToast(t('chart.correctionReasonRequired'), 'error');
      return;
    }
    try {
      setSubmitting(true);
      await enterInError(errorTarget._id, errorReason, { id: currentUser?._id, name: currentUser?.name });
      showToast(t('chart.immunizationMarkedError'), 'success');
      setErrorTarget(null);
      setErrorReason('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('chart.immunizationUpdateFailed'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <ChartSection title="Immunizations" addLabel="Add" onAdd={canRecord ? () => setAdding(true) : undefined} searchValue={search} onSearchChange={setSearch}>
        {rows.length === 0 ? (
          <OmrsEmptyState
            itemLabel="immunizations"
            actionLabel="Record immunizations"
            onAction={canRecord ? () => setAdding(true) : undefined}
            disabledReason={canRecord ? undefined : 'Requires vitals-recording permission'}
          />
        ) : (
          <div className="overflow-x-auto" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            <table className="omrs-table omrs-table--fixed" style={{ minWidth: 840 }}>
              <colgroup>
                <col /><col /><col /><col /><col /><col /><col /><col />
              </colgroup>
              <thead>
                <tr>
                  {['Vaccine', 'Dose', 'Date given', 'Next due', 'Site', 'Batch'].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                  <th>{t('chart.actions')}</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(im => {
                  const s = STATUS_STYLE[im.status] || STATUS_STYLE.scheduled;
                  return (
                    <tr key={im._id} style={im.recordStatus === 'entered_in_error' ? { opacity: 0.62 } : undefined}>
                      <td style={{ fontWeight: 600 }}>
                        {im.vaccine}
                        {im.adverseReaction && (
                          <div style={{ color: 'var(--color-danger-text)', fontSize: 12, fontWeight: 400 }}>
                            Adverse reaction{im.adverseReactionDetails ? `: ${im.adverseReactionDetails}` : ''}
                          </div>
                        )}
                      </td>
                      <td>{im.doseNumber ? `Dose ${im.doseNumber}` : '—'}</td>
                      <td>{im.dateGiven ? formatDate(im.dateGiven) : '—'}</td>
                      <td>{im.nextDueDate ? formatDate(im.nextDueDate) : '—'}</td>
                      <td style={{ textTransform: 'capitalize' }}>{im.site || '—'}</td>
                      <td className="font-mono">{im.batchNumber || '—'}</td>
                      <td>
                        {im.recordStatus === 'entered_in_error' ? (
                          <span title={im.statusReason}>{t('chart.enteredInError')}</span>
                        ) : canRecord ? (
                          <div className="flex gap-1">
                            <button type="button" className="btn btn-xs btn-secondary" onClick={() => startEdit(im)}>{t('chart.correct')}</button>
                            <button type="button" className="btn btn-xs btn-secondary" onClick={() => setErrorTarget(im)}>{t('chart.markError')}</button>
                          </div>
                        ) : '—'}
                      </td>
                      <td>
                        <span className="clinical-status-pill" style={{ background: s.bg, color: s.color }}>
                          {humanizeStatus(im.status)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </ChartSection>

      {adding && (
        <Modal onClose={() => !submitting && resetForm()} width={520} labelledBy="add-immunization-title">
          <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
            <div className="flex items-center justify-between">
              <h2 id="add-immunization-title" className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                {editing ? t('chart.correctImmunization') : 'Record immunization'}
              </h2>
              <button className="p-1 rounded" onClick={() => !submitting && resetForm()} style={{ color: 'var(--text-muted)' }} aria-label="Close"><X className="w-4 h-4" /></button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="imm-vaccine" className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Vaccine</label>
                <Select id="imm-vaccine" value={vaccine} onChange={e => setVaccine(e.target.value)}>
                  {VACCINE_NAMES.map(v => <option key={v} value={v}>{v}</option>)}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="imm-dose" className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Dose number</label>
                <input
                  id="imm-dose"
                  type="number"
                  min={1}
                  value={doseNumber}
                  onChange={e => setDoseNumber(e.target.value)}
                  className="w-full p-2.5 rounded-md text-[13px]"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                {/* Capped at today: a dose cannot have been given in the future. */}
                <label htmlFor="imm-given" className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Date given</label>
                <input
                  id="imm-given"
                  type="date"
                  max={toIsoDate(new Date())}
                  value={dateGiven}
                  onChange={e => setDateGiven(e.target.value)}
                  className="w-full p-2.5 rounded-md text-[13px]"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="imm-next" className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Next dose due (optional)</label>
                <input
                  id="imm-next"
                  type="date"
                  min={dateGiven || undefined}
                  value={nextDueDate}
                  onChange={e => setNextDueDate(e.target.value)}
                  className="w-full p-2.5 rounded-md text-[13px]"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="imm-site" className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Site</label>
                <Select id="imm-site" value={site} onChange={e => setSite(e.target.value as ImmunizationDoc['site'])}>
                  {SITES.map(s => <option key={s} value={s}>{s}</option>)}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="imm-batch" className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Batch number</label>
                <input
                  id="imm-batch"
                  type="text"
                  value={batchNumber}
                  onChange={e => setBatchNumber(e.target.value)}
                  placeholder="e.g. BCG-2026-JTH-044"
                  className="w-full p-2.5 rounded-md text-[13px]"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-primary)' }}>
              <input type="checkbox" checked={adverseReaction} onChange={e => setAdverseReaction(e.target.checked)} />
              Adverse reaction observed
            </label>
            {adverseReaction && (
              <textarea
                rows={2}
                value={adverseDetails}
                onChange={e => setAdverseDetails(e.target.value)}
                placeholder="Describe the reaction and what was done"
                aria-label="Adverse reaction details"
                className="w-full p-2.5 rounded-md text-[13px]"
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)', resize: 'vertical' }}
              />
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button className="btn btn-sm btn-secondary" disabled={submitting} onClick={resetForm}>Cancel</button>
              <button className="btn btn-sm btn-primary" disabled={submitting || !batchNumber.trim()} onClick={handleSubmit}>
                {submitting ? 'Saving…' : editing ? t('chart.saveCorrection') : 'Save immunization'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {errorTarget && (
        <Modal onClose={() => !submitting && setErrorTarget(null)} width={440} labelledBy="immunization-error-title">
          <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
            <h2 id="immunization-error-title" className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>{t('chart.markImmunizationError')}</h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('chart.markImmunizationErrorHelp')}</p>
            <label className="flex flex-col gap-1.5 text-xs font-semibold">
              {t('chart.correctionReason')}
              <textarea rows={3} value={errorReason} onChange={e => setErrorReason(e.target.value)} className="w-full p-2.5 rounded-md text-[13px]" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
            </label>
            <div className="flex justify-end gap-2">
              <button className="btn btn-sm btn-secondary" disabled={submitting} onClick={() => setErrorTarget(null)}>{t('common.cancel')}</button>
              <button className="btn btn-sm btn-primary" disabled={submitting || errorReason.trim().length < 3} onClick={markEnteredInError}>{t('chart.markError')}</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
