'use client';

import { useTranslation } from '@/lib/i18n/useTranslation';
import Select from '@/components/Select';
import { tribes, languages } from '@/lib/data/south-sudan-reference';
import RegistrationField from '../RegistrationField';
import type { RegistrationSectionProps } from '../registration-form';

/** Who the patient is. The only section every other one depends on. */
export default function DemographicsSection({ form, errors, update }: RegistrationSectionProps) {
  const { t } = useTranslation();
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <div className="registration-field-grid registration-field-grid--three">
        <RegistrationField name="firstName" label={t('patientNew.firstName')} error={errors.firstName} required>
          {field => (
            <input {...field} type="text" value={form.firstName}
              onChange={e => update('firstName', e.target.value)}
              placeholder={t('patientNew.firstNamePlaceholder')} />
          )}
        </RegistrationField>
        <RegistrationField name="middleName" label={t('patientNew.middleName')}>
          {field => (
            <input {...field} type="text" value={form.middleName}
              onChange={e => update('middleName', e.target.value)}
              placeholder={t('patientNew.middleNamePlaceholder')} />
          )}
        </RegistrationField>
        <RegistrationField name="surname" label={t('patientNew.surname')} error={errors.surname} required>
          {field => (
            <input {...field} type="text" value={form.surname}
              onChange={e => update('surname', e.target.value)}
              placeholder={t('patientNew.surnamePlaceholder')} />
          )}
        </RegistrationField>
      </div>

      <div className="registration-field-grid registration-field-grid--three">
        <RegistrationField name="maidenName" label={t('patientNew.maidenName')}>
          {field => (
            <input {...field} type="text" value={form.maidenName}
              onChange={e => update('maidenName', e.target.value)}
              placeholder={t('patientNew.maidenNamePlaceholder')} />
          )}
        </RegistrationField>
        {/* Either a date of birth or an estimated age satisfies the form, so
            the marker drops off this one as soon as an age is given. */}
        <RegistrationField
          name="dateOfBirth"
          label={t('patientNew.dateOfBirth')}
          error={errors.dateOfBirth}
          required={!form.estimatedAge}
        >
          {field => (
            <input {...field} type="date" max={today} value={form.dateOfBirth}
              onChange={e => update('dateOfBirth', e.target.value)} />
          )}
        </RegistrationField>
        <RegistrationField name="estimatedAge" label={t('patientNew.estimatedAge')} error={errors.estimatedAge}>
          {field => (
            <input {...field} type="number" min={0} max={150} value={form.estimatedAge}
              onChange={e => update('estimatedAge', e.target.value)}
              placeholder={t('patientNew.estimatedAgePlaceholder')} />
          )}
        </RegistrationField>
      </div>

      <div className="registration-field-grid registration-field-grid--three">
        <RegistrationField name="gender" label={t('patientNew.gender')} error={errors.gender} required>
          {field => (
            <Select {...field} value={form.gender} onChange={e => update('gender', e.target.value)}>
              <option value="">{t('patientNew.selectGender')}</option>
              <option value="Male">{t('patient.male')}</option>
              <option value="Female">{t('patient.female')}</option>
            </Select>
          )}
        </RegistrationField>
        <RegistrationField name="tribe" label={t('patientNew.tribe')}>
          {field => (
            <Select {...field} value={form.tribe} onChange={e => update('tribe', e.target.value)}>
              <option value="">{t('patientNew.selectTribe')}</option>
              {tribes.map(tribe => <option key={tribe} value={tribe}>{tribe}</option>)}
            </Select>
          )}
        </RegistrationField>
        <RegistrationField name="primaryLanguage" label={t('patientNew.primaryLanguage')} error={errors.primaryLanguage} required>
          {field => (
            <Select {...field} value={form.primaryLanguage} onChange={e => update('primaryLanguage', e.target.value)}>
              <option value="">{t('patientNew.selectLanguage')}</option>
              {languages.map(language => <option key={language} value={language}>{language}</option>)}
            </Select>
          )}
        </RegistrationField>
      </div>
    </>
  );
}
