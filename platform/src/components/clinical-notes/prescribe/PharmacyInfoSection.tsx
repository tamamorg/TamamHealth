'use client';

/**
 * Pharmacy Info — where the prescription goes and anything the dispenser needs
 * to know that is not part of the patient's own instructions.
 */

import type { RxDraft } from './types';
import Select from '@/components/Select';

interface PharmacyInfoSectionProps {
  draft: RxDraft;
  onChange: (patch: Partial<RxDraft>) => void;
  pharmacies: string[];
  pharmacy: string;
  onPharmacyChange: (value: string) => void;
}

export default function PharmacyInfoSection({
  draft, onChange, pharmacies, pharmacy, onPharmacyChange,
}: PharmacyInfoSectionProps) {
  return (
    <div className="cn-rx-grid">
      <label className="cn-rx-field cn-rx-field--wide">
        <span className="field-required">Pharmacy</span>
        <Select
          className="cn-select"
          value={pharmacy}
          onChange={e => onPharmacyChange(e.target.value)}
          aria-label="Pharmacy"
        >
          {pharmacies.map(p => <option key={p} value={p}>{p}</option>)}
        </Select>
      </label>

      <label className="cn-rx-field cn-rx-field--wide">
        <span>Pharmacy Instructions</span>
        <input
          className="cn-input"
          value={draft.pharmacyNote}
          onChange={e => onChange({ pharmacyNote: e.target.value })}
          placeholder="Note to the dispensing pharmacist…"
          aria-label="Pharmacy instructions"
        />
      </label>
    </div>
  );
}
