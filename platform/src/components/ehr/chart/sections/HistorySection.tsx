'use client';

/**
 * History tab content — the patient's standing history in one place: medical,
 * surgical, family and social, each its own section card.
 *
 * Before this tab the only record of family or social history was narrative
 * typed into whichever note happened to ask, so reading it meant opening old
 * notes and writing it meant typing it again. Entries here are recorded once,
 * against the patient, and every note reads them from the chart.
 *
 * Two sections also show rows that belong to another list — the problem list
 * under Medical, procedures done here under Surgical. They are read in place,
 * never copied: a diagnosis is still added on Conditions, and a status change
 * made here writes the same problem, so the two can never disagree.
 */

import { useState } from 'react';
import ChartSection from '../ChartSection';
import RowActionsMenu from '@/components/RowActionsMenu';
import HistoryEntryForm from './HistoryEntryForm';
import FormSlider from '@/components/overlay/FormSlider';
import Modal from '@/components/Modal';
import { DialogBody, DialogFooter, DialogFrame, DialogHeader } from '@/components/overlay/Dialog';
import { useConfirm, useConfirmPrompt } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { describeError } from '@/lib/user-facing-error';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { useHistoryEntries } from '@/lib/hooks/useHistoryEntries';
import { useProblems } from '@/lib/hooks/useProblems';
import { useProcedures } from '@/lib/hooks/useProcedures';
import { formatDate, humanizeStatus } from '@/lib/format-utils';
import { todayIso } from '@/lib/date-utils';
import { statusWord } from '@/lib/i18n/status-word';
import type { HistoryDomain, HistoryEntryDoc, ProblemDoc, ProblemStatus, ProcedureDoc } from '@/lib/db-types';
import {
  HISTORY_DOMAINS, OTHER_SOCIAL_FACTOR, formatHistoryEntry, getSocialFactor, historyForDomain, performedProcedures,
} from '@/lib/clinical/patient-history';

/** Same status set as Conditions; 'inactive' takes the row off this list. */
const PROBLEM_STATUSES: ProblemStatus[] = ['active', 'chronic', 'inactive', 'resolved'];

const MUTED = { color: 'var(--ehr-muted, #5D728B)', fontWeight: 400 } as const;
const SUB = { ...MUTED, fontSize: 12 } as const;

/** Column heading keys per domain (`history.col.*`), ending with the actions. */
const COLUMNS: Record<HistoryDomain, readonly string[]> = {
  medical: ['illness', 'when', 'details', 'recorded', 'actions'],
  surgical: ['operation', 'when', 'where', 'recorded', 'actions'],
  family: ['relative', 'condition', 'details', 'recorded', 'actions'],
  social: ['factor', 'finding', 'recorded', 'actions'],
  // Not rendered here (it lives on the Medications tab); listed for the type.
  medication: [],
};

interface HistorySectionProps {
  patientId: string;
  patientName: string;
  /** Jump to another chart section — Conditions, Procedures. */
  onOpenTab?: (tabId: string) => void;
  /** Note the history is being updated from, stamped on entries added there. */
  sourceNoteId?: string;
}

export default function HistorySection({ patientId, patientName, onOpenTab, sourceNoteId }: HistorySectionProps) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const confirmPrompt = useConfirmPrompt();
  // Everyone who cares for the patient can record history — nurses included.
  // (A borrowed problem-list row's status is a clinician's write, as on
  // Conditions, so it rides `canEditClinical`.)
  const { canRecordHistory, canEditClinical, canConsult } = usePermissions();
  const { entries, loading, error, markInError } = useHistoryEntries(patientId);
  const { problems, update: updateProblem, setStatus: setProblemStatus } = useProblems(patientId);
  const { procedures, remove: removeProcedure } = useProcedures(patientId);

  const [form, setForm] = useState<{ domain: HistoryDomain; entry: HistoryEntryDoc | null } | null>(null);
  const [retiring, setRetiring] = useState<string | null>(null);
  const [savingProblem, setSavingProblem] = useState<string | null>(null);
  const [onsetTarget, setOnsetTarget] = useState<ProblemDoc | null>(null);
  const [onsetEdit, setOnsetEdit] = useState('');

  const listedProblems = problems.filter(p => p.status !== 'inactive');
  const doneProcedures = performedProcedures(procedures);

  const handleMarkInError = async (entry: HistoryEntryDoc) => {
    const ok = await confirm({
      title: t('history.confirmErrorTitle'),
      message: t('history.confirmErrorBody', { entry: formatHistoryEntry(entry) }),
      confirmLabel: t('history.confirmErrorAction'),
      tone: 'warning',
    });
    if (!ok) return;
    setRetiring(entry._id);
    try {
      // null: not found, or not in this user's scope. Not a success.
      if (!(await markInError(entry._id, { userId: currentUser?._id, userName: currentUser?.name }))) throw new Error('Change not saved. Try again.');
      showToast(t('history.markedError'), 'success');
    } catch (err) {
      console.error(err);
      showToast(describeError(err, t('history.updateFailed')), 'error');
    } finally {
      setRetiring(null);
    }
  };

  const handleProblemStatus = async (problem: ProblemDoc, status: ProblemStatus) => {
    setSavingProblem(problem._id);
    try {
      // The service returns null when the write fails — not a success.
      if (!(await setProblemStatus(problem._id, status))) throw new Error('Change not saved. Try again.');
      showToast(t('msg.conditionMarked', { value: statusWord(t, status) }), 'success');
    } catch (err) {
      console.error(err);
      showToast(describeError(err, t('msg.conditionNotUpdatedTryAgain')), 'error');
    } finally {
      setSavingProblem(null);
    }
  };

  // The same corrections Conditions makes, written over the problem with a
  // reason, never a delete: a wrong onset is fixed in place, a wrong entry is
  // kept and hidden.
  const saveOnset = async () => {
    if (!onsetTarget || !onsetEdit) return;
    setSavingProblem(onsetTarget._id);
    try {
      if (!(await updateProblem(onsetTarget._id, { onsetDate: onsetEdit }))) throw new Error('Change not saved. Try again.');
      showToast(t('msg.conditionOnsetCorrected'), 'success');
      setOnsetTarget(null);
    } catch (err) {
      showToast(describeError(err, t('msg.changeNotSavedTryAgain')), 'error');
    } finally {
      setSavingProblem(null);
    }
  };

  const markProblemInError = async (problem: ProblemDoc) => {
    const reason = await confirmPrompt({
      title: t('chart.conditionErrorTitle'),
      message: t('chart.conditionErrorMessage', { name: problem.name }),
      inputLabel: t('chart.vitalsDeleteReason'),
      confirmLabel: t('chart.conditionErrorConfirm'),
      tone: 'danger',
    });
    if (!reason?.trim()) return;
    setSavingProblem(problem._id);
    try {
      if (!(await updateProblem(problem._id, { recordStatus: 'entered_in_error', correctionReason: reason.trim() }))) throw new Error('Change not saved. Try again.');
      showToast(t('msg.conditionMarkedInError', { name: problem.name }), 'success');
    } catch (err) {
      showToast(describeError(err, t('msg.changeNotSavedTryAgain')), 'error');
    } finally {
      setSavingProblem(null);
    }
  };

  const markProcedureInError = async (procedure: ProcedureDoc) => {
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
      if (!(await removeProcedure(procedure._id, reason, { id: currentUser?._id, name: currentUser?.name }))) throw new Error(t('chart.procedureUpdateFailed'));
      showToast(t('chart.procedureMarkedError'), 'success');
    } catch (err) {
      showToast(describeError(err, t('chart.procedureUpdateFailed')), 'error');
    }
  };

  const recorded = (entry: HistoryEntryDoc) => (
    <td>
      {/* An edited entry names whoever last changed it, beside that date —
          the recorder's name next to someone else's edit would misattribute it. */}
      {entry.updatedByName || entry.recordedByName || '—'}
      <div style={SUB}>{formatDate(entry.updatedByName ? entry.updatedAt : entry.createdAt)}</div>
    </td>
  );

  // Every correction lives in the row's ⋮, as on every other chart list.
  const actions = (entry: HistoryEntryDoc) => (
    <td>
      <RowActionsMenu
        ariaLabel={t('history.rowActions', { entry: formatHistoryEntry(entry) })}
        actions={canRecordHistory ? [
          { key: 'edit', label: t('history.edit'), onClick: () => setForm({ domain: entry.domain, entry }) },
          { key: 'error', label: t('history.markError'), hint: t('history.markErrorHint'), tone: 'danger' as const, disabled: retiring === entry._id, onClick: () => void handleMarkInError(entry) },
        ] : []}
      />
    </td>
  );

  /**
   * A problem-list row takes the same actions as Conditions — status, onset
   * correction, entered in error — and every write lands on the problem, so
   * the two lists cannot disagree.
   */
  const problemActions = (problem: ProblemDoc) => (
    <td>
      <RowActionsMenu
        ariaLabel={t('history.rowActions', { entry: problem.name })}
        actions={[
          ...(canEditClinical ? PROBLEM_STATUSES.filter(status => status !== problem.status).map(status => ({
            key: `status-${status}`,
            label: t('chart.markStatus', { status: statusWord(t, status) }),
            group: 'status',
            disabled: savingProblem === problem._id,
            onClick: () => void handleProblemStatus(problem, status),
          })) : []),
          ...(canEditClinical ? [
            { key: 'onset', label: t('chart.conditionCorrectOnset'), group: 'correct', onClick: () => { setOnsetTarget(problem); setOnsetEdit(problem.onsetDate || ''); } },
            { key: 'error', label: t('chart.conditionErrorConfirm'), group: 'correct', tone: 'danger' as const, disabled: savingProblem === problem._id, onClick: () => void markProblemInError(problem) },
          ] : []),
          ...(onOpenTab ? [{
            key: 'open',
            label: t('history.openSource', { list: t('history.fromProblemList') }),
            group: 'open',
            onClick: () => onOpenTab('problems'),
          }] : []),
        ]}
      />
    </td>
  );

  /** A procedure is withdrawn here; a full correction is the Procedures form. */
  const procedureActions = (procedure: ProcedureDoc) => (
    <td>
      <RowActionsMenu
        ariaLabel={t('history.rowActions', { entry: procedure.name })}
        actions={[
          ...(onOpenTab ? [{
            key: 'open',
            label: t('history.openSource', { list: t('history.fromProcedures') }),
            group: 'open',
            onClick: () => onOpenTab('procedures'),
          }] : []),
          ...(canConsult ? [{
            key: 'error', label: t('chart.markError'), group: 'correct', tone: 'danger' as const,
            onClick: () => void markProcedureInError(procedure),
          }] : []),
        ]}
      />
    </td>
  );

  const entryRow = (entry: HistoryEntryDoc) => {
    switch (entry.domain) {
      case 'medical':
        return (
          <tr key={entry._id}>
            <td style={{ fontWeight: 600 }}>{entry.title}</td>
            <td>{entry.when || '—'}</td>
            <td>{entry.detail || '—'}</td>
            {recorded(entry)}
            {actions(entry)}
          </tr>
        );
      case 'surgical':
        return (
          <tr key={entry._id}>
            <td style={{ fontWeight: 600 }}>
              {entry.title}
              {entry.detail ? <div style={SUB}>{entry.detail}</div> : null}
            </td>
            <td>{entry.when || '—'}</td>
            <td>{entry.facility || '—'}</td>
            {recorded(entry)}
            {actions(entry)}
          </tr>
        );
      case 'family':
        return (
          <tr key={entry._id}>
            <td style={{ fontWeight: 600 }}>{entry.relation || '—'}</td>
            <td>
              {entry.title}
              {entry.when ? <div style={SUB}>{entry.when}</div> : null}
            </td>
            <td>{entry.detail || '—'}</td>
            {recorded(entry)}
            {actions(entry)}
          </tr>
        );
      default:
        return (
          <tr key={entry._id}>
            <td style={{ fontWeight: 600 }}>
              {/* A named factor is shown in the reader's language; a free-text
                  one ("Diet") is the clinician's own word and shown as typed. */}
              {entry.factor && entry.factor !== OTHER_SOCIAL_FACTOR && getSocialFactor(entry.factor)
                ? t(`history.factor.${entry.factor}`)
                : entry.title}
            </td>
            <td>{entry.detail || '—'}</td>
            {recorded(entry)}
            {actions(entry)}
          </tr>
        );
    }
  };

  /**
   * Says which list a borrowed row belongs to, and is the way to it: the row is
   * edited there, not here. One tag per row instead of a tag and a button — a
   * patient with eight problems does not need eight "Open" buttons.
   */
  const borrowedTag = (tabId: string, label: string) => (onOpenTab ? (
    <button
      type="button"
      className="tamam-panel-badge tamam-panel-badge--muted tamam-history-source"
      title={t('history.openSource', { list: label })}
      onClick={() => onOpenTab(tabId)}
    >
      {label}
    </button>
  ) : (
    <span className="tamam-panel-badge tamam-panel-badge--muted">{label}</span>
  ));

  /** Rows read from another list, shown above the domain's own entries. */
  const borrowedRows = (domain: HistoryDomain) => {
    if (domain === 'medical') {
      return listedProblems.map(p => (
        <tr key={p._id}>
          <td style={{ fontWeight: 600 }}>
            {p.name}{p.icd11Code ? <span style={MUTED}> · {p.icd11Code}</span> : null}
          </td>
          <td>{p.onsetDate ? formatDate(p.onsetDate) : '—'}</td>
          <td>{humanizeStatus(p.status)}</td>
          <td>{borrowedTag('problems', t('history.fromProblemList'))}</td>
          {problemActions(p)}
        </tr>
      ));
    }
    if (domain === 'surgical') {
      return doneProcedures.map(p => (
        <tr key={p._id}>
          <td style={{ fontWeight: 600 }}>
            {p.name}
            {p.outcome ? <div style={SUB}>{p.outcome}</div> : null}
          </td>
          <td>{p.date ? formatDate(p.date) : '—'}</td>
          <td>{p.hospitalName || t('history.thisFacility')}</td>
          <td>{borrowedTag('procedures', t('history.fromProcedures'))}</td>
          {procedureActions(p)}
        </tr>
      ));
    }
    return [];
  };

  return (
    <>
      {HISTORY_DOMAINS.map((def) => {
        const rows = historyForDomain(entries, def.id);
        const borrowed = borrowedRows(def.id);
        const columns = COLUMNS[def.id];
        const empty = rows.length === 0 && borrowed.length === 0;
        return (
          <ChartSection
            key={def.id}
            title={t(`history.domain.${def.id}`)}
            addLabel={t('history.add')}
            onAdd={canRecordHistory ? () => setForm({ domain: def.id, entry: null }) : undefined}
          >
            <table className={`tamam-table tamam-table--fixed tamam-table--history tamam-table--history-${def.id}`}>
              <thead>
                <tr>
                  {columns.map(column => (
                    <th key={column}>
                      {t(`history.col.${column}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {empty && (
                  <tr>
                    <td colSpan={columns.length} style={{ ...MUTED, textAlign: 'left', cursor: 'default', background: 'transparent' }}>
                      {/* A failed read is not an empty history, and must not
                          look like one. */}
                      {error ? t('history.loadFailed') : loading ? t('common.loading') : t(`history.empty.${def.id}`)}
                    </td>
                  </tr>
                )}
                {borrowed}
                {rows.map(entryRow)}
              </tbody>
            </table>
          </ChartSection>
        );
      })}

      {onsetTarget && (
        <Modal className="tamam-dialog" onClose={() => !savingProblem && setOnsetTarget(null)} width={420} labelledBy="history-onset-title">
          <DialogFrame>
            <DialogHeader titleId="history-onset-title" title={<>{t('chart.conditionCorrectOnset')} · {onsetTarget.name}</>} onClose={() => !savingProblem && setOnsetTarget(null)} />
            <DialogBody className="space-y-4">
              <input type="date" className="w-full" aria-label={t('chart.conditionCorrectOnset')} value={onsetEdit} max={todayIso()} onChange={e => setOnsetEdit(e.target.value)} autoFocus />
            </DialogBody>
            <DialogFooter>
              <button className="btn btn-secondary" disabled={!!savingProblem} onClick={() => setOnsetTarget(null)}>{t('action.cancel')}</button>
              <button className="btn btn-primary" disabled={!!savingProblem || !onsetEdit} onClick={() => void saveOnset()}>{savingProblem ? t('noteEditor.saving') : t('chart.conditionSaveOnset')}</button>
            </DialogFooter>
          </DialogFrame>
        </Modal>
      )}

      {form && (
        <FormSlider
          title={t(`${form.entry ? 'history.editTitle' : 'history.addTitle'}.${form.domain}`)}
          className="tamam-dialog"
          width={480}
          onClose={() => setForm(null)}
        >
          <div className="space-y-4">
            <HistoryEntryForm
              key={form.entry?._id || `new-${form.domain}`}
              domain={form.domain}
              patientId={patientId}
              patientName={patientName}
              entry={form.entry}
              entries={entries}
              currentUser={currentUser}
              sourceNoteId={sourceNoteId}
              onSaved={() => setForm(null)}
              onCancel={() => setForm(null)}
            />
          </div>
        </FormSlider>
      )}
    </>
  );
}
