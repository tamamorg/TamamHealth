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
import { X } from '@/components/icons/lucide';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/context';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { useProblems } from '@/lib/hooks/useProblems';
import { COMMON_ICD11_CODES } from '@/lib/icd11-codes';
import { formatDate , humanizeStatus } from '@/lib/format-utils';
import type { ProblemStatus } from '@/lib/db-types';
import Select from '@/components/Select';

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
}

export default function ConditionsSection({
  patientId, patientName, autoOpenAdd, onAutoOpenHandled, noKnownProblems, reconciledAt,
}: ConditionsSectionProps) {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  // Adding or retiring a coded diagnosis is a clinical write, gated the same
  // way AllergiesSection gates its own. `canViewClinical` is much wider than
  // `canEditClinical` — nurses, midwives and the read-only super_admin all see
  // this tab — so leaving the control open let them author the problem list.
  const { canEditClinical } = usePermissions();
  const { problems, create, setStatus } = useProblems(patientId);
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

  const handleStatusChange = async (id: string, status: ProblemStatus) => {
    setSavingStatus(id);
    try {
      await setStatus(id, status);
      showToast(`Condition marked ${humanizeStatus(status).toLowerCase()}`, 'success');
    } catch (err) {
      console.error(err);
      showToast('Could not update this condition. Please try again.', 'error');
    } finally {
      setSavingStatus(null);
    }
  };

  const resetForm = () => { setSearch(''); setPickedCode(null); setOnsetDate(''); setAdding(false); };

  const handleSubmit = async () => {
    if (!pickedCode) { showToast('Pick a diagnosis first', 'error'); return; }
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
      showToast('Condition added', 'success');
      resetForm();
    } catch (err) {
      console.error(err);
      showToast('Could not add this condition. Please try again.', 'error');
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
              <col /><col /><col />
            </colgroup>
            <thead>
              <tr>
                <th>Condition</th>
                <th>Date of onset</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
            {visibleConditions.map(p => (
                <tr key={p._id}>
                  <td style={{ fontWeight: 600 }}>{p.name}{p.icd11Code ? <span style={{ color: 'var(--ehr-muted, #5D728B)', fontWeight: 400 }}> · {p.icd11Code}</span> : null}</td>
                  <td>{p.onsetDate ? formatDate(p.onsetDate) : '—'}</td>
                  <td>
                    {/* The badge IS the control: a condition is retired from the
                        row that records it, not from a separate edit screen. */}
                    <span className={`tamam-status-picker ${STATUS_BADGE[p.status]}`}>
                      {humanizeStatus(p.status)}
                      <Select
                        aria-label={`Status for ${p.name}`}
                        value={p.status}
                        // Retiring a condition is the same clinical write as
                        // adding one — a viewer reads the badge, not edits it.
                        disabled={savingStatus === p._id || !canEditClinical}
                        onChange={e => handleStatusChange(p._id, e.target.value as ProblemStatus)}
                      >
                        {STATUS_OPTIONS.map(option => (
                          <option key={option} value={option}>{humanizeStatus(option)}</option>
                        ))}
                      </Select>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ChartSection>

      {adding && (
        <Modal onClose={() => !submitting && resetForm()} width={480} labelledBy="add-condition-title">
          <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
            <div className="flex items-center justify-between">
              <h2 id="add-condition-title" className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>Add condition</h2>
              <button className="p-1 rounded" onClick={() => !submitting && resetForm()} style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
            </div>
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
            <div className="flex items-center justify-end gap-2 pt-1">
              <button className="btn btn-sm btn-secondary" disabled={submitting} onClick={resetForm}>Cancel</button>
              <button className="btn btn-sm btn-primary" disabled={submitting || !pickedCode} onClick={handleSubmit}>
                {submitting ? 'Saving…' : 'Save condition'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
