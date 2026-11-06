'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  ResponsiveContainer, Cell,
} from 'recharts';
import { tooltipStyle, axisTick } from '@/components/ChartCard';
import Select from '@/components/Select';
import { SadbCard, SadbChip, SadbKpiTile, SadbSearch } from '@/components/admin/sadb-ui';
import { Field, FieldRow, weeklyTrend } from '@/components/oversight/OversightKit';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { useSurveillance } from '@/lib/hooks/useSurveillance';
import { useImmunizations } from '@/lib/hooks/useImmunizations';
import { useANC } from '@/lib/hooks/useANC';
import { useDataQuality } from '@/lib/hooks/useDataQuality';
import { SOUTH_SUDAN_STATES } from '@/lib/geographic-data';
import { AlertTriangle } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';

type View = 'comparison' | 'burden' | 'access';
const VIEW_KEYS: { key: View; labelKey: string }[] = [
  { key: 'comparison', labelKey: 'govEquity.viewComparison' },
  { key: 'burden', labelKey: 'govEquity.viewBurden' },
  { key: 'access', labelKey: 'govEquity.viewAccess' },
];

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 rounded-full flex-shrink-0" style={{ width: 70, background: 'var(--overlay-light)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span style={{ color: 'var(--text-secondary)' }}>{value.toLocaleString()}</span>
    </div>
  );
}

interface StateRow {
  state: string;
  facilities: number;
  activeCases: number;
  immRecords: number;
  ancVisits: number;
  avgCompleteness: number | null;
}

export default function EquityPlanningPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewParam = searchParams?.get('view');
  const view: View = (viewParam === 'burden' || viewParam === 'access') ? viewParam : 'comparison';

  const { hospitals, loading: hospLoading } = useHospitals();
  const { alerts, loading: alertsLoading } = useSurveillance();
  const { stats: immStats, loading: immLoading } = useImmunizations();
  const { stats: ancStats, loading: ancLoading } = useANC();
  const { data: dq, loading: dqLoading } = useDataQuality();

  const loading = hospLoading || alertsLoading || immLoading || ancLoading || dqLoading;

  const setView = (v: View) => {
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('view', v);
    router.replace(`/government/equity?${params.toString()}`, { scroll: false });
  };

  const rows: StateRow[] = useMemo(() => {
    return SOUTH_SUDAN_STATES.map(state => {
      const facilities = hospitals.filter(h => h.state === state).length;
      const activeCases = alerts
        .filter(a => a.state === state && a.alertLevel !== 'normal')
        .reduce((s, a) => s + a.cases, 0);
      const immRecords = immStats?.byState[state] || 0;
      const ancVisits = ancStats?.byState[state] || 0;
      const assessed = (dq?.entries || []).filter(e => e.state === state && e.lastAssessmentDate);
      const avgCompleteness = assessed.length > 0
        ? Math.round(assessed.reduce((s, e) => s + e.reportingCompleteness, 0) / assessed.length)
        : null;
      return { state, facilities, activeCases, immRecords, ancVisits, avgCompleteness };
    });
  }, [hospitals, alerts, immStats, ancStats, dq]);

  // ── Comparison view: worst burden first; every column head sorts the rows ──
  const [search, setSearch] = useState('');
  const sortedRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = needle ? rows.filter(r => r.state.toLowerCase().includes(needle)) : [...rows];
    return list.sort((a, b) => b.activeCases - a.activeCases);
  }, [rows, search]);
  const maxFacilities = Math.max(1, ...rows.map(r => r.facilities));
  const maxCases = Math.max(1, ...rows.map(r => r.activeCases));
  const maxImm = Math.max(1, ...rows.map(r => r.immRecords));
  const maxAnc = Math.max(1, ...rows.map(r => r.ancVisits));

  // ── Burden vs. visibility (scatter) ──
  const scatterRows = useMemo(() => rows.filter(r => r.avgCompleteness !== null), [rows]);
  const median = (nums: number[]) => {
    if (nums.length === 0) return 0;
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const medianCases = useMemo(() => median(scatterRows.map(r => r.activeCases)), [scatterRows]);
  const medianCompleteness = useMemo(() => median(scatterRows.map(r => r.avgCompleteness as number)), [scatterRows]);
  const priorityStates = useMemo(
    () => scatterRows
      .filter(r => r.activeCases > medianCases && (r.avgCompleteness as number) < medianCompleteness)
      .sort((a, b) => b.activeCases - a.activeCases),
    [scatterRows, medianCases, medianCompleteness],
  );

  // ── Facility access ──
  const accessRows = useMemo(() => rows.map(r => ({
    ...r,
    ratePer100Cases: r.activeCases > 0 ? Math.round((r.facilities / r.activeCases) * 100 * 10) / 10 : null,
    accessGap: r.facilities <= 1,
  })).sort((a, b) => a.facilities - b.facilities), [rows]);

  const totalFacilities = rows.reduce((sum, r) => sum + r.facilities, 0);
  const accessGapCount = rows.filter(r => r.facilities <= 1).length;
  const activeAlertRows = useMemo(() => alerts.filter(a => a.alertLevel !== 'normal'), [alerts]);
  const caseTrend = useMemo(() => weeklyTrend(activeAlertRows, a => a.reportDate, a => a.cases || 0), [activeAlertRows]);

  return (
    <main className="page-container page-enter sadb-scope">
      <div className="sadb-page" data-tour="gov-equity-header">
        <div className="sadb-kpi-row">
          <SadbKpiTile
            label={t('govEquity.kpiGap')}
            value={t('govEquity.kpiGapValue', { n: accessGapCount, total: rows.length })}
            delta={t('govEquity.kpiGapDetail')}
            deltaTone={accessGapCount > 0 ? 'warn' : undefined}
            onClick={() => router.push('/manage')}
          />
          <SadbKpiTile
            label={t('govEquity.kpiPriority')}
            value={priorityStates.length}
            delta={t('govEquity.kpiPriorityDetail')}
            onClick={() => setView('burden')}
          />
          <SadbKpiTile
            label={t('ui.activeAlertCases')}
            value={activeAlertRows.reduce((n, a) => n + (a.cases || 0), 0).toLocaleString()}
            delta={t('govEquity.kpiCasesDetail', { n: activeAlertRows.length.toLocaleString() })}
            trend={caseTrend?.trend}
            onClick={() => router.push('/government/alerts')}
          />
          <SadbKpiTile
            label={t('govEquity.kpiFacilities')}
            value={totalFacilities.toLocaleString()}
            delta={t('govEquity.kpiFacilitiesDetail', { n: rows.filter(r => r.facilities > 0).length, total: rows.length })}
            onClick={() => router.push('/manage')}
          />
        </div>

        <FieldRow>
          <Field label={t('govEquity.view')}>
            <Select value={view} onChange={e => setView(e.target.value as View)} data-action="gov-equity-view">
              {VIEW_KEYS.map(v => <option key={v.key} value={v.key}>{t(v.labelKey)}</option>)}
            </Select>
          </Field>
          {view === 'comparison' && (
            <Field label={t('govEquity.search')} group>
              <SadbSearch value={search} onChange={setSearch} placeholder={t('govEquity.searchPlaceholder')} ariaLabel={t('govEquity.searchAria')} />
            </Field>
          )}
        </FieldRow>

        {loading ? (
          <SadbCard><p className="sadb-empty">{t('ui.loadingStateComparisons')}</p></SadbCard>
        ) : (
          <>
            {view === 'comparison' && (
              <SadbCard title={t('govEquity.viewComparison')} meta={t('govEquity.comparisonMeta', { shown: sortedRows.length, total: rows.length })}>
                <div className="show-scrollbar" style={{ overflowX: 'auto' }}>
                  <table className="w-full ov-table" style={{ minWidth: 860 }}>
                    <thead>
                      <tr>
                        <th className="text-start">{t('births.colState')}</th>
                        <th className="text-start">{t('government.colFacilities')}</th>
                        <th className="text-start">{t('ui.activeAlertCases')}</th>
                        <th className="text-start">{t('ui.immunizationRecords2')}</th>
                        <th className="text-start">{t('govEquity.colAnc')}</th>
                        <th className="text-start">{t('govEquity.colCompleteness')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRows.length === 0 && (
                        <tr><td colSpan={6} className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>{t('govEquity.noState')}</td></tr>
                      )}
                      {sortedRows.map(r => (
                        <tr key={r.state}>
                          <td className="font-semibold">{r.state}</td>
                          <td><MiniBar value={r.facilities} max={maxFacilities} color="var(--chart-1)" /></td>
                          <td><MiniBar value={r.activeCases} max={maxCases} color="var(--color-danger-text)" /></td>
                          <td><MiniBar value={r.immRecords} max={maxImm} color="var(--color-success-text)" /></td>
                          <td><MiniBar value={r.ancVisits} max={maxAnc} color="var(--color-warning-text)" /></td>
                          <td style={{ color: r.avgCompleteness === null ? 'var(--text-muted)' : undefined }}>
                            {r.avgCompleteness === null ? t('govEquity.notAssessed') : `${r.avgCompleteness}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SadbCard>
            )}

            {view === 'burden' && (
              <SadbCard title={t('govEquity.burdenTitle')} meta={t('govEquity.burdenMeta')}>
                <p className="px-4 pt-3" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  {t('govEquity.burdenNote')}
                </p>
                <div className="px-4 py-4" style={{ height: 380 }}>
                  {scatterRows.length === 0 ? (
                    <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-muted)' }}>{t('govEquity.burdenNone')}</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
                        <XAxis type="number" dataKey="activeCases" name={t('ui.activeAlertCases')} tick={axisTick} axisLine={{ stroke: 'var(--border-light)' }} tickLine={false} label={{ value: t('govEquity.axisBurden'), position: 'insideBottom', offset: -5, fontSize: 12, fill: 'var(--text-muted)' }} />
                        <YAxis type="number" dataKey="avgCompleteness" name={t('govEquity.colCompleteness')} domain={[0, 100]} tick={axisTick} axisLine={{ stroke: 'var(--border-light)' }} tickLine={false} label={{ value: t('govEquity.axisCompleteness'), angle: -90, position: 'insideLeft', fontSize: 12, fill: 'var(--text-muted)' }} />
                        <Tooltip cursor={tooltipStyle.cursor} content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const p = payload[0].payload as StateRow;
                          return (
                            <div style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-light)', borderRadius: 0, padding: '8px 10px', fontSize: 12 }}>
                              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.state}</div>
                              <div style={{ color: 'var(--text-secondary)' }}>{t('govEquity.tipCases', { n: p.activeCases.toLocaleString() })}</div>
                              <div style={{ color: 'var(--text-secondary)' }}>{t('govEquity.tipCompleteness', { n: p.avgCompleteness ?? 0 })}</div>
                            </div>
                          );
                        }} />
                        <ReferenceLine x={medianCases} stroke="var(--border-light)" strokeDasharray="4 4" />
                        <ReferenceLine y={medianCompleteness} stroke="var(--border-light)" strokeDasharray="4 4" />
                        <Scatter data={scatterRows} fill="var(--chart-1)">
                          {scatterRows.map((r, i) => (
                            <Cell key={i} fill={r.activeCases > medianCases && (r.avgCompleteness as number) < medianCompleteness ? 'var(--color-warning)' : 'var(--chart-1)'} />
                          ))}
                        </Scatter>
                      </ScatterChart>
                    </ResponsiveContainer>
                  )}
                </div>
                <div className="px-4 pb-4">
                  <p className="mb-2" style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-warning-text)' }}>{t('govEquity.priorityHeading')}</p>
                  {priorityStates.length === 0 ? (
                    <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>{t('govEquity.priorityNone')}</p>
                  ) : (
                    <ul className="space-y-1">
                      {priorityStates.map((r, i) => (
                        <li key={r.state} style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{i + 1}. {r.state}</span>
                          {': '}{t('govEquity.priorityRow', { cases: r.activeCases.toLocaleString(), pct: r.avgCompleteness ?? 0 })}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </SadbCard>
            )}

            {view === 'access' && (
              <SadbCard title={t('govEquity.viewAccess')} meta={t('govEquity.accessMeta')}>
                <p className="px-4 pt-3" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  {t('govEquity.accessNote')}
                </p>
                <div className="show-scrollbar" style={{ overflowX: 'auto' }}>
                  <table className="w-full ov-table" style={{ minWidth: 720 }}>
                    <thead>
                      <tr>
                        <th className="text-start">{t('births.colState')}</th>
                        <th className="text-start">{t('government.colFacilities')}</th>
                        <th className="text-start">{t('ui.activeAlertCases')}</th>
                        <th className="text-start">{t('govEquity.colPer100')}</th>
                        <th className="text-start">{t('lab.flag')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accessRows.map(r => (
                        <tr key={r.state}>
                          <td className="font-semibold">{r.state}</td>
                          <td style={{ color: r.accessGap ? 'var(--color-danger-text)' : undefined }}>{r.facilities}</td>
                          <td>{r.activeCases.toLocaleString()}</td>
                          <td>{r.ratePer100Cases === null ? '—' : r.ratePer100Cases}</td>
                          <td>
                            {r.accessGap && (
                              <SadbChip tone="yellow"><AlertTriangle className="w-3 h-3" /> {t('ui.accessGap')}</SadbChip>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SadbCard>
            )}
          </>
        )}
      </div>
    </main>
  );
}
