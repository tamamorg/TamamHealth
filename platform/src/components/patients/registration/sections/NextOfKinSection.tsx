'use client';

import { useTranslation } from '@/lib/i18n/useTranslation';
import Select from '@/components/Select';
import { Trash2 } from '@/components/icons/lucide';
import RegistrationField from '../RegistrationField';
import {
  MAX_ADDITIONAL_NOK, RELATIONSHIP_OPTIONS,
  type AdditionalNok, type RegistrationSectionProps,
} from '../registration-form';

export interface NextOfKinSectionProps extends RegistrationSectionProps {
  additionalNok: AdditionalNok[];
  onAddNok: () => void;
  onUpdateNok: (index: number, patch: Partial<AdditionalNok>) => void;
  onRemoveNok: (index: number) => void;
}

/** Who to call. One primary contact is required; up to three more are not. */
export default function NextOfKinSection({
  form, errors, update, additionalNok, onAddNok, onUpdateNok, onRemoveNok,
}: NextOfKinSectionProps) {
  const { t } = useTranslation();
  return (
    <>
      <p className="registration-section-note">{t('patientNew.nokSectionNote')}</p>

      <div className="registration-contact-card">
        <div className="flex items-center gap-2">
          <span className="registration-contact-badge is-primary">{t('patientNew.primaryBadge')}</span>
        </div>
        <div className="registration-field-grid registration-field-grid--two">
          <RegistrationField name="nokName" label={t('patientNew.fullName')} error={errors.nokName} required>
            {field => (
              <input {...field} type="text" value={form.nokName}
                onChange={e => update('nokName', e.target.value)}
                placeholder={t('patientNew.nokNamePlaceholder')} />
            )}
          </RegistrationField>
          <RegistrationField name="nokRelationship" label={t('patientNew.relationship')} error={errors.nokRelationship} required>
            {field => (
              <Select {...field} value={form.nokRelationship}
                onChange={e => update('nokRelationship', e.target.value)}>
                <option value="">{t('patientNew.selectRelationship')}</option>
                {RELATIONSHIP_OPTIONS.map(r => (
                  <option key={r.value} value={r.value}>{t(r.labelKey)}</option>
                ))}
              </Select>
            )}
          </RegistrationField>
          <RegistrationField name="nokPhone" label={t('patientNew.nokPhone')} error={errors.nokPhone} required>
            {field => (
              <input {...field} type="tel" value={form.nokPhone}
                onChange={e => update('nokPhone', e.target.value)}
                placeholder={t('patientNew.phonePlaceholder')} />
            )}
          </RegistrationField>
          <RegistrationField name="nokEmail" label={t('patientNew.nokEmail')} error={errors.nokEmail}>
            {field => (
              <input {...field} type="email" inputMode="email" value={form.nokEmail}
                onChange={e => update('nokEmail', e.target.value)}
                placeholder={t('patientNew.emailPlaceholder')} />
            )}
          </RegistrationField>
          <RegistrationField name="nokAddress" label={t('patientNew.nokAddress')}>
            {field => (
              <input {...field} type="text" value={form.nokAddress}
                onChange={e => update('nokAddress', e.target.value)}
                placeholder={t('patientNew.nokAddressPlaceholder')} />
            )}
          </RegistrationField>
        </div>
      </div>

      {additionalNok.map((nok, i) => (
        <div key={i} className="registration-contact-card">
          <div className="flex items-center justify-between">
            <span className="registration-contact-badge">{t('patientNew.contactNumber', { number: i + 2 })}</span>
            <button
              type="button"
              onClick={() => onRemoveNok(i)}
              aria-label={t('patientNew.removeContact')}
              title={t('patientNew.removeContact')}
              className="registration-contact-remove"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          <div className="registration-field-grid registration-field-grid--two">
            <RegistrationField name={`additionalNok.${i}.name`} label={t('patientNew.optionalFullName')}>
              {field => (
                <input {...field} type="text" value={nok.name}
                  onChange={e => onUpdateNok(i, { name: e.target.value })}
                  placeholder={t('patientNew.fullNamePlaceholder')} />
              )}
            </RegistrationField>
            <RegistrationField name={`additionalNok.${i}.relationship`} label={t('patientNew.relationshipOptional')}>
              {field => (
                <Select {...field} value={nok.relationship}
                  onChange={e => onUpdateNok(i, { relationship: e.target.value })}>
                  <option value="">{t('patientNew.selectRelationship')}</option>
                  {RELATIONSHIP_OPTIONS.map(r => (
                    <option key={r.value} value={r.value}>{t(r.labelKey)}</option>
                  ))}
                </Select>
              )}
            </RegistrationField>
            <RegistrationField
              name={`additionalNok.${i}.phone`}
              label={t('patientNew.phoneOptionalLabel')}
              error={errors[`additionalNok.${i}.phone`]}
            >
              {field => (
                <input {...field} type="tel" value={nok.phone}
                  onChange={e => onUpdateNok(i, { phone: e.target.value })}
                  placeholder={t('patientNew.phoneNumberPlaceholder')} />
              )}
            </RegistrationField>
            <RegistrationField name={`additionalNok.${i}.address`} label={t('patientNew.addressLocation')}>
              {field => (
                <input {...field} type="text" value={nok.address}
                  onChange={e => onUpdateNok(i, { address: e.target.value })}
                  placeholder={t('patientNew.addressLocationPlaceholder')} />
              )}
            </RegistrationField>
          </div>
        </div>
      ))}

      {additionalNok.length < MAX_ADDITIONAL_NOK && (
        <button type="button" onClick={onAddNok} className="btn btn-secondary btn-sm">
          + {t('patientNew.addAnotherContact')}
        </button>
      )}
    </>
  );
}
