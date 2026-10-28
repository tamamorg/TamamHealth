'use client';

/**
 * Record vitals and biometrics — a workspace docked on the right of the chart,
 * the way OpenMRS O3's vitals workspace is: not a popup. The chart stays lit
 * and usable beside it (no scrim; a click on the chart does not close it), so
 * the nurse can read earlier readings while entering new ones. Only the ✕,
 * Cancel, Escape or a save closes it. Every value sits in a large tile with
 * its unit underneath so it can be read at a glance across the room.
 *
 * Two sections, in the order a nurse takes them: vitals (temperature, blood
 * pressure as one systolic/diastolic tile, heart rate, respiration, SpO2,
 * notes), then biometrics (weight, height, BMI calculated as they type,
 * MUAC). Pain, glucose and GCS follow under "More measurements" so nothing
 * the old grid captured is lost.
 *
 * `presentation='page'` renders the same form alone, for the full-page
 * `/patients/[id]/vitals/new` that the panel's Expand button opens.
 */

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Maximize2, Save, X } from '@/components/icons/lucide';
import { expandHref } from '@/lib/navigation/expand-to-page';
import { calculateBmi, getVitalFlags, isVitalInRange, type VitalsInput, type VITAL_RANGES } from '@/lib/clinical/vitals';
import { recordNursingVitals } from '@/lib/services/medical-record-service';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { MedicalRecordDoc } from '@/lib/db-types';
import { describeError } from '@/lib/user-facing-error';
import { isAnyModalOpen } from '@/components/Modal';
import './nurse-vitals-panel.css';

type NurseVitals = VitalsInput & { height?: string };
type FieldKey = Exclude<keyof NurseVitals, 'notes'>;

interface FieldDef {
  key: FieldKey;
  labelKey: string;
  unit: string;
  placeholder: string;
  rangeKey?: keyof typeof VITAL_RANGES;
}

const FIELDS: Record<FieldKey, FieldDef> = {
  temperature: { key: 'temperature', labelKey: 'vitalsPanel.temperature', unit: '°C', placeholder: '--.-', rangeKey: 'temperature' },
  systolic: { key: 'systolic', labelKey: 'vitalsPanel.systolic', unit: 'mmHg', placeholder: '---', rangeKey: 'systolic' },
  diastolic: { key: 'diastolic', labelKey: 'vitalsPanel.diastolic', unit: 'mmHg', placeholder: '---', rangeKey: 'diastolic' },
  pulse: { key: 'pulse', labelKey: 'vitalsPanel.heartRate', unit: 'beats/min', placeholder: '---', rangeKey: 'pulse' },
  respiratoryRate: { key: 'respiratoryRate', labelKey: 'vitalsPanel.respirationRate', unit: 'breaths/min', placeholder: '--', rangeKey: 'respiratoryRate' },
  spo2: { key: 'spo2', labelKey: 'vitalsPanel.spo2', unit: '%', placeholder: '--', rangeKey: 'spo2' },
  weight: { key: 'weight', labelKey: 'vitalsPanel.weight', unit: 'kg', placeholder: '--.-', rangeKey: 'weight' },
  height: { key: 'height', labelKey: 'vitalsPanel.height', unit: 'cm', placeholder: '---' },
  muac: { key: 'muac', labelKey: 'vitalsPanel.muac', unit: 'cm', placeholder: '--', rangeKey: 'muac' },
  painScore: { key: 'painScore', labelKey: 'vitalsPanel.painScore', unit: '/10', placeholder: '-', rangeKey: 'painScore' },
  bloodGlucose: { key: 'bloodGlucose', labelKey: 'vitalsPanel.bloodGlucose', unit: 'mmol/L', placeholder: '--.-', rangeKey: 'bloodGlucose' },
  gcs: { key: 'gcs', labelKey: 'vitalsPanel.gcs', unit: '/15', placeholder: '--', rangeKey: 'gcs' },
};

const blankVitals = (): NurseVitals => ({
  temperature: '', systolic: '', diastolic: '', pulse: '', respiratoryRate: '', spo2: '',
  weight: '', height: '', painScore: '', bloodGlucose: '', gcs: '', muac: '', notes: '',
});

function vitalsFromRecord(record?: MedicalRecordDoc): NurseVitals {
  if (!record) return blankVitals();
  const value = (field: keyof NonNullable<MedicalRecordDoc['vitalSigns']>) => {
    const raw = record.vitalSigns?.[field];
    return raw === undefined || raw === null ? '' : String(raw);
  };
  return {
    temperature: value('temperature'), systolic: value('systolic'), diastolic: value('diastolic'),
    pulse: value('pulse'), respiratoryRate: value('respiratoryRate'), spo2: value('oxygenSaturation'),
    weight: value('weight'), height: value('height'), painScore: value('painScore'),
    bloodGlucose: value('bloodGlucose'), gcs: value('gcs'), muac: value('muac'),
    notes: record.historyOfPresentIllness || '',
  };
}

export default function NurseVitalsModal({
  patientId,
  patientName,
  hospitalNumber,
  hospitalId,
  hospitalName,
  orgId,
  encounterId,
  currentUser,
  correctingRecord,
  onClose,
  onSaved,
  presentation = 'modal',
}: {
  patientId: string;
  patientName: string;
  hospitalNumber?: string;
  hospitalId: string;
  hospitalName?: string;
  orgId?: string;
  encounterId?: string;
  currentUser: Pick<{ _id: string; name: string }, '_id' | 'name'>;
  correctingRecord?: MedicalRecordDoc;
  onClose: () => void;
  onSaved?: () => void;
  /**
   * 'modal' (the default) slides the form in from the right; 'page' renders
   * the form alone, for `/patients/[id]/vitals/new` inside `CreateRecordPage`;
   * 'workspace' renders it to fill the patient chart's docked workspace slot,
   * with its own scroll and a pinned footer (the slot supplies the header).
   */
  presentation?: 'modal' | 'page' | 'workspace';
}) {
  const router = useRouter();
  const toast = useToast();
  const { t } = useTranslation();
  const [vitals, setVitals] = useState<NurseVitals>(() => vitalsFromRecord(correctingRecord));
  const [correctionReason, setCorrectionReason] = useState('');
  const [saving, setSaving] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const flags = getVitalFlags(vitals);
  const bmi = calculateBmi(vitals.weight, vitals.height);

  const close = () => { if (!saving) onClose(); };

  const save = async () => {
    const entered = Object.entries(vitals).some(([key, value]) => key !== 'notes' && Boolean(value?.trim()));
    if (!entered) {
      toast.showToast(t('msg.enterAtLeastOneVital'), 'error');
      return;
    }
    if (correctingRecord && correctionReason.trim().length < 3) {
      toast.showToast(t('chart.vitalsCorrectionReasonRequired'), 'error');
      return;
    }
    for (const field of Object.values(FIELDS)) {
      const value = vitals[field.key]?.trim();
      if (value && field.rangeKey && !isVitalInRange(field.rangeKey, value)) {
        toast.showToast(t('msg.isOutsideTheAcceptedRange', { label: t(field.labelKey) }), 'error');
        return;
      }
    }
    setSaving(true);
    try {
      await recordNursingVitals({
        patientId,
        patientName,
        hospitalId,
        hospitalName,
        orgId,
        encounterId,
        correctsRecordId: correctingRecord?._id,
        correctionReason: correctingRecord ? correctionReason.trim() : undefined,
        recordedById: currentUser._id,
        recordedByName: currentUser.name,
        vitals,
      });
      onSaved?.();
      onClose();
    } catch (error) {
      toast.showToast(describeError(error, t('msg.vitalsNotSavedTryAgain')), 'error');
    } finally {
      setSaving(false);
    }
  };

  // Workspace behaviour: focus the first field, Escape closes, and focus goes
  // back to whatever opened it. Tab is NOT trapped — the chart beside the
  // workspace stays reachable, as it is in OpenMRS.
  useEffect(() => {
    if (presentation !== 'modal') return;
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !isAnyModalOpen()) { event.preventDefault(); close(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); opener?.focus?.(); };
    // close() only reads `saving`; re-binding on every keystroke is not needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentation]);

  const setField = (key: FieldKey) => (event: ChangeEvent<HTMLInputElement>) =>
    setVitals(current => ({ ...current, [key]: event.target.value }));

  const numberInput = (key: FieldKey, ariaLabel?: string) => (
    <input
      type="number"
      inputMode="decimal"
      min="0"
      step="any"
      value={vitals[key] || ''}
      onChange={setField(key)}
      placeholder={FIELDS[key].placeholder}
      aria-label={ariaLabel || t(FIELDS[key].labelKey)}
      aria-invalid={flags[key] ? true : undefined}
      className="nv-input"
    />
  );

  const tile = (key: FieldKey) => (
    <div className="nv-field" key={key}>
      <span className="nv-label" id={`nv-${key}`}>{t(FIELDS[key].labelKey)}</span>
      <div className={`nv-tile${flags[key] ? ' is-flagged' : ''}`}>
        {numberInput(key)}
        <span className="nv-unit">{FIELDS[key].unit}</span>
      </div>
      {flags[key] && <span className="nv-flag">{t('vitalsPanel.checkValue')}</span>}
    </div>
  );

  const bpFlagged = flags.systolic || flags.diastolic;

  const form = (
    <div className="nv-form">
      <section className="nv-section" aria-labelledby="nv-vitals-heading">
        <h3 id="nv-vitals-heading" className="nv-section-title">{t('vitalsPanel.sectionVitals')}</h3>
        <div className="nv-grid">
          {tile('temperature')}
          <div className="nv-field">
            <span className="nv-label">{t('vitalsPanel.bloodPressure')}</span>
            <div className={`nv-tile nv-tile--bp${bpFlagged ? ' is-flagged' : ''}`}>
              <div className="nv-bp">
                {numberInput('systolic', t('vitalsPanel.systolic'))}
                <span className="nv-bp-sep" aria-hidden>/</span>
                {numberInput('diastolic', t('vitalsPanel.diastolic'))}
              </div>
              <span className="nv-unit">mmHg</span>
            </div>
            {bpFlagged && <span className="nv-flag">{t('vitalsPanel.checkValue')}</span>}
          </div>
          {tile('pulse')}
          {tile('respiratoryRate')}
          {tile('spo2')}
        </div>
        <label className="nv-notes">
          <span className="nv-label">{t('vitalsPanel.notes')}</span>
          <textarea
            value={vitals.notes || ''}
            onChange={event => setVitals(current => ({ ...current, notes: event.target.value }))}
            rows={3}
            placeholder={t('vitalsPanel.notesPlaceholder')}
          />
        </label>
      </section>

      <section className="nv-section" aria-labelledby="nv-bio-heading">
        <h3 id="nv-bio-heading" className="nv-section-title">{t('vitalsPanel.sectionBiometrics')}</h3>
        <div className="nv-grid">
          {tile('weight')}
          {tile('height')}
          <div className="nv-field">
            <span className="nv-label">{t('vitalsPanel.bmi')}</span>
            <div className="nv-tile nv-tile--readonly" aria-live="polite">
              <span className="nv-input nv-input--readonly">{bmi ?? ''}</span>
              <span className="nv-unit">kg / m²</span>
            </div>
          </div>
          {tile('muac')}
        </div>
      </section>

      <section className="nv-section" aria-labelledby="nv-more-heading">
        <h3 id="nv-more-heading" className="nv-section-title">{t('vitalsPanel.sectionMore')}</h3>
        <div className="nv-grid">
          {tile('painScore')}
          {tile('bloodGlucose')}
          {tile('gcs')}
        </div>
      </section>

      {correctingRecord && (
        <label className="nv-notes">
          <span className="nv-label">{t('chart.correctionReason')}</span>
          <textarea
            value={correctionReason}
            onChange={event => setCorrectionReason(event.target.value)}
            rows={2}
            required
            placeholder={t('chart.vitalsCorrectionReasonPlaceholder')}
          />
        </label>
      )}
    </div>
  );

  const actions = (
    <div className="nv-footer">
      <button type="button" className="nv-btn nv-btn--ghost" onClick={close} disabled={saving}>{t('vitalsPanel.cancel')}</button>
      <button type="button" className="nv-btn nv-btn--primary" onClick={() => void save()} disabled={saving}>
        <Save aria-hidden /> {saving ? t('vitalsPanel.saving') : correctingRecord ? t('chart.saveCorrection') : t('vitalsPanel.save')}
      </button>
    </div>
  );

  if (presentation === 'page') return <div className="nv-root nv-root--page">{form}{actions}</div>;
  if (presentation === 'workspace') {
    return <div className="nv-root nv-root--workspace"><div className="nv-body">{form}</div>{actions}</div>;
  }

  const title = correctingRecord ? t('chart.correctVitals') : t('vitalsPanel.title');
  const panel = (
    <div className="nv-root">
      <div ref={panelRef} className="nv-panel" role="dialog" aria-modal="false" aria-labelledby="nv-title">
        <header className="nv-header">
          <div className="nv-header-text">
            <h2 id="nv-title" className="nv-title">{title}</h2>
            <p className="nv-subtitle">{patientName} · {hospitalNumber || t('vitalsPanel.noId')}</p>
          </div>
          {/* A correction is anchored to the record it corrects, which the
              full page has no way to be handed — so only a new reading
              expands. */}
          {!correctingRecord && (
            <button
              type="button"
              className="nv-icon-btn"
              aria-label={t('vitalsPanel.expand')}
              title={t('vitalsPanel.expand')}
              onClick={() => {
                onClose();
                const query = encounterId ? `?encounter=${encodeURIComponent(encounterId)}` : '';
                router.push(expandHref(`/patients/${encodeURIComponent(patientId)}/vitals/new${query}`));
              }}
            >
              <Maximize2 aria-hidden />
            </button>
          )}
          <button type="button" className="nv-icon-btn nv-icon-btn--close" aria-label={t('vitalsPanel.close')} onClick={close}>
            <X aria-hidden />
          </button>
        </header>
        <div className="nv-body">{form}</div>
        {actions}
      </div>
    </div>
  );

  // Portalled so no ancestor's overflow or transform can clip a fixed panel.
  return typeof document === 'undefined' ? null : createPortal(panel, document.body);
}
