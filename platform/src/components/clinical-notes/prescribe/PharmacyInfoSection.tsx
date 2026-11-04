'use client';

/**
 * Pharmacy Info — where the prescription goes and anything the dispenser needs
 * to know that is not part of the patient's own instructions.
 */

import type { RxDraft } from './types';
import Select from '@/components/Select';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface PharmacyInfoSectionProps {
  draft: RxDraft;
  onChange: (patch: Partial<RxDraft>) => void;
  pharmacies: string[];
  pharmacy: string;
  onPharmacyChange: (value: string) => void;
  /** What choosing this destination means for the patient, when it needs saying. */
  note?: string;
}

export default function PharmacyInfoSection({
  draft, onChange, pharmacies, pharmacy, onPharmacyChange, note,
}: PharmacyInfoSectionProps) {
  const { t } = useTranslation();
  return (
    <div className="cn-rx-grid">
      <label className="cn-rx-field cn-rx-field--wide">
        <span className="field-required">{t('breadcrumb.pharmacy')}</span>
        <Select
          className="cn-select"
          value={pharmacy}
          onChange={e => onPharmacyChange(e.target.value)}
          aria-label={t('breadcrumb.pharmacy')}
        >
          {pharmacies.map(p => <option key={p} value={p}>{p}</option>)}
        </Select>
        {note && <span className="cn-rx-qtynote cn-rx-fieldnote">{note}</span>}
      </label>

      <label className="cn-rx-field cn-rx-field--wide">
        <span>{t('ui.pharmacyInstructions')}</span>
        <textarea rows={1}
          className="cn-input"
          value={draft.pharmacyNote}
          onChange={e => onChange({ pharmacyNote: e.target.value })}
          placeholder={t('ui.noteToTheDispensingPharmacist')}
          aria-label={t('ui.pharmacyInstructions2')}
        />
      </label>
    </div>
  );
}
