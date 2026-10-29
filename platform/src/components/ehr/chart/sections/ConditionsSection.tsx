'use client';

/**
 * Conditions tab content — Tamam-style table (Condition / Date of onset /
 * Status). Reuses the SAME `useProblems` hook and service calls ProblemList
 * uses internally, and the SAME ICD-11 coded-search add pattern
 * (CodedSearchField + COMMON_ICD11_CODES) — no new data layer.
 *
 * Every condition is listed: the old "Show: Active/Inactive/All" filter
 * defaulted to Active, which quietly hid resolved conditions from a list short
 * enough to read whole. Status is set from the row instead, so retiring a
 * condition is one click where it is written rather than a trip elsewhere.
 */

import { useEffect, useMemo, useState } from 'react';
import ChartSection, { OmrsEmptyState } from '../ChartSection';
import CodedSearchField from '@/components/CodedSearchField';
import Modal from '@/components/Modal';
import { DialogBody, DialogFooter, DialogFrame, DialogHeader } from '@/components/overlay/Dialog';
import FormSlider from '@/components/overlay/FormSlider';
import RowActionsMenu from '@/components/RowActionsMenu';
import { useConfirmPrompt } from '@/components/ConfirmDialog';
import { describeError } from '@/lib/user-facing-error';
import { todayIso } from '@/lib/date-utils';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/context';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { useProblems } from '@/lib/hooks/useProblems';
import { COMMON_ICD11_CODES } from '@/lib/icd11-codes';
import { formatDate , humanizeStatus } from '@/lib/format-utils';
import type { ProblemStatus } from '@/lib/db-types';
import { FOCUSED_ROW_STYLE } from './rowFocus';
import type { ProblemDoc } from '@/lib/db-types';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { statusWord } from '@/lib/i18n/status-word';

const STATUS_BADGE: Record<ProblemStatus, string> = {
  active: 'tamam-panel-badge tamam-panel-badge--active',
  chronic: 'tamam-panel-badge tamam-panel-badge--active',
  resolved: 'tamam-panel-badge tamam-panel-badge--done',
  inactive: 'tamam-panel-badge tamam-panel-badge--muted',
};

const STATUS_OPTIONS: ProblemStatus[] = ['active', 'chronic', 'inactive', 'resolved'];

interface ConditionsSectionProps {
  patientId: string;
  patientName: string;
  /** "No known problems", attested at a problem review in a note. */
  noKnownProblems?: boolean;
  /** When "Problem reconciliation performed" was last ticked. */
  reconciledAt?: string;
  /** One-shot request from the chart (e.g. the Facesheet Problems card's
   *  "Add") to open the add-condition modal as soon as this tab mounts. */
  autoOpenAdd?: boolean;
  onAutoOpenHandled?: () => void;
  /** Deep-link focus: the condition `_id` to scroll to and highlight. */
  focusId?: string;
}

export default function ConditionsSection({
  patientId, patientName, autoOpenAdd, onAutoOpenHandled, noKnownProblems, reconciledAt, focusId,
}: ConditionsSectionProps) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  // Adding or retiring a coded diagnosis is a clinical write, gated the same
  // way AllergiesSection gates its own. `canViewClinical` is much wider than
  // `canEditClinical` — nurses, midwives and the read-only super_admin all see
  // this tab — so leaving the control open let them author the problem list.
  const { canEditClinical } = usePermissions();
  const { problems, create, update, setStatus } = useProblems(patientId);
  const confirmPrompt = useConfirmPrompt();
  /** The condition whose onset date is being corrected, and the new date. */
  const [onsetTarget, setOnsetTarget] = useState<ProblemDoc | null>(null);
  const [onsetEdit, setOnsetEdit] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [adding, setAdding] = useState(false);
  /** The row mid-save, so a slow write can't be fired twice. */
  const [savingStatus, setSavingStatus] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [tableSearch, setTableSearch] = useState('');
  const [pickedCode, setPickedCode] = useState<{ code: string; title: string; chapter: string } | null>(null);
  const [onsetDate, setOnsetDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (autoOpenAdd) {
      setAdding(true);
      onAutoOpenHandled?.();
    }
  }, [autoOpenAdd, onAutoOpenHandled]);

  const icdOptions = useMemo(() => COMMON_ICD11_CODES.map(c => ({ code: c.code, name: c.title, meta: c.chapter, keywords: c.keywords })), []);

  // Open problems first — a resolved condition is history, not the day's work —
  // then most recent onset within each group.
  const ordered = useMemo(() => {
    const openFirst = (s: ProblemStatus) => (s === 'active' || s === 'chronic' ? 0 : 1);
    return [...problems].sort((a, b) =>
      openFirst(a.status) - openFirst(b.status) ||
      (b.onsetDate || '').localeCompare(a.onsetDate || ''));
  }, [problems]);
  const visibleConditions = useMemo(() => {
    const query = tableSearch.trim().toLowerCase();
    return query ? ordered.filter(problem => `${problem.name} ${problem.icd11Code || ''} ${problem.status} ${problem.onsetDate || ''}`.toLowerCase().includes(query)) : ordered;
  }, [ordered, tableSearch]);

  useEffect(() => {
    if (!focusId) return;
    document.getElementById(`condition-row-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusId, visibleConditions]);

  const handleStatusChange = async (id: string, status: ProblemStatus) => {
    setSavingStatus(id);
    try {
      // The service returns null when the write fails; without this check a
      // refused save still said "Condition marked …".
      if (!(await setStatus(id, status))) throw new Error('Change not saved. Try again.');
      showToast(t('msg.conditionMarked', { value: statusWord(t, status) }), 'success');
    } catch (err) {
      console.error(err);
      showToast(describeError(err, t('msg.conditionNotUpdatedTryAgain')), 'error');
    } finally {
      setSavingStatus(null);
    }
  };

  const closeOnset = () => { setOnsetTarget(null); setOnsetEdit(null); };

  // Corrections write over the entry with a reason, never a delete: a wrong
  // onset date is fixed in place, a wrong entry is kept and hidden.
  const saveOnset = async (problem: ProblemDoc) => {
    if (!onsetEdit) return;
    setCorrecting(true);
    try {
      if (!(await update(problem._id, { onsetDate: onsetEdit }))) throw new Error('Change not saved. Try again.');
      showToast(t('msg.conditionOnsetCorrected'), 'success');
      closeOnset();
    } catch (err) {
      showToast(describeError(err, t('msg.changeNotSavedTryAgain')), 'error');
    } finally {
      setCorrecting(false);
    }
  };

  const markEnteredInError = async (problem: ProblemDoc) => {
    const reason = await confirmPrompt({
      title: t('chart.conditionErrorTitle'),
      message: t('chart.conditionErrorMessage', { name: problem.name }),
      inputLabel: t('chart.vitalsDeleteReason'),
      confirmLabel: t('chart.conditionErrorConfirm'),
      tone: 'danger',
    });
    if (!reason?.trim()) return;
    setCorrecting(true);
    try {
      if (!(await update(problem._id, { recordStatus: 'entered_in_error', correctionReason: reason.trim() }))) throw new Error('Change not saved. Try again.');
      showToast(t('msg.conditionMarkedInError', { name: problem.name }), 'success');
    } catch (err) {
      showToast(describeError(err, t('msg.changeNotSavedTryAgain')), 'error');
    } finally {
      setCorrecting(false);
    }
  };

  const resetForm = () => { setSearch(''); setPickedCode(null); setOnsetDate(''); setAdding(false); };

  const handleSubmit = async () => {
    if (!pickedCode) { showToast(t('msg.selectADiagnosis'), 'error'); return; }
    // The same diagnosis twice on the open list reads as two problems.
    if (problems.some(p => p.icd11Code === pickedCode.code && (p.status === 'active' || p.status === 'chronic'))) {
      showToast(t('msg.conditionAlreadyOnList', { name: pickedCode.title }), 'warning');
      return;
    }
    try {
      setSubmitting(true);
      await create({
        patientId,
        patientName,
        name: pickedCode.title,
        icd11Code: pickedCode.code,
        status: 'active',
        onsetDate: onsetDate || undefined,
        recordedBy: currentUser?._id || currentUser?.username,
        recordedByName: currentUser?.name,
        hospitalId: currentUser?.hospitalId,
        hospitalName: currentUser?.hospitalName,
        orgId: currentUser?.orgId,
      });
      showToast(t('msg.conditionAddedToTheProblem'), 'success');
      resetForm();
    } catch (err) {
      console.error(err);
      showToast(describeError(err, t('msg.conditionNotAddedTryAgain')), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <ChartSection title="Conditions" addLabel="Add" onAdd={canEditClinical ? () => setAdding(true) : undefined} searchValue={tableSearch} onSearchChange={setTableSearch}>
        {/* Attested at a problem review in a note: an empty list means nobody
            has asked, this means someone asked and the answer was none. */}
        {(reconciledAt || (ordered.length === 0 && noKnownProblems)) && (
          <p className="tamam-attestation">
            {ordered.length === 0 && noKnownProblems && <strong>No known problems. </strong>}
            {reconciledAt && <>Problem reconciliation performed · {formatDate(reconciledAt)}.</>}
          </p>
        )}

        {ordered.length === 0 && !noKnownProblems ? (
          <OmrsEmptyState
            itemLabel="conditions"
            actionLabel="Record conditions"
            onAction={canEditClinical ? () => setAdding(true) : undefined}
            disabledReason={canEditClinical ? undefined : 'Requires clinical-editing permission'}
          />
        ) : ordered.length === 0 ? null : (
          <table className="tamam-table tamam-table--conditions">
            {/* Explicit widths: the three columns used to be sized by their
                content, which left the condition name hard against a date and
                the status stranded off at the right edge. */}
            <colgroup>
              <col /><col /><col /><col />
            </colgroup>
            <thead>
              <tr>
                <th>Condition</th>
                <th>Date of onset</th>
                <th>Status</th>
                <th>{t('chart.actions')}</th>
              </tr>
            </thead>
            <tbody>
            {visibleConditions.map(p => (
                <tr
                  key={p._id}
                  id={`condition-row-${p._id}`}
                  style={p._id === focusId ? FOCUSED_ROW_STYLE : undefined}
                >
                  <td style={{ fontWeight: 600 }}>{p.name}{p.icd11Code ? <span style={{ color: 'var(--ehr-muted, #5D728B)', fontWeight: 400 }}> · {p.icd11Code}</span> : null}</td>
                  <td>{p.onsetDate ? formatDate(p.onsetDate) : '—'}</td>
                  <td>
                    <span className={STATUS_BADGE[p.status]}>{humanizeStatus(p.status)}</span>
                  </td>
                  <td>
                    {/* The row's ⋮ carries every correction; there is no
                        separate detail dialog — the row already shows it. */}
                    <RowActionsMenu
                      ariaLabel={t('chart.conditionRowActions', { name: p.name })}
                      actions={[
                        // Status changes live here, not on the badge: the
                        // Status column reads, the Actions column writes.
                        ...(canEditClinical ? STATUS_OPTIONS.filter(option => option !== p.status).map(option => ({
                          key: `status-${option}`,
                          label: t('chart.markStatus', { status: statusWord(t, option) }),
                          disabled: savingStatus === p._id,
                          onClick: () => void handleStatusChange(p._id, option),
                        })) : []),
                        ...(canEditClinical ? [
                          { key: 'onset', label: t('chart.conditionCorrectOnset'), onClick: () => { setOnsetTarget(p); setOnsetEdit(p.onsetDate || ''); } },
                          { key: 'error', label: t('chart.conditionErrorConfirm'), tone: 'danger' as const, onClick: () => void markEnteredInError(p) },
                        ] : []),
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ChartSection>

      {onsetTarget && (
        <Modal className="tamam-dialog" onClose={() => !correcting && closeOnset()} width={420} labelledBy="condition-onset-title">
          <DialogFrame>
            <DialogHeader titleId="condition-onset-title" title={<>{t('chart.conditionCorrectOnset')} · {onsetTarget.name}</>} onClose={() => !correcting && closeOnset()} />
            <DialogBody className="space-y-4">
            <input type="date" className="w-full" aria-label={t('chart.conditionCorrectOnset')} value={onsetEdit ?? ''} max={todayIso()} onChange={e => setOnsetEdit(e.target.value)} autoFocus />
            </DialogBody>
            <DialogFooter>
              <button className="btn btn-secondary" disabled={correcting} onClick={closeOnset}>{t('action.cancel')}</button>
              <button className="btn btn-primary" disabled={correcting || !onsetEdit} onClick={() => void saveOnset(onsetTarget)}>{correcting ? t('noteEditor.saving') : t('chart.conditionSaveOnset')}</button>
            </DialogFooter>
          </DialogFrame>
        </Modal>
      )}

      {adding && (
        <FormSlider
          title="Add condition"
          className="tamam-dialog"
          width={480}
          onClose={() => !submitting && resetForm()}
          busy={submitting}
          footer={<>
              <button className="btn btn-secondary" disabled={submitting} onClick={resetForm}>Cancel</button>
              <button className="btn btn-primary" disabled={submitting || !pickedCode} onClick={handleSubmit}>
                {submitting ? 'Saving…' : 'Save condition'}
              </button>
          </>}
        >
          <div className="space-y-4">
            {pickedCode ? (
              <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg" style={{ background: 'var(--accent-light)', border: '1px solid var(--border-accent)' }}>
                <div className="min-w-0">
                  <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{pickedCode.title}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>ICD-11 · {pickedCode.code} · {pickedCode.chapter}</div>
                </div>
                <button onClick={() => setPickedCode(null)} className="text-xs font-semibold underline shrink-0" style={{ color: 'var(--accent-primary)' }}>Change</button>
              </div>
            ) : (
              <CodedSearchField
                label="Diagnosis"
                placeholder="Search ICD-11 diagnoses…"
                options={icdOptions}
                value={search}
                onChange={setSearch}
                onSelect={c => { setPickedCode({ code: c.code, title: c.name, chapter: c.meta || '' }); setSearch(''); }}
                autoFocus
              />
            )}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Date of onset</label>
              <input
                type="date"
                value={onsetDate}
                onChange={e => setOnsetDate(e.target.value)}
                className="w-full p-2.5 rounded-md text-[13px]"
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
              />
            </div>
          </div>
        </FormSlider>
      )}
    </>
  );
}
