'use client';

import { useTranslation } from '@/lib/i18n/useTranslation';
import Select from '@/components/Select';
import { tribes, languages } from '@/lib/data/south-sudan-reference';
import RegistrationField from '../RegistrationField';
import type { RegistrationSectionProps } from '../registration-form';
import { todayIso } from '@/lib/date-utils';

export interface DemographicsSectionProps extends RegistrationSectionProps {
  /**
   * The facilities the registering user may register at. Only supplied — and
   * only asked about — when they carry no facility of their own; a clerk
   * posted to one hospital never sees this field, because their own posting
   * already answers it.
   */
  facilities?: { id: string; name: string }[];
  facilityRequired?: boolean;
}

/** Who the patient is. The only section every other one depends on. */
export default function DemographicsSection({
  form, errors, update, facilities = [], facilityRequired = false,
}: DemographicsSectionProps) {
  const { t } = useTranslation();
  const today = todayIso();
  return (
    <>
      {/* Asked first, because it decides which organisation the record is
          created in — and a record created in none is refused by the server
          and invisible to every colleague who would go looking for it. */}
      {facilityRequired && (
        <div className="registration-field-grid">
          <RegistrationField
            name="registrationFacility"
            label={t('patientNew.registrationFacility')}
            error={errors.registrationFacility}
            required
          >
            {field => (
              <Select {...field} value={form.registrationFacility}
                onChange={e => update('registrationFacility', e.target.value)}>
                <option value="">{t('facilityAssessments.selectFacility')}</option>
                {facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </Select>
            )}
          </RegistrationField>
        </div>
      )}

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
            <Select {...field} value={form.tribe} onChange={e => update('tribe', e.target.value)}
              searchThreshold={0} searchPlaceholder={t('patientNew.searchTribes')}>
              <option value="">{t('patientNew.selectTribe')}</option>
              {tribes.map(tribe => <option key={tribe.value} value={tribe.value}>{tribe.label}</option>)}
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
