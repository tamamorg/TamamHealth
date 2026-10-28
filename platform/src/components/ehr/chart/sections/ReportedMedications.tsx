'use client';

/**
 * Medicines the patient already takes, as they report them — the Medications
 * tab's second list, under the orders placed here.
 *
 * Each row is a `medication` history entry, not a `PrescriptionDoc`: recording
 * one places no order and puts nothing in the pharmacy queue, which is why the
 * nurse taking the history at triage or on the ward can add it while
 * prescribing stays with clinicians. Entries are never deleted; a mistaken one
 * is marked entered in error, like the rest of the history.
 *
 * The add form is opened by the parent's Add control (`adding`), so the
 * section keeps one Add button whichever list it lands on.
 */

import { useState } from 'react';
import Modal from '@/components/Modal';
import { X } from '@/components/icons/lucide';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { formatDate } from '@/lib/format-utils';
import type { HistoryEntryDoc } from '@/lib/db-types';
import { MEDICATION_HISTORY_DOMAIN, formatHistoryEntry } from '@/lib/clinical/patient-history';
import HistoryEntryForm, { type HistoryFormUser } from './HistoryEntryForm';

interface ReportedMedicationsProps {
  patientId: string;
  patientName: string;
  /** Active `medication` history entries for this patient. */
  medications: readonly HistoryEntryDoc[];
  /** Every active history entry, for the form's in-place update rules. */
  entries: readonly HistoryEntryDoc[];
  loadFailed: boolean;
  canRecord: boolean;
  currentUser: HistoryFormUser | null | undefined;
  /** The parent's Add control asked for the form. */
  adding: boolean;
  onCloseAdd: () => void;
  markInError: (id: string, actor?: { userId?: string; userName?: string }) => Promise<unknown>;
}

const SUB = { color: 'var(--ehr-muted, #5D728B)', fontSize: 12 } as const;

export default function ReportedMedications({
  patientId, patientName, medications, entries, loadFailed, canRecord, currentUser, adding, onCloseAdd, markInError,
}: ReportedMedicationsProps) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<HistoryEntryDoc | null>(null);
  const [retiring, setRetiring] = useState<string | null>(null);

  const formOpen = adding || Boolean(editing);
  const closeForm = () => { setEditing(null); onCloseAdd(); };

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
      await markInError(entry._id, { userId: currentUser?._id || currentUser?.username, userName: currentUser?.name });
      showToast(t('history.markedError'), 'success');
    } catch (err) {
      console.error(err);
      showToast(t('history.updateFailed'), 'error');
    } finally {
      setRetiring(null);
    }
  };

  return (
    <>
      {loadFailed && <p className="tamam-attestation" role="alert">{t('meds.reported.loadFailed')}</p>}

      {medications.length > 0 && (
        <div className="tamam-reported-meds">
          <h4 className="tamam-reported-meds-title">{t('meds.reported.title')}</h4>
          <p style={SUB}>{t('meds.reported.hint')}</p>
          <table className="tamam-table tamam-table--medications">
            <thead>
              <tr>
                <th>{t('meds.reported.colMedication')}</th>
                <th>{t('meds.reported.colHow')}</th>
                <th>{t('meds.reported.colSince')}</th>
                <th>{t('meds.reported.colRecorded')}</th>
                {canRecord && <th>{t('meds.reported.colActions')}</th>}
              </tr>
            </thead>
            <tbody>
              {medications.map(entry => (
                <tr key={entry._id}>
                  <td style={{ fontWeight: 600 }}>{entry.title}</td>
                  <td>{entry.detail || '—'}</td>
                  <td>{entry.when || '—'}</td>
                  <td>
                    {entry.updatedByName || entry.recordedByName || '—'}
                    <div style={SUB}>{formatDate(entry.updatedByName ? entry.updatedAt : entry.createdAt)}</div>
                  </td>
                  {canRecord && (
                    <td>
                      <span className="inline-flex gap-1.5">
                        <button type="button" className="btn btn-xs btn-secondary" onClick={() => setEditing(entry)}>
                          {t('history.edit')}
                        </button>
                        <button
                          type="button"
                          className="btn btn-xs btn-secondary"
                          disabled={retiring === entry._id}
                          onClick={() => void handleMarkInError(entry)}
                        >
                          {t('history.confirmErrorAction')}
                        </button>
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && canRecord && (
        <Modal variant="slider" className="tamam-dialog" onClose={closeForm} width={480} labelledBy="reported-med-title">
          <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
            <div className="flex items-center justify-between">
              <h2 id="reported-med-title" className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                {t(editing ? 'history.editTitle.medication' : 'history.addTitle.medication')}
              </h2>
              <button type="button" className="p-1 rounded" aria-label={t('history.close')} onClick={closeForm} style={{ color: 'var(--text-muted)' }}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <p style={SUB}>{t('meds.reported.hint')}</p>
            <HistoryEntryForm
              key={editing?._id || 'new-medication'}
              domain={MEDICATION_HISTORY_DOMAIN}
              patientId={patientId}
              patientName={patientName}
              entry={editing}
              entries={entries}
              currentUser={currentUser}
              onSaved={closeForm}
              onCancel={closeForm}
            />
          </div>
        </Modal>
      )}
    </>
  );
}
