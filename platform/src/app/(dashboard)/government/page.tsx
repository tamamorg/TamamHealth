'use client';

/**
 * Ministry of Health — National Dashboard.
 *
 * Public-health intelligence workspace (WHO RHIS / DHIS2-aligned), answering:
 * "What is happening nationally, where is action needed, and can we trust the
 * data?" One screen of situation awareness — detailed work lives in the
 * module pages (surveillance, programs, CRVS, data quality, exchange).
 *
 * Every panel states its period and geography, and no number is invented:
 * each value is computed from the live local datasets (disease alerts,
 * facility assessments, immunization/ANC records, birth/death registrations,
 * DHIS2 sync log). Missing data renders as an explicit empty state.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BarChart, Bar, Cell, PieChart, Pie,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { tooltipStyle, axisTick } from '@/components/ChartCard';
import {
  Siren, FileText, ChevronRight, ChevronDown, Check, Syringe, HeartPulse,
} from '@/components/icons/lucide';
import { useSurveillance } from '@/lib/hooks/useSurveillance';
import { SOUTH_SUDAN_STATES, SOUTH_SUDAN_BBOX, type GeoState } from '@/data/south-sudan-geo';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { useBirths } from '@/lib/hooks/useBirths';
import { useDeaths } from '@/lib/hooks/useDeaths';
import { getNationalDataQuality, type NationalDataQuality } from '@/lib/services/data-quality-service';
import { getImmunizationStats } from '@/lib/services/immunization-service';
import { getANCStats } from '@/lib/services/anc-service';
import { CHART_SERIES, CHART_SERIES_HEX, DISEASE_COLOR } from '@/lib/chart-colors';

/* Two jobs, two forms — they were one set of constants doing both, which is
   how the map turned black.

   MAGNITUDE (the choropleth): `govHeatFill` interpolates a wash toward the
   layer colour using `parseInt(hex.slice(…))`, so these must be literal hex.
   They come from the chart scale, not from status. */
const LAYER_ALERTS = CHART_SERIES_HEX[4];   // orange
const LAYER_IMMUNIZATION = CHART_SERIES_HEX[5]; // green
const LAYER_DEEP = '#013D6B';               // brand-800, the reporting layer

/* STATUS (on target / follow-up / critical): handed straight to CSS, so these
   stay tokens and keep tracking the semantic scale. */
const GREEN = 'var(--color-success)';
const AMBER = 'var(--color-warning)';
const RED = 'var(--color-danger)';

type ImmunizationStats = Awaited<ReturnType<typeof getImmunizationStats>>;
type ANCStats = Awaited<ReturnType<typeof getANCStats>>;

// ── The ten states, with 3-letter codes for compact bar-chart axis labels ──
const STATE_TILES: { name: string; abbr: string }[] = [
  { name: 'Northern Bahr el Ghazal', abbr: 'NBG' },
  { name: 'Unity', abbr: 'UNY' },
  { name: 'Upper Nile', abbr: 'UNL' },
  { name: 'Western Bahr el Ghazal', abbr: 'WBG' },
  { name: 'Warrap', abbr: 'WRP' },
  { name: 'Lakes', abbr: 'LKS' },
  { name: 'Jonglei', abbr: 'JGL' },
  { name: 'Western Equatoria', abbr: 'WEQ' },
  { name: 'Central Equatoria', abbr: 'CEQ' },
  { name: 'Eastern Equatoria', abbr: 'EEQ' },
];

type MapLayer = 'alerts' | 'completeness' | 'immunization' | 'facilities';

const MAP_LAYERS: { key: MapLayer; label: string; legend: string }[] = [
  { key: 'alerts', label: 'Alert cases', legend: 'Active surveillance alert cases' },
  { key: 'completeness', label: 'Reporting', legend: 'Avg reporting completeness (facility assessments)' },
  { key: 'immunization', label: 'Immunization', legend: 'Immunization records on file' },
  { key: 'facilities', label: 'Facilities', legend: 'Registered facilities' },
];

function isoWeekLabel(iso: string): { label: string; sortKey: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { label: iso || '?', sortKey: iso || '' };
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  const month = target.toLocaleString('en', { month: 'short', timeZone: 'UTC' });
  return { label: `W${week} ${month}`, sortKey: target.toISOString().slice(0, 10) };
}

function monthLabel(iso: string): { label: string; sortKey: string } | null {
  if (!iso || iso.length < 7) return null;
  const key = iso.slice(0, 7);
  const d = new Date(`${key}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return { label: d.toLocaleString('en', { month: 'short', year: '2-digit', timeZone: 'UTC' }), sortKey: key };
}

// Threshold tone for percentage indicators (WHO DQR-style traffic light).
function pctTone(value: number, amberBelow: number, redBelow: number): string {
  if (value < redBelow) return RED;
  if (value < amberBelow) return AMBER;
  return GREEN;
}

// ── Real-geography "By state" map ────────────────────────────────────
// Same offline approach as the surveillance maps: geoBoundaries ADM1
// polygons projected with one aspect-preserving equirectangular transform.
const GOV_MAP_W = 600;
const GOV_MAP_H = 440;
const GOV_MAP_PAD = 12;

function govProject(lat: number, lng: number): { x: number; y: number } {
  const { minLng, maxLng, minLat, maxLat } = SOUTH_SUDAN_BBOX;
  const scale = Math.min(
    (GOV_MAP_W - 2 * GOV_MAP_PAD) / (maxLng - minLng),
    (GOV_MAP_H - 2 * GOV_MAP_PAD) / (maxLat - minLat),
  );
  const ox = (GOV_MAP_W - (maxLng - minLng) * scale) / 2;
  const oy = (GOV_MAP_H - (maxLat - minLat) * scale) / 2;
  return { x: ox + (lng - minLng) * scale, y: oy + (maxLat - lat) * scale };
}

function govRingPath(ring: Array<[number, number]>): string {
  return ring.map(([lng, lat], i) => {
    const p = govProject(lat, lng);
    return `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  }).join(' ') + ' Z';
}

function govCentroid(state: GeoState): { x: number; y: number } {
  const ring = state.rings.reduce((a, b) => (b.length > a.length ? b : a), state.rings[0]);
  return govProject(
    ring.reduce((s, p) => s + p[1], 0) / ring.length,
    ring.reduce((s, p) => s + p[0], 0) / ring.length,
  );
}

/* Magnitude layers shade from a near-white wash toward the layer's brand
   color (sqrt ramp keeps mid-range states readable); zero/no-data states get
   the neutral blue wash. */
function govHeatFill(value: number | null, max: number, hex: string): string {
  if (value === null || value <= 0 || max <= 0) return 'rgba(33, 145, 208, 0.06)';
  const t = Math.sqrt(value / max);
  const from = [247, 250, 252];
  const to = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  const c = from.map((f, i) => Math.round(f + (to[i] - f) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

// ── Small presentational pieces ──────────────────────────────────────

/* The design's panel head: an h6-style condensed title on the left, the
   period/geography note (and any controls) on the right, on a hairline. All
   geometry lives in .gov-panel-head (globals.css). */
function PanelHead({ title, meta, action }: { title: string; meta?: string; action?: React.ReactNode }) {
  return (
    <div className="gov-panel-head">
      <h3>{title}</h3>
      <div className="flex items-center gap-3">
        {meta && <span className="gov-meta">{meta}</span>}
        {action}
      </div>
    </div>
  );
}

/** One row of the design's ranked panel: label against a condensed value, on
 *  a 6px track filled to the value and coloured by the WHO threshold tone. */
function CoverageBar({ value, label, sub, color }: {
  value: number; label: string; sub?: string; color: string;
}) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className="gov-rank-row">
      <div className="gov-rank-line">
        <span className="truncate">
          {label}
          {sub && <small> · {sub}</small>}
        </span>
        <b style={{ color }}>{pct}%</b>
      </div>
      <div className="gov-rank-track">
        <div style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

// Per-disease line colors. Named diseases get a stable hue (CVD-validated
// against each other); anything else draws the next *unused* fallback so no
// two series ever share a color — cycling previously gave Kala-azar the same
// red as Malaria.
/**
 * Disease colour, from the shared entity map — the same malaria blue this
 * screen shows is the one /surveillance shows. They used to disagree on every
 * disease (malaria red here, blue there; cholera blue here, red there), which
 * made the colour meaningless the moment a reader moved between the two.
 * Entries the shared map does not know keep their own hues below.
 */
const DISEASE_COLORS: Record<string, string> = {
  ...DISEASE_COLOR,
  'hiv/aids': DISEASE_COLOR.hiv,
  measles_rubella: DISEASE_COLOR.measles,
  meningitis: 'var(--chart-3)',
};
/** Anything unnamed walks the categorical slots in fixed order — never a
 *  generated hue, and never a status colour. */
const DISEASE_FALLBACK = [...CHART_SERIES];

// Facility-type donut palette + labels (matches the hospital registry vocab).
// PHCU was slate (#64748B) — it read as gray and was near-indistinguishable
// from the referral blue; the warm orange step validates against every neighbor.
const FACILITY_TYPE_META: Record<string, { label: string; color: string }> = {
  national_referral: { label: 'National Referral', color: 'var(--chart-1)' },
  state_hospital: { label: 'State Hospital', color: 'var(--chart-3)' },
  county_hospital: { label: 'County Hospital', color: 'var(--color-success-text)' },
  phcc: { label: 'PHCC', color: 'var(--color-warning-text)' },
  phcu: { label: 'PHCU', color: '#CA4D1C' },
};

// Recharts <Legend> restyled to spec: identity comes from the colored dot,
// the text stays in neutral ink (series-colored legend text is illegible for
// light hues and reads loud).
const legendProps = {
  iconType: 'circle' as const,
  iconSize: 8,
  wrapperStyle: { fontSize: 11, paddingTop: 4 },
  formatter: (value: React.ReactNode) => <span style={{ color: 'var(--text-secondary)' }}>{value}</span>,
};

export default function GovernmentNationalDashboard() {
  const router = useRouter();
  const { alerts } = useSurveillance();
  const { hospitals } = useHospitals();
  const { births } = useBirths();
  const { deaths } = useDeaths();

  const [dq, setDq] = useState<NationalDataQuality | null>(null);
  const [imm, setImm] = useState<ImmunizationStats | null>(null);
  const [anc, setAnc] = useState<ANCStats | null>(null);
  const [layer, setLayer] = useState<MapLayer>('alerts');
  const [selectedState, setSelectedState] = useState<string | null>(null);
  // Which diseases the weekly-trend chart plots. `null` = all; once the
  // disease list is known, large lists are seeded down to the top 5 by volume.
  const [selectedDiseases, setSelectedDiseases] = useState<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [dqRes, immRes, ancRes] = await Promise.all([
        getNationalDataQuality().catch(() => null),
        getImmunizationStats().catch(() => null),
        getANCStats().catch(() => null),
      ]);
      if (cancelled) return;
      setDq(dqRes); setImm(immRes); setAnc(ancRes);
    })();
    return () => { cancelled = true; };
  }, []);

  const activeAlerts = useMemo(
    () => alerts.filter(a => a.alertLevel === 'watch' || a.alertLevel === 'warning' || a.alertLevel === 'emergency'),
    [alerts],
  );
  // ── Per-state aggregates for the map layers ──
  const stateAgg = useMemo(() => {
    const agg = new Map<string, { alertCases: number; facilities: number; immRecords: number; completenessSum: number; completenessN: number }>();
    const get = (s: string) => {
      const cur = agg.get(s) || { alertCases: 0, facilities: 0, immRecords: 0, completenessSum: 0, completenessN: 0 };
      agg.set(s, cur);
      return cur;
    };
    for (const a of alerts) { if (a.state) get(a.state).alertCases += a.cases || 0; }
    for (const h of hospitals) { if (h.state) get(h.state).facilities += 1; }
    for (const [state, count] of Object.entries(imm?.byState || {})) get(state).immRecords += count;
    for (const e of dq?.entries || []) {
      if (!e.state) continue;
      const cur = get(e.state);
      cur.completenessSum += e.reportingCompleteness;
      cur.completenessN += 1;
    }
    return agg;
  }, [alerts, hospitals, imm, dq]);

  const layerValue = (state: string): number | null => {
    const a = stateAgg.get(state);
    if (!a) return null;
    switch (layer) {
      case 'alerts': return a.alertCases;
      case 'facilities': return a.facilities;
      case 'immunization': return a.immRecords;
      case 'completeness': return a.completenessN > 0 ? Math.round(a.completenessSum / a.completenessN) : null;
    }
  };

  // Facility-type mix for the donut — real counts from the hospital registry.
  const facilityMix = useMemo(() => {
    const counts = new Map<string, number>();
    for (const h of hospitals) {
      const key = (h as { facilityType?: string }).facilityType || 'unknown';
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([key, value]) => ({
        key,
        value,
        label: FACILITY_TYPE_META[key]?.label || key,
        color: FACILITY_TYPE_META[key]?.color || 'var(--text-muted)',
      }))
      .sort((a, b) => b.value - a.value);
  }, [hospitals]);

  const isPercentLayer = layer === 'completeness';

  // Layer data — one entry per state, ranked (kept for max-value scaling on
  // the choropleth and any future ranked views). Null = no data on file.
  const barData = useMemo(() => {
    return STATE_TILES
      .map(s => ({ abbr: s.abbr, name: s.name, value: layerValue(s.name) }))
      .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateAgg, layer]);

  // ── Trends ──
  // The diseases actually present in the surveillance feed, ranked by total
  // cases so the selector lists the biggest contributors first.
  const diseaseList = useMemo(() => {
    const totals = new Map<string, number>();
    for (const a of alerts) {
      if (!a.disease) continue;
      totals.set(a.disease, (totals.get(a.disease) || 0) + (a.cases || 0));
    }
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }, [alerts]);

  // Color follows the disease, never its rank: named hues first, then the next
  // unused fallback, so a filter change never repaints surviving series and no
  // two diseases collide on one color.
  const diseaseColorMap = useMemo(() => {
    const used = new Set<string>();
    const map = new Map<string, string>();
    for (const d of diseaseList) {
      const named = DISEASE_COLORS[d.toLowerCase()];
      const color = named && !used.has(named) ? named : DISEASE_FALLBACK.find(c => !used.has(c)) || '#64748B';
      used.add(color);
      map.set(d, color);
    }
    return map;
  }, [diseaseList]);

  // Seed the trend chart with the top 5 diseases by volume — ten lines at once
  // is unreadable; the selector still exposes the full list.
  const seededTopDiseases = useRef(false);
  useEffect(() => {
    if (seededTopDiseases.current || diseaseList.length === 0) return;
    seededTopDiseases.current = true;
    if (diseaseList.length > 6) setSelectedDiseases(new Set(diseaseList.slice(0, 5)));
  }, [diseaseList]);

  // Weekly cases broken out per disease (last 12 reporting weeks) — one numeric
  // field per disease name so each renders as its own series.
  const weeklyByDisease = useMemo(() => {
    const byWeek = new Map<string, Record<string, number> & { week: string; sortKey: string }>();
    for (const a of alerts) {
      if (!a.reportDate || !a.disease) continue;
      const { label, sortKey } = isoWeekLabel(a.reportDate);
      const cur = byWeek.get(label) || { week: label, sortKey } as Record<string, number> & { week: string; sortKey: string };
      cur[a.disease] = (cur[a.disease] || 0) + (a.cases || 0);
      if (sortKey < cur.sortKey) cur.sortKey = sortKey;
      byWeek.set(label, cur);
    }
    return Array.from(byWeek.values()).sort((a, b) => a.sortKey.localeCompare(b.sortKey)).slice(-12);
  }, [alerts]);

  // Series to actually draw: the selected set, or all when nothing is chosen.
  const shownDiseases = useMemo(
    () => diseaseList.filter(d => selectedDiseases === null || selectedDiseases.has(d)),
    [diseaseList, selectedDiseases],
  );

  const toggleDisease = (name: string) => {
    setSelectedDiseases(prev => {
      const base = prev ?? new Set(diseaseList);
      const next = new Set(base);
      if (next.has(name)) next.delete(name); else next.add(name);
      // Back to "all selected" collapses to null (the all-on default).
      if (next.size === diseaseList.length) return null;
      // Never leave the chart empty — re-selecting the last one keeps it on.
      if (next.size === 0) return new Set([name]);
      return next;
    });
  };

  // Disease picker for the weekly-trend card header. Stays open while
  // toggling (multi-select); closes on outside click or Escape.
  const [diseaseMenuOpen, setDiseaseMenuOpen] = useState(false);
  const diseaseMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!diseaseMenuOpen) return;
    const onDown = (e: MouseEvent) => { if (diseaseMenuRef.current && !diseaseMenuRef.current.contains(e.target as Node)) setDiseaseMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDiseaseMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [diseaseMenuOpen]);

  const diseaseSelector = diseaseList.length > 0 ? (
    <div className="relative" ref={diseaseMenuRef}>
      <button
        type="button"
        onClick={() => setDiseaseMenuOpen(o => !o)}
        aria-expanded={diseaseMenuOpen}
        aria-haspopup="true"
        className="inline-flex items-center gap-1"
        style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          background: 'var(--overlay-subtle)',
          border: '1px solid var(--border-light)',
          borderRadius: 7,
          padding: '3px 8px',
          cursor: 'pointer',
          fontFamily: 'var(--font-platform)',
        }}
      >
        {selectedDiseases === null ? 'Diseases: All' : `Diseases: ${shownDiseases.length}/${diseaseList.length}`}
        <ChevronDown className="w-3 h-3" />
      </button>
      {diseaseMenuOpen && (
        <div
          className="absolute right-0 z-30 mt-1 py-1 rounded-lg overflow-y-auto"
          style={{ top: '100%', minWidth: 210, maxHeight: 260, background: 'var(--bg-card-solid)', border: '1px solid var(--border-light)', boxShadow: 'var(--card-shadow-lg)' }}
        >
          <button
            type="button"
            onClick={() => setSelectedDiseases(null)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--overlay-subtle)]"
            style={{ fontSize: 11, fontWeight: 700, color: selectedDiseases === null ? 'var(--accent-primary)' : 'var(--text-secondary)' }}
          >
            <span className="flex-1">All diseases</span>
            {selectedDiseases === null && <Check className="w-3 h-3 flex-shrink-0" />}
          </button>
          {diseaseList.map(d => {
            const on = selectedDiseases === null || selectedDiseases.has(d);
            const color = diseaseColorMap.get(d)!;
            return (
              <button
                key={d}
                type="button"
                onClick={() => toggleDisease(d)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--overlay-subtle)]"
                style={{ fontSize: 11, fontWeight: 600, color: on ? 'var(--text-primary)' : 'var(--text-muted)' }}
              >
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: on ? color : 'var(--border-medium)' }} />
                <span className="flex-1 truncate">{d}</span>
                {on && <Check className="w-3 h-3 flex-shrink-0" style={{ color }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  ) : null;

  const vitalMonthly = useMemo(() => {
    const byMonth = new Map<string, { births: number; deaths: number }>();
    const bump = (iso: string, key: 'births' | 'deaths') => {
      const m = monthLabel(iso);
      if (!m) return;
      const cur = byMonth.get(m.sortKey) || { births: 0, deaths: 0 };
      cur[key] += 1;
      byMonth.set(m.sortKey, cur);
    };
    for (const b of births) bump(b.dateOfBirth || b.createdAt, 'births');
    for (const d of deaths) bump(d.dateOfDeath || d.createdAt, 'deaths');
    if (byMonth.size === 0) return [];
    // Continuous 6-month axis ending at the latest registration month — months
    // with no events plot as zero instead of vanishing, so gaps stay honest.
    // Labels use “Jun ’26” (the bare "Jun 26" read as a day of the month).
    const latest = Array.from(byMonth.keys()).sort().pop()!;
    const [ly, lm] = latest.split('-').map(Number);
    const out: { month: string; births: number; deaths: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(ly, lm - 1 - i, 1);
      const sortKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const counts = byMonth.get(sortKey) || { births: 0, deaths: 0 };
      out.push({ month: `${d.toLocaleString('en', { month: 'short' })} ’${String(d.getFullYear()).slice(2)}`, ...counts });
    }
    return out;
  }, [births, deaths]);

  const now = new Date();
  const periodLabel = now.toLocaleString('en', { month: 'long', year: 'numeric' });


  const selected = selectedState ? stateAgg.get(selectedState) : null;

  return (
    <main className="page-container page-enter gov-dash">
      {/* ── Header: what/where/when — no decorative hero ── */}
      <div className="gov-page-head">
        <div>
          <h1>National Dashboard</h1>
          <p>South Sudan · National · {periodLabel} — computed live from facility-reported data</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" className="btn btn-secondary" onClick={() => router.push('/government/briefing')}>
            <FileText className="w-4 h-4" /> Executive briefing
          </button>
          <button type="button" className="btn btn-primary btn-alerts" onClick={() => router.push('/government/alerts')}>
            <Siren className="w-4 h-4" /> Priority alerts
          </button>
        </div>
      </div>

      {/* ── The design's 6-column panel grid: map 4/6, every chart 2/6 ── */}
      <div className="gov-grid">
        <section className="gov-panel gov-span-4">
          <PanelHead title="By state" meta="ranked · National" />
          <div className="gov-map-layers">
            {MAP_LAYERS.map(l => (
              <button
                key={l.key}
                type="button"
                onClick={() => setLayer(l.key)}
                className={layer === l.key ? 'is-active' : undefined}
              >
                {l.label}
              </button>
            ))}
          </div>
          <div className="gov-map-body">
            {/* Real South Sudan choropleth: each state polygon shaded by the
                active layer's value; click a state to drill down. The map
                fills the card, with the legend + drill-down on a side rail. */}
            {(() => {
              const byName = new Map(barData.map(b => [b.name, b] as const));
              const maxValue = Math.max(0, ...barData.map(b => b.value ?? 0));
              const layerHex = layer === 'alerts' ? LAYER_ALERTS
                : layer === 'immunization' ? LAYER_IMMUNIZATION : LAYER_DEEP;
              const layerMeta = MAP_LAYERS.find(l => l.key === layer);
              const fillFor = (value: number | null): string => {
                if (isPercentLayer) {
                  return value === null || value === 0 ? 'rgba(33, 145, 208, 0.06)' : pctTone(value, 80, 60);
                }
                return govHeatFill(value, maxValue, layerHex);
              };
              const formatValue = (value: number | null): string =>
                value === null || value === 0 ? '' : isPercentLayer ? `${value}%` : value.toLocaleString();
              return (
                <>
                  <div className="flex-1 min-w-0">
                    <svg viewBox={`0 0 ${GOV_MAP_W} ${GOV_MAP_H}`} style={{ display: 'block', width: '100%', height: 'auto' }}>
                      {SOUTH_SUDAN_STATES.map(s => {
                        const entry = byName.get(s.name);
                        const value = entry?.value ?? null;
                        const isSelected = selectedState === s.name;
                        return s.rings.map((ring, i) => (
                          <path
                            key={`${s.name}-${i}`}
                            d={govRingPath(ring)}
                            fill={fillFor(value)}
                            fillOpacity={isPercentLayer && value ? 0.55 : 1}
                            stroke={isSelected ? 'var(--brand-800)' : 'rgba(1, 86, 151, 0.25)'}
                            strokeWidth={isSelected ? 2.5 : 1}
                            strokeLinejoin="round"
                            style={{ cursor: 'pointer' }}
                            onClick={() => setSelectedState(cur => (cur === s.name ? null : s.name))}
                          >
                            <title>{`${s.name}: ${value === null ? 'No data' : isPercentLayer ? `${value}%` : value.toLocaleString()}`}</title>
                          </path>
                        ));
                      })}
                      {SOUTH_SUDAN_STATES.map(s => {
                        const c = govCentroid(s);
                        const value = byName.get(s.name)?.value ?? null;
                        const heavy = !isPercentLayer && maxValue > 0 && (value ?? 0) / maxValue > 0.55;
                        return (
                          <g key={s.name} pointerEvents="none">
                            <text x={c.x} y={c.y - 2} textAnchor="middle" fontSize="8.5" fontWeight="700"
                              fill={heavy ? '#fff' : 'var(--text-secondary)'}>
                              {s.name}
                            </text>
                            <text x={c.x} y={c.y + 9} textAnchor="middle" fontSize="9.5" fontWeight="800"
                              fill={heavy ? '#fff' : 'var(--brand-800)'} style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {formatValue(value)}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>

                  {/* Explanation rail: what the shading means + selected-state drill-down. */}
                  <div className="gov-map-rail">
                    <div className="gov-map-legend">
                      <p className="gov-legend-title">{layerMeta?.label} shading</p>
                      <p className="gov-legend-note">{layerMeta?.legend}.</p>
                      {isPercentLayer ? (
                        <div className="flex flex-col gap-1">
                          {[{ c: GREEN, t: '80%+ on target' }, { c: AMBER, t: '60–79% needs follow-up' }, { c: RED, t: 'Below 60% critical' }].map(row => (
                            <span key={row.t} className="flex items-center gap-1.5 text-[11px]">
                              <i className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: row.c, opacity: 0.75 }} />
                              {row.t}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px]">0</span>
                          {/* gov-scale-bar: opts out of the app-wide inline-gradient purge —
                              this gradient IS the legend. */}
                          <span aria-hidden="true" className="gov-scale-bar flex-1 rounded-full" style={{
                            height: 8,
                            background: `linear-gradient(90deg, rgb(247,250,252), ${layerHex})`,
                            border: '1px solid var(--ehr-border, #DDEAF3)',
                          }} />
                          <span className="text-[10px] tabular-nums">{maxValue.toLocaleString()}</span>
                        </div>
                      )}
                      <p className="gov-legend-foot">Neutral states have no data on file.</p>
                    </div>

                    {selected && selectedState ? (
                      <div className="gov-map-selected">
                        <b>{selectedState}</b>
                        <span>{selected.facilities} facilities</span>
                        <span style={{ color: selected.alertCases > 0 ? RED : 'inherit' }}>{selected.alertCases.toLocaleString()} alert cases</span>
                        <span>{selected.immRecords.toLocaleString()} immunization records</span>
                        <span>{selected.completenessN > 0 ? `${Math.round(selected.completenessSum / selected.completenessN)}% reporting completeness` : 'No assessment on file'}</span>
                        <button type="button" className="gov-open-link" onClick={() => router.push('/hospitals')}>
                          Open facilities <ChevronRight className="w-3 h-3 inline" />
                        </button>
                      </div>
                    ) : (
                      <div className="gov-map-hint">
                        Click a state on the map to see its facilities, alert cases, immunization records, and reporting completeness here.
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </section>

        {/* Weekly reported cases — the design's paired-bar panel; series stay
            per-disease with the entity-stable palette and the selector. */}
        <section className="gov-panel gov-span-2">
          <PanelHead title="Weekly reported cases" meta="Last 12 weeks · National" action={diseaseSelector} />
          <div className="gov-chart-body" style={{ height: 208 }}>
            {weeklyByDisease.length === 0 || diseaseList.length === 0 ? (
              <p className="text-[12px] p-6 text-center" style={{ color: 'var(--text-muted)' }}>No surveillance reports on file.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%" minHeight={0}>
                <BarChart data={weeklyByDisease} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke="var(--chart-grid, #E3EBF2)" vertical={false} />
                  <XAxis dataKey="week" tick={axisTick} tickLine={false} axisLine={false} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip {...tooltipStyle} cursor={{ fill: 'var(--overlay-subtle)' }} />
                  <Legend {...legendProps} />
                  {shownDiseases.map(d => (
                    <Bar key={d} dataKey={d} name={d} fill={diseaseColorMap.get(d)} radius={[2, 2, 0, 0]} maxBarSize={9} isAnimationActive={false} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {/* Facility-type mix — the design's 104px donut with a count legend. */}
        <section className="gov-panel gov-span-2">
          <PanelHead title="Facility types" meta={`${hospitals.length.toLocaleString()} registered`} />
          {facilityMix.length === 0 ? (
            <p className="text-[12px] p-6 text-center" style={{ color: 'var(--text-muted)' }}>No facilities on file.</p>
          ) : (
            <div className="gov-donut-body">
              <div className="gov-donut-ring">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={facilityMix} dataKey="value" nameKey="label" innerRadius={32} outerRadius={52} paddingAngle={0} stroke="none" isAnimationActive={false}>
                      {facilityMix.map(f => <Cell key={f.key} fill={f.color} />)}
                    </Pie>
                    <Tooltip {...tooltipStyle} formatter={(v: number | undefined, n) => [v ?? 0, String(n ?? '')]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="gov-donut-hole">
                  <b>{hospitals.length.toLocaleString()}</b>
                </div>
              </div>
              <div className="gov-donut-legend">
                {facilityMix.map(f => (
                  <div key={f.key}>
                    <span><i style={{ background: f.color }} />{f.label}</span>
                    <b>{f.value.toLocaleString()}</b>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Vital events per month — births vs deaths, the design's pair. */}
        <section className="gov-panel gov-span-2">
          <PanelHead title="Vital events per month" meta="Births vs deaths · last 6 months" action={
            <span className="flex items-center gap-2">
              <button type="button" className="gov-open-link" style={{ margin: 0 }} onClick={() => router.push('/births')}>Births</button>
              <button type="button" className="gov-open-link" style={{ margin: 0 }} onClick={() => router.push('/deaths')}>Deaths</button>
            </span>
          } />
          <div className="gov-chart-body" style={{ height: 208 }}>
            {vitalMonthly.length === 0 ? (
              <p className="text-[12px] p-6 text-center" style={{ color: 'var(--text-muted)' }}>No birth/death registrations on file.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%" minHeight={0}>
                <BarChart data={vitalMonthly} margin={{ top: 6, right: 8, left: -12, bottom: 0 }} barCategoryGap="24%">
                  <CartesianGrid stroke="var(--chart-grid, #E3EBF2)" vertical={false} />
                  <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={false} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip {...tooltipStyle} cursor={{ fill: 'var(--overlay-subtle)' }} />
                  <Legend {...legendProps} />
                  {/* The design's pair: brand ink for births, the warm counter
                      colour for deaths — the same two hues its bars use. */}
                  <Bar dataKey="births" name="Births" fill="#144972" radius={[2, 2, 0, 0]} maxBarSize={9} isAnimationActive={false} />
                  <Bar dataKey="deaths" name="Deaths" fill="#C2410C" radius={[2, 2, 0, 0]} maxBarSize={9} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {/* Programme coverage — the design's ranked panel. */}
        <section className="gov-panel gov-span-2">
          <PanelHead title="Programme coverage" meta="vs national target" action={
            <span className="flex items-center gap-2">
              <button type="button" className="gov-open-link" style={{ margin: 0 }} onClick={() => router.push('/immunizations')}>
                <Syringe className="w-3 h-3 inline" /> EPI
              </button>
              <button type="button" className="gov-open-link" style={{ margin: 0 }} onClick={() => router.push('/anc')}>
                <HeartPulse className="w-3 h-3 inline" /> ANC
              </button>
            </span>
          } />
          {/* Birth/death certification lives with the Vital events chart —
              only reporting + programme indicators here. */}
          <div className="gov-rank">
            <CoverageBar value={dq?.avgCompleteness ?? 0} label="Reporting" sub={`${dq?.facilitiesReporting ?? 0}/${dq?.totalFacilities ?? 0} facilities`} color={pctTone(dq?.avgCompleteness ?? 0, 80, 60)} />
            <CoverageBar value={dq?.avgTimeliness ?? 0} label="Timeliness" sub="latest assessments" color={pctTone(dq?.avgTimeliness ?? 0, 80, 60)} />
            <CoverageBar value={imm?.coverageRate ?? 0} label="Immunization" sub={`${imm?.totalChildren ?? 0} children`} color={pctTone(imm?.coverageRate ?? 0, 90, 60)} />
            <CoverageBar value={anc?.anc4PlusRate ?? 0} label="ANC 4+" sub={`${anc?.totalMothers ?? 0} mothers`} color={pctTone(anc?.anc4PlusRate ?? 0, 80, 50)} />
          </div>
          <p className="gov-rank-foot">
            Rates use facility-recorded denominators, not population estimates.
          </p>
        </section>
      </div>

    </main>
  );
}
