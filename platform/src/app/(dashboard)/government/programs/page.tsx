'use client';

import { useMemo } from 'react';
import EhrListHeader from '@/components/ehr/EhrListHeader';
import { useRouter } from 'next/navigation';
import { useImmunizations } from '@/lib/hooks/useImmunizations';
import { useANC } from '@/lib/hooks/useANC';
import { useSurveillance } from '@/lib/hooks/useSurveillance';
import { Syringe, HeartPulse, ArrowUpRight, Info } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';

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
  const { t } = useTranslation();
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
      <div data-tour="gov-programs-header" className="dash-card mb-3">
        <EhrListHeader title={t('ui.diseasePrograms')} stats={[{ label: 'Scope', value: 'Programme monitoring · National' }]} />
      </div>

      {loading ? (
        <div className="dash-card p-8 text-center" style={{ color: 'var(--text-muted)' }}>{t('ui.loadingProgrammeData')}</div>
      ) : (
        <>
          <ProgramCard icon={Syringe} iconColor="var(--chart-1)" title={t('ui.immunizationEpi')} period="All records · National"
            links={[{ label: 'Open immunizations', href: '/immunizations' }]}>
            {immStats ? (
              <div className="grid grid-cols-3 gap-2">
                <StatTile label={t('labOrder.fieldCoverage')} value={`${immStats.coverageRate}%`} color="var(--chart-1)" />
                <StatTile label={t('ui.fullyImmunized')} value={immStats.fullyImmunized.toLocaleString()} sub={`of ${immStats.totalChildren.toLocaleString()} children`} />
                <StatTile label={t('ui.overdueMissed')} value={(immStats.overdue + immStats.missed).toLocaleString()} color="var(--color-warning-text)" />
              </div>
            ) : (
              <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>{t('ui.noDataOnFileFor')}</p>
            )}
          </ProgramCard>

          <ProgramCard icon={HeartPulse} iconColor="var(--color-success)" title={t('ui.rmncahAntenatalCare')} period="All records · National"
            links={[{ label: 'Open ANC', href: '/anc' }, { label: 'Open MCH analytics', href: '/mch-analytics' }]}>
            {ancStats ? (
              <div className="grid grid-cols-3 gap-2">
                <StatTile label={t('ui.anc4Rate')} value={`${ancStats.anc4PlusRate}%`} color="var(--color-success-text)" />
                <StatTile label={t('ui.mothersOnRecord')} value={ancStats.totalMothers.toLocaleString()} />
                <StatTile label={t('ui.highRiskPregnancies')} value={ancStats.highRiskCount.toLocaleString()} color="var(--color-danger-text)" />
              </div>
            ) : (
              <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>{t('ui.noDataOnFileFor2')}</p>
            )}
          </ProgramCard>

          <PlaceholderCard title={t('ui.hivProgramme')} note="Programme reporting not yet configured — no HIV programme dataset is collected in TamamHealth yet." />
          <PlaceholderCard title={t('ui.tbProgramme')} note="Programme reporting not yet configured — no TB programme dataset is collected in TamamHealth yet." />
          <PlaceholderCard
            title={t('ui.malariaProgramme')}
            note={
              <>
                {t('ui.programmeReportingNotYetConfigured')}
                {' '}
                <span style={{ color: 'var(--text-secondary)' }}>
                  {malariaAlertCount} {t('ui.activeMalariaSurveillanceSignal')}{malariaAlertCount === 1 ? '' : 's'} {t('ui.onFileSurveillanceSignalNot')}
                </span>
              </>
            }
          />
        </>
      )}
    </main>
  );
}
