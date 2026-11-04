'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Loader2 } from '@/components/icons/lucide';
import { usePatients } from '@/lib/hooks/usePatients';
import { patientFullName, patientInitials, patientGenderAge, avatarTint } from '@/lib/patient-utils';
import MobileFacesheetTab from './tabs/MobileFacesheetTab';
import MobileVitalsTab from './tabs/MobileVitalsTab';
import MobileMedicationsTab from './tabs/MobileMedicationsTab';
import MobileLabsTab from './tabs/MobileLabsTab';
import MobileNotesTab from './tabs/MobileNotesTab';
import { useTranslation } from '@/lib/i18n/useTranslation';

type ChartTab = 'facesheet' | 'vitals' | 'medications' | 'labs' | 'notes';

const TABS: { key: ChartTab; label: string }[] = [
  { key: 'facesheet', label: 'Facesheet' },
  { key: 'vitals', label: 'Vitals' },
  { key: 'medications', label: 'Medications' },
  { key: 'labs', label: 'Labs' },
  { key: 'notes', label: 'Notes' },
];

interface MobileChartDrillInProps {
  patientId: string;
  onClose: () => void;
}

export default function MobileChartDrillIn({ patientId, onClose }: MobileChartDrillInProps) {
  const { t } = useTranslation();
  const { patients, loading } = usePatients();
  const [tab, setTab] = useState<ChartTab>('facesheet');
  const router = useRouter();

  if (loading) {
    return (
      <div className="mobile-chart-drillin">
        <div className="mobile-shell-loading">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      </div>
    );
  }

  const patient = patients.find((p) => p._id === patientId);
  if (!patient) {
    return (
      <div className="mobile-chart-drillin">
        <header className="mobile-chart-header">
          <button type="button" onClick={onClose} aria-label={t('action.back')}><ChevronLeft className="w-5 h-5" /></button>
          <p>{t('err.patientNotFound')}</p>
        </header>
      </div>
    );
  }

  return (
    <div className="mobile-chart-drillin">
      <header className="mobile-chart-header">
        <button type="button" onClick={onClose} aria-label={t('action.back')}>
          <ChevronLeft className="w-5 h-5" />
        </button>
        <span className="mobile-chart-header-avatar" style={avatarTint(patientFullName(patient))}>
          {patientInitials(patient)}
        </span>
        <div className="mobile-chart-header-text">
          <p className="mobile-chart-header-name">{patientFullName(patient)}</p>
          <p className="mobile-chart-header-meta">{patient.hospitalNumber} · {patientGenderAge(patient)}</p>
        </div>
      </header>
      <div className="mobile-chart-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={tab === t.key ? 'active' : ''}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mobile-chart-body">
        {tab === 'facesheet' && <MobileFacesheetTab patient={patient} />}
        {tab === 'vitals' && <MobileVitalsTab patientId={patient._id} />}
        {tab === 'medications' && <MobileMedicationsTab patientId={patient._id} />}
        {tab === 'labs' && <MobileLabsTab patientId={patient._id} />}
        {tab === 'notes' && <MobileNotesTab patientId={patient._id} />}
      </div>
      <div className="mobile-chart-actions">
        <button type="button" onClick={() => router.push(`/lab?patient=${encodeURIComponent(patientFullName(patient))}`)}>{t('ui.orderLabs')}</button>
        <button type="button" className="primary" onClick={() => router.push(`/consultation?patientId=${patient._id}`)}>
          {t('ui.startConsultation')}
        </button>
      </div>
    </div>
  );
}
