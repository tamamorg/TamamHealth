'use client';

/**
 * Nutrition screening — chart workspace form (`nutrition-screening` panel).
 *
 * Screening used to live only on the nutrition station, behind its own
 * "New screening" button; the chart's Clinical forms row navigated away to
 * that console. It is recorded here now, beside the record it belongs to: the
 * patient is already known, so name/sex/age come from the chart and the form
 * is just the measurements. The same `nutrition_screening` store and the same
 * `classifyScreening` thresholds the station used — nothing is re-derived.
 *
 * Earlier screenings for this patient sit above the form, with the follow-up
 * actions a flagged (SAM / MAM / at-risk) result still needs.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useNutritionScreenings } from '@/lib/hooks/useNutritionScreenings';
import { classifyScreening } from '@/lib/services/nutrition-screening-service';
import { patientFullName } from '@/lib/patient-utils';
import { formatDate } from '@/lib/format-utils';
import { describeError } from '@/lib/user-facing-error';
import FormNotices from '@/components/overlay/FormNotices';
import type { NutritionFollowUpAction, NutritionScreeningDoc, PatientDoc } from '@/lib/db-types';
import type { ChartPanelUser } from './types';
import './start-visit-panel.css';

interface NutritionScreeningPanelProps {
  patient: PatientDoc;
  currentUser: ChartPanelUser | null | undefined;
  onClose: () => void;
}

/** The screening record's age string ("18m", "3y") from the chart. Under two
 *  the reading is in months, the way MUAC charts are read. */
export function screeningAgeLabel(patient: { dateOfBirth?: string; estimatedAge?: number }, now: Date = new Date()): string {
  if (patient.dateOfBirth) {
    const [y, m, d] = patient.dateOfBirth.slice(0, 10).split('-').map(Number);
    if (y && m && d) {
      let months = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
      if (now.getDate() < d) months -= 1;
      if (months >= 0) return months < 24 ? `${months}m` : `${Math.floor(months / 12)}y`;
    }
  }
  return typeof patient.estimatedAge === 'number' && patient.estimatedAge > 0 ? `${patient.estimatedAge}y` : '';
}

const FLAGGED = new Set(['SAM', 'MAM', 'At Risk', 'Underweight']);

function statusTone(status: string): string {
  if (status === 'SAM') return 'var(--color-danger-text)';
  if (FLAGGED.has(status)) return 'var(--color-warning-text, var(--color-warning))';
  return 'var(--color-success-text)';
}

export default function NutritionScreeningPanel({ patient, currentUser, onClose }: NutritionScreeningPanelProps) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const router = useRouter();
  const { screenings, add, update } = useNutritionScreenings();
  const history = useMemo(
    () => screenings.filter(s => s.patientId === patient._id).slice(0, 3),
    [screenings, patient._id],
  );

  const isFemale = patient.gender === 'Female';
  const [muac, setMuac] = useState('');
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [edema, setEdema] = useState(false);
  const [isAnc, setIsAnc] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const muacValue = parseFloat(muac);
  const preview = Number.isFinite(muacValue) && muacValue > 0
    ? classifyScreening(muacValue, edema, isFemale && isAnc)
    : null;

  const save = async () => {
    if (!Number.isFinite(muacValue) || muacValue <= 0 || muacValue > 40) {
      showToast(t('nutrition.formErrorMuac'), 'error');
      return;
    }
    const age = screeningAgeLabel(patient);
    const weightKg = parseFloat(weight);
    const heightCm = parseFloat(height);
    setSaving(true);
    try {
      await add({
        patientId: patient._id,
        patientName: patientFullName(patient),
        age: isFemale && isAnc ? `${age} ANC`.trim() : age,
        sex: patient.gender === 'Male' ? 'M' : 'F',
        muac: muacValue,
        weightKg: Number.isFinite(weightKg) ? weightKg : undefined,
        heightCm: Number.isFinite(heightCm) ? heightCm : undefined,
        edema,
        isAnc: isFemale && isAnc,
        notes: notes.trim() || undefined,
        screenedById: currentUser?._id,
        screenedByName: currentUser?.name,
        hospitalId: currentUser?.hospitalId,
        orgId: currentUser?.orgId,
      });
      showToast(t('nutritionForm.saved'), 'success');
      onClose();
    } catch (err) {
      showToast(describeError(err, t('screenings.errFailed')), 'error');
    } finally {
      setSaving(false);
    }
  };

  const setFollowUp = async (screening: NutritionScreeningDoc, action: NutritionFollowUpAction) => {
    try {
      await update(screening._id, { followUpAction: action });
      if (action === 'referred') router.push(`/referrals?patient=${encodeURIComponent(screening.patientName)}`);
    } catch (err) {
      showToast(describeError(err, t('screenings.errFailed')), 'error');
    }
  };

  const followUpLabel = (action?: NutritionFollowUpAction) => {
    if (action === 'followed_up') return t('nutrition.followedUp');
    if (action === 'referred') return t('nutrition.referred');
    if (action === 'treatment_started') return t('nutrition.treatmentStarted');
    return t('nutrition.followUpNeeded');
  };

  return (
    <div className="sv-root">
      <div className="sv-body">
        {history.length > 0 && (
          <section>
            <h3 className="sv-label">{t('nutritionForm.previous')}</h3>
            <dl className="sv-facts">
              {history.map(s => {
                const open = FLAGGED.has(s.status) && (!s.followUpAction || s.followUpAction === 'needed');
                return (
                  <div key={s._id}>
                    <dt>{formatDate(s.screeningDate)}</dt>
                    <dd>
                      <strong style={{ color: statusTone(s.status) }}>{s.status}</strong>
                      {' · '}{t('nutritionForm.muacReading', { value: s.muac })}
                      {s.edema ? ` · ${t('nutrition.formEdema')}` : ''}
                      {FLAGGED.has(s.status) && (
                        open ? (
                          <span className="nsp-actions">
                            <button type="button" onClick={() => void setFollowUp(s, 'followed_up')}>{t('nutrition.markFollowedUp')}</button>
                            <button type="button" onClick={() => void setFollowUp(s, 'treatment_started')}>{t('nutrition.startTreatment')}</button>
                            <button type="button" onClick={() => void setFollowUp(s, 'referred')}>{t('nutrition.refer')}</button>
                          </span>
                        ) : (
                          <span className="nsp-done">{followUpLabel(s.followUpAction)}</span>
                        )
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        )}

        <div className="sv-form">
          <div className="nsp-grid">
            <label className="sv-field">
              <span className="sv-label">{t('nutrition.formMuac')}</span>
              <input type="number" step="0.1" min="0" inputMode="decimal" value={muac}
                onChange={e => setMuac(e.target.value)} data-modal-initial-focus />
            </label>
            <label className="sv-field">
              <span className="sv-label">{t('nutrition.formWeight')}</span>
              <input type="number" step="0.1" min="0" inputMode="decimal" value={weight} onChange={e => setWeight(e.target.value)} />
            </label>
            <label className="sv-field">
              <span className="sv-label">{t('nutrition.formHeight')}</span>
              <input type="number" step="0.1" min="0" inputMode="decimal" value={height} onChange={e => setHeight(e.target.value)} />
            </label>
          </div>

          <div className="nsp-checks">
            <label><input type="checkbox" checked={edema} onChange={e => setEdema(e.target.checked)} /> {t('nutrition.formEdema')}</label>
            {isFemale && (
              <label><input type="checkbox" checked={isAnc} onChange={e => setIsAnc(e.target.checked)} /> {t('nutrition.formAnc')}</label>
            )}
          </div>

          {preview && (
            <p className="nsp-preview">
              {t('nutrition.formClassification')}: <strong style={{ color: statusTone(preview) }}>{preview}</strong>
            </p>
          )}

          <label className="sv-field">
            <span className="sv-label">{t('nutrition.formNotes')}</span>
            <textarea rows={3} value={notes} placeholder={t('nutrition.formNotesPlaceholder')} onChange={e => setNotes(e.target.value)} />
          </label>
        </div>
      </div>
      <FormNotices />
      <div className="sv-footer">
        <button type="button" className="sv-footer-btn sv-footer-btn--discard" onClick={onClose} disabled={saving}>
          {t('nutrition.formCancel')}
        </button>
        <button type="button" className="sv-footer-btn sv-footer-btn--primary" onClick={() => void save()} disabled={saving || !muac}>
          {saving ? t('nutritionForm.saving') : t('nutrition.formSave')}
        </button>
      </div>
    </div>
  );
}
