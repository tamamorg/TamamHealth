'use client';

/**
 * Epidemic Intelligence — the surveillance arm of the Government App family.
 *
 * Restyled onto the same visual language as /government (`gov-panel` /
 * `gov-panel-head` / `gov-page-head` / `gov-map-layers`, see globals.css
 * "National Dashboard (Government App design)"), with page-specific pieces
 * (the Rt meter, tonal chips, alert/list rows, stat tiles) in the `epi-*`
 * section added alongside it. Six tabs, `?tab=` deep-linked: overview,
 * epidemic curves, syndromic surveillance, geographic spread, the IDSR
 * weekly report, and the full EWARS alert list.
 */

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useEpidemicIntelligence } from '@/lib/hooks/useEpidemicIntelligence';
import { Activity, MapPin, ChevronDown, ChevronRight } from '@/components/icons/lucide';
import { CHART_SERIES, DISEASE_COLOR } from '@/lib/chart-colors';
import { ChartLoadingState } from '@/components/ChartCard';

// recharts (~80-100KB) is deferred behind a dynamic boundary so it's fetched
// only when this chart renders — same pattern as
// FacilityManagementDashboard/_FacilityCharts.
const EpidemicCurveChart = dynamic(
  () => import('./_EpidemicCharts').then(m => m.EpidemicCurveChart),
  { ssr: false, loading: () => <ChartLoadingState height={260} /> },
);

type TabView = 'overview' | 'curves' | 'syndromic' | 'geographic' | 'idsr' | 'alerts';
const VALID_TABS: TabView[] = ['overview', 'curves', 'syndromic', 'geographic', 'idsr', 'alerts'];

// ── Shared tone system: one 4-step escalation (green → blue → yellow → red)
// covers risk level, EWARS severity, and geographic risk score alike; the
// 3-step confidence scale (green / yellow / neutral) is spec'd separately. ──
type Tone = 'green' | 'blue' | 'yellow' | 'red' | 'neutral';

function severityTone(level: string): Tone {
  if (level === 'critical') return 'red';
  if (level === 'high') return 'yellow';
  if (level === 'medium' || level === 'moderate') return 'blue';
  return 'green'; // low
}

function confidenceTone(level: string): Tone {
  if (level === 'high') return 'green';
  if (level === 'medium') return 'yellow';
  return 'neutral'; // low
}

function riskScoreTone(score: number): Tone {
  if (score >= 70) return 'red';
  if (score >= 50) return 'yellow';
  if (score >= 30) return 'blue';
  return 'green';
}

// The "same tone" fill used by meters and bare colored numbers sitting
// directly on a white/tinted card (not inside a chip) — the base 500/600
// tokens, per the design's explicit Rt-meter spec.
const TONE_FILL: Record<Tone, string> = {
  red: 'var(--color-danger-500)',
  yellow: 'var(--color-warning-600)',
  blue: 'var(--color-info)',
  green: 'var(--color-success-600)',
  neutral: 'var(--text-muted)',
};
/** Singular label when the count is exactly 1; otherwise the (already
 *  correctly-pluralized) translated label. Fixes "1 Emergency States". */
function pluralLabel(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

// Aliases the raw DISEASE_COLOR map doesn't carry — same additions as
// /government (chart-colors.ts keys 'hiv', not the seed data's literal
// "HIV/AIDS"; meningitis has no entry at all). Without these, both fall
// through to the fallback slots and can collide with — or exhaust the
// slots meant for — the named diseases.
const DISEASE_COLORS: Record<string, string> = {
  ...DISEASE_COLOR,
  'hiv/aids': DISEASE_COLOR.hiv,
  meningitis: 'var(--chart-3)',
};

// Per-disease colour, entity-stable and collision-free — same approach and
// same shared map as /government, so a disease is the same colour on both
// screens.
function buildDiseaseColorMap(names: string[]): Map<string, string> {
  const fallback = [...CHART_SERIES];
  const used = new Set<string>();
  const map = new Map<string, string>();
  for (const name of names) {
    const named = DISEASE_COLORS[name.trim().toLowerCase()];
    const color = named && !used.has(named) ? named : fallback.find(c => !used.has(c)) || 'var(--text-muted)';
    used.add(color);
    map.set(name, color);
  }
  return map;
}

function PanelHead({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="gov-panel-head">
      <h3>{title}</h3>
      {meta && <span className="gov-meta">{meta}</span>}
    </div>
  );
}

function Chip({ tone, className = '', children }: { tone: Tone; className?: string; children: React.ReactNode }) {
  return <span className={`epi-chip epi-chip--${tone} ${className}`}>{children}</span>;
}

const OVERVIEW_ALERT_LIMIT = 8;

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
      <main className="page-container flex items-center justify-center">
        <div className="text-center">
          <Activity className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--color-danger)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{t('epidemic.loading')}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{t('epidemic.loadingSubtitle')}</p>
        </div>
      </main>
    );
  }

  const { summary, epidemicCurves, rtEstimates, syndromicAlerts, idsrReport, geographicSpread, ewarsAlerts } = data;

  // Diseases present in the curve data, ranked by total case volume — same
  // ordering /government uses for its disease selector and colour
  // assignment. This matters for buildDiseaseColorMap below: it's a greedy
  // assignment, so ranking by volume (not the seed data's incidental,
  // near-alphabetical order) ensures the highest-burden diseases claim
  // their canonical slot before a low-volume one can take it first.
  const diseaseTotals = new Map<string, number>();
  for (const c of epidemicCurves || []) diseaseTotals.set(c.disease, (diseaseTotals.get(c.disease) || 0) + c.cases);
  const diseases = [...diseaseTotals.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  // The palette has CHART_SERIES.length distinct slots; drawing more series
  // than that guarantees two diseases collapse onto the same fallback
  // colour (indistinguishable in the chart/legend). Cap "All diseases" to
  // the top N by volume instead — same limit /government's chart observes.
  const curveChartDiseases = selectedDisease ? [selectedDisease] : diseases.slice(0, CHART_SERIES.length);
  const curveChartCapped = !selectedDisease && diseases.length > CHART_SERIES.length;
  const diseaseColorMap = buildDiseaseColorMap(diseases);
  const weeks = [...new Set((epidemicCurves || []).map(c => c.week))];
  const curveWeeksData = weeks.map(w => {
    const rec: Record<string, number | string> = { week: w.split('-')[1] || w };
    for (const d of curveChartDiseases) {
      const point = epidemicCurves.find(c => c.week === w && c.disease === d);
      rec[d] = point ? point.cases : 0;
    }
    return rec;
  });

  const overviewAlerts = ewarsAlerts.slice(0, OVERVIEW_ALERT_LIMIT);
  const moreAlertsCount = ewarsAlerts.length - overviewAlerts.length;

  const riskTone = severityTone(summary.overallRiskLevel);

  const statTiles: { label: string; value: string; tone?: Tone }[] = [
    {
      label: pluralLabel(summary.totalActiveDiseases, 'Active Disease', t('epidemic.kpiActiveDiseases')),
      value: summary.totalActiveDiseases.toLocaleString(),
    },
    {
      label: pluralLabel(summary.totalCasesThisWeek, 'Case This Week', t('epidemic.kpiCasesThisWeek')),
      value: summary.totalCasesThisWeek.toLocaleString(),
    },
    {
      label: pluralLabel(summary.totalDeathsThisWeek, 'Death This Week', t('epidemic.kpiDeathsThisWeek')),
      value: summary.totalDeathsThisWeek.toLocaleString(),
      tone: summary.totalDeathsThisWeek > 0 ? 'red' : undefined,
    },
    {
      label: t('epidemic.kpiHighestRt'),
      value: summary.highestRt ? summary.highestRt.value.toFixed(2) : t('epidemic.notAvailable'),
      tone: summary.highestRt ? (summary.highestRt.value > 1 ? 'red' : 'green') : undefined,
    },
    {
      label: pluralLabel(summary.statesWithEmergency.length, 'Emergency State', t('epidemic.kpiEmergencyStates')),
      value: summary.statesWithEmergency.length.toLocaleString(),
      tone: summary.statesWithEmergency.length > 0 ? 'red' : undefined,
    },
    {
      label: pluralLabel(ewarsAlerts.length, 'EWARS Alert', t('epidemic.kpiEwarsAlerts')),
      value: ewarsAlerts.length.toLocaleString(),
    },
  ];

  const tabs: { key: TabView; label: string }[] = [
    { key: 'overview', label: t('epidemic.tabOverview') },
    { key: 'curves', label: t('epidemic.tabCurves') },
    { key: 'syndromic', label: t('epidemic.tabSyndromic') },
    { key: 'geographic', label: t('epidemic.tabGeographic') },
    { key: 'idsr', label: t('epidemic.tabIdsr') },
    { key: 'alerts', label: t('epidemic.tabAlerts') },
  ];

  // Shared alert-row renderer for both the overview preview and the full
  // Alerts tab — same anatomy: severity chip, disease bold + state muted
  // sub, cases condensed tabular right, click to expand the message.
  const renderAlertRow = (alert: typeof ewarsAlerts[number], i: number) => {
    const isExpanded = expandedAlert === i;
    return (
      <div key={i}>
        <div
          className="epi-alert-row"
          role="button"
          tabIndex={0}
          aria-expanded={isExpanded}
          onClick={() => setExpandedAlert(isExpanded ? null : i)}
          onKeyDown={event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            setExpandedAlert(isExpanded ? null : i);
          }}
        >
          <div className="epi-alert-main">
            <Chip tone={severityTone(alert.severity)}>{alert.severity}</Chip>
            <div className="epi-alert-text">
              <p className="epi-alert-disease">{alert.disease}</p>
              <p className="epi-alert-state">
                {alert.state} · {alert.alertType.replace(/_/g, ' ')}
                {alert.deaths > 0 ? ` · ${t('epidemic.deathsCount', { count: alert.deaths })}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="epi-alert-right">
              <span className="epi-alert-cases">{alert.cases.toLocaleString()}</span>
              <span className="epi-alert-cases-label">{t('epidemic.cases')}</span>
            </div>
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} /> : <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />}
          </div>
        </div>
        {isExpanded && <div className="epi-alert-detail">{alert.message}</div>}
      </div>
    );
  };

  return (
    <main className="page-container page-enter">

      {/* ── Header: condensed title, IDSR week subtitle, risk chip ── */}
      <div className="gov-page-head">
        <div>
          <div className="epi-title-row">
            <h1>{t('epidemic.pageTitle')}</h1>
            <Chip tone={riskTone} className="epi-chip--lg">{t('epidemic.riskSuffix', { level: summary.overallRiskLevel })}</Chip>
          </div>
          <p>South Sudan · IDSR week {idsrReport.reportingWeek} · computed live from facility reports</p>
        </div>
      </div>

      {/* ── Stat tile row ── */}
      <div className="epi-stat-row">
        {statTiles.map(tile => (
          <div key={tile.label} className="epi-stat-tile">
            <p className="epi-stat-label">{tile.label}</p>
            <p className="epi-stat-value" style={tile.tone ? { color: TONE_FILL[tile.tone] } : undefined}>{tile.value}</p>
          </div>
        ))}
      </div>

      {/* ── Tab strip (gov-map-layers pill pattern) ── */}
      <div className="gov-map-layers" style={{ padding: 0, marginBottom: 16 }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            type="button"
            data-tour={`epi-tab-${tab.key}`}
            onClick={() => setActiveTabAndUrl(tab.key)}
            className={activeTab === tab.key ? 'is-active' : undefined}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* OVERVIEW TAB */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Rt Tracker */}
          <section data-tour="epi-rt-panel" className="gov-panel lg:col-span-2">
            <PanelHead title={t('epidemic.rtTrackerTitle')} meta={t('epidemic.rtTrackerHint')} />
            {rtEstimates.length === 0 ? (
              <p className="text-[12px] p-6 text-center" style={{ color: 'var(--text-muted)' }}>{t('epidemic.notAvailable')}</p>
            ) : (
              <div className="epi-rt-list">
                {rtEstimates.map(rt => {
                  const tone = rt.rt === null ? 'neutral' : rt.rt >= 1.2 ? 'red' : rt.rt >= 1.0 ? 'yellow' : 'green';
                  const fill = TONE_FILL[tone];
                  const fillWidth = rt.rt === null ? 0 : Math.min(1, rt.rt / 2) * 100;
                  return (
                    <div key={rt.disease} className="epi-rt-row">
                      <div className="epi-rt-left">
                        <span className="epi-rt-disease">{rt.disease}</span>
                        <Chip tone={confidenceTone(rt.confidence)}>{t('epidemic.confidenceSuffix', { level: rt.confidence })}</Chip>
                      </div>
                      <div className="epi-rt-right">
                        <div className="epi-meter">
                          <div className="epi-meter-fill" style={{ width: `${fillWidth}%`, background: fill }} />
                          <div className="epi-meter-tick" style={{ left: '50%' }} />
                        </div>
                        <span className="epi-rt-delta" style={{ color: fill }}>
                          {rt.trend === 'insufficient_data' ? t('epidemic.notAvailable') : `${rt.weeklyChange > 0 ? '+' : ''}${rt.weeklyChange}%`}
                        </span>
                        <span className="epi-rt-value" style={{ color: fill }}>{rt.rt === null ? '—' : rt.rt.toFixed(2)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Active EWARS Alerts */}
          <section className="gov-panel flex flex-col" style={{ maxHeight: 480 }}>
            <PanelHead title={t('epidemic.activeEwarsAlerts')} meta={`${ewarsAlerts.length.toLocaleString()} active`} />
            {overviewAlerts.length === 0 ? (
              <p className="text-[12px] p-6 text-center" style={{ color: 'var(--text-muted)' }}>{t('epidemic.noActiveDiseaseAlerts')}</p>
            ) : (
              <div className="epi-alert-list">
                {overviewAlerts.map((alert, i) => renderAlertRow(alert, i))}
              </div>
            )}
            {moreAlertsCount > 0 && (
              <button type="button" className="epi-alert-more" onClick={() => setActiveTabAndUrl('alerts')}>
                {moreAlertsCount} more {moreAlertsCount === 1 ? 'alert' : 'alerts'} — open the EWARS tab
                <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </section>
        </div>
      )}

      {/* EPIDEMIC CURVES TAB */}
      {activeTab === 'curves' && (
        <div className="space-y-4">
          {/* Disease filter */}
          <section className="gov-panel epi-filter-panel">
            <div className="gov-map-layers">
              <button type="button" onClick={() => setSelectedDisease(null)} className={selectedDisease === null ? 'is-active' : undefined}>
                {t('epidemic.allDiseases')}
              </button>
              {diseases.map(d => (
                <button key={d} type="button" onClick={() => setSelectedDisease(d)} className={selectedDisease === d ? 'is-active' : undefined}>
                  {d}
                </button>
              ))}
            </div>
          </section>

          {/* Epidemic curve chart */}
          <section data-tour="epi-curve-panel" className="gov-panel">
            <PanelHead
              title={t('epidemic.epidemicCurveTitle', { disease: selectedDisease || t('epidemic.allDiseases') })}
              meta={curveChartCapped ? `${t('epidemic.weeklyCaseCounts')} · top ${curveChartDiseases.length} of ${diseases.length} by volume` : t('epidemic.weeklyCaseCounts')}
            />
            <div className="gov-chart-body">
              {diseases.length === 0 ? (
                <p className="text-[12px] p-6 text-center" style={{ color: 'var(--text-muted)' }}>{t('epidemic.noActiveDiseaseAlerts')}</p>
              ) : (
                <EpidemicCurveChart data={curveWeeksData} diseases={curveChartDiseases} colorMap={diseaseColorMap} />
              )}
            </div>
          </section>

          {/* Per-disease breakdown table */}
          <section className="gov-panel">
            <PanelHead title={t('epidemic.diseaseLevelBreakdown')} />
            <div className="sa-table-scroll">
              <table className="sa-table" style={{ minWidth: 840 }}>
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
                  {rtEstimates.length === 0 ? (
                    <tr><td colSpan={7} className="sa-empty">{t('epidemic.noActiveDiseaseAlerts')}</td></tr>
                  ) : rtEstimates.map(rt => {
                    const diseaseCases = epidemicCurves.filter(c => c.disease === rt.disease);
                    const totalCases = diseaseCases.reduce((s, c) => s + c.cases, 0);
                    const totalDeaths = diseaseCases.reduce((s, c) => s + c.deaths, 0);
                    const cfr = totalCases > 0 ? ((totalDeaths / totalCases) * 100).toFixed(1) : '0';
                    const rtTone = rt.rt === null ? 'neutral' : rt.rt >= 1.2 ? 'red' : rt.rt >= 1.0 ? 'yellow' : 'green';
                    const trendTone: Tone = rt.trend === 'growing' ? 'red' : rt.trend === 'declining' ? 'green' : rt.trend === 'insufficient_data' ? 'neutral' : 'yellow';
                    return (
                      <tr key={rt.disease}>
                        <td><strong>{rt.disease}</strong></td>
                        <td><span className="sa-num" style={{ fontWeight: 700, color: TONE_FILL[rtTone] }}>{rt.rt === null ? '—' : rt.rt.toFixed(2)}</span></td>
                        <td>
                          <span className="capitalize" style={{ color: TONE_FILL[trendTone] }}>
                            {rt.trend === 'insufficient_data' ? t('epidemic.notAvailable') : rt.trend}
                          </span>
                        </td>
                        <td className="sa-num">{totalCases.toLocaleString()}</td>
                        <td className="sa-num" style={{ color: totalDeaths > 0 ? 'var(--color-danger-text)' : undefined }}>{totalDeaths.toLocaleString()}</td>
                        <td><span className="sa-num" style={{ color: parseFloat(cfr) > 5 ? 'var(--color-danger-text)' : undefined }}>{cfr}%</span></td>
                        <td><Chip tone={confidenceTone(rt.confidence)}>{rt.confidence}</Chip></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* SYNDROMIC TAB */}
      {activeTab === 'syndromic' && (
        <div className="space-y-4">
          <div data-tour="epi-syndromic-panel" className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Exceeded thresholds */}
            <section className="gov-panel">
              <PanelHead title={t('epidemic.thresholdExceeded')} />
              {syndromicAlerts.filter(a => a.exceeded).length === 0 ? (
                <p className="text-[12px] p-6 text-center" style={{ color: 'var(--text-muted)' }}>{t('epidemic.noThresholdsExceeded')}</p>
              ) : (
                <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                  {syndromicAlerts.filter(a => a.exceeded).map((alert, i) => (
                    <div key={i} className="epi-list-row" style={{ alignItems: 'flex-start' }}>
                      <div className="epi-list-main" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                        <span className="epi-list-title" style={{ fontSize: 13, fontWeight: 600 }}>{alert.syndrome}</span>
                        <span className="epi-list-sub">{alert.state} · {t('epidemic.vsLastWeek', { count: alert.previousWeekCases })} · {t('epidemic.thresholdValue', { value: alert.threshold })}</span>
                      </div>
                      <div className="epi-list-right" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                        <Chip tone="red">{alert.percentChange > 0 ? '+' : ''}{alert.percentChange}%</Chip>
                        <span style={{ color: 'var(--color-danger-text)', fontWeight: 700 }}>{alert.currentWeekCases.toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Under watch */}
            <section className="gov-panel">
              <PanelHead title={t('epidemic.underWatch')} />
              {syndromicAlerts.filter(a => !a.exceeded && a.percentChange > 0).length === 0 ? (
                <p className="text-[12px] p-6 text-center" style={{ color: 'var(--text-muted)' }}>{t('epidemic.noActiveDiseaseAlerts')}</p>
              ) : (
                <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                  {syndromicAlerts.filter(a => !a.exceeded && a.percentChange > 0).slice(0, 10).map((alert, i) => (
                    <div key={i} className="epi-list-row">
                      <div className="epi-list-main">
                        <span className="epi-list-dot" style={{ background: 'var(--color-warning-600)' }} />
                        <div>
                          <div className="epi-list-title">{alert.syndrome}</div>
                          <div className="epi-list-sub">{alert.state} · {t('epidemic.casesCount', { count: alert.currentWeekCases })} · {t('epidemic.percentOfThreshold', { percent: alert.threshold ? Math.round((alert.currentWeekCases / alert.threshold) * 100) : 0 })}</div>
                        </div>
                      </div>
                      <span style={{ color: 'var(--color-warning-text)', fontWeight: 600, fontSize: 12 }}>+{alert.percentChange}%</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Full syndromic table */}
          <section className="gov-panel">
            <PanelHead title={t('epidemic.fullSyndromicMatrix')} />
            <div className="sa-table-scroll">
              <table className="sa-table" style={{ minWidth: 840 }}>
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
                  {syndromicAlerts.length === 0 ? (
                    <tr><td colSpan={7} className="sa-empty">{t('epidemic.noActiveDiseaseAlerts')}</td></tr>
                  ) : syndromicAlerts.slice(0, 15).map((alert, i) => (
                    <tr key={i}>
                      <td><strong>{alert.syndrome}</strong></td>
                      <td>{alert.state}</td>
                      <td className="sa-num" style={{ fontWeight: 600 }}>{alert.currentWeekCases.toLocaleString()}</td>
                      <td className="sa-num">{alert.previousWeekCases.toLocaleString()}</td>
                      <td>
                        <span className="sa-num" style={{
                          fontWeight: 700,
                          color: alert.percentChange > 20 ? 'var(--color-danger-text)' : alert.percentChange > 0 ? 'var(--color-warning-text)' : 'var(--color-success-text)',
                        }}>
                          {alert.percentChange > 0 ? '+' : ''}{alert.percentChange}%
                        </span>
                      </td>
                      <td className="sa-num">{alert.threshold}</td>
                      <td>{alert.exceeded ? <Chip tone="red">{t('epidemic.statusExceeded')}</Chip> : <Chip tone="green">{t('epidemic.statusNormal')}</Chip>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* GEOGRAPHIC TAB */}
      {activeTab === 'geographic' && (
        <div data-tour="epi-geo-panel" className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {geographicSpread.map(state => {
            const tone = riskScoreTone(state.riskScore);
            const fill = TONE_FILL[tone];
            return (
              <section key={state.state} className="gov-panel">
                <div className="epi-state-head">
                  <span className="epi-state-name">
                    <MapPin className="w-3.5 h-3.5" style={{ color: fill }} />
                    {state.state}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="gov-meta">{t('epidemic.totalCases', { count: state.totalCases })}</span>
                    <Chip tone={tone}>{t('epidemic.riskScore', { score: state.riskScore })}</Chip>
                  </div>
                </div>
                <div className="epi-state-body">
                  <div className="epi-meter" style={{ width: '100%', marginBottom: 12 }}>
                    <div className="epi-meter-fill" style={{ width: `${state.riskScore}%`, background: fill }} />
                  </div>
                  {state.diseases.length === 0 ? (
                    <p className="text-[11px] text-center py-2" style={{ color: 'var(--text-muted)' }}>{t('epidemic.noActiveDiseaseAlerts')}</p>
                  ) : (
                    <div>
                      {state.diseases.map((d, i) => (
                        <div key={i} className="epi-list-row" style={{ padding: '7px 0' }}>
                          <div className="epi-list-main">
                            <span className="epi-list-dot" style={{
                              background: d.alertLevel === 'emergency' ? 'var(--color-danger-500)' : d.alertLevel === 'warning' ? 'var(--color-warning-600)' : 'var(--color-success-600)',
                            }} />
                            <span className="epi-list-title">{d.disease}</span>
                          </div>
                          <div className="epi-list-right">
                            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t('epidemic.casesCount', { count: d.cases })}</span>
                            <span style={{ color: 'var(--color-danger-text)' }}>{t('epidemic.deathsCount', { count: d.deaths })}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* IDSR TAB */}
      {activeTab === 'idsr' && (
        <div className="space-y-4">
          <div className="epi-stat-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <div className="epi-stat-tile">
              <p className="epi-stat-label">{t('epidemic.reportingWeek')}</p>
              <p className="epi-stat-value">{idsrReport.reportingWeek}</p>
            </div>
            <div className="epi-stat-tile">
              <p className="epi-stat-label">{t('epidemic.facilitiesReportingLabel')}</p>
              <p className="epi-stat-value" style={{ color: 'var(--accent-primary)' }}>{idsrReport.totalFacilitiesReporting.toLocaleString()}</p>
            </div>
            <div className="epi-stat-tile">
              <p className="epi-stat-label">{t('epidemic.completeness')}</p>
              <p className="epi-stat-value" style={{
                color: idsrReport.completeness >= 80 ? 'var(--color-success-600)' : idsrReport.completeness >= 60 ? 'var(--color-warning-600)' : 'var(--color-danger-500)',
              }}>{idsrReport.completeness}%</p>
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{t('epidemic.whoTarget')}</p>
            </div>
          </div>

          <section data-tour="epi-idsr-panel" className="gov-panel">
            <PanelHead title={t('epidemic.idsrWeeklyReport')} />
            <div className="sa-table-scroll">
              <table className="sa-table" style={{ minWidth: 720 }}>
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
                  {idsrReport.diseases.length === 0 ? (
                    <tr><td colSpan={6} className="sa-empty">{t('epidemic.noActiveDiseaseAlerts')}</td></tr>
                  ) : idsrReport.diseases.map(d => (
                    <tr key={d.disease}>
                      <td><strong>{d.disease}</strong></td>
                      <td className="sa-num" style={{ fontWeight: 600 }}>{d.cases.toLocaleString()}</td>
                      <td className="sa-num" style={{ color: d.deaths > 0 ? 'var(--color-danger-text)' : undefined }}>{d.deaths.toLocaleString()}</td>
                      <td>
                        <span className="sa-num" style={{
                          color: d.cfr > 10 ? 'var(--color-danger-text)' : d.cfr > 5 ? 'var(--color-warning-text)' : undefined,
                        }}>{d.cfr}%</span>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {d.states.map(s => (
                            <span key={s} className="epi-chip epi-chip--neutral" style={{ textTransform: 'none' }}>
                              {s.replace('Northern ', 'N. ').replace('Western ', 'W. ').replace('Eastern ', 'E. ').replace('Central ', 'C. ')}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        {d.cfr > 10 ? (
                          <Chip tone="red">{t('epidemic.severityCritical')}</Chip>
                        ) : d.cfr > 5 ? (
                          <Chip tone="yellow">{t('epidemic.severityHigh')}</Chip>
                        ) : d.cases > 50 ? (
                          <Chip tone="blue">{t('epidemic.severityWatch')}</Chip>
                        ) : (
                          <Chip tone="green">{t('epidemic.severityLow')}</Chip>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* EWARS ALERTS TAB */}
      {activeTab === 'alerts' && (
        <div className="space-y-4">
          <div className="epi-stat-row">
            {(['critical', 'high', 'medium', 'low'] as const).map(sev => {
              const count = ewarsAlerts.filter(a => a.severity === sev).length;
              return (
                <div key={sev} className="epi-stat-tile text-center">
                  <p className="epi-stat-value" style={{ color: TONE_FILL[severityTone(sev)] }}>{count}</p>
                  <p className="epi-stat-label">{sev}</p>
                </div>
              );
            })}
          </div>

          <section className="gov-panel">
            <PanelHead title={t('epidemic.tabAlerts')} meta={`${ewarsAlerts.length.toLocaleString()} total`} />
            {ewarsAlerts.length === 0 ? (
              <p className="text-[12px] p-6 text-center" style={{ color: 'var(--text-muted)' }}>{t('epidemic.noActiveDiseaseAlerts')}</p>
            ) : (
              <div>
                {ewarsAlerts.map((alert, i) => renderAlertRow(alert, i))}
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
