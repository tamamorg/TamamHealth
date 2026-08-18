'use client';
import { useMemo, useState } from 'react';
import { useAuth } from '@/lib/context';
import RoleGuard from '@/components/RoleGuard';
import { useMCHAnalytics } from '@/lib/hooks/useMCHAnalytics';
import { useBirths } from '@/lib/hooks/useBirths';
import { useDeaths } from '@/lib/hooks/useDeaths';
import { useImmunizations } from '@/lib/hooks/useImmunizations';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { useSurveillance } from '@/lib/hooks/useSurveillance';
import { jubaYearMonth } from '@/lib/time-juba';
import { useTranslation } from '@/lib/i18n/useTranslation';
import EhrCareDashboard, { type EhrCareDashboardRow } from '@/components/ehr/EhrCareDashboard';
import { type DayStatsItem } from '@/components/ehr/EhrDayStatsChart';
import { formatDateTitle, toIsoDate, parseIsoDate, addDays } from '@/components/ehr/EhrMiniCalendar';
import { Download, Activity, TrendingUp, Table as TableIcon } from '@/components/icons/lucide';
import { tooltipStyle, axisTick } from '@/components/ChartCard';
import { formatClockTime } from '@/lib/format-utils';
import {
  ResponsiveContainer, ComposedChart, LineChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from 'recharts';

// Chart series colors — fixed palette per the surveillance/analytics spec
// (not the --viz-* EHR tokens, which are reserved for the shared Day
// statistics widget's inpatient/outpatient pair).
const CHART_BLUE = 'var(--chart-1)';
const CHART_GREEN = 'var(--color-success)';
const CHART_RED = 'var(--color-danger)';
const CHART_AMBER = 'var(--color-warning)';
const DISEASE_LINE_COLORS = [CHART_BLUE, CHART_GREEN, CHART_RED];

// Same local CSV-download helper duplicated across reports/pharmacy/hospitals/
// immunizations pages — plain data-in/file-out, no shared util to import.
function downloadCSV(data: Record<string, unknown>[], filename: string) {
  if (data.length === 0) return;
  const headers = Object.keys(data[0]);
  const csv = [
    headers.join(','),
    ...data.map(row =>
      headers.map(h => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(',')
    ),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function clockTime(iso?: string): string | undefined {
  if (!iso) return undefined;
  return formatClockTime(iso) || undefined;
}

function countByState(
  agg: Record<string, number> | undefined,
  stateName: string,
): number {
  if (!agg) return 0;
  return agg[stateName] ?? 0;
}

export default function StateDashboardPage() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const stateName = (currentUser as unknown as { state?: string } | null)?.state || '';

  const { data: mch, loading: mchLoading } = useMCHAnalytics();
  const { births } = useBirths();
  const { deaths } = useDeaths();
  const { immunizations } = useImmunizations();
  const { hospitals } = useHospitals();
  const { alerts: diseaseAlerts } = useSurveillance();

  // Shell state: single-tab work list plus a county-name search. Search is new
  // here — the bespoke layout had none — so it's a pure improvement.
  const [activeTab, setActiveTab] = useState('all');
  const [search, setSearch] = useState('');

  const thisMonth = jubaYearMonth();
  const stateBirthsThisMonth = births.filter(
    b => b.state === stateName && b.dateOfBirth?.startsWith(thisMonth),
  ).length;
  const stateDeathsThisMonth = deaths.filter(
    d => d.state === stateName && d.dateOfDeath?.startsWith(thisMonth),
  ).length;
  const facilitiesInState = hospitals.filter(h => h.state === stateName);
  const anc1ForState = mch?.ancCascade?.byState?.[stateName]?.anc1 ?? 0;
  const ancTotalForState = mch?.ancCascade?.byState?.[stateName]?.total ?? 0;
  const anc1Rate = ancTotalForState > 0 ? Math.round((anc1ForState / ancTotalForState) * 100) : 0;
  // "YTD" is meant literally — `getImmunizationStats().totalVaccinations` is an
  // all-time count, so derive the current-year figure from the raw records instead.
  const thisYear = thisMonth.slice(0, 4);
  const immunizationsYtd = immunizations.filter(i => i.status === 'completed' && i.dateGiven.startsWith(thisYear)).length;

  // Counties within this state from the byCounty rollup (keyed `${state}::${county}`).
  // facilityIds / lastReportAt are real aggregates from the same birth/death
  // streams (facilityId + createdAt are already on every record) — used to
  // fill the queue-card Source/Status/Wait columns honestly instead of
  // leaving them blank.
  // anc1/anc4/anc8 ride along with the total (the byCounty rollup already
  // computes them, src/lib/services/mch-analytics-service.ts) purely for the
  // row's detail panel — the ANC cascade rate is the one figure the queue
  // row itself has no column for.
  type CountyRow = { county: string; birthCount: number; deathCount: number; ancTotal: number; anc1: number; anc4: number; anc8: number; facilityIds: Set<string>; lastReportAt?: string };
  const counties: CountyRow[] = [];
  const byCounty = mch?.ancCascade?.byCounty ?? {};
  for (const [key, val] of Object.entries(byCounty)) {
    const [s, c] = key.split('::');
    if (s !== stateName) continue;
    counties.push({
      county: c,
      birthCount: countByState(undefined, c), // birth count by county is not yet aggregated; fall back below
      deathCount: 0,
      ancTotal: val.total,
      anc1: val.anc1,
      anc4: val.anc4,
      anc8: val.anc8,
      facilityIds: new Set(),
    });
  }
  const touchCounty = (countyName: string): CountyRow => {
    let row = counties.find(c => c.county === countyName);
    if (!row) {
      row = { county: countyName, birthCount: 0, deathCount: 0, ancTotal: 0, anc1: 0, anc4: 0, anc8: 0, facilityIds: new Set() };
      counties.push(row);
    }
    return row;
  };
  // Fallback: derive county births/deaths from raw streams when the rollup is empty for them.
  for (const b of births) {
    if (b.state !== stateName || !b.county) continue;
    const row = touchCounty(b.county);
    row.birthCount += 1;
    if (b.facilityId) row.facilityIds.add(b.facilityId);
    if (b.createdAt && (!row.lastReportAt || b.createdAt > row.lastReportAt)) row.lastReportAt = b.createdAt;
  }
  for (const d of deaths) {
    if (d.state !== stateName || !d.county) continue;
    const row = touchCounty(d.county);
    row.deathCount += 1;
    if (d.facilityId) row.facilityIds.add(d.facilityId);
    if (d.createdAt && (!row.lastReportAt || d.createdAt > row.lastReportAt)) row.lastReportAt = d.createdAt;
  }
  counties.sort((a, b) => a.county.localeCompare(b.county));

  const query = search.trim().toLowerCase();
  const visibleCounties = query
    ? counties.filter(c => c.county.toLowerCase().includes(query))
    : counties;

  const dateLabel = formatDateTitle(toIsoDate(new Date()));
  const todayIso = toIsoDate(new Date());

  // Only real user-triggered action on this otherwise read-only oversight
  // dashboard: export the county rollup as CSV (drill-downs into a county
  // don't count as an "action" — they're navigation, not a completed task).
  const exportCountyData = () => {
    if (counties.length === 0) return;
    const rows = counties.map(c => ({
      County: c.county,
      Births: c.birthCount,
      Deaths: c.deathCount,
      'ANC Total': c.ancTotal,
    }));
    downloadCSV(rows, `${(stateName || 'state').toLowerCase().replace(/\s+/g, '_')}_county_data`);
  };

  // Per-county detail, rendered inline via `row.popupDetail` (EhrCareDashboard's
  // shared expand-in-place panel). Births/deaths/ANC total and reporting
  // status are already on the row above, so this only surfaces what the row
  // has no room for: the ANC1/ANC4 cascade rate, and which facilities are
  // behind the county's reporting figures.
  const renderCountyDetail = (c: CountyRow) => {
    const anc1Rate = c.ancTotal > 0 ? Math.round((c.anc1 / c.ancTotal) * 100) : 0;
    const anc4Rate = c.ancTotal > 0 ? Math.round((c.anc4 / c.ancTotal) * 100) : 0;
    const facilityNames = facilitiesInState.filter(h => c.facilityIds.has(h._id)).map(h => h.name).sort();
    return (
      <div className="ehr-visit-pop ehr-visit-pop--inline">
        <div className="ehr-visit-pop-body">
          <div className="ehr-visit-pop-row">
            <span className="ehr-visit-pop-label">ANC coverage</span>
            <div>
              <strong>{anc1Rate}% ANC1 · {anc4Rate}% ANC4</strong>
              <p>{c.ancTotal} tracked pregnanc{c.ancTotal === 1 ? 'y' : 'ies'}</p>
            </div>
          </div>
          <div className="ehr-visit-pop-row">
            <span className="ehr-visit-pop-label">Facilities</span>
            <div>
              {facilityNames.length > 0
                ? <p>{facilityNames.join(', ')}</p>
                : <p>No facility-linked reports yet.</p>}
            </div>
          </div>
        </div>
      </div>
    );
  };


  // Day statistics rail: counties are aggregates with no dated per-item work,
  // so row-derived bucketing (the shared shell's default) is meaningless here.
  // Built instead from the dated registry docs the page already loads — births
  // and deaths for this state — plotted at their real registration instant.
  const stateChartItems = useMemo<DayStatsItem[]>(() => [
    ...births.filter(b => b.state === stateName).map((b): DayStatsItem => ({
      date: b.createdAt.slice(0, 10), time: clockTime(b.createdAt), series: 0,
    })),
    ...deaths.filter(d => d.state === stateName).map((d): DayStatsItem => ({
      date: d.createdAt.slice(0, 10), time: clockTime(d.createdAt), series: 1,
    })),
  ], [births, deaths, stateName]);

  // (a) Weekly notifiable-disease trend — real DiseaseAlertDoc records
  // (src/lib/services/surveillance-service.ts, seeded in db-seed.ts from the
  // `diseaseAlerts` list in src/data/mock.ts) scoped to this state. Each
  // alert carries disease/state/county/cases/reportDate; seeding replicates
  // every base alert across 8 weekly reportDates so the trend genuinely
  // varies week to week rather than being a single flat point. Bucketed into
  // Sunday-start weeks and split into up to 3 lines (the diseases with the
  // highest total case volume for this state — most states only ever have
  // 1–5 tracked diseases). The reference line is an illustrative threshold
  // (1.4x the top disease's own average weekly count here) — not a WHO/MoH
  // clinical alert value, which this dataset doesn't carry.
  const diseaseWeeklyChart = useMemo(() => {
    const stateAlerts = diseaseAlerts.filter(a => a.state === stateName);
    if (stateAlerts.length === 0) return null;
    const weekOf = (iso: string) => {
      const d = parseIsoDate(iso);
      return toIsoDate(addDays(d, -d.getDay()));
    };
    const byDiseaseWeek = new Map<string, Map<string, number>>();
    const diseaseTotals = new Map<string, number>();
    const weeks = new Set<string>();
    for (const a of stateAlerts) {
      const week = weekOf(a.reportDate);
      weeks.add(week);
      if (!byDiseaseWeek.has(a.disease)) byDiseaseWeek.set(a.disease, new Map());
      const wk = byDiseaseWeek.get(a.disease)!;
      wk.set(week, (wk.get(week) ?? 0) + a.cases);
      diseaseTotals.set(a.disease, (diseaseTotals.get(a.disease) ?? 0) + a.cases);
    }
    const topDiseases = [...diseaseTotals.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([d]) => d);
    const sortedWeeks = [...weeks].sort();
    const data = sortedWeeks.map(week => {
      const row: Record<string, number | string> = {
        weekLabel: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(parseIsoDate(week)),
      };
      for (const disease of topDiseases) row[disease] = byDiseaseWeek.get(disease)?.get(week) ?? 0;
      return row;
    });
    const primaryDisease = topDiseases[0];
    const primarySeries = sortedWeeks.map(week => byDiseaseWeek.get(primaryDisease)?.get(week) ?? 0);
    const primaryAvg = primarySeries.reduce((s, v) => s + v, 0) / (primarySeries.length || 1);
    const threshold = Math.max(5, Math.round((primaryAvg * 1.4) / 5) * 5);
    return { data, diseases: topDiseases, primaryDisease, threshold };
  }, [diseaseAlerts, stateName]);

  // (b) Deliveries (bars) + deaths (line) by month — real births/deaths for
  // this state, bucketed by dateOfBirth/dateOfDeath month, over whatever
  // month range is actually present in the data (no fixed calendar window).
  const monthlyDeliveriesDeaths = useMemo(() => {
    const stateBirths = births.filter(b => b.state === stateName);
    const stateDeaths = deaths.filter(d => d.state === stateName);
    if (stateBirths.length === 0 && stateDeaths.length === 0) return null;
    const months = new Set<string>();
    const birthsByMonth = new Map<string, number>();
    const deathsByMonth = new Map<string, number>();
    for (const b of stateBirths) {
      const m = b.dateOfBirth.slice(0, 7);
      months.add(m);
      birthsByMonth.set(m, (birthsByMonth.get(m) ?? 0) + 1);
    }
    for (const d of stateDeaths) {
      const m = d.dateOfDeath.slice(0, 7);
      months.add(m);
      deathsByMonth.set(m, (deathsByMonth.get(m) ?? 0) + 1);
    }
    const sortedMonths = [...months].sort();
    return sortedMonths.map(m => ({
      monthLabel: new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit' }).format(new Date(`${m}-01T00:00:00`)),
      deliveries: birthsByMonth.get(m) ?? 0,
      deaths: deathsByMonth.get(m) ?? 0,
    }));
  }, [births, deaths, stateName]);

  // (c) Facility RAG league table — extends the same honest reporting-recency
  // signal already used for the county rows above (lastReportAt vs. this
  // month), rolled up per facility instead of per county. A facility with no
  // birth/death record at all reads "No reports" rather than being guessed
  // into "Behind" — that distinction is real (zero records vs. stale ones),
  // not invented.
  type FacilityRagRow = {
    id: string; name: string; type: string;
    births: number; deaths: number; lastReportAt?: string;
    status: 'current' | 'behind' | 'none';
  };
  const facilityRagRows = useMemo<FacilityRagRow[]>(() => (
    facilitiesInState.map((h): FacilityRagRow => {
      let birthsCount = 0;
      let deathsCount = 0;
      let lastReportAt: string | undefined;
      for (const b of births) {
        if (b.facilityId !== h._id) continue;
        birthsCount += 1;
        if (b.createdAt && (!lastReportAt || b.createdAt > lastReportAt)) lastReportAt = b.createdAt;
      }
      for (const d of deaths) {
        if (d.facilityId !== h._id) continue;
        deathsCount += 1;
        if (d.createdAt && (!lastReportAt || d.createdAt > lastReportAt)) lastReportAt = d.createdAt;
      }
      const status: FacilityRagRow['status'] = !lastReportAt
        ? 'none'
        : lastReportAt.slice(0, 7) === thisMonth ? 'current' : 'behind';
      return { id: h._id, name: h.name, type: h.facilityType, births: birthsCount, deaths: deathsCount, lastReportAt, status };
    }).sort((a, b) => a.name.localeCompare(b.name))
  // eslint-disable-next-line react-hooks/exhaustive-deps -- facilitiesInState is derived from hospitals/stateName each render, both already covered
  ), [hospitals, stateName, births, deaths, thisMonth]);

  return (
    <RoleGuard>
      <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <EhrCareDashboard
          title={t('state.title')}
          greetingName={currentUser?.name}
          dateLabel={dateLabel}
          tabs={[
            { key: 'all', label: t('state.countiesIn', { state: stateName || '—' }), count: counties.length },
          ]}
          // Counties are a roster, not a day's schedule — their row date is
          // "last reported", so day-scoping left the list empty on most days
          // while the tab counted the whole state.
          filterRowsByDate={false}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          searchValue={search}
          searchPlaceholder={t('topbar.searchPlaceholder')}
          onSearchChange={setSearch}
          filters={[]}
          actions={[
            { label: t('action.export'), icon: Download, onClick: exportCountyData },
          ]}
          chartSeriesNames={['Births', 'Deaths']}
          chartItems={stateChartItems}
          rows={visibleCounties.map((c): EhrCareDashboardRow => {
            const facilityCount = c.facilityIds.size;
            // "Current" vs "behind" is only claimed once we actually have a
            // dated report for this county — otherwise it's left blank
            // rather than guessing.
            const reportingCurrent = c.lastReportAt ? c.lastReportAt.slice(0, 7) === thisMonth : undefined;
            return {
              id: c.county,
              title: c.county,
              subtitle: t('state.countyStats', { births: c.birthCount, deaths: c.deathCount, anc: c.ancTotal }),
              careTeam: facilityCount > 0 ? `${facilityCount} facilit${facilityCount === 1 ? 'y' : 'ies'}` : undefined,
              careTeamLabel: 'Reporting facilities',
              location: t('state.countyStats', { births: c.birthCount, deaths: c.deathCount, anc: c.ancTotal }),
              locationSecondary: 'Monthly indicators',
              statusLabel: reportingCurrent === undefined ? undefined : reportingCurrent ? 'Current' : 'Behind',
              statusSecondary: reportingCurrent === undefined ? 'No report' : thisMonth,
              statusTone: reportingCurrent === undefined ? undefined : reportingCurrent ? 'ready' : 'warning',
              time: c.lastReportAt
                ? new Date(c.lastReportAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                : undefined,
              date: c.lastReportAt ? c.lastReportAt.slice(0, 10) : undefined,
              timeSecondary: c.lastReportAt ? c.lastReportAt.slice(0, 10) : 'No report',
              popupDetail: renderCountyDetail(c),
            };
          })}
          metrics={[
            { label: t('state.birthsThisMonth'), value: stateBirthsThisMonth },
            { label: t('state.deathsThisMonth'), value: stateDeathsThisMonth },
            { label: 'Facilities', value: facilitiesInState.length },
            { label: t('state.anc1Coverage'), value: `${anc1Rate}%` },
            { label: t('state.immunizationsYtd'), value: immunizationsYtd },
          ]}
          metricsTitle={t('state.title')}
          missionTitle={t('state.title')}
          // Counties count already lives on the tab label above — the mission
          // card only adds the facilities figure so the two don't repeat.
          missionDescription={`${facilitiesInState.length} ${facilitiesInState.length === 1 ? 'facility' : 'facilities'} reporting`}
          emptyTitle={mchLoading && counties.length === 0 ? t('status.loading') : t('state.noCountyData')}
        />
      </main>
    </RoleGuard>
  );
}
