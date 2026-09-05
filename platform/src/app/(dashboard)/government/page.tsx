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

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Siren, FileText, ChevronRight, ChevronDown, Check, Globe,
} from '@/components/icons/lucide';
import EhrMissionCard from '@/components/ehr/EhrMissionCard';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useSurveillance } from '@/lib/hooks/useSurveillance';
import { getRoleConfig } from '@/lib/permissions';
import { abbreviateProviderName } from '@/lib/patient-utils';
import { useAuth } from '@/lib/context';
import { SOUTH_SUDAN_STATES } from '@/data/south-sudan-geo';
import { makeProjector } from '@/lib/maps/south-sudan-projection';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { getNationalDataQuality, type NationalDataQuality } from '@/lib/services/data-quality-service';
import { getImmunizationStats } from '@/lib/services/immunization-service';
import { isoWeek } from '@/lib/format-utils';
import { CHART_SERIES, CHART_SERIES_HEX, DISEASE_COLOR } from '@/lib/chart-colors';
import { toIsoDate } from '@/lib/date-utils';
import { ChartLoadingState } from '@/components/ChartCard';

// recharts (~80-100KB) is deferred behind dynamic boundaries so it's fetched
// only when a chart actually renders — same pattern as
// FacilityManagementDashboard/_FacilityCharts.
const FacilityTypeDonut = dynamic(
  () => import('./_GovernmentCharts').then(m => m.FacilityTypeDonut),
  { ssr: false, loading: () => <ChartLoadingState height={140} fill /> },
);
const WeeklyCasesChart = dynamic(
  () => import('./_GovernmentCharts').then(m => m.WeeklyCasesChart),
  { ssr: false, loading: () => <ChartLoadingState height={180} fill /> },
);

/* Two jobs, two forms — they were one set of constants doing both, which is
   how the map turned black.

   MAGNITUDE (the choropleth): `govHeatFill` interpolates a wash toward the
   layer colour using `parseInt(hex.slice(…))`, so these must be literal hex.
   They come from the chart scale, not from status. */
const LAYER_ALERTS = CHART_SERIES_HEX[4];   // orange
const LAYER_IMMUNIZATION = CHART_SERIES_HEX[5]; // green
const LAYER_DEEP = '#113055';               // brand-800, the reporting layer

/* STATUS (on target / follow-up / critical): handed straight to CSS, so these
   stay tokens and keep tracking the semantic scale. */
const GREEN = 'var(--color-success)';
const AMBER = 'var(--color-warning)';
const RED = 'var(--color-danger)';

type ImmunizationStats = Awaited<ReturnType<typeof getImmunizationStats>>;

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

// Chart-label wrapper around the shared ISO-week calculator: the week number
// comes from `isoWeek` (the same algorithm /surveillance uses), while the
// Thursday-of-week date it also needs stays local — it's only used here to
// format the display month and a chronological sort key, values `isoWeek`
// doesn't expose.
function isoWeekLabel(iso: string): { label: string; sortKey: string } {
  const d = new Date(iso);
  const w = isoWeek(iso);
  if (Number.isNaN(d.getTime()) || !w) return { label: iso || '?', sortKey: iso || '' };
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const month = target.toLocaleString('en', { month: 'short', timeZone: 'UTC' });
  return { label: `W${w.week} ${month}`, sortKey: toIsoDate(target) };
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

const governmentProjector = makeProjector(GOV_MAP_W, GOV_MAP_H, GOV_MAP_PAD);

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
// PHCU was slate (#5D728B) — it read as gray and was near-indistinguishable
// from the referral blue; the warm orange step validates against every neighbor.
const FACILITY_TYPE_META: Record<string, { label: string; color: string }> = {
  national_referral: { label: 'National Referral', color: 'var(--chart-1)' },
  state_hospital: { label: 'State Hospital', color: 'var(--chart-3)' },
  county_hospital: { label: 'County Hospital', color: 'var(--color-success-text)' },
  phcc: { label: 'PHCC', color: 'var(--color-warning-text)' },
  phcu: { label: 'PHCU', color: '#B35900' },
};

export default function GovernmentNationalDashboard() {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useAuth();
  const { alerts } = useSurveillance();
  const { hospitals } = useHospitals();

  const [dq, setDq] = useState<NationalDataQuality | null>(null);
  const [imm, setImm] = useState<ImmunizationStats | null>(null);
  const [layer, setLayer] = useState<MapLayer>('alerts');
  const [selectedState, setSelectedState] = useState<string | null>(null);
  // Which diseases the weekly-trend chart plots. `null` = all; once the
  // disease list is known, large lists are seeded down to the top 5 by volume.
  const [selectedDiseases, setSelectedDiseases] = useState<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [dqRes, immRes] = await Promise.all([
        getNationalDataQuality().catch(() => null),
        getImmunizationStats().catch(() => null),
      ]);
      if (cancelled) return;
      setDq(dqRes); setImm(immRes);
    })();
    return () => { cancelled = true; };
  }, []);

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
      const color = named && !used.has(named) ? named : DISEASE_FALLBACK.find(c => !used.has(c)) || '#5D728B';
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
    /* The trailing twelve weeks, zero-filled — not the twelve weeks that
       happen to carry a report.
       This used to bucket whatever arrived and keep the last twelve buckets,
       so a fortnight with nothing reported simply closed up: the axis still
       read as twelve consecutive weeks while the line ran straight across the
       blackout. In surveillance a silent week is the signal, and the panel
       says "Last 12 weeks", so the twelve are built first and the reports are
       dropped into them. */
    const today = new Date();
    const anchors = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - (11 - i) * 7);
      return isoWeekLabel(toIsoDate(d));
    });
    const byWeek = new Map<string, Record<string, number> & { week: string; sortKey: string }>(
      anchors.map(a => [a.label, { week: a.label, sortKey: a.sortKey } as Record<string, number> & { week: string; sortKey: string }]),
    );
    for (const a of alerts) {
      if (!a.reportDate || !a.disease) continue;
      const { label } = isoWeekLabel(a.reportDate);
      const cur = byWeek.get(label);
      // Older than the window — the panel is the last twelve weeks, not the
      // whole archive.
      if (!cur) continue;
      cur[a.disease] = (cur[a.disease] || 0) + (a.cases || 0);
    }
    return anchors.map(a => byWeek.get(a.label)!);
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
          className="absolute end-0 z-30 mt-1 py-1 rounded-lg overflow-y-auto"
          style={{ top: '100%', minWidth: 210, maxHeight: 260, background: 'var(--bg-card-solid)', border: '1px solid var(--border-light)', boxShadow: 'var(--card-shadow-lg)' }}
        >
          <button
            type="button"
            onClick={() => setSelectedDiseases(null)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-start hover:bg-[var(--overlay-subtle)]"
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
                className="w-full flex items-center gap-2 px-3 py-1.5 text-start hover:bg-[var(--overlay-subtle)]"
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

  const now = new Date();
  const periodLabel = now.toLocaleString('en', { month: 'long', year: 'numeric' });


  const selected = selectedState ? stateAgg.get(selectedState) : null;

  return (
    <main className="page-container page-enter gov-dash">
      {/* ── Header: what/where/when — no decorative hero ── */}
      <div className="gov-page-head">
        <div>
          {/* Who is looking, then what they are looking at as the role they
              hold — the shape every module header uses (see EhrListHeader).
              This console named neither, so the one screen that speaks for the
              whole country did not say whose session it was. */}
          <h1>
            {currentUser?.name
              ? `Welcome, ${abbreviateProviderName(currentUser.name)}`
              : 'National Dashboard'}
          </h1>
          {currentUser && (
            <p className="ehr-care-greeting-sub">
              {getRoleConfig(currentUser.role).label} · National dashboard
            </p>
          )}
          <p>South Sudan · National · {periodLabel} — computed live from facility-reported data</p>
        </div>
        {/* Actions on top, the role's mission card under them: the head is the
            only part of this viewport-fit page with room for the card, and
            it flexes to auto height so the grid below simply takes less. */}
        <div className="flex flex-col items-end gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" className="btn btn-secondary" onClick={() => router.push('/government/briefing')}>
            <FileText className="w-4 h-4" /> Executive briefing
          </button>
          <button type="button" className="btn btn-primary btn-alerts" onClick={() => router.push('/government/alerts')}>
            <Siren className="w-4 h-4" /> Priority alerts
          </button>
        </div>
        <EhrMissionCard
          className="gov-mission-card"
          title={t('mission.government.title')}
          description={t('mission.government.body')}
          icon={Globe}
        />
        </div>
      </div>

      {/* ── One viewport, no scrolling: the map fills the left 4/6 across
          both rows; the right 2/6 stacks Facility types over Weekly cases,
          the chart flexing to absorb the leftover height. ── */}
      <div className="gov-grid">
        <section className="gov-panel gov-span-4 gov-map-panel">
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
                  <div className="gov-map-canvas flex-1 min-w-0">
                    <svg viewBox={`0 0 ${GOV_MAP_W} ${GOV_MAP_H}`} style={{ display: 'block', width: '100%', height: 'auto' }}>
                      {SOUTH_SUDAN_STATES.map(s => {
                        const entry = byName.get(s.name);
                        const value = entry?.value ?? null;
                        const isSelected = selectedState === s.name;
                        return s.rings.map((ring, i) => (
                          <path
                            key={`${s.name}-${i}`}
                            d={governmentProjector.ringPath(ring)}
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
                        const c = governmentProjector.centroid(s);
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
                            background: `linear-gradient(90deg, rgb(245, 247, 248), ${layerHex})`,
                            border: '1px solid var(--ehr-border, #E2E6EB)',
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
                        <button type="button" className="gov-open-link" onClick={() => router.push('/manage')}>
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

        {/* Facility-type mix — the design's 104px donut with a count legend. */}
        <section className="gov-panel gov-span-2">
          <PanelHead title="Facility types" meta={`${hospitals.length.toLocaleString()} registered`} />
          {facilityMix.length === 0 ? (
            <p className="text-[12px] p-6 text-center" style={{ color: 'var(--text-muted)' }}>No facilities on file.</p>
          ) : (
            <div className="gov-donut-body">
              <div className="gov-donut-ring">
                <FacilityTypeDonut data={facilityMix} />
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

        {/* Weekly reported cases — the design's paired-bar panel; series stay
            per-disease with the entity-stable palette and the selector. */}
        <section className="gov-panel gov-span-2 gov-fill-panel">
          <PanelHead title="Weekly reported cases" meta="Last 12 weeks · National" action={diseaseSelector} />
          <div className="gov-chart-body gov-chart-fill" style={{ height: 208 }}>
            {weeklyByDisease.length === 0 || diseaseList.length === 0 ? (
              <p className="text-[12px] p-6 text-center" style={{ color: 'var(--text-muted)' }}>No surveillance reports on file.</p>
            ) : (
              <WeeklyCasesChart data={weeklyByDisease} diseases={shownDiseases} colorMap={diseaseColorMap} />
            )}
          </div>
        </section>

      </div>

    </main>
  );
}
