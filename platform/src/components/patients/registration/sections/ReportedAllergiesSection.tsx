'use client';

import { useTranslation } from '@/lib/i18n/useTranslation';
import { Trash2 } from '@/components/icons/lucide';
import RegistrationField from '../RegistrationField';
import { MAX_REPORTED_ALLERGIES, type ReportedAllergy } from '../registration-form';

export interface ReportedAllergiesSectionProps {
  allergies: ReportedAllergy[];
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<ReportedAllergy>) => void;
  onRemove: (index: number) => void;
}

/**
 * Allergies the patient says they have. Optional, and never an "all clear":
 * leaving it empty keeps the chart at "Not recorded". Whatever is entered here
 * is saved as unverified until triage reviews it.
 */
export default function ReportedAllergiesSection({
  allergies, onAdd, onUpdate, onRemove,
}: ReportedAllergiesSectionProps) {
  const { t } = useTranslation();
  return (
    <div className="registration-inline-panel" id="reg-reported-allergies">
      <div className="registration-panel-heading">
        <h4>{t('patientNew.allergiesHeading')}</h4>
        <span>{t('patientNew.optionalLabel')}</span>
      </div>
      <p className="registration-field-hint">{t('patientNew.allergiesHint')}</p>
      {allergies.map((row, i) => (
        <div key={i} className="registration-contact-card">
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => onRemove(i)}
              aria-label={t('patientNew.removeAllergy')}
              title={t('patientNew.removeAllergy')}
              className="registration-contact-remove"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          <div className="registration-field-grid registration-field-grid--two">
            <RegistrationField name={`reportedAllergies.${i}.substance`} label={t('patientNew.allergySubstance')}>
              {field => (
                <input {...field} type="text" value={row.substance}
                  onChange={e => onUpdate(i, { substance: e.target.value })}
                  placeholder={t('patientNew.allergySubstancePlaceholder')} />
              )}
            </RegistrationField>
            <RegistrationField name={`reportedAllergies.${i}.reaction`} label={t('patientNew.allergyReaction')}>
              {field => (
                <input {...field} type="text" value={row.reaction}
                  onChange={e => onUpdate(i, { reaction: e.target.value })}
                  placeholder={t('patientNew.allergyReactionPlaceholder')} />
              )}
            </RegistrationField>
          </div>
        </div>
      ))}
      {allergies.length < MAX_REPORTED_ALLERGIES && (
        <button type="button" onClick={onAdd} className="btn btn-secondary btn-sm">
          + {t('patientNew.addAllergy')}
        </button>
      )}
    </div>
  );
}
