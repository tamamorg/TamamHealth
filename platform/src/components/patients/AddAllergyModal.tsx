'use client';

/**
 * Single canonical "Add Allergy" modal — was previously hand-rolled twice
 * (ChartSafetyActions.tsx and AllergyList.tsx each had their own copy of
 * this exact form). Both now render this instead.
 */

import { useState } from 'react';
import { AlertTriangle, X } from '@/components/icons/lucide';
import Modal from '@/components/Modal';
import CodedSearchField from '@/components/CodedSearchField';
import { COMMON_ALLERGENS, type AllergenClassification } from '@/data/allergens';
import type { AllergyEntry } from '@/data/mock';
import Select from '@/components/Select';

const CLASSIFICATIONS: AllergenClassification[] = ['drug', 'food', 'environmental', 'biologic', 'other'];
const CRITICALITIES: NonNullable<AllergyEntry['criticality']>[] = ['mild', 'moderate', 'severe', 'unknown'];
const CLASSIFICATION_BADGE: Record<AllergenClassification, string> = {
  drug: 'Drug', food: 'Food', environmental: 'Environmental', biologic: 'Biologic', other: 'Other',
};

const allergenOptions = COMMON_ALLERGENS.map(a => ({ code: CLASSIFICATION_BADGE[a.classification], name: a.substance, classification: a.classification }));

const inputCls = 'w-full p-2.5 rounded-md text-[13px]';
const inputStyle = { background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' } as const;

export default function AddAllergyModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  /** Persist the allergy (caller owns the patient id + service call + toast). */
  onSave: (input: { substance: string; classification: AllergyEntry['classification']; criticality: NonNullable<AllergyEntry['criticality']>; reaction: string; onsetDate: string }) => Promise<void>;
}) {
  const [substance, setSubstance] = useState('');
  const [classification, setClassification] = useState<AllergyEntry['classification']>('drug');
  const [criticality, setCriticality] = useState<NonNullable<AllergyEntry['criticality']>>('unknown');
  const [reaction, setReaction] = useState('');
  const [onsetDate, setOnsetDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave({ substance: substance.trim(), classification, criticality, reaction, onsetDate });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={busy ? () => {} : onClose} width={480} labelledBy="add-allergy-title">
      <div className="rounded-xl p-5 space-y-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
        <div className="flex items-center justify-between">
          <h2 id="add-allergy-title" className="text-[15px] font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <AlertTriangle className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} /> Add allergy
          </h2>
          <button className="p-1 rounded hover:bg-red-50 transition-colors" disabled={busy} onClick={onClose} aria-label="Close">
            <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        <CodedSearchField
          label="Substance"
          placeholder="Search or type a substance (e.g. Penicillin)"
          options={allergenOptions}
          value={substance}
          onChange={setSubstance}
          onSelect={o => {
            setSubstance(o.name);
            const match = allergenOptions.find(a => a.code === o.code && a.name === o.name);
            if (match) setClassification(match.classification);
          }}
          autoFocus
        />

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>Classification</label>
            <Select value={classification} onChange={e => setClassification(e.target.value as AllergyEntry['classification'])} className="p-2.5 rounded-md text-[12px]" style={inputStyle}>
              {CLASSIFICATIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>Criticality</label>
            <Select value={criticality} onChange={e => setCriticality(e.target.value as NonNullable<AllergyEntry['criticality']>)} className="p-2.5 rounded-md text-[12px]" style={inputStyle}>
              {CRITICALITIES.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
          </div>
        </div>

        <input
          value={reaction}
          onChange={e => setReaction(e.target.value)}
          placeholder="Reaction (e.g. anaphylaxis, rash)"
          className={inputCls} style={inputStyle}
        />

        {error && <p className="text-[11px]" style={{ color: 'var(--color-danger-text)' }}>{error}</p>}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button className="btn btn-sm btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="btn btn-sm btn-primary" disabled={busy || substance.trim().length === 0} onClick={save}>
            {busy ? 'Saving…' : 'Save allergy'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
