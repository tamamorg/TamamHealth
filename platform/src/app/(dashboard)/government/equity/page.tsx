'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  ResponsiveContainer, Cell,
} from 'recharts';
import { tooltipStyle, axisTick } from '@/components/ChartCard';
import { FilterTabs } from '@/components/filters';
import EhrListHeader, { LIST_STAT_COLORS } from '@/components/ehr/EhrListHeader';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { useSurveillance } from '@/lib/hooks/useSurveillance';
import { useImmunizations } from '@/lib/hooks/useImmunizations';
import { useANC } from '@/lib/hooks/useANC';
import { useDataQuality } from '@/lib/hooks/useDataQuality';
import { SOUTH_SUDAN_STATES } from '@/lib/geographic-data';
import { ChevronUp, ChevronDown, AlertTriangle } from '@/components/icons/lucide';

type View = 'comparison' | 'burden' | 'access';
const VIEWS: { key: View; label: string }[] = [
  { key: 'comparison', label: 'State comparison' },
  { key: 'burden', label: 'Burden vs. visibility' },
  { key: 'access', label: 'Facility access' },
];

function Th({ children, onClick, active, dir }: { children?: React.ReactNode; onClick?: () => void; active?: boolean; dir?: 'asc' | 'desc' }) {
  return (
    <th
      className="text-start px-4 py-2.5"
      style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-light)', background: 'var(--bg-card-solid)', cursor: onClick ? 'pointer' : undefined }}
      onClick={onClick}
    >
      <span className="text-[11px] font-bold uppercase tracking-wider whitespace-nowrap inline-flex items-center gap-1">
        {children}
        {onClick && active && (dir === 'asc' ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />)}
      </span>
    </th>
  );
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 rounded-full flex-shrink-0" style={{ width: 70, background: 'var(--overlay-light)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[13px] font-mono" style={{ color: 'var(--ehr-muted, var(--text-secondary))' }}>{value.toLocaleString()}</span>
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

  // ── Comparison view sort state ──
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<keyof StateRow>('activeCases');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const sortedRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const copy = needle ? rows.filter(r => r.state.toLowerCase().includes(needle)) : [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const an = av === null ? -1 : (av as number);
      const bn = bv === null ? -1 : (bv as number);
      if (sortKey === 'state') return sortDir === 'asc' ? a.state.localeCompare(b.state) : b.state.localeCompare(a.state);
      return sortDir === 'asc' ? an - bn : bn - an;
    });
    return copy;
  }, [rows, sortKey, sortDir, search]);
  const toggleSort = (key: keyof StateRow) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };
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

  return (
    <main className="page-container page-enter">
      <div data-tour="gov-equity-header" className="dash-card mb-3">
        <EhrListHeader
          title="Equity & planning"
          stats={[
            { label: 'States', value: rows.length, color: LIST_STAT_COLORS.muted },
            { label: 'Facilities', value: rows.reduce((sum, r) => sum + r.facilities, 0), color: LIST_STAT_COLORS.blue },
          ]}
          search={{ value: search, onChange: setSearch, placeholder: 'Search a state…', ariaLabel: 'Search states' }}
          actions={
            <FilterTabs ariaLabel="Equity view" active={view} onChange={k => setView(k as View)} tabs={VIEWS.map(v => ({ key: v.key, label: v.label }))} />
          }
        />
      </div>

      {loading ? (
        <div className="dash-card p-8 text-center" style={{ color: 'var(--text-muted)' }}>Loading state comparisons…</div>
      ) : (
        <>
          {view === 'comparison' && (
            <div className="dash-card overflow-hidden">
              <div className="show-scrollbar" style={{ overflowX: 'auto' }}>
                <table className="w-full" style={{ minWidth: 860 }}>
                  <thead>
                    <tr>
                      <Th onClick={() => toggleSort('state')} active={sortKey === 'state'} dir={sortDir}>State</Th>
                      <Th onClick={() => toggleSort('facilities')} active={sortKey === 'facilities'} dir={sortDir}>Facilities</Th>
                      <Th onClick={() => toggleSort('activeCases')} active={sortKey === 'activeCases'} dir={sortDir}>Active alert cases</Th>
                      <Th onClick={() => toggleSort('immRecords')} active={sortKey === 'immRecords'} dir={sortDir}>Immunization records</Th>
                      <Th onClick={() => toggleSort('ancVisits')} active={sortKey === 'ancVisits'} dir={sortDir}>ANC visits</Th>
                      <Th onClick={() => toggleSort('avgCompleteness')} active={sortKey === 'avgCompleteness'} dir={sortDir}>Avg. reporting completeness</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map(r => (
                      <tr key={r.state} style={{ borderBottom: '1px solid var(--border-light)' }}>
                        <td className="px-4 py-2.5 text-[14px]" style={{ color: 'var(--ehr-text, var(--text-primary))', fontWeight: 800 }}>{r.state}</td>
                        <td className="px-4 py-2.5"><MiniBar value={r.facilities} max={maxFacilities} color="var(--chart-1)" /></td>
                        <td className="px-4 py-2.5"><MiniBar value={r.activeCases} max={maxCases} color="var(--color-danger-text)" /></td>
                        <td className="px-4 py-2.5"><MiniBar value={r.immRecords} max={maxImm} color="var(--color-success-text)" /></td>
                        <td className="px-4 py-2.5"><MiniBar value={r.ancVisits} max={maxAnc} color="var(--color-warning-text)" /></td>
                        <td className="px-4 py-2.5 text-[13px] font-mono" style={{ color: r.avgCompleteness === null ? 'var(--text-muted)' : 'var(--ehr-muted, var(--text-secondary))' }}>
                          {r.avgCompleteness === null ? 'No data on file' : `${r.avgCompleteness}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {view === 'burden' && (
            <div className="dash-card">
              <div className="px-4 pt-4 pb-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
                <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Active case burden vs. reporting completeness</span>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  Reporting completeness is used here as a visibility proxy, not a measure of service coverage. States without any facility assessment are excluded from this chart.
                </p>
              </div>
              <div className="px-4 py-4" style={{ height: 380 }}>
                {scatterRows.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-[13px]" style={{ color: 'var(--text-muted)' }}>No facility assessments on file to plot.</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
                      <XAxis type="number" dataKey="activeCases" name="Active alert cases" tick={axisTick} axisLine={{ stroke: 'var(--border-light)' }} tickLine={false} label={{ value: 'Active alert cases (burden)', position: 'insideBottom', offset: -5, fontSize: 11, fill: 'var(--text-muted)' }} />
                      <YAxis type="number" dataKey="avgCompleteness" name="Avg. completeness" domain={[0, 100]} tick={axisTick} axisLine={{ stroke: 'var(--border-light)' }} tickLine={false} label={{ value: 'Reporting completeness % (visibility proxy)', angle: -90, position: 'insideLeft', fontSize: 11, fill: 'var(--text-muted)' }} />
                      <Tooltip cursor={tooltipStyle.cursor} content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const p = payload[0].payload as StateRow;
                        return (
                          <div style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-light)', borderRadius: 8, padding: '8px 10px', fontSize: 12 }}>
                            <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{p.state}</div>
                            <div style={{ color: 'var(--text-secondary)' }}>{p.activeCases.toLocaleString()} active cases</div>
                            <div style={{ color: 'var(--text-secondary)' }}>{p.avgCompleteness}% avg. completeness</div>
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
                <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--color-warning-text)' }}>High burden / low visibility — priority</p>
                {priorityStates.length === 0 ? (
                  <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>No states currently fall in the high-burden / low-visibility quadrant.</p>
                ) : (
                  <ul className="space-y-1">
                    {priorityStates.map((r, i) => (
                      <li key={r.state} className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                        <span className="font-bold" style={{ color: 'var(--ehr-text, var(--text-primary))' }}>{i + 1}. {r.state}</span>
                        {' — '}{r.activeCases.toLocaleString()} active cases, {r.avgCompleteness}% avg. completeness
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {view === 'access' && (
            <div className="dash-card overflow-hidden">
              <div className="px-4 pt-4 pb-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  Population denominators are not on file — density figures below are per recorded activity (active alert cases), not per-capita.
                </p>
              </div>
              <div className="show-scrollbar" style={{ overflowX: 'auto' }}>
                <table className="w-full" style={{ minWidth: 720 }}>
                  <thead>
                    <tr>
                      <Th>State</Th>
                      <Th>Facilities</Th>
                      <Th>Active alert cases</Th>
                      <Th>Facilities per 100 active cases</Th>
                      <Th>Flag</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {accessRows.map(r => (
                      <tr key={r.state} style={{ borderBottom: '1px solid var(--border-light)' }}>
                        <td className="px-4 py-2.5 text-[14px]" style={{ color: 'var(--ehr-text, var(--text-primary))', fontWeight: 800 }}>{r.state}</td>
                        <td className="px-4 py-2.5 text-[13px] font-mono" style={{ color: r.accessGap ? 'var(--color-danger-text)' : 'var(--ehr-muted, var(--text-secondary))' }}>{r.facilities}</td>
                        <td className="px-4 py-2.5 text-[13px] font-mono" style={{ color: 'var(--ehr-muted, var(--text-secondary))' }}>{r.activeCases.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-[13px] font-mono" style={{ color: 'var(--ehr-muted, var(--text-secondary))' }}>{r.ratePer100Cases === null ? '—' : r.ratePer100Cases}</td>
                        <td className="px-4 py-2.5">
                          {r.accessGap && (
                            <span className="gov-chip gap-1" style={{ background: 'rgba(255, 153, 51,0.14)', color: '#b35900', border: '1px solid rgba(255, 153, 51,0.4)' }}>
                              <AlertTriangle className="w-3 h-3" /> Access gap
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
