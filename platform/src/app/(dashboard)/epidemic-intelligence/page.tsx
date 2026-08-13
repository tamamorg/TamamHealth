'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/useTranslation';
import EhrListHeader from '@/components/ehr/EhrListHeader';
import { useEpidemicIntelligence } from '@/lib/hooks/useEpidemicIntelligence';
import {
  Activity, AlertTriangle, TrendingUp,
  Shield, Zap, MapPin, FileText, Radio, BarChart3,
  ChevronDown, ChevronRight, Thermometer, Bug, Eye,
} from '@/components/icons/lucide';
import { SOUTH_SUDAN_STATES } from '@/lib/geographic-data';
import Badge, { type BadgeTone } from '@/components/Badge';
import { FilterBar, FilterTabs } from '@/components/filters';

// EWARS / IDSR severity → semantic Badge tone.
const SEVERITY_TONE: Record<string, BadgeTone> = {
  critical: 'danger',
  high: 'warning',
  medium: 'warning',
  low: 'success',
};

type TabView = 'overview' | 'curves' | 'syndromic' | 'geographic' | 'idsr' | 'alerts';
const VALID_TABS: TabView[] = ['overview', 'curves', 'syndromic', 'geographic', 'idsr', 'alerts'];

// South Sudan states for mini heatmap
const STATES_GRID = [
  ['Northern Bahr el Ghazal', 'Unity', 'Upper Nile'],
  ['Western Bahr el Ghazal', 'Warrap', 'Jonglei'],
  ['Western Equatoria', 'Lakes', ''],
  ['', 'Central Equatoria', 'Eastern Equatoria'],
];

if (process.env.NODE_ENV !== 'production') {
  const flat = STATES_GRID.flat().filter(Boolean);
  for (const name of flat) {
    if (!SOUTH_SUDAN_STATES.includes(name)) {
      throw new Error(`STATES_GRID contains unknown state "${name}" — not in SOUTH_SUDAN_STATES`);
    }
  }
}

export default function EpidemicIntelligencePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTabParam = searchParams?.get('tab');
  const initialTab: TabView = VALID_TABS.includes(initialTabParam as TabView) ? (initialTabParam as TabView) : 'overview';
  const { data, loading } = useEpidemicIntelligence();
  const [activeTab, setActiveTab] = useState<TabView>(initialTab);
  const setActiveTabAndUrl = (next: TabView) => {
    setActiveTab(next);
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('tab', next);
    router.replace(`/epidemic-intelligence?${params.toString()}`, { scroll: false });
  };
  const [selectedDisease, setSelectedDisease] = useState<string | null>(null);
  const [expandedAlert, setExpandedAlert] = useState<number | null>(null);

  if (loading || !data) {
    return (
      <>
        <main className="page-container flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center" style={{ background: 'transparent' }}>
              <Activity className="w-8 h-8" style={{ color: 'var(--color-danger)' }} />
            </div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{t('epidemic.loading')}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{t('epidemic.loadingSubtitle')}</p>
          </div>
        </main>
      </>
    );
  }

  const { summary, epidemicCurves, rtEstimates, syndromicAlerts, idsrReport, geographicSpread, ewarsAlerts } = data;

  const riskColors: Record<string, { bg: string; text: string; border: string }> = {
    low: { bg: 'rgba(74,222,128,0.1)', text: 'var(--color-success-text)', border: 'rgba(74,222,128,0.2)' },
    moderate: { bg: 'rgba(251,191,36,0.1)', text: 'var(--color-warning-text)', border: 'rgba(251,191,36,0.2)' },
    high: { bg: 'rgba(251,146,60,0.1)', text: '#FB923C', border: 'rgba(251,146,60,0.2)' },
    critical: { bg: 'rgba(248,113,113,0.1)', text: 'var(--color-danger-text)', border: 'rgba(248,113,113,0.2)' },
  };

  const severityColors: Record<string, { bg: string; text: string }> = {
    low: { bg: 'rgba(74,222,128,0.12)', text: 'var(--color-success-text)' },
    medium: { bg: 'rgba(251,191,36,0.12)', text: 'var(--color-warning-text)' },
    high: { bg: 'rgba(251,146,60,0.12)', text: '#FB923C' },
    critical: { bg: 'rgba(248,113,113,0.12)', text: 'var(--color-danger-text)' },
  };

  const risk = riskColors[summary.overallRiskLevel] || riskColors.low;

  // Get unique diseases for filtering
  const diseases = [...new Set((epidemicCurves || []).map(c => c.disease))];
  const filteredCurves = selectedDisease
    ? (epidemicCurves || []).filter(c => c.disease === selectedDisease)
    : (epidemicCurves || []);

  // Aggregate curve data by week (for multi-disease stacked view)
  const weeks = [...new Set((epidemicCurves || []).map(c => c.week))];
  const weekTotals = weeks.map(w => {
    const weekData = filteredCurves.filter(c => c.week === w);
    return weekData.reduce((s, c) => s + c.cases, 0);
  });
  const maxCases = weekTotals.length > 0 ? Math.max(...weekTotals, 1) : 1;

  const tabs: { key: TabView; label: string; icon: typeof Activity }[] = [
    { key: 'overview', label: t('epidemic.tabOverview'), icon: Eye },
    { key: 'curves', label: t('epidemic.tabCurves'), icon: BarChart3 },
    { key: 'syndromic', label: t('epidemic.tabSyndromic'), icon: Thermometer },
    { key: 'geographic', label: t('epidemic.tabGeographic'), icon: MapPin },
    { key: 'idsr', label: t('epidemic.tabIdsr'), icon: FileText },
    { key: 'alerts', label: t('epidemic.tabAlerts'), icon: AlertTriangle },
  ];

  return (
    <>
      <main className="page-container page-enter">

        <div className="dash-card mb-4">
          <EhrListHeader
            title={t('epidemic.pageTitle')}
            actions={
              <>
                <div className="px-4 py-2 rounded-xl flex items-center gap-2" style={{
                  background: risk.bg,
                  border: `1px solid ${risk.border}`,
                }}>
                  <Shield className="w-4 h-4" style={{ color: risk.text }} />
                  <span className="text-xs font-bold uppercase tracking-wider" style={{ color: risk.text }}>
                    {t('epidemic.riskSuffix', { level: summary.overallRiskLevel })}
                  </span>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>{t('epidemic.idsrWeek')}</p>
                  <p className="text-sm font-bold font-mono" style={{ color: 'var(--text-primary)' }}>{idsrReport.reportingWeek}</p>
                </div>
              </>
            }
          />
        </div>

        {/* ═══ KPI STRIP ═══ */}
        <div className="kpi-grid mb-4">
          {[
            { label: t('epidemic.kpiActiveDiseases'), value: summary.totalActiveDiseases, icon: Bug, color: 'var(--color-danger-text)', bg: 'rgba(239,68,68,0.12)' },
            { label: t('epidemic.kpiCasesThisWeek'), value: summary.totalCasesThisWeek.toLocaleString(), icon: Activity, color: '#FB923C', bg: 'rgba(251,146,60,0.12)' },
            { label: t('epidemic.kpiDeathsThisWeek'), value: summary.totalDeathsThisWeek, icon: AlertTriangle, color: 'var(--color-danger-text)', bg: 'rgba(248,113,113,0.12)' },
            { label: t('epidemic.kpiHighestRt'), value: summary.highestRt ? `${summary.highestRt.value.toFixed(2)}` : t('epidemic.notAvailable'), icon: TrendingUp, color: summary.highestRt && summary.highestRt.value > 1 ? 'var(--color-danger-text)' : 'var(--color-success-text)', bg: summary.highestRt && summary.highestRt.value > 1 ? 'rgba(239,68,68,0.12)' : 'rgba(74,222,128,0.12)' },
            { label: t('epidemic.kpiEmergencyStates'), value: summary.statesWithEmergency.length, icon: Zap, color: 'var(--color-danger-text)', bg: 'rgba(248,113,113,0.12)' },
            { label: t('epidemic.kpiEwarsAlerts'), value: ewarsAlerts.length, icon: Radio, color: 'var(--color-warning-text)', bg: 'rgba(251,191,36,0.12)' },
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

        {/* ═══ TAB NAVIGATION ═══ */}
        <div className="flex gap-1 mb-4 p-1 rounded-xl" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTabAndUrl(tab.key)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all"
              style={{
                background: activeTab === tab.key ? 'var(--bg-card)' : 'transparent',
                color: activeTab === tab.key ? 'var(--text-primary)' : 'var(--text-muted)',
                border: activeTab === tab.key ? '1px solid var(--border-light)' : '1px solid transparent',
                boxShadow: activeTab === tab.key ? 'var(--card-shadow)' : 'none',
              }}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* ═══ TAB CONTENT ═══ */}

        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Rt Tracker */}
            <div className="lg:col-span-2 card-elevated">
              <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                <h3 className="font-semibold text-sm flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <TrendingUp className="w-4 h-4" style={{ color: 'var(--color-danger)' }} />
                  {t('epidemic.rtTrackerTitle')}
                </h3>
                <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{t('epidemic.rtTrackerHint')}</p>
              </div>
              <div className="p-4 space-y-3">
                {rtEstimates.map(rt => {
                  const barWidth = rt.rt === null ? 0 : Math.min(100, (rt.rt / 3) * 100);
                  const rtColor = rt.rt === null ? 'var(--text-muted)' : rt.rt > 1.5 ? 'var(--color-danger)' : rt.rt > 1.0 ? '#FB923C' : rt.rt > 0.8 ? 'var(--color-warning)' : 'var(--color-success)';
                  return (
                    <div key={rt.disease} className="p-3 rounded-xl" style={{
                      background: 'var(--overlay-subtle)',
                      border: '1px solid var(--border-light)',
                    }}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{rt.disease}</span>
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{
                            background: severityColors[rt.confidence === 'high' ? 'low' : rt.confidence === 'medium' ? 'medium' : 'high'].bg,
                            color: severityColors[rt.confidence === 'high' ? 'low' : rt.confidence === 'medium' ? 'medium' : 'high'].text,
                          }}>
                            {t('epidemic.confidenceSuffix', { level: rt.confidence })}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1">
                            <span className="text-xs font-medium" style={{
                              color: rt.trend === 'growing' ? 'var(--color-danger-text)' : rt.trend === 'declining' ? 'var(--color-success-text)' : rt.trend === 'insufficient_data' ? 'var(--text-muted)' : 'var(--color-warning-text)',
                            }}>
                              {rt.trend === 'insufficient_data' ? t('epidemic.notAvailable') : `${rt.weeklyChange > 0 ? '+' : ''}${rt.weeklyChange}%`}
                            </span>
                          </div>
                          <span className="text-xl font-bold font-mono" style={{ color: rtColor }}>
                            {rt.rt === null ? '—' : rt.rt.toFixed(2)}
                          </span>
                        </div>
                      </div>
                      {/* Rt bar */}
                      <div className="relative h-3 rounded-full" style={{ background: 'var(--overlay-light)' }}>
                        <div className="h-full rounded-full transition-all" style={{
                          width: `${barWidth}%`,
                          background: `linear-gradient(90deg, #4ADE80, ${rtColor})`,
                        }} />
                        {/* Rt = 1 marker */}
                        <div className="absolute top-0 bottom-0 w-0.5" style={{
                          left: `${(1 / 3) * 100}%`,
                          background: 'var(--text-muted)',
                          opacity: 0.5,
                        }} />
                        <span className="absolute text-[8px] font-mono" style={{
                          left: `${(1 / 3) * 100}%`,
                          top: '-14px',
                          transform: 'translateX(-50%)',
                          color: 'var(--text-muted)',
                        }}>Rt=1</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Top EWARS Alerts */}
            <div className="card-elevated flex flex-col" style={{ maxHeight: '520px' }}>
              <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                <h3 className="font-semibold text-sm flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <AlertTriangle className="w-4 h-4" style={{ color: 'var(--color-danger-text)' }} />
                  {t('epidemic.activeEwarsAlerts')}
                </h3>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {ewarsAlerts.slice(0, 8).map((alert, i) => {
                  const sev = severityColors[alert.severity] || severityColors.low;
                  return (
                    <div key={i} className="p-3 rounded-xl cursor-pointer transition-all"
                      onClick={() => setExpandedAlert(expandedAlert === i ? null : i)}
                      style={{
                        background: sev.bg,
                        border: `1px solid ${sev.text}20`,
                      }}>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-1.5 mb-1">
                            <Badge tone={SEVERITY_TONE[alert.severity] ?? 'neutral'} uppercase>
                              {alert.severity.toUpperCase()}
                            </Badge>
                            <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{alert.alertType.replace(/_/g, ' ')}</span>
                          </div>
                          <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{alert.disease}</p>
                          <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{alert.state}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold" style={{ color: sev.text }}>{alert.cases}</p>
                          <p className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{t('epidemic.cases')}</p>
                        </div>
                      </div>
                      {expandedAlert === i && (
                        <div className="mt-2 pt-2 border-t text-[11px]" style={{ borderColor: `${sev.text}20`, color: 'var(--text-secondary)' }}>
                          {alert.message}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Geographic Heatmap Mini */}
            <div className="lg:col-span-2 card-elevated">
              <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                <h3 className="font-semibold text-sm flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <MapPin className="w-4 h-4" style={{ color: '#FB923C' }} />
                  {t('epidemic.geoHeatmapTitle')}
                </h3>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {STATES_GRID.flat().map((state, i) => {
                    if (!state) return <div key={i} />;
                    const spread = geographicSpread.find(g => g.state === state);
                    const score = spread?.riskScore || 0;
                    const color = score >= 70 ? 'var(--color-danger-text)' : score >= 50 ? '#FB923C' : score >= 30 ? 'var(--color-warning)' : 'var(--color-success)';
                    return (
                      <div key={state} className="p-3 rounded-xl text-center transition-all cursor-default" style={{
                        background: `${color}10`,
                        border: `1px solid ${color}25`,
                      }}>
                        <p className="text-[10px] font-medium mb-1 truncate" style={{ color: 'var(--text-secondary)' }}>{state.replace('Northern ', 'N. ').replace('Western ', 'W. ').replace('Eastern ', 'E. ').replace('Central ', 'C. ')}</p>
                        <p className="text-lg font-bold" style={{ color }}>{score}</p>
                        <p className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{t('epidemic.casesCount', { count: spread?.totalCases || 0 })}</p>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-center gap-3 mt-3">
                  {[
                    { label: t('epidemic.legendLow'), color: 'var(--color-success-text)' },
                    { label: t('epidemic.legendModerate'), color: 'var(--color-warning-text)' },
                    { label: t('epidemic.legendHigh'), color: '#FB923C' },
                    { label: t('epidemic.legendCritical'), color: 'var(--color-danger-text)' },
                  ].map(l => (
                    <div key={l.label} className="flex items-center gap-1">
                      <div className="w-2.5 h-2.5 rounded" style={{ background: l.color }} />
                      <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{l.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* IDSR Quick Summary */}
            <div className="card-elevated">
              <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                <h3 className="font-semibold text-sm flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <FileText className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                  {t('epidemic.idsrSummary')}
                </h3>
              </div>
              <div className="p-4 space-y-3">
                <div className="p-3 rounded-xl text-center" style={{ background: 'var(--overlay-subtle)' }}>
                  <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>{t('epidemic.reportingCompleteness')}</p>
                  <p className="text-2xl font-bold mt-1 stat-value" style={{
                    color: idsrReport.completeness >= 80 ? 'var(--color-success-text)' : idsrReport.completeness >= 60 ? 'var(--color-warning-text)' : 'var(--color-danger-text)',
                  }}>{idsrReport.completeness}%</p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{t('epidemic.facilitiesReporting', { count: idsrReport.totalFacilitiesReporting })}</p>
                </div>
                {idsrReport.diseases.slice(0, 4).map(d => (
                  <div key={d.disease} className="flex items-center justify-between p-2 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                    <div>
                      <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{d.disease}</p>
                      <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{d.states.length > 1 ? t('epidemic.statesCountPlural', { count: d.states.length }) : t('epidemic.statesCountSingular', { count: d.states.length })}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{d.cases}</p>
                      <p className="text-[9px]" style={{ color: d.cfr > 5 ? 'var(--color-danger-text)' : 'var(--text-muted)' }}>{t('epidemic.cfrValue', { value: d.cfr })}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* EPIDEMIC CURVES TAB */}
        {activeTab === 'curves' && (
          <div className="space-y-4">
            {/* Disease filter */}
            <FilterBar>
              <FilterTabs
                ariaLabel={t('epidemic.allDiseases')}
                active={selectedDisease ?? 'all'}
                onChange={key => setSelectedDisease(key === 'all' ? null : key)}
                tabs={[
                  { key: 'all', label: t('epidemic.allDiseases') },
                  ...diseases.map(d => ({ key: d, label: d })),
                ]}
              />
            </FilterBar>

            {/* Epidemic Curve Chart (CSS bar chart) */}
            <div className="card-elevated">
              <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                <h3 className="font-semibold text-sm flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <BarChart3 className="w-4 h-4" style={{ color: 'var(--color-danger)' }} />
                  {t('epidemic.epidemicCurveTitle', { disease: selectedDisease || t('epidemic.allDiseases') })}
                </h3>
                <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{t('epidemic.weeklyCaseCounts')}</p>
              </div>
              <div className="p-4">
                <div className="flex items-end gap-1.5" style={{ height: '220px' }}>
                  {weeks.map(week => {
                    const weekCurves = filteredCurves.filter(c => c.week === week);
                    const totalCases = weekCurves.reduce((s, c) => s + c.cases, 0);
                    const totalDeaths = weekCurves.reduce((s, c) => s + c.deaths, 0);
                    const barHeight = maxCases > 0 ? (totalCases / maxCases) * 100 : 0;

                    return (
                      <div key={week} className="flex-1 flex flex-col items-center gap-1 group" style={{ minWidth: 0 }}>
                        {/* Tooltip on hover */}
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity text-center mb-1">
                          <p className="text-[10px] font-bold" style={{ color: 'var(--text-primary)' }}>{totalCases}</p>
                          <p className="text-[8px]" style={{ color: 'var(--color-danger-text)' }}>{t('epidemic.deathsCount', { count: totalDeaths })}</p>
                        </div>
                        <div className="w-full flex flex-col justify-end" style={{ height: '180px' }}>
                          <div
                            className="w-full rounded-t-md transition-all"
                            style={{
                              height: `${barHeight}%`,
                              minHeight: totalCases > 0 ? '4px' : '0',
                              background: `linear-gradient(180deg, var(--color-danger), rgba(239,68,68,0.4))`,
                            }}
                          />
                        </div>
                        <span className="text-[8px] font-mono truncate w-full text-center" style={{ color: 'var(--text-muted)' }}>
                          {week.split('-')[1] || week}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Per-disease breakdown table */}
            <div className="card-elevated overflow-hidden">
              <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{t('epidemic.diseaseLevelBreakdown')}</h3>
              </div>
              <div className="overflow-x-auto">
              <table className="data-table" style={{ minWidth: 840 }}>
                <thead>
                  <tr>
                    <th>{t('epidemic.colDisease')}</th>
                    <th>{t('epidemic.colRt')}</th>
                    <th>{t('epidemic.colTrend')}</th>
                    <th>{t('epidemic.col12WeekCases')}</th>
                    <th>{t('epidemic.col12WeekDeaths')}</th>
                    <th>{t('epidemic.colCfr')}</th>
                    <th>{t('epidemic.colConfidence')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rtEstimates.map(rt => {
                    const diseaseCases = epidemicCurves.filter(c => c.disease === rt.disease);
                    const totalCases = diseaseCases.reduce((s, c) => s + c.cases, 0);
                    const totalDeaths = diseaseCases.reduce((s, c) => s + c.deaths, 0);
                    const cfr = totalCases > 0 ? ((totalDeaths / totalCases) * 100).toFixed(1) : '0';
                    const rtColor = rt.rt === null ? 'var(--text-muted)' : rt.rt > 1.5 ? 'var(--color-danger)' : rt.rt > 1 ? '#FB923C' : 'var(--color-success)';
                    return (
                      <tr key={rt.disease}>
                        <td className="font-medium text-sm">{rt.disease}</td>
                        <td><span className="font-bold font-mono" style={{ color: rtColor }}>{rt.rt === null ? '—' : rt.rt.toFixed(2)}</span></td>
                        <td>
                          <div className="flex items-center gap-1">
                            <span className="text-xs capitalize" style={{
                              color: rt.trend === 'growing' ? 'var(--color-danger-text)' : rt.trend === 'declining' ? 'var(--color-success-text)' : rt.trend === 'insufficient_data' ? 'var(--text-muted)' : 'var(--color-warning-text)',
                            }}>{rt.trend === 'insufficient_data' ? t('epidemic.notAvailable') : rt.trend}</span>
                          </div>
                        </td>
                        <td className="font-semibold">{totalCases.toLocaleString()}</td>
                        <td style={{ color: 'var(--color-danger-text)' }}>{totalDeaths}</td>
                        <td><span className="font-mono" style={{ color: parseFloat(cfr) > 5 ? 'var(--color-danger-text)' : 'var(--text-secondary)' }}>{cfr}%</span></td>
                        <td>
                          <Badge tone={rt.confidence === 'high' ? 'success' : rt.confidence === 'medium' ? 'warning' : 'danger'}>
                            {rt.confidence}
                          </Badge>
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

        {/* SYNDROMIC TAB */}
        {activeTab === 'syndromic' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {/* Exceeded thresholds */}
              <div className="card-elevated">
                <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                  <h3 className="font-semibold text-sm flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <Zap className="w-4 h-4" style={{ color: 'var(--color-danger-text)' }} />
                    {t('epidemic.thresholdExceeded')}
                  </h3>
                </div>
                <div className="p-3 space-y-2" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                  {syndromicAlerts.filter(a => a.exceeded).map((alert, i) => (
                    <div key={i} className="p-3 rounded-xl" style={{
                      background: 'rgba(248,113,113,0.06)',
                      border: '1px solid rgba(248,113,113,0.15)',
                    }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{alert.syndrome}</span>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(248,113,113,0.15)', color: 'var(--color-danger-text)' }}>
                          {alert.percentChange > 0 ? '+' : ''}{alert.percentChange}%
                        </span>
                      </div>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{alert.state}</p>
                      <div className="flex items-center gap-3 mt-1.5 text-[11px]">
                        <span style={{ color: 'var(--color-danger-text)' }}><strong>{alert.currentWeekCases}</strong> {t('epidemic.thisWeek')}</span>
                        <span style={{ color: 'var(--text-muted)' }}>{t('epidemic.vsLastWeek', { count: alert.previousWeekCases })}</span>
                        <span style={{ color: 'var(--text-muted)' }}>{t('epidemic.thresholdValue', { value: alert.threshold })}</span>
                      </div>
                    </div>
                  ))}
                  {syndromicAlerts.filter(a => a.exceeded).length === 0 && (
                    <div className="text-center py-6">
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('epidemic.noThresholdsExceeded')}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Under watch */}
              <div className="card-elevated">
                <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                  <h3 className="font-semibold text-sm flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <Eye className="w-4 h-4" style={{ color: 'var(--color-warning)' }} />
                    {t('epidemic.underWatch')}
                  </h3>
                </div>
                <div className="p-3 space-y-2" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                  {syndromicAlerts.filter(a => !a.exceeded && a.percentChange > 0).slice(0, 10).map((alert, i) => (
                    <div key={i} className="p-3 rounded-xl" style={{
                      background: 'rgba(251,191,36,0.06)',
                      border: '1px solid rgba(251,191,36,0.12)',
                    }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{alert.syndrome}</span>
                        <span className="text-[10px]" style={{ color: 'var(--color-warning-text)' }}>+{alert.percentChange}%</span>
                      </div>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {alert.state} &middot; {t('epidemic.casesCount', { count: alert.currentWeekCases })} &middot; {t('epidemic.percentOfThreshold', { percent: alert.threshold ? Math.round((alert.currentWeekCases / alert.threshold) * 100) : 0 })}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Full syndromic table */}
            <div className="card-elevated overflow-hidden">
              <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{t('epidemic.fullSyndromicMatrix')}</h3>
              </div>
              <div className="overflow-x-auto">
              <table className="data-table" style={{ minWidth: 840 }}>
                <thead>
                  <tr>
                    <th>{t('epidemic.colSyndrome')}</th>
                    <th>{t('epidemic.colState')}</th>
                    <th>{t('epidemic.colThisWeek')}</th>
                    <th>{t('epidemic.colLastWeek')}</th>
                    <th>{t('epidemic.colChange')}</th>
                    <th>{t('epidemic.colThreshold')}</th>
                    <th>{t('epidemic.colStatus')}</th>
                  </tr>
                </thead>
                <tbody>
                  {syndromicAlerts.slice(0, 15).map((alert, i) => (
                    <tr key={i}>
                      <td className="font-medium text-sm">{alert.syndrome}</td>
                      <td className="text-xs">{alert.state}</td>
                      <td className="font-semibold">{alert.currentWeekCases}</td>
                      <td className="text-xs">{alert.previousWeekCases}</td>
                      <td>
                        <span className="text-xs font-bold" style={{
                          color: alert.percentChange > 20 ? 'var(--color-danger-text)' : alert.percentChange > 0 ? 'var(--color-warning-text)' : 'var(--color-success-text)',
                        }}>
                          {alert.percentChange > 0 ? '+' : ''}{alert.percentChange}%
                        </span>
                      </td>
                      <td className="text-xs font-mono">{alert.threshold}</td>
                      <td>
                        {alert.exceeded ? (
                          <Badge tone="danger">{t('epidemic.statusExceeded')}</Badge>
                        ) : (
                          <Badge tone="success">{t('epidemic.statusNormal')}</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          </div>
        )}

        {/* GEOGRAPHIC TAB */}
        {activeTab === 'geographic' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {geographicSpread.map(state => {
                const color = state.riskScore >= 70 ? 'var(--color-danger-text)' : state.riskScore >= 50 ? '#FB923C' : state.riskScore >= 30 ? 'var(--color-warning)' : 'var(--color-success)';
                return (
                  <div key={state.state} className="card-elevated p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4" style={{ color }} />
                        <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{state.state}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('epidemic.totalCases', { count: state.totalCases })}</span>
                        <div className="px-2 py-0.5 rounded-lg text-xs font-bold" style={{
                          background: `${color}15`,
                          color,
                          border: `1px solid ${color}25`,
                        }}>
                          {t('epidemic.riskScore', { score: state.riskScore })}
                        </div>
                      </div>
                    </div>
                    {/* Risk bar */}
                    <div className="h-2 rounded-full mb-3" style={{ background: 'var(--overlay-light)' }}>
                      <div className="h-full rounded-full" style={{
                        width: `${state.riskScore}%`,
                        background: `linear-gradient(90deg, #4ADE80, ${color})`,
                      }} />
                    </div>
                    {/* Diseases */}
                    <div className="space-y-1.5">
                      {state.diseases.map((d, i) => (
                        <div key={i} className="flex items-center justify-between p-2 rounded-lg text-xs" style={{ background: 'var(--overlay-subtle)' }}>
                          <div className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full" style={{
                              background: d.alertLevel === 'emergency' ? 'var(--color-danger)' : d.alertLevel === 'warning' ? 'var(--color-warning)' : 'var(--color-success)',
                            }} />
                            <span style={{ color: 'var(--text-primary)' }}>{d.disease}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-semibold">{t('epidemic.casesCount', { count: d.cases })}</span>
                            <span style={{ color: 'var(--color-danger-text)' }}>{t('epidemic.deathsCount', { count: d.deaths })}</span>
                          </div>
                        </div>
                      ))}
                      {state.diseases.length === 0 && (
                        <p className="text-[11px] text-center py-2" style={{ color: 'var(--text-muted)' }}>{t('epidemic.noActiveDiseaseAlerts')}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* IDSR TAB */}
        {activeTab === 'idsr' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="card-elevated p-4">
                <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{t('epidemic.reportingWeek')}</p>
                <p className="text-2xl font-bold font-mono" style={{ color: 'var(--text-primary)' }}>{idsrReport.reportingWeek}</p>
              </div>
              <div className="card-elevated p-4">
                <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{t('epidemic.facilitiesReportingLabel')}</p>
                <p className="text-2xl font-bold" style={{ color: 'var(--accent-primary)' }}>{idsrReport.totalFacilitiesReporting}</p>
              </div>
              <div className="card-elevated p-4">
                <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{t('epidemic.completeness')}</p>
                <p className="text-2xl font-bold stat-value" style={{
                  color: idsrReport.completeness >= 80 ? 'var(--color-success-text)' : idsrReport.completeness >= 60 ? 'var(--color-warning-text)' : 'var(--color-danger-text)',
                }}>{idsrReport.completeness}%</p>
                <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{t('epidemic.whoTarget')}</p>
              </div>
            </div>

            <div className="card-elevated overflow-hidden">
              <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                <h3 className="font-semibold text-sm flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <FileText className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                  {t('epidemic.idsrWeeklyReport')}
                </h3>
              </div>
              <div className="overflow-x-auto">
              <table className="data-table" style={{ minWidth: 720 }}>
                <thead>
                  <tr>
                    <th>{t('epidemic.colPriorityDisease')}</th>
                    <th>{t('epidemic.colCases')}</th>
                    <th>{t('epidemic.colDeaths')}</th>
                    <th>{t('epidemic.colCfrPercent')}</th>
                    <th>{t('epidemic.colAffectedStates')}</th>
                    <th>{t('epidemic.colSeverity')}</th>
                  </tr>
                </thead>
                <tbody>
                  {idsrReport.diseases.map(d => (
                    <tr key={d.disease}>
                      <td className="font-medium text-sm">{d.disease}</td>
                      <td className="font-semibold">{d.cases.toLocaleString()}</td>
                      <td style={{ color: d.deaths > 0 ? 'var(--color-danger-text)' : 'var(--text-secondary)' }}>{d.deaths}</td>
                      <td>
                        <span className="font-mono text-sm" style={{
                          color: d.cfr > 10 ? 'var(--color-danger-text)' : d.cfr > 5 ? '#FB923C' : 'var(--text-secondary)',
                        }}>{d.cfr}%</span>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {d.states.map(s => (
                            <span key={s} className="text-[9px] px-1.5 py-0.5 rounded" style={{
                              background: 'var(--overlay-medium)',
                              color: 'var(--text-secondary)',
                            }}>{s.replace('Northern ', 'N. ').replace('Western ', 'W. ').replace('Eastern ', 'E. ').replace('Central ', 'C. ')}</span>
                          ))}
                        </div>
                      </td>
                      <td>
                        {d.cfr > 10 ? (
                          <Badge tone="danger">{t('epidemic.severityCritical')}</Badge>
                        ) : d.cfr > 5 ? (
                          <Badge tone="warning">{t('epidemic.severityHigh')}</Badge>
                        ) : d.cases > 50 ? (
                          <Badge tone="info">{t('epidemic.severityWatch')}</Badge>
                        ) : (
                          <Badge tone="success">{t('epidemic.severityLow')}</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          </div>
        )}

        {/* EWARS ALERTS TAB */}
        {activeTab === 'alerts' && (
          <div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              {['critical', 'high', 'medium', 'low'].map(sev => {
                const count = ewarsAlerts.filter(a => a.severity === sev).length;
                const colors = severityColors[sev];
                return (
                  <div key={sev} className="relative px-3 py-2.5 rounded-xl overflow-hidden text-center" style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-light)',
                    boxShadow: 'var(--card-shadow)',
                  }}>
                    <p className="text-2xl font-bold" style={{ color: colors.text }}>{count}</p>
                    <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{sev}</p>
                  </div>
                );
              })}
            </div>

            <div className="space-y-2">
              {ewarsAlerts.map((alert, i) => {
                const sev = severityColors[alert.severity];
                const isExpanded = expandedAlert === i;
                return (
                  <div key={i} className="card-elevated overflow-hidden">
                    <div
                      className="p-4 flex items-center justify-between cursor-pointer"
                      onClick={() => setExpandedAlert(isExpanded ? null : i)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{
                          background: 'transparent',
                        }}>
                          <AlertTriangle className="w-4 h-4" style={{ color: sev.text }} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{alert.disease}</span>
                            <Badge tone={SEVERITY_TONE[alert.severity] ?? 'neutral'} uppercase>
                              {alert.severity.toUpperCase()}
                            </Badge>
                            <Badge tone="neutral">
                              {alert.alertType.replace(/_/g, ' ')}
                            </Badge>
                          </div>
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{alert.state}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <span className="text-lg font-bold" style={{ color: sev.text }}>{alert.cases}</span>
                          <span className="text-xs ml-1" style={{ color: 'var(--text-muted)' }}>{t('epidemic.cases')}</span>
                          {alert.deaths > 0 && (
                            <span className="text-xs ml-2" style={{ color: 'var(--color-danger-text)' }}>{t('epidemic.deathsCount', { count: alert.deaths })}</span>
                          )}
                        </div>
                        {isExpanded ? <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-muted)' }} /> : <ChevronRight className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />}
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-0 border-t" style={{ borderColor: 'var(--border-light)' }}>
                        <div className="mt-3 p-3 rounded-lg text-sm" style={{ background: 'var(--overlay-subtle)', color: 'var(--text-secondary)' }}>
                          {alert.message}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </>
  );
}
