'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDataQuality } from '@/lib/hooks/useDataQuality';
import { useSurveillance } from '@/lib/hooks/useSurveillance';
import { useTranslation } from '@/lib/i18n/useTranslation';
import Select from '@/components/Select';
import './data-quality.css';
import InlineBanner from '@/components/overlay/InlineBanner';
import { SadbKpiTile } from '@/components/admin/sadb-ui';
import DuplicateReviewPanel from '@/components/patients/DuplicateReviewPanel';
import { useDuplicateReview } from '@/components/patients/useDuplicateReview';
import { useAuth } from '@/lib/context';
import { isAggregateOnlyViewer } from '@/lib/services/data-scope';
import EhrListHeader, { LIST_STAT_COLORS } from '@/components/ehr/EhrListHeader';
import type { DataCompletenessEntry } from '@/lib/services/data-quality-service';

type View = 'completeness' | 'timeliness' | 'outliers' | 'scores';
const VIEW_KEYS: { key: View; labelKey: string }[] = [
  { key: 'completeness', labelKey: 'dataQuality.viewCompleteness' },
  { key: 'timeliness', labelKey: 'dataQuality.viewTimeliness' },
  { key: 'scores', labelKey: 'dataQuality.viewScores' },
  { key: 'outliers', labelKey: 'dataQuality.viewOutliers' },
];

const RED = 'var(--color-danger)';
const AMBER = 'var(--color-warning)';
const GREEN = 'var(--color-success)';

function thresholdColor(value: number) {
  return value < 60 ? RED : value < 80 ? AMBER : GREEN;
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
  // Duplicate review runs on the viewer's own DataScope, so an organisation or
  // facility role reviews the records it actually holds. Called before the
  // early return below to keep the hook order stable.
  const duplicateReview = useDuplicateReview();
  const { currentUser } = useAuth();
  // Government sees aggregate data-quality metrics only, never the duplicate
  // candidates' names/hospital numbers (security audit 2026-11-05, H3).
  const aggregateOnly = isAggregateOnlyViewer(currentUser?.role);

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

  const facilityRows = view === 'completeness' ? filteredCompletenessRows : view === 'timeliness' ? filteredTimelinessRows : filteredScoreRows;

  // Header stat pills reflect the whole (unfiltered) view, matching the
  // appointments-page convention where the search box narrows the table but
  // not the summary counts. Only completeness/timeliness carry a "Below 80%"
  // pill — scores has no comparable threshold and outliers is a different
  // (alert-based) row shape entirely.
  // The view's own row total rides the title ("Facility data quality (N)");
  // only the breakdown chips remain in the stats row.
  const listHeaderCount =
    view === 'completeness' ? completenessRows.length
    : view === 'timeliness' ? timelinessRows.length
    : view === 'scores' ? scoreRows.length
    : outliers.length;
  const listHeaderStats =
    view === 'completeness'
      ? [{ label: t('dataQuality.belowEighty'), value: belowCompleteness80, color: LIST_STAT_COLORS.amber }]
      : view === 'timeliness'
      ? [{ label: t('dataQuality.belowEighty'), value: belowTimeliness80, color: LIST_STAT_COLORS.amber }]
      : [];

  const listHeaderSearch =
    view === 'outliers'
      ? { value: rowQuery, onChange: setRowQuery, placeholder: t('dataQuality.searchOutliers'), ariaLabel: t('dataQuality.searchOutliersAria') }
      : { value: rowQuery, onChange: setRowQuery, placeholder: t('dataQuality.searchFacility'), ariaLabel: t('dataQuality.searchFacilityAria') };

  const assessed = assessedEntries.length;
  const goodFacilities = assessedEntries.filter(e => e.reportingCompleteness >= 80).length;
  const dhis2Facilities = data.totalFacilities ? Math.round(data.dhis2Adoption * data.totalFacilities / 100) : 0;
  const tone = (value: number, target: number) => (value < target ? 'warn' as const : undefined);

  return (
    <main className="page-container page-enter">
      {/* The figures: what each is made of and the target it is held to. The
          assessments carry one date each, so there is no honest period
          comparison to draw a trend from. */}
      <div className="sadb-kpi-row dq-kpis" data-tour="dq-national-indicators">
        <SadbKpiTile
          label={t('dataQuality.tileCompleteness')}
          value={`${data.avgCompleteness}%`}
          delta={t('dataQuality.detailTarget', { target: 80, count: assessed })}
          deltaTone={tone(data.avgCompleteness, 80)}
        />
        <SadbKpiTile
          label={t('dataQuality.tileTimeliness')}
          value={`${data.avgTimeliness}%`}
          delta={t('dataQuality.detailTarget', { target: 75, count: assessed })}
          deltaTone={tone(data.avgTimeliness, 75)}
        />
        <SadbKpiTile
          label={t('dataQuality.tileAccuracy')}
          value={`${data.avgQuality}%`}
          delta={t('dataQuality.detailTarget', { target: 70, count: assessed })}
          deltaTone={tone(data.avgQuality, 70)}
        />
        <SadbKpiTile
          label={t('dataQuality.tileGoodFacilities')}
          value={`${data.completenessRate}%`}
          delta={t('dataQuality.detailGoodFacilities', { target: 60, good: goodFacilities, total: assessed })}
          deltaTone={tone(data.completenessRate, 60)}
        />
        <SadbKpiTile
          label={t('dataQuality.tileDhis2')}
          value={`${data.dhis2Adoption}%`}
          delta={t('dataQuality.detailDhis2', { target: 50, count: dhis2Facilities, total: data.totalFacilities })}
          deltaTone={tone(data.dhis2Adoption, 50)}
        />
        <SadbKpiTile
          label={t('dataQuality.tileStaff')}
          value={data.totalHISStaff.toLocaleString()}
          delta={t('dataQuality.detailStaff', { trained: data.facilitiesWithTrainedStaff, total: data.totalFacilities })}
        />
      </div>

      {/* Facility-level views */}
      <div className="dash-card overflow-hidden" data-tour="dq-facility-table">
        <EhrListHeader
          title={t('dataQuality.listTitle')}
          count={listHeaderCount}
          stats={listHeaderStats}
          search={listHeaderSearch}
          actions={
            <label className="dq-view-field">
              <span>{t('dataQuality.viewLabel')}</span>
              <Select value={view} onChange={e => setView(e.target.value as View)} data-action="dq-view">
                {VIEW_KEYS.map(v => <option key={v.key} value={v.key}>{t(v.labelKey)}</option>)}
              </Select>
            </label>
          }
        />

        {view !== 'outliers' && (
          <div className="overflow-x-auto">
            <table className="w-full" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  {view === 'scores' && <th>{t('dataQuality.colRank')}</th>}
                  <th>{t('dataQuality.colFacility')}</th>
                  <th>{t('dataQuality.colState')}</th>
                  <th>{view === 'completeness' ? t('dataQuality.colCompleteness') : view === 'timeliness' ? t('dataQuality.colTimeliness') : t('dataQuality.colScore')}</th>
                  <th>{t('dataQuality.colLastAssessment')}</th>
                </tr>
              </thead>
              <tbody>
                {facilityRows.length === 0 && (
                  <tr><td colSpan={view === 'scores' ? 5 : 4} className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>{t('dataQuality.noAssessments')}</td></tr>
                )}
                {facilityRows.map((e: DataCompletenessEntry, i: number) => (
                  <tr key={e.facilityId}>
                    {view === 'scores' && <td className="tabular-nums" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>}
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{e.facilityName}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{e.state}</td>
                    <td><MetricBar value={view === 'completeness' ? e.reportingCompleteness : view === 'timeliness' ? e.reportingTimeliness : e.dataQualityScore} /></td>
                    <td className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>{e.lastAssessmentDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {view === 'outliers' && (
          <div>
            <div className="px-4 pb-3">
              <InlineBanner tone="warning">{t('dataQuality.outlierNote')}</InlineBanner>
            </div>
            {alertsLoading ? (
              <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>{t('dataQuality.alertsLoading')}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full" style={{ minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th>{t('dataQuality.colDisease')}</th>
                      <th>{t('dataQuality.colLocation')}</th>
                      <th>{t('dataQuality.colCases')}</th>
                      <th>{t('dataQuality.colReported')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOutliers.length === 0 && (
                      <tr><td colSpan={4} className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>{t('dataQuality.noOutliers')}</td></tr>
                    )}
                    {filteredOutliers.map(a => (
                      <tr key={a._id}>
                        <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{a.disease}</td>
                        <td style={{ color: 'var(--text-secondary)' }}>{a.county}, {a.state}</td>
                        <td className="tabular-nums" style={{ color: RED, fontWeight: 600 }}>{a.cases.toLocaleString()}</td>
                        <td className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>{a.reportDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Duplicate patient records: the review that used to live only on the
          platform operator's /admin/data, which holds no records. Government
          sees the aggregate quality metrics above only, never the candidate
          patient names/hospital numbers (security audit 2026-11-05, H3). */}
      {!aggregateOnly && (
        <div className="mt-4" data-tour="dq-duplicate-review">
          <DuplicateReviewPanel review={duplicateReview} standalone />
        </div>
      )}
    </main>
  );
}
