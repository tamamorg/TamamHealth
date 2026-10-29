'use client';

/**
 * Who the order is for, at the top of the drug order form (O3): full name,
 * sex · age · date of birth, then what the patient reacts to — the line a
 * prescriber reads before choosing a dose.
 */

import { formatDate } from '@/lib/format-utils';
import { patientAgeLabel, patientFullName } from '@/lib/patient-utils';
import type { PatientDoc } from '@/lib/db-types';
import { useTranslation } from '@/lib/i18n/useTranslation';

export function AllergyLine({ patient }: { patient: PatientDoc }) {
  const { t } = useTranslation();
  const active = (patient.structuredAllergies || []).filter(a => a.status === 'active').map(a => a.substance);
  const value = active.length
    ? active.join(', ')
    : patient.structuredAllergies !== undefined ? t('basket.allergiesNone') : t('basket.allergiesUnknown');
  return (
    <p className={active.length ? 'obf-allergies has-allergies' : 'obf-allergies'}>
      {t('basket.allergies')}: <span>{value}</span>
    </p>
  );
}

export default function PatientBanner({ patient }: { patient: PatientDoc }) {
  const facts = [
    patient.gender,
    patientAgeLabel(patient),
    patient.dateOfBirth ? formatDate(patient.dateOfBirth) : '',
  ].filter(Boolean).join(' · ');
  return (
    <div className="obf-banner">
      <p className="obf-banner-name">
        <strong>{patientFullName(patient)}</strong>
        {facts && <span>{facts}</span>}
      </p>
      <AllergyLine patient={patient} />
    </div>
  );
}
