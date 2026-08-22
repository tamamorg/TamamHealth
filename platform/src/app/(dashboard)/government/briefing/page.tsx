'use client';

import { useEffect, useMemo, useState } from 'react';
import EhrListHeader from '@/components/ehr/EhrListHeader';
import { useSurveillance } from '@/lib/hooks/useSurveillance';
import { useImmunizations } from '@/lib/hooks/useImmunizations';
import { useANC } from '@/lib/hooks/useANC';
import { useBirths } from '@/lib/hooks/useBirths';
import { useDeaths } from '@/lib/hooks/useDeaths';
import { useDataQuality } from '@/lib/hooks/useDataQuality';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { Printer } from '@/components/icons/lucide';

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="dash-card mb-3">
      <div className="px-4 pt-4 pb-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
        <span className="text-[15px] font-bold" style={{ color: 'var(--text-primary)' }}>{heading}</span>
      </div>
      <div className="px-4 py-3">
        {children}
      </div>
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((line, i) => (
        <li key={i} className="text-[13px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          &bull;&nbsp; {line}
        </li>
      ))}
    </ul>
  );
}

export default function ExecutiveBriefingPage() {
  const { alerts, loading: alertsLoading } = useSurveillance();
  const { stats: immStats, loading: immLoading } = useImmunizations();
  const { stats: ancStats, loading: ancLoading } = useANC();
  const { stats: birthStats, loading: birthsLoading } = useBirths();
  const { stats: deathStats, loading: deathsLoading } = useDeaths();
  const { data: dq, loading: dqLoading } = useDataQuality();
  const scope = useDataScope();

  const [defaulterStats, setDefaulterStats] = useState<{ totalDefaulters: number; uniqueChildren: number; critical: number } | null>(null);
  useEffect(() => {
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
      <main className="page-container page-enter">
        <div className="dash-card p-8 text-center" style={{ color: 'var(--text-muted)' }}>Compiling briefing…</div>
      </main>
    );
  }

  return (
    <main className="page-container page-enter">
      <div data-tour="gov-briefing-header" className="dash-card mb-3">
        <EhrListHeader
          title="Executive briefing"
          stats={[{ label: 'As of', value: `${today} · National` }]}
          actions={
            <button onClick={() => window.print()} className="btn btn-secondary print-visible" style={{ height: 36 }}>
              <Printer className="w-4 h-4" /> Print briefing
            </button>
          }
        />
      </div>

      <Section heading="Situation overview">
        <Bullets items={[
          activeAlerts.length > 0
            ? `${activeAlerts.length} active disease alert${activeAlerts.length === 1 ? '' : 's'} on file: ${emergencyCount} emergency, ${warningCount} warning, ${watchCount} watch.`
            : 'No active disease alerts on file — all reporting facilities at normal alert level.',
          topDisease
            ? `Highest case load: ${topDisease[0]} (${topDisease[1].toLocaleString()} active cases).`
            : 'No disease with an active case load to report.',
          statesAffected > 0
            ? `${statesAffected} state${statesAffected === 1 ? '' : 's'} carrying at least one active alert.`
            : 'No states currently carrying an active alert.',
        ]} />
      </Section>

      <Section heading="Service delivery">
        <Bullets items={[
          immStats
            ? `Immunization coverage: ${immStats.coverageRate}% fully immunized (${immStats.fullyImmunized.toLocaleString()} of ${immStats.totalChildren.toLocaleString()} children on record).`
            : 'No data on file for immunization coverage.',
          ancStats
            ? `ANC4+ coverage: ${ancStats.anc4PlusRate}% (${ancStats.anc4Plus.toLocaleString()} of ${ancStats.totalMothers.toLocaleString()} mothers on record with 4+ visits).`
            : 'No data on file for antenatal care coverage.',
        ]} />
      </Section>

      <Section heading="Vital events">
        <Bullets items={[
          birthStats
            ? `Births registered: ${birthStats.total.toLocaleString()} total on record, ${birthStats.thisMonth.toLocaleString()} this month.`
            : 'No data on file for birth registrations.',
          deathStats
            ? `Deaths registered: ${deathStats.total.toLocaleString()} total on record, ${deathStats.thisMonth.toLocaleString()} this month.`
            : 'No data on file for death registrations.',
        ]} />
      </Section>

      <Section heading="Data quality">
        <Bullets items={[
          dq
            ? `Average reporting completeness ${dq.avgCompleteness}%, timeliness ${dq.avgTimeliness}%, across ${dq.facilitiesReporting} of ${dq.totalFacilities} facilities assessed.`
            : 'No data on file for facility reporting quality.',
          worstFacilities.length > 0
            ? `Lowest data-quality scores: ${worstFacilities.map(f => `${f.facilityName} (${f.state}) — ${f.dataQualityScore}%`).join('; ')}.`
            : 'No facility assessments on file to rank by data-quality score.',
        ]} />
      </Section>

      <Section heading="Recommended actions">
        <Bullets items={[
          emergencyCount > 0
            ? `Verify ${emergencyCount} emergency alert${emergencyCount === 1 ? '' : 's'} at source before dispatch of response teams.`
            : 'No emergency alerts require verification at this time.',
          belowCompletenessCount > 0
            ? `Follow up ${belowCompletenessCount} facilit${belowCompletenessCount === 1 ? 'y' : 'ies'} reporting below 80% completeness.`
            : (dq && dq.facilitiesReporting > 0 ? 'All assessed facilities are reporting at or above 80% completeness.' : 'No facility assessments on file to evaluate completeness.'),
          defaulterStats
            ? (defaulterStats.totalDefaulters > 0
              ? `${defaulterStats.totalDefaulters.toLocaleString()} immunization defaulter${defaulterStats.totalDefaulters === 1 ? '' : 's'} (${defaulterStats.uniqueChildren.toLocaleString()} children, ${defaulterStats.critical} critical) need tracing.`
              : 'No immunization defaulters currently need tracing.')
            : 'No data on file for immunization defaulters.',
        ]} />
      </Section>
    </main>
  );
}
