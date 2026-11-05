'use client';

import { useEffect, useMemo, useState } from 'react';
import { SadbCard } from '@/components/admin/sadb-ui';
import { FieldRow } from '@/components/oversight/OversightKit';
import { useSurveillance } from '@/lib/hooks/useSurveillance';
import { useImmunizations } from '@/lib/hooks/useImmunizations';
import { useANC } from '@/lib/hooks/useANC';
import { useBirths } from '@/lib/hooks/useBirths';
import { useDeaths } from '@/lib/hooks/useDeaths';
import { useDataQuality } from '@/lib/hooks/useDataQuality';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { Printer } from '@/components/icons/lucide';
import { printElementById } from '@/lib/safe-html';
import { useTranslation } from '@/lib/i18n/useTranslation';

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <SadbCard title={heading}>
      <div className="px-4 py-3">{children}</div>
    </SadbCard>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((line, i) => (
        <li key={i} className="leading-relaxed" style={{ fontSize: 14, color: 'var(--text-primary)' }}>
          &bull;&nbsp; {line}
        </li>
      ))}
    </ul>
  );
}

export default function ExecutiveBriefingPage() {
  const { t } = useTranslation();
  const { alerts, loading: alertsLoading } = useSurveillance();
  const { stats: immStats, loading: immLoading } = useImmunizations();
  const { stats: ancStats, loading: ancLoading } = useANC();
  const { stats: birthStats, loading: birthsLoading } = useBirths();
  const { stats: deathStats, loading: deathsLoading } = useDeaths();
  const { data: dq, loading: dqLoading } = useDataQuality();
  const scope = useDataScope();

  const [defaulterStats, setDefaulterStats] = useState<{ totalDefaulters: number; uniqueChildren: number; critical: number } | null>(null);
  useEffect(() => {
    if (!scope) return; // pre-hydration; re-runs once the user is known
    let cancelled = false;
    (async () => {
      const { getDefaulterStats } = await import('@/lib/services/immunization-service');
      const s = await getDefaulterStats(scope);
      if (!cancelled) setDefaulterStats(s);
    })();
    return () => { cancelled = true; };
  }, [scope]);

  const loading = alertsLoading || immLoading || ancLoading || birthsLoading || deathsLoading || dqLoading;

  const today = useMemo(() => new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }), []);

  const activeAlerts = useMemo(() => alerts.filter(a => a.alertLevel !== 'normal'), [alerts]);
  const emergencyCount = activeAlerts.filter(a => a.alertLevel === 'emergency').length;
  const warningCount = activeAlerts.filter(a => a.alertLevel === 'warning').length;
  const watchCount = activeAlerts.filter(a => a.alertLevel === 'watch').length;
  const statesAffected = new Set(activeAlerts.map(a => a.state)).size;
  const topDisease = useMemo(() => {
    const byDisease = new Map<string, number>();
    for (const a of activeAlerts) byDisease.set(a.disease, (byDisease.get(a.disease) || 0) + a.cases);
    const sorted = Array.from(byDisease.entries()).sort((a, b) => b[1] - a[1]);
    return sorted[0] || null;
  }, [activeAlerts]);

  const worstFacilities = useMemo(() => {
    if (!dq) return [];
    return dq.entries
      .filter(e => e.lastAssessmentDate)
      .sort((a, b) => a.dataQualityScore - b.dataQualityScore)
      .slice(0, 3);
  }, [dq]);

  const belowCompletenessCount = useMemo(() => {
    if (!dq) return 0;
    return dq.entries.filter(e => e.lastAssessmentDate && e.reportingCompleteness < 80).length;
  }, [dq]);

  if (loading) {
    return (
      <main className="page-container page-enter sadb-scope">
        <SadbCard><p className="sadb-empty">{t('ui.compilingBriefing')}</p></SadbCard>
      </main>
    );
  }

  return (
    <main id="executive-briefing-print" className="page-container page-enter sadb-scope">
      <div className="sadb-page">
      <div data-tour="gov-briefing-header" className="no-print">
        <FieldRow
          end={(
            <button
              type="button"
              onClick={() => printElementById('executive-briefing-print', { label: t('ui.executiveBriefing'), issuer: t('brief.issuer'), fieldsTitle: t('brief.reportScope'), fields: [{ label: t('brief.coverage'), value: t('brief.national') }] })}
              className="tm-ghost-btn print-visible"
            >
              {t('ui.printBriefing')} <Printer className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        >
          <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{t('brief.asOf', { date: today })}</p>
        </FieldRow>
      </div>

      <Section heading={t('ui.situationOverview')}>
        <Bullets items={[
          activeAlerts.length > 0
            ? t(activeAlerts.length === 1 ? 'brief.alertsOne' : 'brief.alertsMany', { n: activeAlerts.length, emergency: emergencyCount, warning: warningCount, watch: watchCount })
            : t('brief.alertsNone'),
          topDisease
            ? t('brief.topDisease', { disease: topDisease[0], n: topDisease[1].toLocaleString() })
            : t('brief.topDiseaseNone'),
          statesAffected > 0
            ? t(statesAffected === 1 ? 'brief.statesOne' : 'brief.statesMany', { n: statesAffected })
            : t('brief.statesNone'),
        ]} />
      </Section>

      <Section heading={t('ui.serviceDelivery')}>
        <Bullets items={[
          immStats
            ? t('brief.immCoverage', { rate: immStats.coverageRate, n: immStats.fullyImmunized.toLocaleString(), total: immStats.totalChildren.toLocaleString() })
            : t('brief.immNone'),
          ancStats
            ? t('brief.ancCoverage', { rate: ancStats.anc4PlusRate, n: ancStats.anc4Plus.toLocaleString(), total: ancStats.totalMothers.toLocaleString() })
            : t('brief.ancNone'),
        ]} />
      </Section>

      <Section heading={t('ui.vitalEvents')}>
        <Bullets items={[
          birthStats
            ? t('brief.births', { total: birthStats.total.toLocaleString(), month: birthStats.thisMonth.toLocaleString() })
            : t('brief.birthsNone'),
          deathStats
            ? t('brief.deaths', { total: deathStats.total.toLocaleString(), month: deathStats.thisMonth.toLocaleString() })
            : t('brief.deathsNone'),
        ]} />
      </Section>

      <Section heading={t('dataMgmt.dataQuality')}>
        <Bullets items={[
          dq
            ? t('brief.dqAverage', { completeness: dq.avgCompleteness, timeliness: dq.avgTimeliness, n: dq.facilitiesReporting, total: dq.totalFacilities })
            : t('brief.dqNone'),
          worstFacilities.length > 0
            ? t('brief.dqLowest', { list: worstFacilities.map(f => `${f.facilityName} (${f.state}) ${f.dataQualityScore}%`).join('; ') })
            : t('brief.dqRankNone'),
        ]} />
      </Section>

      <Section heading={t('ui.recommendedActions')}>
        <Bullets items={[
          emergencyCount > 0
            ? t(emergencyCount === 1 ? 'brief.verifyOne' : 'brief.verifyMany', { n: emergencyCount })
            : t('brief.verifyNone'),
          belowCompletenessCount > 0
            ? t(belowCompletenessCount === 1 ? 'brief.followUpOne' : 'brief.followUpMany', { n: belowCompletenessCount })
            : (dq && dq.facilitiesReporting > 0 ? t('brief.allComplete') : t('brief.completeNone')),
          defaulterStats
            ? (defaulterStats.totalDefaulters > 0
              ? t(defaulterStats.totalDefaulters === 1 ? 'brief.defaultersOne' : 'brief.defaultersMany', { n: defaulterStats.totalDefaulters.toLocaleString(), children: defaulterStats.uniqueChildren.toLocaleString(), critical: defaulterStats.critical })
              : t('brief.defaultersNone'))
            : t('brief.defaultersNoData'),
        ]} />
      </Section>
      </div>
    </main>
  );
}
