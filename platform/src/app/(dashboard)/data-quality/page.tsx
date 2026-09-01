'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDataQuality } from '@/lib/hooks/useDataQuality';
import { useSurveillance } from '@/lib/hooks/useSurveillance';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { Wifi, Users, TrendingUp, AlertTriangle } from '@/components/icons/lucide';
import { FilterTabs } from '@/components/filters';
import EhrListHeader, { LIST_STAT_COLORS } from '@/components/ehr/EhrListHeader';
import type { DataCompletenessEntry } from '@/lib/services/data-quality-service';

type View = 'completeness' | 'timeliness' | 'outliers' | 'scores';
const VIEWS: { key: View; label: string }[] = [
  { key: 'completeness', label: 'Completeness' },
  { key: 'timeliness', label: 'Timeliness' },
  { key: 'scores', label: 'Quality scores' },
  { key: 'outliers', label: 'Possible outliers' },
];

const RED = 'var(--color-danger)';
const AMBER = 'var(--color-warning)';
const GREEN = 'var(--color-success)';

function thresholdColor(value: number) {
  return value < 60 ? RED : value < 80 ? AMBER : GREEN;
}

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return (
    <th className={`${right ? 'text-end' : 'text-start'} px-4 py-2.5`} style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-light)', background: 'var(--bg-card-solid)' }}>
      <span className="text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">{children}</span>
    </th>
  );
}

function MetricBar({ value }: { value: number }) {
  const color = thresholdColor(value);
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 rounded-full flex-shrink-0" style={{ width: 90, background: 'var(--overlay-light)' }}>
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, value)}%`, background: color }} />
      </div>
      <span className="text-[13px] font-bold" style={{ color }}>{value}%</span>
    </div>
  );
}

export default function DataQualityPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data, loading } = useDataQuality();
  const { alerts, loading: alertsLoading } = useSurveillance();

  const viewParam = searchParams?.get('view');
  const view: View = (viewParam === 'timeliness' || viewParam === 'outliers' || viewParam === 'scores') ? viewParam : 'completeness';
  const setView = (v: View) => {
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('view', v);
    router.replace(`/data-quality?${params.toString()}`, { scroll: false });
  };

  const assessedEntries = useMemo(() => (data?.entries || []).filter(e => e.lastAssessmentDate), [data]);
  const completenessRows = useMemo(() => [...assessedEntries].sort((a, b) => a.reportingCompleteness - b.reportingCompleteness), [assessedEntries]);
  const timelinessRows = useMemo(() => [...assessedEntries].sort((a, b) => a.reportingTimeliness - b.reportingTimeliness), [assessedEntries]);
  const scoreRows = useMemo(() => [...assessedEntries].sort((a, b) => b.dataQualityScore - a.dataQualityScore), [assessedEntries]);
  const belowCompleteness80 = useMemo(() => assessedEntries.filter(e => e.reportingCompleteness < 80).length, [assessedEntries]);
  const belowTimeliness80 = useMemo(() => assessedEntries.filter(e => e.reportingTimeliness < 80).length, [assessedEntries]);

  // Free-text filter over the active view's rows. Completeness/timeliness/scores
  // match on facility name or state; outliers (a different row shape sourced
  // from surveillance alerts) match on disease or location instead.
  const [rowQuery, setRowQuery] = useState('');
  const q = rowQuery.trim().toLowerCase();
  const filterFacilityRows = useCallback(
    (rows: DataCompletenessEntry[]) =>
      (q ? rows.filter(e => e.facilityName.toLowerCase().includes(q) || e.state.toLowerCase().includes(q)) : rows),
    [q],
  );
  const filteredCompletenessRows = useMemo(() => filterFacilityRows(completenessRows), [completenessRows, filterFacilityRows]);
  const filteredTimelinessRows = useMemo(() => filterFacilityRows(timelinessRows), [timelinessRows, filterFacilityRows]);
  const filteredScoreRows = useMemo(() => filterFacilityRows(scoreRows), [scoreRows, filterFacilityRows]);

  // Honest, simple outlier check: an alert's cases are >3x the median cases
  // reported for that same disease across all alerts on file. No validation
  // ruleset exists yet — this is a heuristic flag to verify at source, not a
  // confirmed data-quality finding.
  const outliers = useMemo(() => {
    const byDisease = new Map<string, number[]>();
    for (const a of alerts) {
      const list = byDisease.get(a.disease) || [];
      list.push(a.cases);
      byDisease.set(a.disease, list);
    }
    const median = (nums: number[]) => {
      const sorted = [...nums].sort((x, y) => x - y);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };
    const medianByDisease = new Map<string, number>();
    for (const [disease, list] of byDisease) medianByDisease.set(disease, median(list));
    return alerts
      .filter(a => {
        const med = medianByDisease.get(a.disease) || 0;
        return med > 0 && a.cases > med * 3;
      })
      .sort((a, b) => b.cases - a.cases);
  }, [alerts]);

  const filteredOutliers = useMemo(
    () => q ? outliers.filter(a => a.disease.toLowerCase().includes(q) || a.county.toLowerCase().includes(q) || a.state.toLowerCase().includes(q)) : outliers,
    [outliers, q]
  );

  if (loading || !data) return <main className="page-container flex items-center justify-center"><p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('dataQuality.loading')}</p></main>;

  const scoreColor = (score: number) => score >= 70 ? 'var(--accent-primary)' : score >= 50 ? 'var(--color-warning)' : 'var(--color-danger)';

  // Header stat pills reflect the whole (unfiltered) view, matching the
  // appointments-page convention where the search box narrows the table but
  // not the summary counts. Only completeness/timeliness carry a "Below 80%"
  // pill — scores has no comparable threshold and outliers is a different
  // (alert-based) row shape entirely.
  const listHeaderStats =
    view === 'completeness'
      ? [
          { label: 'Facilities', value: completenessRows.length, color: LIST_STAT_COLORS.muted },
          { label: 'Below 80%', value: belowCompleteness80, color: LIST_STAT_COLORS.amber },
        ]
      : view === 'timeliness'
      ? [
          { label: 'Facilities', value: timelinessRows.length, color: LIST_STAT_COLORS.muted },
          { label: 'Below 80%', value: belowTimeliness80, color: LIST_STAT_COLORS.amber },
        ]
      : view === 'scores'
      ? [{ label: 'Facilities', value: scoreRows.length, color: LIST_STAT_COLORS.muted }]
      : [{ label: 'Outliers flagged', value: outliers.length, color: LIST_STAT_COLORS.amber }];

  const listHeaderSearch =
    view === 'outliers'
      ? { value: rowQuery, onChange: setRowQuery, placeholder: 'Search disease or location', ariaLabel: 'Search outliers by disease or location' }
      : { value: rowQuery, onChange: setRowQuery, placeholder: 'Search facility or state', ariaLabel: 'Search facilities by name or state' };

  return (
    <main className="page-container page-enter">
        <div className="card-elevated px-4 pt-4 pb-3 mb-4">
          <span style={{ fontFamily: 'var(--font-condensed)', fontWeight: 800, fontSize: 22, lineHeight: 1.12, letterSpacing: '-0.015em', color: 'var(--text-primary)' }}>
            {t('dataQuality.topBarTitle')}
          </span>
        </div>
        {/* National indicators */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="card-elevated p-4" data-tour="dq-national-indicators">
            <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
              {t('dataQuality.nationalIndicatorsTitle')}
            </h3>
            <div className="space-y-3">
              {[
                { label: t('dataQuality.indicatorReportingCompleteness'), value: data.avgCompleteness, target: 80 },
                { label: t('dataQuality.indicatorReportingTimeliness'), value: data.avgTimeliness, target: 75 },
                { label: t('dataQuality.indicatorDataAccuracy'), value: data.avgQuality, target: 70 },
                { label: t('dataQuality.indicatorFacilitiesCompleteness'), value: data.completenessRate, target: 60 },
                { label: t('dataQuality.indicatorDhis2Reporting'), value: data.dhis2Adoption, target: 50 },
              ].map(item => (
                <div key={item.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
                    <span className="font-bold" style={{ color: scoreColor(item.value) }}>{item.value}%
                      <span className="font-semibold ms-1" style={{ color: 'var(--text-muted)' }}>/ {item.target}%</span>
                    </span>
                  </div>
                  <div className="relative w-full h-3 rounded-full" style={{ background: 'var(--overlay-light)' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${item.value}%`, background: scoreColor(item.value) }} />
                    <div className="absolute top-0 bottom-0 w-0.5" style={{ left: `${item.target}%`, background: 'var(--text-muted)', opacity: 0.5 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card-elevated p-4">
            <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
              <Users className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
              {t('dataQuality.hisWorkforceTitle')}
            </h3>
            <div className="space-y-4">
              <div className="p-3 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{t('dataQuality.totalHisStaff')}</p>
                <p className="text-3xl font-bold" style={{ color: 'var(--accent-primary)' }}>{data.totalHISStaff}</p>
                <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{t('dataQuality.acrossFacilitiesTrained', { count: data.facilitiesWithTrainedStaff })}</p>
              </div>
              <div className="p-3 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{t('dataQuality.staffCoverage')}</p>
                <p className="text-3xl font-bold" style={{ color: scoreColor(data.totalFacilities ? Math.round(data.facilitiesWithTrainedStaff / data.totalFacilities * 100) : 0) }}>
                  {data.totalFacilities ? Math.round(data.facilitiesWithTrainedStaff / data.totalFacilities * 100) : 0}%
                </p>
                <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{t('dataQuality.facilitiesWithTrainedStaff', { trained: data.facilitiesWithTrainedStaff, total: data.totalFacilities })}</p>
              </div>
              <div className="p-3 rounded-lg" style={{ background: data.dhis2Adoption >= 50 ? 'rgba(33, 145, 208, 0.08)' : 'rgba(224, 49, 39,0.08)' }}>
                <div className="flex items-center gap-2 mb-1">
                  <Wifi className="w-3.5 h-3.5" style={{ color: scoreColor(data.dhis2Adoption) }} />
                  <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('dataQuality.electronicReporting')}</p>
                </div>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {t('dataQuality.facilitiesUsingDhis2', { count: data.totalFacilities ? Math.round(data.dhis2Adoption * data.totalFacilities / 100) : 0 })}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Facility-level views */}
        <div className="dash-card overflow-hidden" data-tour="dq-facility-table">
          <EhrListHeader
            title="Facility data quality"
            stats={listHeaderStats}
            search={listHeaderSearch}
            actions={
              <FilterTabs ariaLabel="Data quality view" active={view} onChange={k => setView(k as View)} tabs={VIEWS.map(v => ({ key: v.key, label: v.label }))} />
            }
          />

          {view === 'completeness' && (
            <div className="overflow-x-auto">
              <table className="w-full" style={{ minWidth: 640 }}>
                <thead><tr><Th>Facility</Th><Th>State</Th><Th>Reporting completeness</Th><Th>Last assessment</Th></tr></thead>
                <tbody>
                  {filteredCompletenessRows.length === 0 && (
                    <tr><td colSpan={4} className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>No facility assessments on file.</td></tr>
                  )}
                  {filteredCompletenessRows.map((e: DataCompletenessEntry) => (
                    <tr key={e.facilityId} style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <td className="px-4 py-2.5 text-[14px]" style={{ color: 'var(--ehr-text, var(--text-primary))', fontWeight: 800 }}>{e.facilityName}</td>
                      <td className="px-4 py-2.5 text-[13px]" style={{ color: 'var(--ehr-muted, var(--text-secondary))' }}>{e.state}</td>
                      <td className="px-4 py-2.5"><MetricBar value={e.reportingCompleteness} /></td>
                      <td className="px-4 py-2.5 text-[12px] font-mono" style={{ color: 'var(--text-muted)' }}>{e.lastAssessmentDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {view === 'timeliness' && (
            <div className="overflow-x-auto">
              <table className="w-full" style={{ minWidth: 640 }}>
                <thead><tr><Th>Facility</Th><Th>State</Th><Th>Reporting timeliness</Th><Th>Last assessment</Th></tr></thead>
                <tbody>
                  {filteredTimelinessRows.length === 0 && (
                    <tr><td colSpan={4} className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>No facility assessments on file.</td></tr>
                  )}
                  {filteredTimelinessRows.map((e: DataCompletenessEntry) => (
                    <tr key={e.facilityId} style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <td className="px-4 py-2.5 text-[14px]" style={{ color: 'var(--ehr-text, var(--text-primary))', fontWeight: 800 }}>{e.facilityName}</td>
                      <td className="px-4 py-2.5 text-[13px]" style={{ color: 'var(--ehr-muted, var(--text-secondary))' }}>{e.state}</td>
                      <td className="px-4 py-2.5"><MetricBar value={e.reportingTimeliness} /></td>
                      <td className="px-4 py-2.5 text-[12px] font-mono" style={{ color: 'var(--text-muted)' }}>{e.lastAssessmentDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {view === 'scores' && (
            <div className="overflow-x-auto">
              <table className="w-full" style={{ minWidth: 640 }}>
                <thead><tr><Th>Rank</Th><Th>Facility</Th><Th>State</Th><Th>Data quality score</Th><Th>Last assessment</Th></tr></thead>
                <tbody>
                  {filteredScoreRows.length === 0 && (
                    <tr><td colSpan={5} className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>No facility assessments on file.</td></tr>
                  )}
                  {filteredScoreRows.map((e: DataCompletenessEntry, i: number) => (
                    <tr key={e.facilityId} style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <td className="px-4 py-2.5 text-[13px] font-mono" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                      <td className="px-4 py-2.5 text-[14px]" style={{ color: 'var(--ehr-text, var(--text-primary))', fontWeight: 800 }}>{e.facilityName}</td>
                      <td className="px-4 py-2.5 text-[13px]" style={{ color: 'var(--ehr-muted, var(--text-secondary))' }}>{e.state}</td>
                      <td className="px-4 py-2.5"><MetricBar value={e.dataQualityScore} /></td>
                      <td className="px-4 py-2.5 text-[12px] font-mono" style={{ color: 'var(--text-muted)' }}>{e.lastAssessmentDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {view === 'outliers' && (
            <div>
              <div className="px-4 py-3 flex items-start gap-2" style={{ borderBottom: '1px solid var(--border-light)', background: 'var(--overlay-subtle)' }}>
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: AMBER }} />
                <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                  Possible data outliers — verify at source. Flagged where an alert&rsquo;s case count exceeds 3&times; the median for that disease. No validation rules are configured yet in TamamHealth; this is a heuristic, not a confirmed error.
                </p>
              </div>
              {alertsLoading ? (
                <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>Loading surveillance alerts…</div>
              ) : filteredOutliers.length === 0 ? (
                <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>No outliers detected against this heuristic.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full" style={{ minWidth: 640 }}>
                    <thead><tr><Th>Disease</Th><Th>Location</Th><Th right>Cases</Th><Th>Reported</Th></tr></thead>
                    <tbody>
                      {filteredOutliers.map(a => (
                        <tr key={a._id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                          <td className="px-4 py-2.5 text-[14px]" style={{ color: 'var(--ehr-text, var(--text-primary))', fontWeight: 800 }}>{a.disease}</td>
                          <td className="px-4 py-2.5 text-[13px]" style={{ color: 'var(--ehr-muted, var(--text-secondary))' }}>{a.county}, {a.state}</td>
                          <td className="px-4 py-2.5 text-[13px] text-end font-mono" style={{ color: RED }}>{a.cases.toLocaleString()}</td>
                          <td className="px-4 py-2.5 text-[12px] font-mono" style={{ color: 'var(--text-muted)' }}>{a.reportDate}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
    </main>
  );
}
