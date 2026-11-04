'use client';

import { useTranslation } from '@/lib/i18n/useTranslation';
import Select from '@/components/Select';
import RegistrationField from '../RegistrationField';
import type { CoverageType, RegistrationSectionProps } from '../registration-form';

const COVERAGE_OPTIONS: { value: CoverageType; labelKey: string; descKey: string }[] = [
  { value: 'out-of-pocket', labelKey: 'patientNew.coverageOutOfPocket', descKey: 'patientNew.coverageOutOfPocketDesc' },
  { value: 'program', labelKey: 'patientNew.coverageProgram', descKey: 'patientNew.coverageProgramDesc' },
  { value: 'exemption', labelKey: 'patientNew.coverageExemption', descKey: 'patientNew.coverageExemptionDesc' },
  { value: 'ngo', labelKey: 'patientNew.coverageNgo', descKey: 'patientNew.coverageNgoDesc' },
];

const EXEMPTION_REASONS: { value: string; labelKey: string }[] = [
  { value: 'Child under 5', labelKey: 'patientNew.exemptionChildUnder5' },
  { value: 'Pregnant woman', labelKey: 'patientNew.exemptionPregnantWoman' },
  { value: 'Indigent / unable to pay', labelKey: 'patientNew.exemptionIndigent' },
  { value: 'Emergency care', labelKey: 'patientNew.exemptionEmergency' },
  { value: 'Other', labelKey: 'patientNew.exemptionOther' },
];

export interface CoverageSectionProps extends RegistrationSectionProps {
  onCoverageTypeChange: (value: CoverageType) => void;
  onExemptionReasonChange: (value: string) => void;
}

/** How the visit gets paid for. Defaults to out-of-pocket, so nothing here is required. */
export default function CoverageSection({
  form, errors, update, onCoverageTypeChange, onExemptionReasonChange,
}: CoverageSectionProps) {
  const { t } = useTranslation();
  return (
    <>
      <p className="registration-section-note">{t('patientNew.coverageNote')}</p>

      {/* A radio group, not a field: `label`/`htmlFor` cannot point at four
          buttons, so the group gets a real fieldset and its own legend. */}
      <fieldset className="registration-option-fieldset">
        <legend>{t('patientNew.coverageTypeLabel')}</legend>
        <div className="registration-option-grid">
          {COVERAGE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onCoverageTypeChange(opt.value)}
              className="registration-option-button"
              // Selection as an attribute rather than an inline style: inline
              // wins over every stylesheet, so a hard-coded colour here would
              // override the tile treatment no matter how the rule was written.
              data-selected={form.payorCoverageType === opt.value ? 'true' : 'false'}
              aria-pressed={form.payorCoverageType === opt.value}
            >
              <span className="registration-option-label">{t(opt.labelKey)}</span>
              <span className="registration-option-desc">{t(opt.descKey)}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {form.payorCoverageType === 'program' && (
        <RegistrationField name="payorProgram" label={t('patientNew.programName')} error={errors.payorProgram}>
          {field => (
            <input {...field} type="text" value={form.payorProgram}
              onChange={e => update('payorProgram', e.target.value)}
              placeholder={t('patientNew.programNamePlaceholder')} />
          )}
        </RegistrationField>
      )}

      {form.payorCoverageType === 'ngo' && (
        <RegistrationField name="payorNgo" label={t('patientNew.ngoName')} error={errors.payorNgo}>
          {field => (
            <input {...field} type="text" value={form.payorNgo}
              onChange={e => update('payorNgo', e.target.value)}
              placeholder={t('patientNew.ngoNamePlaceholder')} />
          )}
        </RegistrationField>
      )}

      {form.payorCoverageType === 'exemption' && (
        <>
          <RegistrationField name="payorExemptionReason" label={t('patientNew.exemptionReasonLabel')} error={errors.payorExemptionReason}>
            {field => (
              <Select {...field} value={form.payorExemptionReason}
                onChange={e => onExemptionReasonChange(e.target.value)}>
                <option value="">{t('patientNew.selectReason')}</option>
                {EXEMPTION_REASONS.map(r => (
                  <option key={r.value} value={r.value}>{t(r.labelKey)}</option>
                ))}
              </Select>
            )}
          </RegistrationField>
          {form.payorExemptionReason === 'Other' && (
            <RegistrationField name="payorExemptionOther" label={t('patientNew.specifyReason')}>
              {field => (
                <textarea rows={1} {...field} value={form.payorExemptionOther}
                  onChange={e => update('payorExemptionOther', e.target.value)}
                  placeholder={t('patientNew.specifyReason')} />
              )}
            </RegistrationField>
          )}
        </>
      )}

      <div className="registration-info-note">
        <p>{t('patientNew.medicalHistoryDeferredNote')}</p>
      </div>
    </>
  );
}
