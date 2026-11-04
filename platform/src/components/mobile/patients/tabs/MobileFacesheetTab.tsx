'use client';

import CareAlertsBanner from '@/components/patients/CareAlertsBanner';
import AllergyList from '@/components/patients/AllergyList';
import { patientAgeLabel } from '@/lib/patient-utils';
import type { PatientDoc } from '@/lib/db-types';
import { useTranslation } from '@/lib/i18n/useTranslation';

export default function MobileFacesheetTab({ patient }: { patient: PatientDoc }) {
  const { t } = useTranslation();
  return (
    <div className="mobile-chart-tab-body">
      <CareAlertsBanner patient={patient} hideAddButton />
      <div className="mobile-chart-card">
        <h3>{t('patient.demographics')}</h3>
        <div className="mobile-chart-kv-row"><span>{t('anc.age')}</span><b>{patientAgeLabel(patient)}</b></div>
        <div className="mobile-chart-kv-row"><span>{t('deaths.gender')}</span><b>{patient.gender || '—'}</b></div>
        <div className="mobile-chart-kv-row"><span>{t('noteEditor.type.phone')}</span><b>{patient.phone || '—'}</b></div>
        <div className="mobile-chart-kv-row"><span>{t('deaths.location')}</span><b>{[patient.payam, patient.county, patient.state].filter(Boolean).join(', ') || '—'}</b></div>
      </div>
      <AllergyList patient={patient} hideAddButton />
    </div>
  );
}
