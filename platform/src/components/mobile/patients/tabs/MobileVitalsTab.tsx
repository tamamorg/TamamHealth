'use client';

import dynamic from 'next/dynamic';
import { Loader2 } from '@/components/icons/lucide';
import { useMedicalRecords } from '@/lib/hooks/useMedicalRecords';
import EmptyState from '@/components/EmptyState';
import { useTranslation } from '@/lib/i18n/useTranslation';

const VitalsTrends = dynamic(() => import('@/components/VitalsTrends'), { ssr: false });

export default function MobileVitalsTab({ patientId }: { patientId: string }) {
  const { t } = useTranslation();
  const { records, loading } = useMedicalRecords(patientId);

  if (loading) {
    return (
      <div className="mobile-shell-loading">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  const latest = records[0]?.vitalSigns;
  if (!latest) {
    return <EmptyState title={t('ui.noVitalsRecorded')} message="Vitals will appear here once recorded." />;
  }

  return (
    <div className="mobile-chart-tab-body">
      <div className="mobile-chart-card">
        <div className="mobile-vitals-header">
          <h3>{t('patientPortal.latestVitals')}</h3>
          <span>{new Date(latest.recordedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div className="mobile-vitals-grid">
          <div className="mobile-vitals-tile"><b>{latest.temperature}</b><small>{t('ui.tempC')}</small></div>
          <div className="mobile-vitals-tile"><b>{latest.pulse}</b><small>PULSE</small></div>
          <div className="mobile-vitals-tile"><b>{latest.systolic}/{latest.diastolic}</b><small>BP</small></div>
          <div className="mobile-vitals-tile"><b>{latest.oxygenSaturation}%</b><small>{t('nurse.vital_oxygenSaturation')}</small></div>
        </div>
      </div>
      <VitalsTrends records={records} />
    </div>
  );
}
