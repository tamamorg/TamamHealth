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
 * never copied: a diagnosis is still added and retired on Conditions, so the
 * two can never disagree about what the patient has.
 */

import { useState } from 'react';
import ChartSection from '../ChartSection';
import HistoryEntryForm from './HistoryEntryForm';
import Modal from '@/components/Modal';
import { useConfirm } from '@/components/ConfirmDialog';
import { X } from '@/components/icons/lucide';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { useHistoryEntries } from '@/lib/hooks/useHistoryEntries';
import { useProblems } from '@/lib/hooks/useProblems';
import { useProcedures } from '@/lib/hooks/useProcedures';
import { formatDate, humanizeStatus } from '@/lib/format-utils';
import type { HistoryDomain, HistoryEntryDoc } from '@/lib/db-types';
import {
  HISTORY_DOMAINS, OTHER_SOCIAL_FACTOR, formatHistoryEntry, getSocialFactor, historyForDomain, performedProcedures,
} from '@/lib/clinical/patient-history';

const MUTED = { color: 'var(--ehr-muted, #5D728B)', fontWeight: 400 } as const;
const SUB = { ...MUTED, fontSize: 12 } as const;

/** Column heading keys per domain (`history.col.*`), ending with the actions. */
const COLUMNS: Record<HistoryDomain, readonly string[]> = {
  medical: ['illness', 'when', 'details', 'recorded', 'actions'],
  surgical: ['operation', 'when', 'where', 'recorded', 'actions'],
  family: ['relative', 'condition', 'details', 'recorded', 'actions'],
  social: ['factor', 'finding', 'recorded', 'actions'],
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
  // Everyone who cares for the patient can record history — nurses included.
  // (The borrowed problem-list rows stay read-only here; diagnoses are still a
  // clinician's write, made on Conditions.)
  const { canRecordHistory } = usePermissions();
  const { entries, loading, error, markInError } = useHistoryEntries(patientId);
  const { problems } = useProblems(patientId);
  const { procedures } = useProcedures(patientId);

  const [form, setForm] = useState<{ domain: HistoryDomain; entry: HistoryEntryDoc | null } | null>(null);
  const [retiring, setRetiring] = useState<string | null>(null);

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
      await markInError(entry._id, { userId: currentUser?._id, userName: currentUser?.name });
      showToast(t('history.markedError'), 'success');
    } catch (err) {
      console.error(err);
      showToast(t('history.updateFailed'), 'error');
    } finally {
      setRetiring(null);
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

  const actions = (entry: HistoryEntryDoc) => (
    <td>
      {canRecordHistory ? (
        <span className="inline-flex gap-1.5">
          <button
            type="button"
            className="btn btn-xs btn-secondary"
            onClick={() => setForm({ domain: entry.domain, entry })}
          >
            {t('history.edit')}
          </button>
          <button
            type="button"
            className="btn btn-xs btn-secondary"
            disabled={retiring === entry._id}
            onClick={() => void handleMarkInError(entry)}
            title={t('history.markErrorHint')}
          >
            {t('history.markError')}
          </button>
        </span>
      ) : null}
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
          <td />
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
          <td />
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
                      {column === 'actions'
                        ? <span className="sr-only">{t('history.col.actions')}</span>
                        : t(`history.col.${column}`)}
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

      {form && (
        <Modal
          className="tamam-dialog"
          onClose={() => setForm(null)}
          width={480}
          labelledBy="history-entry-title"
        >
          <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
            <div className="flex items-center justify-between">
              <h2 id="history-entry-title" className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                {t(`${form.entry ? 'history.editTitle' : 'history.addTitle'}.${form.domain}`)}
              </h2>
              <button type="button" className="p-1 rounded" aria-label={t('history.close')} onClick={() => setForm(null)} style={{ color: 'var(--text-muted)' }}>
                <X className="w-4 h-4" />
              </button>
            </div>
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
        </Modal>
      )}
    </>
  );
}
