'use client';

import { useState } from 'react';
import { Activity, Save, X } from '@/components/icons/lucide';
import Modal from '@/components/Modal';
import { getVitalFlags, isVitalInRange, type VitalsInput } from '@/lib/clinical/vitals';
import { recordNursingVitals } from '@/lib/services/medical-record-service';
import { useToast } from '@/components/Toast';

type NurseVitals = VitalsInput & { height?: string };

const FIELDS: Array<{ key: keyof NurseVitals; label: string; unit: string; placeholder: string; rangeKey?: keyof typeof import('@/lib/clinical/vitals').VITAL_RANGES }> = [
  { key: 'temperature', label: 'Temperature', unit: '°C', placeholder: '36.8', rangeKey: 'temperature' },
  { key: 'systolic', label: 'Systolic BP', unit: 'mmHg', placeholder: '120', rangeKey: 'systolic' },
  { key: 'diastolic', label: 'Diastolic BP', unit: 'mmHg', placeholder: '80', rangeKey: 'diastolic' },
  { key: 'pulse', label: 'Pulse', unit: 'bpm', placeholder: '72', rangeKey: 'pulse' },
  { key: 'respiratoryRate', label: 'Respiratory rate', unit: '/min', placeholder: '16', rangeKey: 'respiratoryRate' },
  { key: 'spo2', label: 'Oxygen saturation', unit: '%', placeholder: '98', rangeKey: 'spo2' },
  { key: 'weight', label: 'Weight', unit: 'kg', placeholder: '65', rangeKey: 'weight' },
  { key: 'height', label: 'Height', unit: 'cm', placeholder: '170' },
  { key: 'painScore', label: 'Pain score', unit: '/10', placeholder: '0', rangeKey: 'painScore' },
  { key: 'bloodGlucose', label: 'Blood glucose', unit: 'mmol/L', placeholder: '5.5', rangeKey: 'bloodGlucose' },
  { key: 'gcs', label: 'GCS', unit: '/15', placeholder: '15', rangeKey: 'gcs' },
  { key: 'muac', label: 'MUAC', unit: 'cm', placeholder: '22', rangeKey: 'muac' },
];

const blankVitals = (): NurseVitals => ({
  temperature: '', systolic: '', diastolic: '', pulse: '', respiratoryRate: '', spo2: '',
  weight: '', height: '', painScore: '', bloodGlucose: '', gcs: '', muac: '', notes: '',
});

export default function NurseVitalsModal({
  patientId,
  patientName,
  hospitalNumber,
  hospitalId,
  hospitalName,
  orgId,
  encounterId,
  currentUser,
  onClose,
  onSaved,
}: {
  patientId: string;
  patientName: string;
  hospitalNumber?: string;
  hospitalId: string;
  hospitalName?: string;
  orgId?: string;
  encounterId?: string;
  currentUser: Pick<{ _id: string; name: string }, '_id' | 'name'>;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const toast = useToast();
  const [vitals, setVitals] = useState<NurseVitals>(blankVitals);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const entered = Object.entries(vitals).some(([key, value]) => key !== 'notes' && Boolean(value?.trim()));
    if (!entered) {
      toast.showToast('Enter at least one vital sign.', 'error');
      return;
    }
    for (const field of FIELDS) {
      const value = vitals[field.key]?.trim();
      if (value && field.rangeKey && !isVitalInRange(field.rangeKey, value)) {
        toast.showToast(`${field.label} is outside the valid range. Check the value.`, 'error');
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
        recordedById: currentUser._id,
        recordedByName: currentUser.name,
        vitals,
      });
      onSaved?.();
      onClose();
    } catch (error) {
      toast.showToast(error instanceof Error ? error.message : 'Failed to save vitals', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={() => { if (!saving) onClose(); }} width={620} labelledBy="nurse-vitals-title">
      <div className="p-5" style={{ background: 'var(--bg-card-solid, var(--bg-card))' }}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
              <h2 id="nurse-vitals-title" className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Record vitals</h2>
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{patientName} · {hospitalNumber || 'No ID'}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close" style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {FIELDS.map(field => {
            const flagged = Boolean(getVitalFlags(vitals)[field.key]);
            return (
              <label key={field.key} className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                <span className="flex justify-between gap-2 mb-1"><span>{field.label}</span><span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{field.unit}</span></span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={vitals[field.key] || ''}
                  onChange={event => setVitals(current => ({ ...current, [field.key]: event.target.value }))}
                  placeholder={field.placeholder}
                  className="w-full rounded border px-2.5 py-2 text-sm"
                  style={{ borderColor: flagged ? 'var(--color-danger)' : 'var(--border-light)', background: 'var(--bg-input, var(--bg-app))', color: 'var(--text-primary)' }}
                />
                {flagged && <span className="block mt-1 text-[10px]" style={{ color: 'var(--color-danger-text)' }}>Check this value</span>}
              </label>
            );
          })}
        </div>
        <label className="block mt-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
          Notes
          <textarea value={vitals.notes || ''} onChange={event => setVitals(current => ({ ...current, notes: event.target.value }))} rows={2} className="w-full mt-1 rounded border px-2.5 py-2 text-sm resize-none" placeholder="Position, oxygen, symptoms, or other observation" style={{ borderColor: 'var(--border-light)', background: 'var(--bg-input, var(--bg-app))', color: 'var(--text-primary)' }} />
        </label>
        <div className="flex justify-end gap-2 mt-4 pt-3" style={{ borderTop: '1px solid var(--border-light)' }}>
          <button type="button" onClick={onClose} disabled={saving} className="px-3 py-2 rounded text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>Cancel</button>
          <button type="button" onClick={() => void save()} disabled={saving} className="flex items-center gap-1.5 px-3 py-2 rounded text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--accent-primary)' }}>
            <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save vitals'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
