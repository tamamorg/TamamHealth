'use client';

import { useState } from 'react';
import TableCols from '@/components/TableCols';
import { useTranslation } from '@/lib/i18n/useTranslation';
import DashboardGreetingHeader from '@/components/dashboard/DashboardGreetingHeader';
import { useMCHAnalytics } from '@/lib/hooks/useMCHAnalytics';
import {
  HeartPulse, Baby, Syringe, AlertTriangle,
  Shield, Users, Activity, Heart,
  ChevronDown, ChevronRight, Eye,
} from '@/components/icons/lucide';
import { SOUTH_SUDAN_STATES } from '@/lib/geographic-data';

type TabView = 'overview' | 'anc' | 'births' | 'mortality' | 'immunization' | 'high-risk';

export default function MCHAnalyticsPage() {
  const { t } = useTranslation();
  const { data, loading } = useMCHAnalytics();
  const [activeTab, setActiveTab] = useState<TabView>('overview');
  const [expandedMother, setExpandedMother] = useState<string | null>(null);

  if (loading || !data) {
    return (
      <>
        <main className="page-container flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center" style={{ background: 'transparent' }}>
              <HeartPulse className="w-8 h-8" style={{ color: 'var(--chart-2)' }} />
            </div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{t('mch.loading')}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{t('mch.loadingSub')}</p>
          </div>
        </main>
      </>
    );
  }

  const { summary, ancCascade, maternalMortality, birthOutcomes, neonatalData, immunizationGaps, highRiskPregnancies } = data;

  const gradeColors: Record<string, { bg: string; text: string }> = {
    A: { bg: 'rgba(79, 199, 155,0.12)', text: 'var(--color-success-text)' },
    B: { bg: 'rgba(124, 199, 255,0.12)', text: 'var(--accent-primary)' },
    C: { bg: 'rgba(255, 210, 166,0.12)', text: 'var(--color-warning-text)' },
    D: { bg: 'rgba(255, 153, 51,0.12)', text: '#FF9933' },
    F: { bg: 'rgba(242, 109, 100,0.12)', text: 'var(--color-danger-text)' },
  };

  const grade = gradeColors[summary.overallGrade] || gradeColors.F;
  const scoreColor = (v: number, target: number) => v >= target ? 'var(--color-success)' : v >= target * 0.6 ? 'var(--color-warning)' : 'var(--color-danger)';

  const tabs: { key: TabView; label: string; icon: typeof HeartPulse }[] = [
    { key: 'overview', label: t('mch.tabOverview'), icon: Eye },
    { key: 'anc', label: t('mch.tabAncCascade'), icon: HeartPulse },
    { key: 'births', label: t('mch.tabBirthOutcomes'), icon: Baby },
    { key: 'mortality', label: t('mch.tabMortality'), icon: Heart },
    { key: 'immunization', label: t('mch.tabImmunization'), icon: Syringe },
    { key: 'high-risk', label: t('mch.tabHighRisk'), icon: AlertTriangle },
  ];

  return (
    <>
      <main className="page-container page-enter">
        <DashboardGreetingHeader module="MCH analytics" actions={
          <>
            <div className="px-4 py-2 rounded-md flex items-center gap-2" style={{
              background: grade.bg,
              border: `1px solid ${grade.text}30`,
            }}>
              <Shield className="w-4 h-4" style={{ color: grade.text }} />
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: grade.text }}>
                {t('mch.gradePrefix', { grade: summary.overallGrade })}
              </span>
            </div>
            <div className="px-3 py-2 rounded-md" style={{ background: 'rgba(204, 102, 0,0.08)', border: '1px solid rgba(204, 102, 0,0.15)' }}>
              <p className="text-[10px] font-semibold" style={{ color: 'var(--chart-2)' }}>{t('mch.highRiskCount', { count: summary.highRiskCount })}</p>
            </div>
          </>
        } />

        {/* ═══ KPI STRIP ═══ */}
        <div className="kpi-grid mb-4">
          {[
            { label: t('mch.kpiMothersTracked'), value: summary.totalMothersTracked, icon: Users, color: 'var(--chart-2)', bg: 'rgba(204, 102, 0,0.12)' },
            { label: t('mch.kpiAnc4Rate'), value: `${summary.anc4PlusCoverage}%`, icon: HeartPulse, color: scoreColor(summary.anc4PlusCoverage, 50), bg: 'rgba(204, 102, 0,0.08)' },
            { label: t('mch.kpiMmr'), value: summary.maternalMortalityRatio.toLocaleString(), icon: Heart, color: summary.maternalMortalityRatio > 500 ? 'var(--color-danger-text)' : 'var(--color-warning-text)', bg: summary.maternalMortalityRatio > 500 ? 'rgba(242, 109, 100,0.12)' : 'rgba(255, 210, 166,0.12)' },
            { label: t('mch.kpiNmr'), value: summary.neonatalMortalityRate, icon: Baby, color: summary.neonatalMortalityRate > 30 ? 'var(--color-danger-text)' : 'var(--color-warning-text)', bg: summary.neonatalMortalityRate > 30 ? 'rgba(242, 109, 100,0.12)' : 'rgba(255, 210, 166,0.12)' },
            { label: t('mch.kpiImmunization'), value: `${summary.immunizationCoverage}%`, icon: Syringe, color: scoreColor(summary.immunizationCoverage, 80), bg: 'rgba(204, 102, 0,0.08)' },
            { label: t('mch.kpiFacilityBirths'), value: `${summary.facilityDeliveryRate}%`, icon: Activity, color: scoreColor(summary.facilityDeliveryRate, 50), bg: 'rgba(204, 102, 0,0.08)' },
            { label: t('mch.kpiHighRisk'), value: summary.highRiskCount, icon: AlertTriangle, color: 'var(--color-danger-text)', bg: 'rgba(242, 109, 100,0.12)' },
          ].map((kpi) => (
            <div key={kpi.label} className="kpi">
              <div className="kpi__icon">
                <kpi.icon style={{ color: kpi.color }} />
              </div>
              <div className="kpi__body">
                <div className="kpi__value">{kpi.value}</div>
                <div className="kpi__label">{kpi.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* ═══ SECTION SHELL: sidebar nav + content panel (replaces old pill-tab bar) ═══ */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <aside style={{ width: 224, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="dash-card" style={{ padding: '14px 16px' }}>
              <div className="flex items-center gap-2.5">
                <div className="listpage-header-icon"><HeartPulse size={20} /></div>
                <div style={{ minWidth: 0 }}>
                  <p className="listpage-eyebrow" style={{ margin: 0 }}>Maternal &amp; Child Health</p>
                  <h1 style={{ fontSize: 16, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>{t('mch.topbarTitle')}</h1>
                </div>
              </div>
            </div>
            <nav className="ehr-set-nav" aria-label={t('mch.topbarTitle')}>
              {tabs.map(tab => {
                const Icon = tab.icon;
                const count = tab.key === 'high-risk' ? highRiskPregnancies.length : undefined;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    className={activeTab === tab.key ? 'active' : undefined}
                    onClick={() => setActiveTab(tab.key)}
                  >
                    <Icon />
                    <em>{tab.label}</em>
                    {count !== undefined && <b>{count}</b>}
                  </button>
                );
              })}
            </nav>
          </aside>

          <section style={{ flex: 1, minWidth: 0 }}>

        {/* ═══ OVERVIEW TAB ═══ */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* ANC Cascade Visual */}
            <div className="card-elevated">
              <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                <h3 className="font-semibold text-sm flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <HeartPulse className="w-4 h-4" style={{ color: 'var(--chart-2)' }} />
                  {t('mch.ancCoverageCascade')}
                </h3>
              </div>
              <div className="p-4 space-y-4">
                {[
                  { label: t('mch.anc1Visit'), value: ancCascade.anc1, rate: ancCascade.anc1Rate, target: 90, color: 'var(--chart-2)' },
                  { label: t('mch.anc4Visits'), value: ancCascade.anc4, rate: ancCascade.anc4Rate, target: 50, color: 'var(--chart-3)' },
                  { label: t('mch.anc8WhoTarget'), value: ancCascade.anc8, rate: ancCascade.anc8Rate, target: 30, color: '#1174B4' },
                ].map(item => (
                  <div key={item.label}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('mch.mothersCount', { count: item.value })}</span>
                        <span className="text-sm font-bold" style={{ color: item.rate >= item.target ? 'var(--color-success-text)' : item.color }}>{item.rate}%</span>
                      </div>
                    </div>
                    <div className="relative h-4 rounded-full" style={{ background: 'var(--overlay-light)' }}>
                      <div className="h-full rounded-full transition-all" style={{
                        width: `${Math.min(100, item.rate)}%`,
                        background: `linear-gradient(90deg, ${item.color}, ${item.color}80)`,
                      }} />
                      <div className="absolute top-0 bottom-0 w-0.5" style={{
                        left: `${item.target}%`,
                        background: 'var(--text-muted)',
                        opacity: 0.5,
                      }} />
                      <span className="absolute text-[7px] font-mono" style={{
                        left: `${item.target}%`,
                        top: '-12px',
                        transform: 'translateX(-50%)',
                        color: 'var(--text-muted)',
                      }}>{t('mch.targetPercent', { value: item.target })}</span>
                    </div>
                  </div>
                ))}
                <div className="p-2 rounded-lg text-center mt-2" style={{ background: 'var(--overlay-subtle)' }}>
                  <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {t('mch.dropOffAnc1Anc4')} <strong style={{ color: '#FF9933' }}>{ancCascade.anc1Rate - ancCascade.anc4Rate}%</strong>
                  </p>
                </div>
              </div>
            </div>

            {/* Maternal Mortality Snapshot */}
            <div className="card-elevated">
              <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                <h3 className="font-semibold text-sm flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <Heart className="w-4 h-4" style={{ color: 'var(--color-danger-text)' }} />
                  {t('mch.maternalMortality')}
                </h3>
              </div>
              <div className="p-4 space-y-3">
                <div className="p-3 rounded-md text-center" style={{
                  background: maternalMortality.mmr > 500 ? 'rgba(242, 109, 100,0.08)' : 'rgba(255, 210, 166,0.08)',
                  border: `1px solid ${maternalMortality.mmr > 500 ? 'rgba(242, 109, 100,0.15)' : 'rgba(255, 210, 166,0.15)'}`,
                }}>
                  <p className="text-3xl font-bold stat-value" style={{
                    color: maternalMortality.mmr > 500 ? 'var(--color-danger-text)' : 'var(--color-warning-text)',
                  }}>{maternalMortality.mmr.toLocaleString()}</p>
                  <p className="text-[10px] uppercase tracking-wider font-semibold mt-1" style={{ color: 'var(--text-muted)' }}>
                    {t('mch.mmrPer100k')}
                  </p>
                  <p className="text-[9px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{t('mch.mmrBenchmark')}</p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 rounded-lg text-center" style={{ background: 'var(--overlay-subtle)' }}>
                    <p className="text-lg font-bold" style={{ color: 'var(--color-danger-text)' }}>{maternalMortality.totalMaternalDeaths}</p>
                    <p className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{t('mch.maternalDeaths')}</p>
                  </div>
                  <div className="p-2 rounded-lg text-center" style={{ background: 'var(--overlay-subtle)' }}>
                    <p className="text-lg font-bold" style={{ color: 'var(--color-success-text)' }}>{maternalMortality.totalLiveBirths}</p>
                    <p className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{t('mch.liveBirths')}</p>
                  </div>
                </div>

                {/* Top causes */}
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>{t('mch.topCauses')}</p>
                  {maternalMortality.directCauses.slice(0, 4).map(c => (
                    <div key={c.cause} className="flex items-center justify-between py-1.5 text-xs" style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{c.cause}</span>
                      <span className="font-bold" style={{ color: 'var(--color-danger-text)' }}>{c.count} ({c.percentage}%)</span>
                    </div>
                  ))}
                  {maternalMortality.directCauses.length === 0 && (
                    <p className="text-xs text-center py-2" style={{ color: 'var(--text-muted)' }}>{t('mch.noMaternalDeathData')}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Neonatal & Child Health */}
            <div className="card-elevated">
              <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                <h3 className="font-semibold text-sm flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <Baby className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                  {t('mch.childMortality')}
                </h3>
              </div>
              <div className="p-4 space-y-3">
                {[
                  { label: t('mch.neonatalLabel'), value: neonatalData.neonatalMortalityRate, deaths: neonatalData.totalNeonatalDeaths, target: 12, unit: '/1,000 LB' },
                  { label: t('mch.infantLabel'), value: neonatalData.infantMortalityRate, deaths: neonatalData.totalInfantDeaths, target: 25, unit: '/1,000 LB' },
                  { label: t('mch.under5Label'), value: neonatalData.under5MortalityRate, deaths: neonatalData.totalUnder5Deaths, target: 25, unit: '/1,000 LB' },
                ].map(item => {
                  const color = item.value > item.target * 2 ? 'var(--color-danger-text)' : item.value > item.target ? 'var(--color-warning)' : 'var(--color-success)';
                  return (
                    <div key={item.label} className="p-3 rounded-md" style={{ background: `${color}08`, border: `1px solid ${color}15` }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
                        <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{t('mch.deathsCount', { count: item.deaths })}</span>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-xl font-bold" style={{ color }}>{item.value}</span>
                        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{item.unit}</span>
                      </div>
                      <p className="text-[9px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{t('mch.sdgTarget', { value: item.target })}</p>
                    </div>
                  );
                })}

                {/* Top causes */}
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>{t('mch.topUnder5Causes')}</p>
                  {neonatalData.topCauses.slice(0, 4).map(c => (
                    <div key={c.cause} className="flex items-center justify-between py-1 text-[11px]">
                      <span style={{ color: 'var(--text-secondary)' }}>{c.cause}</span>
                      <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{c.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Immunization Coverage Overview */}
            <div className="lg:col-span-2 card-elevated">
              <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                <h3 className="font-semibold text-sm flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <Syringe className="w-4 h-4" style={{ color: 'var(--chart-3)' }} />
                  {t('mch.immunizationCoverageGaps')}
                </h3>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {immunizationGaps.map(gap => {
                    const color = gap.coverageRate >= 80 ? 'var(--color-success)' : gap.coverageRate >= 50 ? 'var(--color-warning)' : 'var(--color-danger)';
                    return (
                      <div key={gap.vaccine} className="p-3 rounded-md" style={{
                        background: 'var(--overlay-subtle)',
                        border: '1px solid var(--border-light)',
                      }}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{gap.vaccine}</span>
                          <span className="text-sm font-bold" style={{ color }}>{gap.coverageRate}%</span>
                        </div>
                        <div className="h-2 rounded-full mb-2" style={{ background: 'var(--overlay-light)' }}>
                          <div className="h-full rounded-full" style={{
                            width: `${gap.coverageRate}%`,
                            background: `linear-gradient(90deg, ${color}80, ${color})`,
                          }} />
                        </div>
                        <div className="flex justify-between text-[9px]">
                          <span style={{ color: 'var(--text-muted)' }}>{gap.vaccinated}/{gap.targetPopulation}</span>
                          {gap.dropoutRate > 0 && (
                            <span style={{ color: '#FF9933' }}>{t('mch.dropoutPercent', { value: gap.dropoutRate })}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Birth Outcomes Quick */}
            <div className="card-elevated">
              <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                <h3 className="font-semibold text-sm flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <Baby className="w-4 h-4" style={{ color: 'var(--color-success)' }} />
                  {t('mch.birthOutcomes')}
                </h3>
              </div>
              <div className="p-4 space-y-3">
                {[
                  { label: t('mch.totalBirths'), value: birthOutcomes.totalBirths, color: 'var(--accent-primary)' },
                  { label: t('mch.facilityDelivery'), value: `${birthOutcomes.facilityDeliveryRate}%`, color: scoreColor(birthOutcomes.facilityDeliveryRate, 50) },
                  { label: t('mch.caesareanRate'), value: `${birthOutcomes.caesareanRate}%`, color: birthOutcomes.caesareanRate > 5 && birthOutcomes.caesareanRate < 15 ? 'var(--color-success-text)' : 'var(--color-warning-text)' },
                  { label: t('mch.lowBirthWeight'), value: `${birthOutcomes.lowBirthWeightRate}%`, color: birthOutcomes.lowBirthWeightRate > 15 ? 'var(--color-danger-text)' : 'var(--color-warning)' },
                  { label: t('mch.avgBirthWeight'), value: `${birthOutcomes.averageBirthWeight}g`, color: birthOutcomes.averageBirthWeight >= 2500 ? 'var(--color-success)' : 'var(--color-danger)' },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between p-2 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
                    <span className="text-sm font-bold" style={{ color: item.color }}>{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══ ANC CASCADE TAB ═══ */}
        {activeTab === 'anc' && (
          <div className="space-y-4">
            {/* Large cascade visual */}
            <div className="card-elevated p-6">
              <h3 className="font-semibold text-sm mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <HeartPulse className="w-4 h-4" style={{ color: 'var(--chart-2)' }} />
                {t('mch.ancCascadeWhoTitle')}
              </h3>
              <div className="flex items-end justify-center gap-6" style={{ height: '240px' }}>
                {[
                  { label: t('mch.anc1Short'), value: ancCascade.anc1, rate: ancCascade.anc1Rate, color: 'var(--chart-2)' },
                  { label: t('mch.anc4Short'), value: ancCascade.anc4, rate: ancCascade.anc4Rate, color: 'var(--chart-3)' },
                  { label: t('mch.anc8Short'), value: ancCascade.anc8, rate: ancCascade.anc8Rate, color: '#1174B4' },
                ].map(item => {
                  const maxRate = Math.max(ancCascade.anc1Rate, 1);
                  const barHeight = (item.rate / maxRate) * 100;
                  return (
                    <div key={item.label} className="flex flex-col items-center gap-2" style={{ width: '120px' }}>
                      <p className="text-2xl font-bold" style={{ color: item.color }}>{item.rate}%</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{item.value} mothers</p>
                      <div className="w-full flex flex-col justify-end" style={{ height: '140px' }}>
                        <div className="w-full rounded-t-xl transition-all" style={{
                          height: `${barHeight}%`,
                          minHeight: '8px',
                          background: `linear-gradient(180deg, ${item.color}, ${item.color}40)`,
                        }} />
                      </div>
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{item.label}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* By state table */}
            <div className="card-elevated overflow-hidden">
              <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{t('mch.ancCoverageByState')}</h3>
              </div>
              <div className="overflow-x-auto">
              <table className="data-table" style={{ minWidth: 840, tableLayout: 'fixed' }}>
                <TableCols widths={[1.6, 1.2, 0.9, 0.9, 0.9, 1.1, 1.1]} />
                <thead>
                  <tr>
                    <th>{t('mch.colState')}</th>
                    <th>{t('mch.colTotalPregnancies')}</th>
                    <th>{t('mch.anc1Short')}</th>
                    <th>{t('mch.anc4Short')}</th>
                    <th>{t('mch.anc8Short')}</th>
                    <th>{t('mch.colAnc4Rate')}</th>
                    <th>{t('mch.colDropOff')}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(ancCascade.byState)
                    .filter(([, d]) => d.total > 0)
                    .sort(([, a], [, b]) => b.total - a.total)
                    .map(([state, d]) => {
                      const anc4Rate = d.total > 0 ? Math.round((d.anc4 / d.total) * 100) : 0;
                      const dropoff = d.anc1 > 0 ? Math.round(((d.anc1 - d.anc4) / d.anc1) * 100) : 0;
                      return (
                        <tr key={state}>
                          <td className="font-semibold text-sm">{state}</td>
                          <td>{d.total}</td>
                          <td className="font-semibold">{d.anc1}</td>
                          <td className="font-semibold">{d.anc4}</td>
                          <td>{d.anc8}</td>
                          <td>
                            <span className="font-bold" style={{ color: anc4Rate >= 50 ? 'var(--color-success-text)' : anc4Rate >= 30 ? 'var(--color-warning-text)' : 'var(--color-danger-text)' }}>
                              {anc4Rate}%
                            </span>
                          </td>
                          <td>
                            <span className="text-xs" style={{ color: dropoff > 50 ? 'var(--color-danger-text)' : '#FF9933' }}>
                              {dropoff}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              </div>
            </div>
          </div>
        )}

        {/* ═══ BIRTHS TAB ═══ */}
        {activeTab === 'births' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: t('mch.totalBirths'), value: birthOutcomes.totalBirths, color: 'var(--accent-primary)' },
                { label: t('mch.facilityDelivery'), value: `${birthOutcomes.facilityDeliveryRate}%`, color: scoreColor(birthOutcomes.facilityDeliveryRate, 50) },
                { label: t('mch.caesareanRate'), value: `${birthOutcomes.caesareanRate}%`, color: 'var(--chart-3)' },
                { label: t('mch.lowBirthWeight'), value: `${birthOutcomes.lowBirthWeightRate}%`, sub: t('mch.babiesCount', { count: birthOutcomes.lowBirthWeight }), color: birthOutcomes.lowBirthWeightRate > 15 ? 'var(--color-danger-text)' : 'var(--color-warning-text)' },
              ].map(item => (
                <div key={item.label} className="card-elevated p-4">
                  <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{item.label}</p>
                  <p className="text-2xl font-bold" style={{ color: item.color }}>{item.value}</p>
                  {'sub' in item && item.sub && <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{item.sub}</p>}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Delivery Type */}
              <div className="card-elevated p-4">
                <h3 className="font-semibold text-sm mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <Baby className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                  {t('mch.byDeliveryType')}
                </h3>
                <div className="space-y-3">
                  {Object.entries(birthOutcomes.byDeliveryType).map(([type, count]) => {
                    const pct = birthOutcomes.totalBirths > 0 ? Math.round((count / birthOutcomes.totalBirths) * 100) : 0;
                    const color = type === 'normal' ? 'var(--color-success)' : type === 'caesarean' ? 'var(--chart-3)' : 'var(--accent-primary)';
                    return (
                      <div key={type}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="capitalize" style={{ color: 'var(--text-secondary)' }}>{type}</span>
                          <span className="font-bold" style={{ color }}>{count} ({pct}%)</span>
                        </div>
                        <div className="h-3 rounded-full" style={{ background: 'var(--overlay-light)' }}>
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Birth Attendant */}
              <div className="card-elevated p-4">
                <h3 className="font-semibold text-sm mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <Users className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                  {t('mch.byBirthAttendant')}
                </h3>
                <div className="space-y-3">
                  {Object.entries(birthOutcomes.byAttendant)
                    .sort(([, a], [, b]) => b - a)
                    .map(([attendant, count]) => {
                      const pct = birthOutcomes.totalBirths > 0 ? Math.round((count / birthOutcomes.totalBirths) * 100) : 0;
                      const color = attendant === 'doctor' ? 'var(--accent-primary)' : attendant === 'midwife' ? 'var(--chart-2)' : attendant === 'nurse' ? 'var(--accent-primary)' : '#FF9933';
                      return (
                        <div key={attendant}>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="capitalize" style={{ color: 'var(--text-secondary)' }}>{attendant}</span>
                            <span className="font-bold" style={{ color }}>{count} ({pct}%)</span>
                          </div>
                          <div className="h-3 rounded-full" style={{ background: 'var(--overlay-light)' }}>
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>

            {/* Monthly trend */}
            <div className="card-elevated">
              <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{t('mch.monthlyBirthTrend')}</h3>
              </div>
              <div className="p-4">
                <div className="flex items-end gap-3" style={{ height: '160px' }}>
                  {(birthOutcomes.monthlyTrend || []).map(m => {
                    const monthlyBirthValues = (birthOutcomes.monthlyTrend || []).map(mt => mt.births);
                    const maxBirths = monthlyBirthValues.length > 0 ? Math.max(...monthlyBirthValues, 1) : 1;
                    const height = (m.births / maxBirths) * 100;
                    return (
                      <div key={m.month} className="flex-1 flex flex-col items-center gap-1 group">
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity text-center">
                          <p className="text-[10px] font-bold" style={{ color: 'var(--text-primary)' }}>{m.births}</p>
                          <p className="text-[8px]" style={{ color: 'var(--chart-3)' }}>{t('mch.caesareanCount', { count: m.caesarean })}</p>
                        </div>
                        <div className="w-full flex flex-col justify-end" style={{ height: '120px' }}>
                          <div className="w-full rounded-t-md" style={{
                            height: `${height}%`,
                            minHeight: m.births > 0 ? '4px' : '0',
                            background: 'linear-gradient(180deg, #2191D0, rgba(17, 116, 180,0.3))',
                          }} />
                        </div>
                        <span className="text-[9px] font-mono" style={{ color: 'var(--text-muted)' }}>{m.month}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* By state */}
            <div className="card-elevated overflow-hidden">
              <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{t('mch.birthOutcomesByState')}</h3>
              </div>
              <div className="overflow-x-auto">
              <table className="data-table" style={{ minWidth: 720, tableLayout: 'fixed' }}>
                <TableCols widths={[1.7, 1.1, 1.1, 1, 1.2, 1]} />
                <thead>
                  <tr>
                    <th>{t('mch.colState')}</th>
                    <th>{t('mch.totalBirths')}</th>
                    <th>{t('mch.colCaesarean')}</th>
                    <th>{t('mch.colCsRate')}</th>
                    <th>{t('mch.lowBirthWeight')}</th>
                    <th>{t('mch.colLbwRate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(birthOutcomes.byState)
                    .filter(([, d]) => d.total > 0)
                    .sort(([, a], [, b]) => b.total - a.total)
                    .map(([state, d]) => (
                      <tr key={state}>
                        <td className="font-semibold text-sm">{state}</td>
                        <td className="font-semibold">{d.total}</td>
                        <td>{d.caesarean}</td>
                        <td>
                          <span style={{ color: d.total > 0 && (d.caesarean / d.total * 100) > 15 ? '#FF9933' : 'var(--text-secondary)' }}>
                            {d.total > 0 ? Math.round((d.caesarean / d.total) * 100) : 0}%
                          </span>
                        </td>
                        <td>{d.lowBW}</td>
                        <td>
                          <span style={{ color: d.total > 0 && (d.lowBW / d.total * 100) > 15 ? 'var(--color-danger-text)' : 'var(--text-secondary)' }}>
                            {d.total > 0 ? Math.round((d.lowBW / d.total) * 100) : 0}%
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              </div>
            </div>
          </div>
        )}

        {/* ═══ MORTALITY TAB ═══ */}
        {activeTab === 'mortality' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {/* Maternal Mortality Detail */}
              <div className="card-elevated">
                <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                  <h3 className="font-semibold text-sm flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <Heart className="w-4 h-4" style={{ color: 'var(--color-danger-text)' }} />
                    {t('mch.maternalMortalityAnalysis')}
                  </h3>
                </div>
                <div className="p-4 space-y-4">
                  {/* MMR by age group */}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>{t('mch.byAgeGroup')}</p>
                    <div className="space-y-2">
                      {Object.entries(maternalMortality.byAgeGroup).map(([age, count]) => {
                        const ageGroupValues = Object.values(maternalMortality.byAgeGroup || {});
                        const maxCount = ageGroupValues.length > 0 ? Math.max(...ageGroupValues, 1) : 1;
                        return (
                          <div key={age} className="flex items-center gap-2">
                            <span className="text-xs w-12 text-end font-mono" style={{ color: 'var(--text-muted)' }}>{age}</span>
                            <div className="flex-1 h-3 rounded-full" style={{ background: 'var(--overlay-light)' }}>
                              <div className="h-full rounded-full" style={{
                                width: `${(count / maxCount) * 100}%`,
                                background: 'var(--color-danger)',
                                minWidth: count > 0 ? '4px' : '0',
                              }} />
                            </div>
                            <span className="text-xs font-bold w-6" style={{ color: 'var(--text-primary)' }}>{count}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Monthly trend */}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>{t('mch.monthlyTrend')}</p>
                    <div className="flex items-end gap-2" style={{ height: '100px' }}>
                      {maternalMortality.trend.map(mt => {
                        const trendValues = (maternalMortality.trend || []).map(tr => tr.deaths);
                        const maxDeaths = trendValues.length > 0 ? Math.max(...trendValues, 1) : 1;
                        const height = (mt.deaths / maxDeaths) * 100;
                        return (
                          <div key={mt.month} className="flex-1 flex flex-col items-center gap-0.5 group">
                            <span className="text-[8px] opacity-0 group-hover:opacity-100 font-bold" style={{ color: 'var(--color-danger-text)' }}>{mt.deaths}</span>
                            <div className="w-full flex flex-col justify-end" style={{ height: '70px' }}>
                              <div className="w-full rounded-t-sm" style={{
                                height: `${height}%`,
                                minHeight: mt.deaths > 0 ? '3px' : '0',
                                background: 'var(--color-danger)',
                              }} />
                            </div>
                            <span className="text-[7px] font-mono" style={{ color: 'var(--text-muted)' }}>{mt.month}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Child Mortality Detail */}
              <div className="card-elevated">
                <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                  <h3 className="font-semibold text-sm flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <Baby className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                    {t('mch.childMortalityAnalysis')}
                  </h3>
                </div>
                <div className="p-4 space-y-4">
                  {/* By gender */}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>{t('mch.under5ByGender')}</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 rounded-md text-center" style={{ background: 'rgba(124, 199, 255,0.08)' }}>
                        <p className="text-xl font-bold" style={{ color: 'var(--accent-primary)' }}>{neonatalData.byGender?.Male || 0}</p>
                        <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{t('mch.male')}</p>
                      </div>
                      <div className="p-3 rounded-md text-center" style={{ background: 'rgba(204, 102, 0,0.08)' }}>
                        <p className="text-xl font-bold" style={{ color: 'var(--chart-2)' }}>{neonatalData.byGender?.Female || 0}</p>
                        <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{t('mch.female')}</p>
                      </div>
                    </div>
                  </div>

                  {/* Top causes (larger) */}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>{t('mch.topUnder5CausesOfDeath')}</p>
                    <div className="space-y-2">
                      {(neonatalData.topCauses || []).slice(0, 6).map((c, i) => {
                        const topCauseValues = (neonatalData.topCauses || []).map(tc => tc.count);
                        const maxCount = topCauseValues.length > 0 ? Math.max(...topCauseValues, 1) : 1;
                        return (
                          <div key={c.cause}>
                            <div className="flex justify-between text-xs mb-1">
                              <span style={{ color: 'var(--text-secondary)' }}>{c.cause}</span>
                              <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{c.count}</span>
                            </div>
                            <div className="h-2 rounded-full" style={{ background: 'var(--overlay-light)' }}>
                              <div className="h-full rounded-full" style={{
                                width: `${(c.count / maxCount) * 100}%`,
                                background: i === 0 ? 'var(--color-danger)' : i < 3 ? '#FF9933' : 'var(--color-warning)',
                              }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* By state table */}
            <div className="card-elevated overflow-hidden">
              <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{t('mch.mortalityByState')}</h3>
              </div>
              <div className="overflow-x-auto">
              <table className="data-table" style={{ minWidth: 840, tableLayout: 'fixed' }}>
                <TableCols widths={[1.6, 1.1, 1, 1, 1.1, 1, 1]} />
                <thead>
                  <tr>
                    <th>{t('mch.colState')}</th>
                    <th>{t('mch.maternalDeaths')}</th>
                    <th>{t('mch.colBirths')}</th>
                    <th>{t('mch.colMmr')}</th>
                    <th>{t('mch.colNeonatal')}</th>
                    <th>{t('mch.colInfant')}</th>
                    <th>{t('mch.colUnder5')}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(maternalMortality.byState)
                    .sort(([, a], [, b]) => b.mmr - a.mmr)
                    .map(([state, d]) => {
                      const neo = neonatalData.byState?.[state];
                      return (
                        <tr key={state}>
                          <td className="font-semibold text-sm">{state}</td>
                          <td style={{ color: d.deaths > 0 ? 'var(--color-danger-text)' : 'var(--text-secondary)' }}>{d.deaths}</td>
                          <td>{d.births}</td>
                          <td>
                            <span className="font-bold" style={{
                              color: d.mmr > 500 ? 'var(--color-danger-text)' : d.mmr > 200 ? 'var(--color-warning-text)' : 'var(--color-success-text)',
                            }}>{d.mmr.toLocaleString()}</span>
                          </td>
                          <td>{neo?.neonatal || 0}</td>
                          <td>{neo?.infant || 0}</td>
                          <td>{neo?.under5 || 0}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              </div>
            </div>
          </div>
        )}

        {/* ═══ IMMUNIZATION TAB ═══ */}
        {activeTab === 'immunization' && (
          <div className="space-y-4">
            <div className="card-elevated overflow-hidden">
              <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                <h3 className="font-semibold text-sm flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <Syringe className="w-4 h-4" style={{ color: 'var(--chart-3)' }} />
                  {t('mch.vaccineCoverageDropout')}
                </h3>
              </div>
              <div className="overflow-x-auto">
              <table className="data-table" style={{ minWidth: 840, tableLayout: 'fixed' }}>
                <TableCols widths={[1.9, 1, 1, 1, 0.9, 1, 1]} />
                <thead>
                  <tr>
                    <th>{t('mch.colVaccine')}</th>
                    <th>{t('mch.colTargetPop')}</th>
                    <th>{t('mch.colVaccinated')}</th>
                    <th>{t('mch.colCoverage')}</th>
                    <th>{t('mch.colGap')}</th>
                    <th>{t('mch.colDropout')}</th>
                    <th>{t('mch.colStatus')}</th>
                  </tr>
                </thead>
                <tbody>
                  {immunizationGaps.map(gap => {
                    const color = gap.coverageRate >= 80 ? 'var(--color-success)' : gap.coverageRate >= 50 ? 'var(--color-warning)' : 'var(--color-danger)';
                    return (
                      <tr key={gap.vaccine}>
                        <td className="font-semibold text-sm">{gap.vaccine}</td>
                        <td>{gap.targetPopulation}</td>
                        <td className="font-semibold">{gap.vaccinated}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 rounded-full" style={{ background: 'var(--overlay-light)', maxWidth: '60px' }}>
                              <div className="h-full rounded-full" style={{ width: `${gap.coverageRate}%`, background: color }} />
                            </div>
                            <span className="text-xs font-bold" style={{ color }}>{gap.coverageRate}%</span>
                          </div>
                        </td>
                        <td style={{ color: '#FF9933' }}>{gap.gap}</td>
                        <td>
                          {gap.dropoutRate > 0 ? (
                            <span style={{ color: gap.dropoutRate > 20 ? 'var(--color-danger-text)' : '#FF9933' }}>{gap.dropoutRate}%</span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>—</span>
                          )}
                        </td>
                        <td>
                          {gap.coverageRate >= 80 ? (
                            <span className="badge badge-normal text-[10px]">{t('mch.statusOnTrack')}</span>
                          ) : gap.coverageRate >= 50 ? (
                            <span className="badge badge-warning text-[10px]">{t('mch.statusBelowTarget')}</span>
                          ) : (
                            <span className="badge badge-emergency text-[10px]">{t('mch.statusCriticalGap')}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>

            {/* By state heatmap */}
            <div className="card-elevated">
              <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{t('mch.immunizationCoverageByState')}</h3>
              </div>
              <div className="p-4 overflow-x-auto">
                <table className="data-table" style={{ minWidth: 760, tableLayout: 'fixed' }}>
                  <thead>
                    <tr>
                      <th>{t('mch.colState')}</th>
                      {immunizationGaps.map(g => (
                        <th key={g.vaccine} className="text-center">{g.vaccine}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {SOUTH_SUDAN_STATES.map(state => (
                      <tr key={state}>
                        <td className="font-semibold text-xs whitespace-nowrap">{state.replace('Northern ', 'N. ').replace('Western ', 'W. ').replace('Eastern ', 'E. ').replace('Central ', 'C. ')}</td>
                        {immunizationGaps.map(g => {
                          const stateData = g.byState?.[state];
                          const rate = stateData?.rate || 0;
                          const color = rate >= 80 ? 'var(--color-success)' : rate >= 50 ? 'var(--color-warning)' : rate > 0 ? 'var(--color-danger)' : 'var(--text-muted)';
                          return (
                            <td key={g.vaccine} className="text-center">
                              <span className="text-xs font-bold" style={{ color }}>{rate}%</span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ═══ HIGH RISK TAB ═══ */}
        {activeTab === 'high-risk' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="card-elevated p-4">
                <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{t('mch.totalHighRisk')}</p>
                <p className="text-2xl font-bold" style={{ color: 'var(--color-danger-text)' }}>
                  {highRiskPregnancies.filter(h => h.riskLevel === 'high').length}
                </p>
              </div>
              <div className="card-elevated p-4">
                <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{t('mch.moderateRisk')}</p>
                <p className="text-2xl font-bold" style={{ color: 'var(--color-warning-text)' }}>
                  {highRiskPregnancies.filter(h => h.riskLevel === 'moderate').length}
                </p>
              </div>
              <div className="card-elevated p-4">
                <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{t('mch.totalTracked')}</p>
                <p className="text-2xl font-bold" style={{ color: 'var(--accent-primary)' }}>
                  {highRiskPregnancies.length}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {highRiskPregnancies.map(mother => {
                const isHigh = mother.riskLevel === 'high';
                const color = isHigh ? 'var(--color-danger-text)' : 'var(--color-warning)';
                const isExpanded = expandedMother === mother.motherId;
                return (
                  <div key={mother.motherId} className="card-elevated overflow-hidden">
                    <div
                      className="p-4 flex items-center justify-between cursor-pointer"
                      onClick={() => setExpandedMother(isExpanded ? null : mother.motherId)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-md flex items-center justify-center" style={{
                          background: 'transparent',
                        }}>
                          <HeartPulse className="w-5 h-5" style={{ color }} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{mother.motherName}</span>
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{
                              background: `${color}15`,
                              color,
                            }}>{mother.riskLevel.toUpperCase()}</span>
                          </div>
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {t('mch.motherMeta', { age: mother.age, weeks: mother.gestationalAge, visits: mother.visitCount, facility: mother.facility })}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-end">
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{mother.state}</p>
                          <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{t('mch.lastVisit', { date: mother.lastVisitDate })}</p>
                        </div>
                        {isExpanded ? <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-muted)' }} /> : <ChevronRight className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />}
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="px-4 pb-4 border-t" style={{ borderColor: 'var(--border-light)' }}>
                        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div className="p-2 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                            <p className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('mch.bloodPressure')}</p>
                            <p className="text-sm font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>{mother.bloodPressure}</p>
                          </div>
                          <div className="p-2 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                            <p className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('mch.hemoglobin')}</p>
                            <p className="text-sm font-bold mt-0.5" style={{
                              color: mother.hemoglobin < 11 ? 'var(--color-danger-text)' : 'var(--color-success-text)',
                            }}>{t('mch.hemoglobinValue', { value: mother.hemoglobin })}</p>
                          </div>
                          <div className="p-2 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                            <p className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('mch.gestationalAge')}</p>
                            <p className="text-sm font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>{t('mch.weeksValue', { value: mother.gestationalAge })}</p>
                          </div>
                          <div className="p-2 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                            <p className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('mch.visitCount')}</p>
                            <p className="text-sm font-bold mt-0.5" style={{
                              color: mother.visitCount >= 4 ? 'var(--color-success-text)' : 'var(--color-warning-text)',
                            }}>{mother.visitCount}</p>
                          </div>
                        </div>
                        {(mother.riskFactors?.length ?? 0) > 0 && (
                          <div className="mt-3">
                            <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>{t('mch.riskFactors')}</p>
                            <div className="flex flex-wrap gap-1.5">
                              {(mother.riskFactors || []).map(rf => (
                                <span key={rf} className="text-[10px] px-2 py-0.5 rounded-full" style={{
                                  background: `${color}10`,
                                  color,
                                  border: `1px solid ${color}20`,
                                }}>{rf}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {highRiskPregnancies.length === 0 && (
                <div className="card-elevated p-8 text-center">
                  <HeartPulse className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--text-muted)', opacity: 0.3 }} />
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('mch.noHighRiskDetected')}</p>
                </div>
              )}
            </div>
          </div>
        )}

          </section>
        </div>
      </main>
    </>
  );
}
