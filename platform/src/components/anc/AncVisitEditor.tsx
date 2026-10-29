'use client';

/**
 * Edit / correct a saved ANC visit, as a right-hand slider. Shared by the ANC
 * register (/anc) and the patient chart's Antenatal care section, so both
 * write the same fields through the same `updateANCVisit` path (audit and sync
 * preserved; a visit is corrected, never hard-deleted from the UI).
 */
import { useState } from 'react';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import { X } from '@/components/icons/lucide';
import { useANC } from '@/lib/hooks/useANC';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { describeError } from '@/lib/user-facing-error';
import type { ANCVisitDoc } from '@/lib/db-types';

export default function AncVisitEditor({ visit, onClose, onSaved }: {
  visit: ANCVisitDoc;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { update } = useANC();
  const [draft, setDraft] = useState<ANCVisitDoc>(visit);
  const [saving, setSaving] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await update(draft._id, {
        visitDate: draft.visitDate,
        gestationalAge: draft.gestationalAge,
        bloodPressure: draft.bloodPressure,
        weight: draft.weight,
        hemoglobin: draft.hemoglobin,
        fetalHeartRate: draft.fetalHeartRate,
        riskLevel: draft.riskLevel,
        nextVisitDate: draft.nextVisitDate,
        notes: draft.notes,
      });
      onSaved?.();
      onClose();
    } catch (error) {
      showToast(describeError(error, t('ancChart.notSaved')), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal variant="slider" onClose={onClose} width={560} labelledBy="anc-edit-title">
      <div className="modal-panel p-6 w-full overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 id="anc-edit-title" className="text-lg font-semibold">{t('ancChart.editTitle', { n: draft.visitNumber, name: draft.motherName })}</h3>
          <button type="button" onClick={onClose} aria-label={t('action.close')}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label>{t('ancChart.visitDate')}</label>
              <input type="date" value={draft.visitDate} onChange={e => setDraft({ ...draft, visitDate: e.target.value })} />
            </div>
            <div>
              <label>{t('ancChart.gaWeeks')}</label>
              <input type="number" step="1" min={4} max={44} value={draft.gestationalAge} onChange={e => setDraft({ ...draft, gestationalAge: parseInt(e.target.value, 10) || 0 })} />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label>{t('ancChart.bp')}</label>
              <input type="text" value={draft.bloodPressure} onChange={e => setDraft({ ...draft, bloodPressure: e.target.value })} placeholder="120/80" />
            </div>
            <div>
              <label>{t('ancChart.weight')}</label>
              <input type="number" step="0.1" value={draft.weight || ''} onChange={e => setDraft({ ...draft, weight: parseFloat(e.target.value) })} />
            </div>
            <div>
              <label>{t('ancChart.hb')}</label>
              <input type="number" step="0.1" value={draft.hemoglobin || ''} onChange={e => setDraft({ ...draft, hemoglobin: parseFloat(e.target.value) })} />
            </div>
            <div>
              <label>{t('ancChart.fhr')}</label>
              <input type="number" step="1" value={draft.fetalHeartRate || ''} onChange={e => setDraft({ ...draft, fetalHeartRate: parseInt(e.target.value, 10) })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label>{t('ancChart.risk')}</label>
              <Select value={draft.riskLevel} onChange={e => setDraft({ ...draft, riskLevel: e.target.value as ANCVisitDoc['riskLevel'] })}>
                <option value="low">{t('ancChart.riskLow')}</option>
                <option value="moderate">{t('ancChart.riskModerate')}</option>
                <option value="high">{t('ancChart.riskHigh')}</option>
              </Select>
            </div>
            <div>
              <label>{t('ancChart.nextVisit')}</label>
              <input type="date" value={draft.nextVisitDate || ''} onChange={e => setDraft({ ...draft, nextVisitDate: e.target.value })} />
            </div>
          </div>
          <div>
            <label>{t('ancChart.notes')}</label>
            <textarea rows={2} value={draft.notes || ''} onChange={e => setDraft({ ...draft, notes: e.target.value })} />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn btn-secondary flex-1">{t('action.cancel')}</button>
            <button type="submit" disabled={saving} className="btn btn-primary flex-1">{t('action.saveChanges')}</button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
