'use client';

/**
 * Procedures tab content — bedside/theatre procedures backed by ProcedureDoc +
 * procedure-service + useProcedures, mirroring the ConditionsSection read+add
 * pattern. Free-text name with an optional code; not validated against a
 * coding system today.
 */

import { useState } from 'react';
import RowActionsMenu from '@/components/RowActionsMenu';
import ChartSection, { OmrsEmptyState } from '../ChartSection';
import FormSlider from '@/components/overlay/FormSlider';
import { useToast } from '@/components/Toast';
import { useConfirmPrompt } from '@/components/ConfirmDialog';
import { useAuth } from '@/lib/context';
import { useProcedures } from '@/lib/hooks/useProcedures';
import { formatDate } from '@/lib/format-utils';
import { procedure as procedureLifecycle, type ProcedureStatus } from '@/lib/clinical-flow/order-lifecycles';
import { todayIso } from '@/lib/date-utils';
import type { ProcedureDoc } from '@/lib/db-types';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { statusWord } from '@/lib/i18n/status-word';
import { describeError } from '@/lib/user-facing-error';

/** Stage 7 states, worded the way a clinician would say them. */
const PROCEDURE_STATUS_LABELS: Record<ProcedureStatus, string> = {
  ordered: 'Ordered',
  consented: 'Consented',
  in_progress: 'In progress',
  completed: 'Completed',
  in_observation: 'In observation',
  released: 'Released',
  aborted: 'Aborted',
  complication: 'Complication',
  ae_reported: 'Adverse event reported',
};

interface ProceduresSectionProps {
  patientId: string;
  patientName: string;
  canConsult: boolean;
}

export default function ProceduresSection({ patientId, patientName, canConsult }: ProceduresSectionProps) {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const confirmPrompt = useConfirmPrompt();
  const { procedures, create, amend, advance, remove } = useProcedures(patientId);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ProcedureDoc | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [date, setDate] = useState(() => todayIso());
  const [bodySite, setBodySite] = useState('');
  const [outcome, setOutcome] = useState('');
  const [notes, setNotes] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [advancing, setAdvancing] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const visibleProcedures = procedures.filter(procedure => `${procedure.name} ${procedure.code || ''} ${procedure.status || ''} ${procedure.performedByName || ''} ${procedure.outcome || ''}`.toLowerCase().includes(search.trim().toLowerCase()));

  /**
   * Move one procedure to its next Stage 7 state. The picker only ever offers
   * moves the lifecycle allows, and 'aborted' is prompted for its reason
   * because the document specifies "aborted (with reason)" — the service
   * refuses the move without one.
   */
  const advanceTo = async (id: string, to: ProcedureStatus) => {
    let reason: string | undefined;
    if (to === 'aborted') {
      const answer = await confirmPrompt({
        title: t('confirm.procedureAbortTitle'),
        inputLabel: t('confirm.procedureAbortLabel'),
        confirmLabel: t('confirm.procedureAbortConfirm'),
        inputRequired: true,
        tone: 'warning',
      });
      if (!answer) return;
      reason = answer;
    }
    setAdvancing(id);
    try {
      if (!(await advance(id, to, { actorId: currentUser?._id, actorName: currentUser?.name, reason }))) throw new Error('Change not saved. Try again.');
      showToast(t('msg.procedureMovedTo', { value: statusWord(t, to) }), 'success');
    } catch (err) {
      showToast(describeError(err, t('chart.procedureUpdateFailed')), 'error');
    } finally {
      setAdvancing(null);
    }
  };

  const resetForm = () => {
    setName(''); setCode(''); setBodySite(''); setOutcome(''); setNotes(''); setCorrectionReason('');
    setDate(todayIso());
    setEditing(null);
    setAdding(false);
  };

  const startCorrection = (procedure: ProcedureDoc) => {
    setEditing(procedure);
    setName(procedure.name);
    setCode(procedure.code || '');
    setDate(procedure.date);
    setBodySite(procedure.bodySite || '');
    setOutcome(procedure.outcome || '');
    setNotes(procedure.notes || '');
    setCorrectionReason('');
    setAdding(true);
  };

  const handleSubmit = async () => {
    if (!name.trim()) { showToast(t('msg.enterTheProcedureName'), 'error'); return; }
    if (!date) { showToast(t('msg.selectTheProcedureDate'), 'error'); return; }
    if (editing && correctionReason.trim().length < 3) { showToast(t('chart.correctionReasonRequired'), 'error'); return; }
    try {
      setSubmitting(true);
      const details = {
        name: name.trim(),
        code: code.trim() || undefined,
        date,
        bodySite: bodySite.trim() || undefined,
        outcome: outcome.trim() || undefined,
        notes: notes.trim() || undefined,
      };
      if (editing) {
        await amend(editing._id, details, correctionReason, { id: currentUser?._id, name: currentUser?.name });
      } else await create({
        patientId,
        patientName,
        ...details,
        performedBy: currentUser?._id || currentUser?.username,
        performedByName: currentUser?.name,
        hospitalId: currentUser?.hospitalId,
        hospitalName: currentUser?.hospitalName,
        orgId: currentUser?.orgId,
      });
      showToast(editing ? t('chart.procedureCorrected') : t('msg.procedureRecorded'), 'success');
      resetForm();
    } catch (err) {
      console.error(err);
      // The amend path explains itself (reason too short, record changed).
      showToast(describeError(err, t('msg.procedureNotRecordedTryAgain')), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const markEnteredInError = async () => {
    if (!editing || correctionReason.trim().length < 3) { showToast(t('chart.correctionReasonRequired'), 'error'); return; }
    try {
      setSubmitting(true);
      const ok = await remove(editing._id, correctionReason, { id: currentUser?._id, name: currentUser?.name });
      if (!ok) throw new Error(t('chart.procedureUpdateFailed'));
      showToast(t('chart.procedureMarkedError'), 'success');
      resetForm();
    } catch (err) {
      showToast(describeError(err, t('chart.procedureUpdateFailed')), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  /** The ⋮ path to the same write: asks only for the reason. */
  const promptEnteredInError = async (procedure: ProcedureDoc) => {
    const reason = await confirmPrompt({
      title: t('chart.markError'),
      message: procedure.name,
      inputLabel: t('chart.vitalsDeleteReason'),
      inputRequired: true,
      confirmLabel: t('chart.markError'),
      tone: 'danger',
    });
    if (!reason) return;
    if (reason.trim().length < 3) { showToast(t('chart.correctionReasonRequired'), 'error'); return; }
    try {
      if (!(await remove(procedure._id, reason, { id: currentUser?._id, name: currentUser?.name }))) throw new Error(t('chart.procedureUpdateFailed'));
      showToast(t('chart.procedureMarkedError'), 'success');
    } catch (err) {
      showToast(describeError(err, t('chart.procedureUpdateFailed')), 'error');
    }
  };

  return (
    <>
      <ChartSection title="Procedures" addLabel="Add" onAdd={canConsult ? () => setAdding(true) : undefined} searchValue={search} onSearchChange={setSearch}>
        <table className="tamam-table tamam-table--fixed">
            <colgroup>
              <col /><col /><col /><col /><col /><col />
            </colgroup>
            <thead>
              <tr>
                <th>Procedure</th>
                <th>Date</th>
                <th>Performed by</th>
                <th>Outcome</th>
                <th>Status</th>
                <th>{t('chart.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {procedures.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ cursor: 'default', background: 'transparent' }}>
                    <OmrsEmptyState
                      itemLabel="procedures"
                      actionLabel="Record procedures"
                      onAction={canConsult ? () => setAdding(true) : undefined}
                      disabledReason={canConsult ? undefined : 'Requires consultation permission'}
                    />
                  </td>
                </tr>
              )}
              {visibleProcedures.map(p => (
                <tr
                  key={p._id}
                  style={p.recordStatus === 'entered_in_error' ? { opacity: 0.62 } : undefined}
                >
                  <td style={{ fontWeight: 600 }}>
                    {p.name}
                    {p.code ? <span style={{ color: 'var(--ehr-muted, #5D728B)', fontWeight: 400 }}> · {p.code}</span> : null}
                    {p.bodySite ? <div style={{ color: 'var(--ehr-muted, #5D728B)', fontWeight: 400, fontSize: 12 }}>{p.bodySite}</div> : null}
                  </td>
                  <td>{formatDate(p.date)}</td>
                  <td>{p.performedByName || '—'}</td>
                  <td>
                    {p.outcome || '—'}
                    {p.notes ? <div style={{ color: 'var(--ehr-muted, #5D728B)', fontSize: 12 }}>{p.notes}</div> : null}
                  </td>
                  <td>
                    <span className="clinical-status-pill" title={p.recordStatus === 'entered_in_error' ? p.statusReason : undefined}>
                      {p.recordStatus === 'entered_in_error' ? t('chart.enteredInError') : p.status ? PROCEDURE_STATUS_LABELS[p.status] : 'Recorded'}
                    </span>
                    {p.status === 'aborted' && p.abortedReason ? (
                      <div style={{ color: 'var(--ehr-muted, #5D728B)', fontWeight: 400, fontSize: 12 }}>{p.abortedReason}</div>
                    ) : null}
                  </td>
                  <td>
                    {/* Status reads; this column writes — advancing the
                        lifecycle included. */}
                    <RowActionsMenu
                      ariaLabel={t('chart.procedureRowActions', { name: p.name })}
                      actions={canConsult && p.recordStatus !== 'entered_in_error' ? [
                        ...procedureLifecycle.next(p.status || 'ordered').map(next => ({
                          key: `status-${next}`,
                          label: t('chart.markStatus', { status: PROCEDURE_STATUS_LABELS[next] }),
                          disabled: advancing === p._id,
                          onClick: () => void advanceTo(p._id, next),
                        })),
                        { key: 'correct', label: t('chart.correct'), onClick: () => startCorrection(p) },
                        { key: 'error', label: t('chart.markError'), tone: 'danger' as const, onClick: () => void promptEnteredInError(p) },
                      ] : []}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
      </ChartSection>

      {adding && (
        <FormSlider
          title={editing ? t('chart.correctProcedure') : 'Record procedure'}
          className="tamam-dialog"
          width={480}
          onClose={() => !submitting && resetForm()}
          busy={submitting}
          footer={<>
              {editing && (
                <button className="btn btn-secondary" disabled={submitting || correctionReason.trim().length < 3} onClick={markEnteredInError}>
                  {t('chart.markError')}
                </button>
              )}
              <button className="btn btn-secondary" disabled={submitting} onClick={resetForm}>Cancel</button>
              <button className="btn btn-primary" disabled={submitting || !name.trim()} onClick={handleSubmit}>
                {submitting ? 'Saving…' : editing ? t('chart.saveCorrection') : 'Save procedure'}
              </button>
          </>}
        >
          <div className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Procedure</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Incision and drainage of abscess"
                autoFocus
                className="w-full p-2.5 rounded-md text-[13px]"
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
              />
            </div>
            {editing && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>{t('chart.correctionReason')}</label>
                <textarea
                  rows={2}
                  value={correctionReason}
                  onChange={e => setCorrectionReason(e.target.value)}
                  placeholder={t('chart.procedureCorrectionReasonPlaceholder')}
                  className="w-full p-2.5 rounded-md text-[13px]"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)', resize: 'vertical' }}
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Code (optional)</label>
                <input
                  type="text"
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  className="w-full p-2.5 rounded-md text-[13px]"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="w-full p-2.5 rounded-md text-[13px]"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Body site (optional)</label>
                <input
                  type="text"
                  value={bodySite}
                  onChange={e => setBodySite(e.target.value)}
                  placeholder="e.g. left forearm"
                  className="w-full p-2.5 rounded-md text-[13px]"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Outcome (optional)</label>
                <input
                  type="text"
                  value={outcome}
                  onChange={e => setOutcome(e.target.value)}
                  placeholder="e.g. successful, no complications"
                  className="w-full p-2.5 rounded-md text-[13px]"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Notes (optional)</label>
              <textarea
                rows={2}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="w-full p-2.5 rounded-md text-[13px]"
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)', resize: 'vertical' }}
              />
            </div>
          </div>
        </FormSlider>
      )}
    </>
  );
}
