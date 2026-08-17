'use client';

import { useTranslation } from '@/lib/i18n/useTranslation';
import Select from '@/components/Select';
import { statesAndCounties, states } from '@/lib/data/south-sudan-reference';
import RegistrationField from '../RegistrationField';
import type { RegistrationSectionProps } from '../registration-form';

/** The computed geocode, or undefined until both halves are present. */
export function geocodeIdFor(bomaCode: string, householdNumber: string): string | undefined {
  return bomaCode && householdNumber
    ? `BOMA-${bomaCode.toUpperCase()}-HH${householdNumber}`
    : undefined;
}

/** How to reach the patient, and where they live. */
export default function ContactSection({ form, errors, update }: RegistrationSectionProps) {
  const { t } = useTranslation();
  const counties = form.state ? statesAndCounties[form.state] || [] : [];
  const geocodeId = geocodeIdFor(form.bomaCode, form.householdNumber);

  return (
    <>
      <div className="registration-field-grid registration-field-grid--three">
        <RegistrationField name="phone" label={t('patientNew.phone')} error={errors.phone}>
          {field => (
            <input {...field} type="tel" value={form.phone}
              onChange={e => update('phone', e.target.value)}
              placeholder={t('patientNew.phonePlaceholder')} />
          )}
        </RegistrationField>
        <RegistrationField name="altPhone" label={t('patientNew.altPhone')} error={errors.altPhone}>
          {field => (
            <input {...field} type="tel" value={form.altPhone}
              onChange={e => update('altPhone', e.target.value)}
              placeholder={t('patientNew.altPhonePlaceholder')} />
          )}
        </RegistrationField>
        <RegistrationField name="whatsapp" label={t('patientNew.whatsapp')} error={errors.whatsapp}>
          {field => (
            <input {...field} type="tel" value={form.whatsapp}
              onChange={e => update('whatsapp', e.target.value)}
              placeholder={t('patientNew.whatsappPlaceholder')} />
          )}
        </RegistrationField>
        {/* The patient's OWN address, used for things sent to them — booking
            confirmations and receipts. Optional: most patients here are
            reachable by phone only, so every surface that sends has to handle
            its absence rather than assume it. */}
        <RegistrationField name="email" label={t('patientNew.email')} error={errors.email}>
          {field => (
            <input {...field} type="email" inputMode="email" autoComplete="email" value={form.email}
              onChange={e => update('email', e.target.value)}
              placeholder={t('patientNew.emailPlaceholder')} />
          )}
        </RegistrationField>
      </div>

      <div className="registration-subsection">
        <h4>{t('patientNew.geographicIdentifier')}</h4>
        <p>{t('patientNew.geocodeDescription')}</p>
        <div className="registration-field-grid registration-field-grid--three">
          <RegistrationField name="bomaCode" label={t('patientNew.bomaCode')}>
            {field => (
              <input {...field} type="text" value={form.bomaCode} maxLength={4}
                onChange={e => update('bomaCode', e.target.value.toUpperCase().slice(0, 4))}
                placeholder={t('patientNew.bomaCodePlaceholder')} />
            )}
          </RegistrationField>
          <RegistrationField name="householdNumber" label={t('patientNew.householdNumber')}>
            {field => (
              <input {...field} type="number" min={0} value={form.householdNumber}
                onChange={e => update('householdNumber', e.target.value)}
                placeholder={t('patientNew.householdNumberPlaceholder')} />
            )}
          </RegistrationField>
          {/* Computed, never typed — read-only rather than disabled so it stays
              reachable to a screen reader. */}
          <RegistrationField name="geocodeId" label={t('patientNew.geocodeId')}>
            {field => (
              <input {...field} type="text" readOnly aria-readonly="true"
                value={geocodeId || '—'} />
            )}
          </RegistrationField>
        </div>
        <div className="registration-field-grid registration-field-grid--three">
          <RegistrationField name="nationalId" label={t('patientNew.nationalId')} error={errors.nationalId}>
            {field => (
              <input {...field} type="text" value={form.nationalId}
                onChange={e => update('nationalId', e.target.value)}
                placeholder={t('patientNew.nationalIdPlaceholder')} />
            )}
          </RegistrationField>
        </div>
      </div>

      <div className="registration-subsection">
        <h4>{t('patientNew.address')}</h4>
        <div className="registration-field-grid registration-field-grid--two">
          <RegistrationField name="state" label={t('patientNew.state')} error={errors.state} required>
            {field => (
              <Select {...field} value={form.state}
                onChange={e => { update('state', e.target.value); update('county', ''); }}>
                <option value="">{t('patientNew.selectState')}</option>
                {states.map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
            )}
          </RegistrationField>
          <RegistrationField name="county" label={t('patientNew.county')} error={errors.county} required>
            {field => (
              <Select {...field} value={form.county} disabled={!form.state}
                onChange={e => update('county', e.target.value)}>
                <option value="">{t('patientNew.selectCounty')}</option>
                {counties.map(c => <option key={c} value={c}>{c}</option>)}
              </Select>
            )}
          </RegistrationField>
          {/* No placeholder: "Enter payam" under a label reading "Payam" is a
              line of text that carries nothing. */}
          <RegistrationField name="payam" label={t('patientNew.payam')}>
            {field => (
              <input {...field} type="text" value={form.payam}
                onChange={e => update('payam', e.target.value)} />
            )}
          </RegistrationField>
          <RegistrationField name="boma" label={t('patientNew.boma')}>
            {field => (
              <input {...field} type="text" value={form.boma}
                onChange={e => update('boma', e.target.value)} />
            )}
          </RegistrationField>
        </div>
        <RegistrationField name="address" label={t('patientNew.residentialAddress')}>
          {field => (
            <textarea {...field} rows={2} value={form.address}
              onChange={e => update('address', e.target.value)}
              placeholder={t('patientNew.residentialAddressPlaceholder')} />
          )}
        </RegistrationField>
      </div>
    </>
  );
}
