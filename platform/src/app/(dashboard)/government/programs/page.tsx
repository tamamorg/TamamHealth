'use client';

import { useMemo } from 'react';
import EhrListHeader from '@/components/ehr/EhrListHeader';
import { useRouter } from 'next/navigation';
import { useImmunizations } from '@/lib/hooks/useImmunizations';
import { useANC } from '@/lib/hooks/useANC';
import { useSurveillance } from '@/lib/hooks/useSurveillance';
import { Syringe, HeartPulse, ArrowUpRight, Info } from '@/components/icons/lucide';

const SECTION_TITLE_STYLE: React.CSSProperties = {
  fontFamily: 'var(--font-condensed)', fontWeight: 600, fontSize: 22, lineHeight: 1.12, letterSpacing: '-0.015em', color: 'var(--text-primary)',
};

function StatTile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="px-3 py-2.5 rounded-lg" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
      <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-[20px] font-bold" style={{ color: color || 'var(--text-primary)' }}>{value}</p>
      {sub && <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  );
}

function ProgramCard({ icon: Icon, iconColor, title, period, children, links }: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  iconColor: string;
  title: string;
  period: string;
  children: React.ReactNode;
  links: { label: string; href: string }[];
}) {
  const router = useRouter();
  return (
    <div className="dash-card mb-3">
      <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-2 flex-wrap" style={{ borderBottom: '1px solid var(--border-light)' }}>
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4" style={{ color: iconColor }} />
          <span className="text-[15px] font-bold" style={{ color: 'var(--text-primary)' }}>{title}</span>
        </div>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{period}</span>
      </div>
      <div className="px-4 py-3">
        {children}
        <div className="flex items-center gap-4 mt-3">
          {links.map(l => (
            <button
              key={l.href}
              onClick={() => router.push(l.href)}
              className="inline-flex items-center gap-1 text-[12px] font-semibold"
              style={{ color: 'var(--accent-primary)' }}
            >
              {l.label} <ArrowUpRight className="w-3 h-3" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PlaceholderCard({ title, note }: { title: string; note: React.ReactNode }) {
  return (
    <div className="dash-card mb-3" style={{ opacity: 0.85 }}>
      <div className="px-4 pt-4 pb-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
        <span className="text-[15px] font-bold" style={{ color: 'var(--text-primary)' }}>{title}</span>
      </div>
      <div className="px-4 py-3 flex items-start gap-2">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--text-muted)' }} />
        <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>{note}</div>
      </div>
    </div>
  );
}

export default function DiseaseProgramsPage() {
  const { stats: immStats, loading: immLoading } = useImmunizations();
  const { stats: ancStats, loading: ancLoading } = useANC();
  const { alerts, loading: alertsLoading } = useSurveillance();

  const malariaAlertCount = useMemo(
    () => alerts.filter(a => a.disease.toLowerCase() === 'malaria' && a.alertLevel !== 'normal').length,
    [alerts],
  );

  const loading = immLoading || ancLoading || alertsLoading;

  return (
    <main className="page-container page-enter">
      <div className="dash-card mb-3">
        <EhrListHeader title="Disease programs" stats={[{ label: 'Scope', value: 'Programme monitoring · National' }]} />
      </div>

      {loading ? (
        <div className="dash-card p-8 text-center" style={{ color: 'var(--text-muted)' }}>Loading programme data…</div>
      ) : (
        <>
          <ProgramCard icon={Syringe} iconColor="var(--chart-1)" title="Immunization (EPI)" period="All records · National"
            links={[{ label: 'Open immunizations', href: '/immunizations' }]}>
            {immStats ? (
              <div className="grid grid-cols-3 gap-2">
                <StatTile label="Coverage" value={`${immStats.coverageRate}%`} color="var(--chart-1)" />
                <StatTile label="Fully immunized" value={immStats.fullyImmunized.toLocaleString()} sub={`of ${immStats.totalChildren.toLocaleString()} children`} />
                <StatTile label="Overdue / missed" value={(immStats.overdue + immStats.missed).toLocaleString()} color="var(--color-warning-text)" />
              </div>
            ) : (
              <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>No data on file for immunization coverage.</p>
            )}
          </ProgramCard>

          <ProgramCard icon={HeartPulse} iconColor="var(--color-success)" title="RMNCAH — Antenatal Care" period="All records · National"
            links={[{ label: 'Open ANC', href: '/anc' }, { label: 'Open MCH analytics', href: '/mch-analytics' }]}>
            {ancStats ? (
              <div className="grid grid-cols-3 gap-2">
                <StatTile label="ANC4+ rate" value={`${ancStats.anc4PlusRate}%`} color="var(--color-success-text)" />
                <StatTile label="Mothers on record" value={ancStats.totalMothers.toLocaleString()} />
                <StatTile label="High-risk pregnancies" value={ancStats.highRiskCount.toLocaleString()} color="var(--color-danger-text)" />
              </div>
            ) : (
              <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>No data on file for antenatal care coverage.</p>
            )}
          </ProgramCard>

          <PlaceholderCard title="HIV programme" note="Programme reporting not yet configured — no HIV programme dataset is collected in TamamHealth yet." />
          <PlaceholderCard title="TB programme" note="Programme reporting not yet configured — no TB programme dataset is collected in TamamHealth yet." />
          <PlaceholderCard
            title="Malaria programme"
            note={
              <>
                Programme reporting not yet configured — no malaria programme dataset is collected in TamamHealth yet.
                {' '}
                <span style={{ color: 'var(--text-secondary)' }}>
                  {malariaAlertCount} active malaria surveillance signal{malariaAlertCount === 1 ? '' : 's'} on file (surveillance signal, not programme data).
                </span>
              </>
            }
          />
        </>
      )}
    </main>
  );
}
