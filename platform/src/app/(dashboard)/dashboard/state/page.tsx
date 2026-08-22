'use client';
import { useMemo, useState } from 'react';
import { useAuth } from '@/lib/context';
import RoleGuard from '@/components/RoleGuard';
import { useMCHAnalytics } from '@/lib/hooks/useMCHAnalytics';
import { useBirths } from '@/lib/hooks/useBirths';
import { useDeaths } from '@/lib/hooks/useDeaths';
import { useImmunizations } from '@/lib/hooks/useImmunizations';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { jubaYearMonth } from '@/lib/time-juba';
import { useTranslation } from '@/lib/i18n/useTranslation';
import EhrCareDashboard, { type EhrCareDashboardRow } from '@/components/ehr/EhrCareDashboard';
import { type DayStatsItem } from '@/components/ehr/EhrDayStatsChart';
import { formatDateTitle } from '@/components/ehr/EhrMiniCalendar';
import { toIsoDate } from '@/lib/date-utils';
import { Download } from '@/components/icons/lucide';
import { formatClockTime } from '@/lib/format-utils';
import { downloadCsv, safeFilenamePart } from '@/lib/export-file';

function clockTime(iso?: string): string | undefined {
  if (!iso) return undefined;
  return formatClockTime(iso) || undefined;
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
      // Births/deaths are not in the ANC rollup; the raw-stream pass below fills them.
      birthCount: 0,
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

  // Only real user-triggered action on this otherwise read-only oversight
  // dashboard: export the county rollup as CSV (drill-downs into a county
  // don't count as an "action" — they're navigation, not a completed task).
  const exportCountyData = () => {
    downloadCsv(
      counties.map(c => ({
        County: c.county,
        Births: c.birthCount,
        Deaths: c.deathCount,
        'ANC Total': c.ancTotal,
      })),
      `${safeFilenamePart(stateName || 'state')}-county-data`,
    );
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
              detailHref: `/hospitals?state=${encodeURIComponent(stateName)}&county=${encodeURIComponent(c.county)}&returnTo=${encodeURIComponent('/dashboard/state')}`,
              detailLabel: t('referrals.viewDetails'),
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
