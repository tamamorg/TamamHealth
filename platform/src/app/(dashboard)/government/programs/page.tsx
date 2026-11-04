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

export default function DiseaseProgramsPage() {
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
    { name: 'HIV programme', note: 'No HIV programme data is collected in TamamHealth yet.' },
    { name: 'TB programme', note: 'No TB programme data is collected in TamamHealth yet.' },
    {
      name: 'Malaria programme',
      note: `No malaria programme data is collected yet. ${malariaAlertCount} active malaria surveillance alert${malariaAlertCount === 1 ? '' : 's'} on file (surveillance, not programme data).`,
    },
  ];

  return (
    <main className="page-container page-enter sadb-scope">
      <div className="sadb-page" data-tour="gov-programs-header">
        {loading ? (
          <SadbCard><p className="sadb-empty">Loading programme data…</p></SadbCard>
        ) : (
          <>
            <div className="sadb-kpi-row">
              <SadbKpiTile
                label="Children fully immunized"
                value={immStats ? `${immStats.coverageRate}%` : '—'}
                delta={immStats ? `${immStats.fullyImmunized.toLocaleString()} of ${immStats.totalChildren.toLocaleString()} children on record` : 'No immunization records on file'}
                onClick={() => router.push('/immunizations')}
              />
              <SadbKpiTile
                label="Overdue or missed doses"
                value={immStats ? (immStats.overdue + immStats.missed).toLocaleString() : '—'}
                delta="Doses past their due date that are not yet given"
                deltaTone={immStats && immStats.overdue + immStats.missed > 0 ? 'warn' : undefined}
                onClick={() => router.push('/immunizations')}
              />
              <SadbKpiTile
                label="Mothers with 4 or more visits"
                value={ancStats ? `${ancStats.anc4PlusRate}%` : '—'}
                delta={ancStats ? `${ancStats.anc4Plus.toLocaleString()} of ${ancStats.totalMothers.toLocaleString()} mothers on record` : 'No antenatal records on file'}
                onClick={() => router.push('/anc')}
              />
              <SadbKpiTile
                label="High-risk pregnancies"
                value={ancStats ? ancStats.highRiskCount.toLocaleString() : '—'}
                delta="Pregnancies flagged high risk at antenatal visits"
                deltaTone={ancStats && ancStats.highRiskCount > 0 ? 'warn' : undefined}
                onClick={() => router.push('/anc')}
              />
            </div>

            <SadbCard title="Programmes not yet reporting" meta="Disease programmes">
              <ul>
                {notReporting.map(p => (
                  <li key={p.name} className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderTop: '1px solid var(--border-light)' }}>
                    <div className="min-w-0">
                      <p style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</p>
                      <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{p.note}</p>
                    </div>
                    <SadbChip tone="neutral">Pending</SadbChip>
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
