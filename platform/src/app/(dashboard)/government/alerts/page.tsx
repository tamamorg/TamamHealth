'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSurveillance } from '@/lib/hooks/useSurveillance';
import { formatCompactDateTime } from '@/lib/format-utils';
import {
  ArrowUpRight, Search, TrendingUp, TrendingDown, Minus,
} from '@/components/icons/lucide';
import type { DiseaseAlertDoc } from '@/lib/db-types';

// ── Shared "flat clinical" section chrome (matches the HR / patients pages) ──
const SECTION_TITLE_STYLE: React.CSSProperties = {
  fontFamily: 'var(--font-condensed)', fontWeight: 800, fontSize: 22, lineHeight: 1.12, letterSpacing: '-0.015em', color: 'var(--text-primary)',
};

const LEVEL_COLORS: Record<string, string> = {
  emergency: 'var(--color-danger)',
  warning: 'var(--color-warning)',
  watch: 'var(--chart-1)',
  normal: '#94a2b3',
};

const LEVEL_RANK: Record<string, number> = { emergency: 0, warning: 1, watch: 2, normal: 3 };

function StatDots({ stats }: { stats: { label: string; value: number | string; color: string }[] }) {
  return (
    <div className="flex items-center gap-3 flex-wrap justify-end pb-0.5">
      {stats.map(s => (
        <span key={s.label} className="inline-flex items-center gap-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
          {s.label} ({typeof s.value === 'number' ? s.value.toLocaleString() : s.value})
        </span>
      ))}
    </div>
  );
}

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return (
    <th className={`${right ? 'text-end' : 'text-start'} px-4 py-2.5`} style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-light)', background: 'var(--bg-card-solid)' }}>
      <span className="text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">{children}</span>
    </th>
  );
}

function LevelPill({ level }: { level: string }) {
  const color = LEVEL_COLORS[level] || LEVEL_COLORS.normal;
  return (
    <span className="gov-chip" style={{ background: `${color}1F`, color, border: `1px solid ${color}40` }}>
      {level}
    </span>
  );
}

function TrendIcon({ trend }: { trend: string }) {
  if (trend === 'increasing') return <TrendingUp className="w-3.5 h-3.5" style={{ color: 'var(--color-danger-text)' }} />;
  if (trend === 'decreasing') return <TrendingDown className="w-3.5 h-3.5" style={{ color: 'var(--color-success-text)' }} />;
  return <Minus className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />;
}

export default function PriorityAlertsPage() {
  const router = useRouter();
  const { alerts, loading } = useSurveillance();
  const [search, setSearch] = useState('');

  // "Active" alerts for this queue: anything the surveillance team hasn't
  // downgraded to normal. Emergency first, then warning/watch, ties broken
  // by case count so the biggest outbreaks always rise to the top.
  const activeAlerts = useMemo(
    () => alerts
      .filter(a => a.alertLevel !== 'normal')
      .sort((a, b) => (LEVEL_RANK[a.alertLevel] - LEVEL_RANK[b.alertLevel]) || (b.cases - a.cases)),
    [alerts],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return activeAlerts;
    return activeAlerts.filter(a =>
      a.disease.toLowerCase().includes(q) ||
      a.state.toLowerCase().includes(q) ||
      (a.county || '').toLowerCase().includes(q)
    );
  }, [activeAlerts, search]);

  const counts = useMemo(() => ({
    emergency: activeAlerts.filter(a => a.alertLevel === 'emergency').length,
    warning: activeAlerts.filter(a => a.alertLevel === 'warning').length,
    watch: activeAlerts.filter(a => a.alertLevel === 'watch').length,
    total: activeAlerts.length,
  }), [activeAlerts]);

  // Top-3 counties by active case load — feeds the response guidance note.
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

  return (
    <main className="page-container page-enter">
      <div data-tour="gov-alerts-list" className="dash-card overflow-hidden flex flex-col" style={{ minHeight: 0 }}>
        <div className="px-4 pt-4 pb-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="flex items-end justify-between gap-3 mb-1 flex-wrap">
            <div>
              <span style={SECTION_TITLE_STYLE}>
                Priority alerts
                <span className="tabular-nums" style={{ color: 'var(--text-muted)', fontWeight: 600 }}> ({counts.total})</span>
              </span>
              <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-muted)' }}>All active alerts · National</p>
            </div>
            <StatDots stats={[
              { label: 'Emergency', value: counts.emergency, color: LEVEL_COLORS.emergency },
              { label: 'Warning', value: counts.warning, color: LEVEL_COLORS.warning },
              { label: 'Watch', value: counts.watch, color: LEVEL_COLORS.watch },
            ]} />
          </div>
          <div className="relative mt-3" style={{ maxWidth: 360 }}>
            <Search className="w-3.5 h-3.5 absolute" style={{ left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by disease, state, or county…"
              style={{ width: '100%', padding: '9px 14px 9px 34px', height: 38, borderRadius: 999, border: '1px solid var(--border-light)', background: 'var(--bg-card-solid)', fontSize: 13, color: 'var(--text-primary)', outline: 'none' }}
            />
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>Loading surveillance alerts…</div>
        ) : activeAlerts.length === 0 ? (
          <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>No active disease alerts on file. All reporting facilities are at normal alert level.</div>
        ) : (
          <div className="show-scrollbar" style={{ overflowX: 'auto' }}>
            <table className="w-full" style={{ minWidth: 840 }}>
              <thead>
                <tr>
                  <Th>Disease</Th>
                  <Th>Location</Th>
                  <Th right>Cases</Th>
                  <Th right>Deaths</Th>
                  <Th>Level</Th>
                  <Th>Trend</Th>
                  <Th>Reported</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>No alerts match &ldquo;{search}&rdquo;.</td></tr>
                )}
                {filtered.map((a: DiseaseAlertDoc) => (
                  <tr key={a._id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td className="px-4 py-2.5 text-[14px]" style={{ color: 'var(--ehr-text, var(--text-primary))', fontWeight: 800 }}>{a.disease}</td>
                    <td className="px-4 py-2.5 text-[13px]" style={{ color: 'var(--ehr-muted, var(--text-secondary))' }}>{a.county}, {a.state}</td>
                    <td className="px-4 py-2.5 text-[13px] text-end font-mono" style={{ color: 'var(--ehr-muted, var(--text-secondary))' }}>{a.cases.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-[13px] text-end font-mono" style={{ color: a.deaths > 0 ? LEVEL_COLORS.emergency : 'var(--ehr-muted, var(--text-secondary))' }}>{a.deaths}</td>
                    <td className="px-4 py-2.5"><LevelPill level={a.alertLevel} /></td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1 text-[12px] capitalize" style={{ color: 'var(--ehr-muted, var(--text-secondary))' }}>
                        <TrendIcon trend={a.trend} /> {a.trend}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[12px] whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{formatCompactDateTime(a.reportDate)}</td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => router.push('/surveillance')}
                        className="inline-flex items-center gap-1 text-[12px] font-semibold whitespace-nowrap"
                        style={{ color: 'var(--accent-primary)' }}
                      >
                        Open in surveillance <ArrowUpRight className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Response guidance — top counties by active case load */}
      <div className="dash-card mt-3">
        <div className="px-4 pt-4 pb-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <span style={{ fontFamily: 'var(--font-condensed)', fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-primary)' }}>Response guidance</span>
        </div>
        <div className="px-4 py-3">
          {topCounties.length === 0 ? (
            <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>No active alerts to prioritize.</p>
          ) : (
            <ul className="space-y-1.5">
              {topCounties.map((c, i) => (
                <li key={`${c.county}-${c.state}`} className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0" style={{ background: 'var(--overlay-subtle)', color: 'var(--text-muted)' }}>{i + 1}</span>
                  <span style={{ fontWeight: 700, color: 'var(--ehr-text, var(--text-primary))' }}>{c.county}, {c.state}</span>
                  <span style={{ color: 'var(--text-muted)' }}>— {c.cases.toLocaleString()} active cases across {c.alerts} alert{c.alerts === 1 ? '' : 's'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
