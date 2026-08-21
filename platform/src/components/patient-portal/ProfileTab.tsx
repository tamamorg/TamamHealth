'use client';

import type { PatientDoc } from '@/lib/db-types';
import { useTranslation } from '@/lib/i18n/useTranslation';

/* ═════════════════════════════════════════
   PROFILE TAB
   ═════════════════════════════════════════ */
export function ProfileTab({ patient }: { patient: PatientDoc }) {
  const { t } = useTranslation();
  const facilityName = (patient as { registrationHospitalName?: string }).registrationHospitalName
    || patient.registrationHospital
    || '—';

  const fields = [
    { label: t('patientPortal.firstName'), value: patient.firstName },
    { label: t('patientPortal.middleName'), value: patient.middleName || '—' },
    { label: t('patientPortal.surname'), value: patient.surname },
    { label: t('patientPortal.dateOfBirth'), value: patient.dateOfBirth || (patient.estimatedAge ? `~${patient.estimatedAge} years` : '—') },
    { label: t('patient.gender'), value: patient.gender },
    { label: t('patient.bloodType'), value: patient.bloodType || '—' },
    { label: t('patient.phone'), value: patient.phone || '—' },
    { label: t('patientPortal.geocodeId'), value: patient.geocodeId || '—' },
    { label: t('patientPortal.county'), value: patient.county || '—' },
    { label: t('patientPortal.state'), value: patient.state || '—' },
    { label: t('patient.hospitalNumber'), value: patient.hospitalNumber || '—' },
    { label: t('patientPortal.registrationHospital'), value: facilityName },
  ];

  // 'None' / 'None known' placeholders are the absence of an entry.
  const realAllergies = (patient.allergies || []).filter(a => a && !/^none\b/i.test(a));
  const realConditions = (patient.chronicConditions || []).filter(c => c && !/^none\b/i.test(c));

  return (
    <div>
      <div className="pp-head">
        <div>
          <h1>{t('patientPortal.tabMyProfile')}</h1>
          <p className="pp-head-note">{t('patientPortal.protectedFieldsNote')}</p>
        </div>
      </div>

      <div className="pp-grid2">
        <div className="pp-card">
          <div className="pp-card-head"><h2>{t('patientPortal.personalDetails')}</h2></div>
          <div className="pp-fields">
            {fields.map((f, i) => (
              <div key={i}>
                <p className="pp-field-label">{f.label}</p>
                <p className="pp-field-value">{f.value}</p>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="pp-card">
            <div className="pp-card-head"><h2>{t('patientPortal.emergencyContact')}</h2></div>
            <div style={{ padding: '11px 14px' }}>
              <b style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: '#113055' }}>
                {patient.nokName || '—'}{patient.nokRelationship ? ` · ${patient.nokRelationship}` : ''}
              </b>
              <span style={{ display: 'block', marginTop: 2, fontSize: 12, color: '#5D728B' }}>{patient.nokPhone || '—'}</span>
            </div>
          </div>

          <div className="pp-card pp-card--danger">
            <div className="pp-card-head"><h2>{t('patient.allergies')}</h2></div>
            <div className="pp-pillbox">
              {realAllergies.length > 0 ? realAllergies.map((a, i) => (
                <span key={i} className="pp-pill pp-pill--red">{a}</span>
              )) : (
                <span style={{ fontSize: 12, color: '#5D728B' }}>{t('patientPortal.noKnownAllergies')}</span>
              )}
            </div>
          </div>

          <div className="pp-card">
            <div className="pp-card-head"><h2>{t('patient.chronicConditions')}</h2></div>
            <div className="pp-pillbox">
              {realConditions.length > 0 ? realConditions.map((c, i) => (
                <span key={i} className="pp-pill pp-pill--blue">{c}</span>
              )) : (
                <span style={{ fontSize: 12, color: '#5D728B' }}>{t('patientPortal.noChronicConditions')}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
