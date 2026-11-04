'use client';

/**
 * Priority alerts: every active (not normal) disease alert, worst first.
 *
 * The level counts are the KPI band (with their week-on-week movement); the
 * list below is searchable and filterable by level. Reporting a new alert
 * lives on /surveillance, which owns the IDSR reporting form.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSurveillance } from '@/lib/hooks/useSurveillance';
import { formatCompactDateTime } from '@/lib/format-utils';
import { TrendingUp, TrendingDown, Minus } from '@/components/icons/lucide';
import Select from '@/components/Select';
import { SadbCard, SadbChip, SadbKpiTile, SadbSearch, type ChipTone } from '@/components/admin/sadb-ui';
import { Field, weeklyTrend } from '@/components/oversight/OversightKit';
import type { DiseaseAlertDoc } from '@/lib/db-types';

const LEVEL_TONE: Record<string, ChipTone> = {
  emergency: 'red',
  warning: 'yellow',
  watch: 'blue',
  normal: 'neutral',
};

const LEVEL_RANK: Record<string, number> = { emergency: 0, warning: 1, watch: 2, normal: 3 };

function TrendIcon({ trend }: { trend: string }) {
  if (trend === 'increasing') return <TrendingUp className="w-3.5 h-3.5" style={{ color: 'var(--color-danger-text)' }} />;
  if (trend === 'decreasing') return <TrendingDown className="w-3.5 h-3.5" style={{ color: 'var(--color-success-text)' }} />;
  return <Minus className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />;
}

export default function PriorityAlertsPage() {
  const { alerts, loading } = useSurveillance();
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState('');

  // "Active" alerts: anything the surveillance team has not downgraded to
  // normal. Emergency first, then warning and watch, ties by case count so the
  // biggest outbreaks rise to the top.
  const activeAlerts = useMemo(
    () => alerts
      .filter(a => a.alertLevel !== 'normal')
      .sort((a, b) => (LEVEL_RANK[a.alertLevel] - LEVEL_RANK[b.alertLevel]) || (b.cases - a.cases)),
    [alerts],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeAlerts.filter(a =>
      (!level || a.alertLevel === level) &&
      (!q || a.disease.toLowerCase().includes(q) || a.state.toLowerCase().includes(q) || (a.county || '').toLowerCase().includes(q)),
    );
  }, [activeAlerts, search, level]);

  const byLevel = useMemo(() => (['emergency', 'warning', 'watch'] as const).map(l => {
    const rows = activeAlerts.filter(a => a.alertLevel === l);
    return { level: l, rows, week: weeklyTrend(rows, a => a.reportDate, () => 1) };
  }), [activeAlerts]);

  // Top-3 counties by active case load, for the response note.
  const topCounties = useMemo(() => {
    const byCounty = new Map<string, { county: string; state: string; cases: number; alerts: number }>();
    for (const a of activeAlerts) {
      const key = `${a.county}|${a.state}`;
      const existing = byCounty.get(key);
      if (existing) { existing.cases += a.cases; existing.alerts += 1; }
      else byCounty.set(key, { county: a.county, state: a.state, cases: a.cases, alerts: 1 });
    }
    return Array.from(byCounty.values()).sort((a, b) => b.cases - a.cases).slice(0, 3);
  }, [activeAlerts]);

  const LEVEL_LABEL: Record<string, string> = { emergency: 'Emergency', warning: 'Warning', watch: 'Watch' };

  return (
    <main className="page-container page-enter sadb-scope">
      <div className="sadb-page">
        <div className="sadb-kpi-row" data-tour="gov-alerts-kpis">
          {byLevel.map(({ level: l, rows, week }) => (
            <SadbKpiTile
              key={l}
              label={`${LEVEL_LABEL[l]} alerts`}
              value={rows.length.toLocaleString()}
              delta={`${rows.reduce((n, a) => n + (a.cases || 0), 0).toLocaleString()} cases and ${rows.reduce((n, a) => n + (a.deaths || 0), 0).toLocaleString()} deaths on these alerts`}
              trend={week ? { ...week.trend, label: `${week.current.toLocaleString()} reported this week, ${week.previous.toLocaleString()} last week` } : undefined}
            />
          ))}
        </div>

        <div data-tour="gov-alerts-list">
          <SadbCard title="Priority alerts" meta={`${filtered.length.toLocaleString()} of ${activeAlerts.length.toLocaleString()} active · National`}>
            <div className="ov-fields" style={{ border: 0, borderBottom: '1px solid var(--border-light)', borderRadius: 0 }}>
              <Field label="Search" group>
                <SadbSearch value={search} onChange={setSearch} placeholder="Disease, state or county" ariaLabel="Search alerts" />
              </Field>
              <Field label="Level">
                <Select value={level} onChange={e => setLevel(e.target.value)} data-action="gov-alert-level">
                  <option value="">All levels</option>
                  <option value="emergency">Emergency</option>
                  <option value="warning">Warning</option>
                  <option value="watch">Watch</option>
                </Select>
              </Field>
            </div>

            {loading ? (
              <p className="sadb-empty">Loading alerts…</p>
            ) : (
              <div className="show-scrollbar" style={{ overflowX: 'auto' }}>
                <table className="w-full ov-table" style={{ minWidth: 760 }}>
                  <thead>
                    <tr>
                      <th className="text-start">Disease</th>
                      <th className="text-start">Location</th>
                      <th className="text-start">Cases</th>
                      <th className="text-start">Deaths</th>
                      <th className="text-start">Level</th>
                      <th className="text-start">Trend</th>
                      <th className="text-start">Reported</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeAlerts.length === 0 ? (
                      <tr><td colSpan={7} className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>No active disease alerts. Every reporting facility is at normal level.</td></tr>
                    ) : filtered.length === 0 ? (
                      <tr><td colSpan={7} className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>No alerts match these filters. Clear the search or choose another level.</td></tr>
                    ) : filtered.map((a: DiseaseAlertDoc) => (
                      <tr key={a._id}>
                        <td>
                          <Link href="/surveillance" className="font-semibold" style={{ color: 'var(--accent-link)' }}>{a.disease}</Link>
                        </td>
                        <td>{a.county}, {a.state}</td>
                        <td>{a.cases.toLocaleString()}</td>
                        <td style={{ color: a.deaths > 0 ? 'var(--color-danger-text)' : undefined }}>{a.deaths}</td>
                        <td><SadbChip tone={LEVEL_TONE[a.alertLevel] ?? 'neutral'}>{a.alertLevel}</SadbChip></td>
                        <td>
                          <span className="inline-flex items-center gap-1 capitalize">
                            <TrendIcon trend={a.trend} /> {a.trend}
                          </span>
                        </td>
                        <td className="whitespace-nowrap">{formatCompactDateTime(a.reportDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SadbCard>
        </div>

        <SadbCard title="Where to respond first" meta="Top counties by active cases">
          <div className="px-4 py-3">
            {topCounties.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>No active alerts to prioritise.</p>
            ) : (
              <ol className="space-y-1.5">
                {topCounties.map((c, i) => (
                  <li key={`${c.county}-${c.state}`} className="flex items-center gap-2" style={{ fontSize: 14 }}>
                    <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'var(--overlay-subtle)', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600 }}>{i + 1}</span>
                    <span style={{ fontWeight: 600 }}>{c.county}, {c.state}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{c.cases.toLocaleString()} active cases across {c.alerts} alert{c.alerts === 1 ? '' : 's'}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </SadbCard>
      </div>
    </main>
  );
}
