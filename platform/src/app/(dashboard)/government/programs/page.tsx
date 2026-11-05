'use client';

/**
 * Disease programmes. Immunization and antenatal care each own a tab in this
 * hub, so here they are two figure tiles that open those pages; the programmes
 * the platform does not collect data for yet sit in one list, marked as such.
 */

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useImmunizations } from '@/lib/hooks/useImmunizations';
import { useANC } from '@/lib/hooks/useANC';
import { useSurveillance } from '@/lib/hooks/useSurveillance';
import { SadbCard, SadbChip, SadbKpiTile } from '@/components/admin/sadb-ui';
import { useTranslation } from '@/lib/i18n/useTranslation';

export default function DiseaseProgramsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { stats: immStats, loading: immLoading } = useImmunizations();
  const { stats: ancStats, loading: ancLoading } = useANC();
  const { alerts, loading: alertsLoading } = useSurveillance();

  const malariaAlertCount = useMemo(
    () => alerts.filter(a => a.disease.toLowerCase() === 'malaria' && a.alertLevel !== 'normal').length,
    [alerts],
  );

  const loading = immLoading || ancLoading || alertsLoading;

  const notReporting = [
    { name: t('ui.hivProgramme'), note: t('govPrograms.noHiv') },
    { name: t('ui.tbProgramme'), note: t('govPrograms.noTb') },
    {
      name: t('ui.malariaProgramme'),
      note: t(malariaAlertCount === 1 ? 'govPrograms.noMalariaOne' : 'govPrograms.noMalariaMany', { n: malariaAlertCount }),
    },
  ];

  return (
    <main className="page-container page-enter sadb-scope">
      <div className="sadb-page" data-tour="gov-programs-header">
        {loading ? (
          <SadbCard><p className="sadb-empty">{t('ui.loadingProgrammeData')}</p></SadbCard>
        ) : (
          <>
            <div className="sadb-kpi-row">
              <SadbKpiTile
                label={t('govHome.kpiImmunized')}
                value={immStats ? `${immStats.coverageRate}%` : '—'}
                delta={immStats ? t('govPrograms.immDetail', { n: immStats.fullyImmunized.toLocaleString(), total: immStats.totalChildren.toLocaleString() }) : t('govHome.kpiImmunizedNone')}
                onClick={() => router.push('/immunizations')}
              />
              <SadbKpiTile
                label={t('govPrograms.kpiOverdue')}
                value={immStats ? (immStats.overdue + immStats.missed).toLocaleString() : '—'}
                delta={t('govPrograms.kpiOverdueDetail')}
                deltaTone={immStats && immStats.overdue + immStats.missed > 0 ? 'warn' : undefined}
                onClick={() => router.push('/immunizations')}
              />
              <SadbKpiTile
                label={t('govPrograms.kpiAnc4')}
                value={ancStats ? `${ancStats.anc4PlusRate}%` : '—'}
                delta={ancStats ? t('govPrograms.ancDetail', { n: ancStats.anc4Plus.toLocaleString(), total: ancStats.totalMothers.toLocaleString() }) : t('govPrograms.ancNone')}
                onClick={() => router.push('/anc')}
              />
              <SadbKpiTile
                label={t('ui.highRiskPregnancies')}
                value={ancStats ? ancStats.highRiskCount.toLocaleString() : '—'}
                delta={t('govPrograms.highRiskDetail')}
                deltaTone={ancStats && ancStats.highRiskCount > 0 ? 'warn' : undefined}
                onClick={() => router.push('/anc')}
              />
            </div>

            <SadbCard title={t('govPrograms.pendingTitle')} meta={t('govPrograms.metaPrograms')}>
              <ul>
                {notReporting.map(p => (
                  <li key={p.name} className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderTop: '1px solid var(--border-light)' }}>
                    <div className="min-w-0">
                      <p style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</p>
                      <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{p.note}</p>
                    </div>
                    <SadbChip tone="neutral">{t('govPrograms.pending')}</SadbChip>
                  </li>
                ))}
              </ul>
            </SadbCard>
          </>
        )}
      </div>
    </main>
  );
}
