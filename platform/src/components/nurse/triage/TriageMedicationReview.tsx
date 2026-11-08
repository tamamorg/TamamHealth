'use client';

/**
 * "Medication list review" on the triage form's history page.
 *
 * Shows the patient's current medication list and lets the triage nurse add,
 * edit and stop entries through the chart's own ReportedMedications form. Each
 * of those writes a `medication` history entry and nothing else: never a
 * prescription, never anything in the pharmacy queue. Active prescriptions are
 * listed read-only so the nurse asks about them too. The review is confirmed
 * with a required tick, saved on the triage (`medicationReview`).
 */

import { useMemo, useState } from 'react';
import { O3Question } from '@/components/forms/O3Form';
import { Plus } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { usePrescriptions } from '@/lib/hooks/usePrescriptions';
import { formatRxSig } from '@/lib/format-utils';
import type { HistoryEntryDoc } from '@/lib/db-types';
import { MEDICATION_HISTORY_DOMAIN, historyForDomain } from '@/lib/clinical/patient-history';
import type { MedicationReviewChanges } from '@/lib/clinical/triage-medication-review';
import ReportedMedications, { type ReportedMedicationChange } from '@/components/ehr/chart/sections/ReportedMedications';
import type { HistoryFormUser } from '@/components/ehr/chart/sections/HistoryEntryForm';
import type { TriageFormState } from './useTriageForm';

type Actor = { userId?: string; userName?: string };

export interface MedicationListReviewProps {
  patientId: string;
  patientName: string;
  /** The patient's active history entries (every domain). */
  entries: readonly HistoryEntryDoc[];
  loadFailed: boolean;
  markInError: (id: string, actor?: Actor) => Promise<unknown>;
  stop: (id: string, actor?: Actor) => Promise<unknown>;
  canRecord: boolean;
  currentUser: HistoryFormUser | null | undefined;
  reviewed: boolean;
  onReviewedChange: (reviewed: boolean) => void;
  changes: MedicationReviewChanges;
  onChanged: (change: ReportedMedicationChange) => void;
}

export function MedicationListReview({
  patientId, patientName, entries, loadFailed, markInError, stop, canRecord, currentUser,
  reviewed, onReviewedChange, changes, onChanged,
}: MedicationListReviewProps) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const medications = useMemo(() => historyForDomain(entries, MEDICATION_HISTORY_DOMAIN), [entries]);
  const { prescriptions } = usePrescriptions(patientId);
  const activeRx = useMemo(
    () => (prescriptions || []).filter(rx => rx.patientId === patientId && rx.status !== 'discontinued'),
    [patientId, prescriptions],
  );
  const changed = changes.added.length + changes.edited.length + changes.stopped.length + changes.removed.length;

  return (
    <div className="o3f-fields">
      <p className="o3f-caption">{t('triageMeds.caption')}</p>
      <div className="o3f-field o3f-field--wide">
        {!loadFailed && medications.length === 0 && <p className="o3f-caption">{t('triageMeds.empty')}</p>}
        <ReportedMedications
          patientId={patientId}
          patientName={patientName}
          medications={medications}
          entries={entries}
          loadFailed={loadFailed}
          canRecord={canRecord}
          currentUser={currentUser}
          adding={adding}
          onCloseAdd={() => setAdding(false)}
          markInError={markInError}
          stop={stop}
          onChanged={onChanged}
        />
        {canRecord && (
          <div style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setAdding(true)}>
              <Plus className="w-3.5 h-3.5" aria-hidden /> {t('triageMeds.add')}
            </button>
          </div>
        )}
      </div>

      {activeRx.length > 0 && (
        <O3Question label={t('triageMeds.prescribedHere')} wide>
          <ul className="o3f-caption" style={{ margin: 0, paddingInlineStart: '1.25em' }}>
            {activeRx.map(rx => (
              <li key={rx._id}>{[rx.medication, formatRxSig(rx)].filter(Boolean).join(' · ')}</li>
            ))}
          </ul>
        </O3Question>
      )}

      {changed > 0 && (
        <p className="o3f-caption" role="status">
          {t('triageMeds.changesSummary', {
            added: changes.added.length,
            edited: changes.edited.length,
            stopped: changes.stopped.length + changes.removed.length,
          })}
        </p>
      )}

      <O3Question label={t('triageMeds.reviewedLabel')} required wide>
        <label className="o3f-choice o3f-confirm">
          <input
            id="triage-medication-reviewed"
            type="checkbox"
            checked={reviewed}
            onChange={e => onReviewedChange(e.target.checked)}
          />
          <span>{t('triageMeds.reviewedConfirm')}</span>
        </label>
      </O3Question>
    </div>
  );
}

/** The section as the triage form renders it, wired to the form's state. */
export function TriageMedicationReview({ f }: { f: TriageFormState }) {
  const { t } = useTranslation();
  const patient = f.selectedTriagePatient;
  if (!patient) return <div className="o3f-fields"><p className="o3f-caption">{t('triageMeds.pickPatient')}</p></div>;
  return (
    <MedicationListReview
      patientId={patient._id}
      patientName={f.selectedPatientFullName}
      entries={f.medicationHistory.entries}
      loadFailed={f.medicationHistory.error}
      markInError={f.medicationHistory.markInError}
      stop={f.medicationHistory.stop}
      canRecord={f.canRecordMedicationHistory}
      currentUser={f.currentUser}
      reviewed={f.medicationReviewed}
      onReviewedChange={f.setMedicationReviewed}
      changes={f.medicationChanges}
      onChanged={f.noteMedicationChange}
    />
  );
}
