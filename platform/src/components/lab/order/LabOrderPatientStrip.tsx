'use client';

/**
 * The identity band that sits under the wizard header — the same facts a paper
 * requisition carries at the top, so the clinician can confirm at a glance that
 * the order is on the right chart before it is placed.
 */

import { patientAgeLabel, patientFullName } from '@/lib/patient-utils';
import { formatDate } from '@/lib/format-utils';
import { formatPhoneShared } from '@/lib/field-formats';
import { useSharedScreenMask } from '@/lib/settings/useRoleSetting';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { PatientDoc } from '@/lib/db-types';

/** Coverage label from the registration payor block. */
export function coverageLabel(patient: PatientDoc): string {
  const info = patient.payorInfo;
  if (!info) return 'Out-of-pocket';
  switch (info.coverageType) {
    case 'program': return info.programEnrollment ? `Program — ${info.programEnrollment}` : 'Program';
    case 'ngo': return info.ngoName ? `NGO — ${info.ngoName}` : 'NGO';
    case 'exemption': return info.exemptionReason ? `Exempt — ${info.exemptionReason}` : 'Exempt';
    default: return 'Out-of-pocket';
  }
}

export default function LabOrderPatientStrip({ patient }: { patient: PatientDoc }) {
  const { t } = useTranslation();
  useSharedScreenMask();

  const fields: { label: string; value: string }[] = [
    { label: t('labOrder.fieldName'), value: `${patient.surname?.toUpperCase() || ''}, ${patient.firstName || ''}`.trim() },
    { label: t('labOrder.fieldHospitalNumber'), value: patient.hospitalNumber || '—' },
    { label: t('labOrder.fieldDob'), value: patient.dateOfBirth ? formatDate(patient.dateOfBirth) : '—' },
    { label: t('labOrder.fieldAgeSex'), value: `${patientAgeLabel(patient)} · ${patient.gender || '—'}` },
    { label: t('labOrder.fieldCoverage'), value: coverageLabel(patient) },
    { label: t('labOrder.fieldPhone'), value: patient.phone ? formatPhoneShared(patient.phone) : '—' },
  ];

  return (
    <div className="labord-patient-strip">
      <span className="sr-only">{patientFullName(patient)}</span>
      {fields.map(field => (
        <div key={field.label}>
          <span className="labord-field-label">{field.label}</span>
          <span className="labord-field-value">{field.value}</span>
        </div>
      ))}
    </div>
  );
}
