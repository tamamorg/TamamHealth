'use client';

import { useMemo, useState } from 'react';
import Modal from '@/components/Modal';
import EhrListHeader from '@/components/ehr/EhrListHeader';
import {
  AlertTriangle, Shield, TrendingUp, TrendingDown,
  Minus, MapPin, Activity, FileText, Calendar, ChevronRight,
  Download, Plus, X, BarChart3,
} from '@/components/icons/lucide';
import EmptyState from '@/components/EmptyState';
import Badge, { type BadgeTone } from '@/components/Badge';
import { formatDate } from '@/lib/format-utils';
// `states` is a static reference list (28 states/oblasts) used only to
// populate a dropdown. It contains no PHI, so importing from the mock
// module is fine. The disease aggregates that used to come from the same
// module have been replaced with values derived from the live alert feed.
import { states } from '@/data/mock';
import { SOUTH_SUDAN_STATES, SOUTH_SUDAN_BBOX, WHITE_NILE, type GeoState } from '@/data/south-sudan-geo';
import { useSurveillance } from '@/lib/hooks/useSurveillance';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { useAuth } from '@/lib/context';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, AreaChart, Area, Legend
} from 'recharts';
import ChartCard, { tooltipStyle as chartTooltipStyle, axisTick, AreaGradients } from '@/components/ChartCard';
import Select from '@/components/Select';

// Chart colors
const COLORS = {
  malaria: 'var(--accent-primary)',
  cholera: 'var(--color-danger)',
  measles: 'var(--color-warning)',
  pneumonia: 'var(--accent-primary)',
  diarrhea: 'var(--color-success)',
  tb: '#D4A843',
  hiv: 'var(--accent-primary)',
};

// Alert level ordering for severity sorting
const severityOrder: Record<string, number> = {
  emergency: 0,
  warning: 1,
  watch: 2,
  normal: 3,
};

// Alert level styling
const alertLevelConfig: Record<string, { bg: string; color: string; iconColor: string }> = {
  emergency: { bg: 'rgba(229,46,66,0.16)', color: 'var(--color-danger-text)', iconColor: 'var(--color-danger)' },
  warning: { bg: 'rgba(252,211,77,0.12)', color: '#FB923C', iconColor: 'var(--color-warning)' },
  watch: { bg: 'rgba(252,211,77,0.14)', color: 'var(--color-warning)', iconColor: 'var(--color-warning)' },
  normal: { bg: 'rgba(62,207,142,0.12)', color: 'var(--color-success)', iconColor: 'var(--color-success)' },
};

// Hospital map positions - rough placement on SVG to represent South Sudan geography
// Mapped from lat/lng to SVG coordinates within a 600x400 viewBox
/* Real-geography projection: uniform (aspect-preserving) equirectangular
   scale over the actual South Sudan bounding box, centred in the viewBox.
   Facility dots and the boundary polygons share this one transform, so the
   markers sit on the true map. */
const MAP_W = 600;
const MAP_H = 460;
const MAP_PAD = 14;

function latLngToSvg(lat: number, lng: number): { x: number; y: number } {
  const { minLng, maxLng, minLat, maxLat } = SOUTH_SUDAN_BBOX;
  const scale = Math.min(
    (MAP_W - 2 * MAP_PAD) / (maxLng - minLng),
    (MAP_H - 2 * MAP_PAD) / (maxLat - minLat),
  );
  const originX = (MAP_W - (maxLng - minLng) * scale) / 2;
  const originY = (MAP_H - (maxLat - minLat) * scale) / 2;
  return {
    x: originX + (lng - minLng) * scale,
    y: originY + (maxLat - lat) * scale,
  };
}

function geoRingPath(ring: Array<[number, number]>, close = true): string {
  const d = ring
    .map(([lng, lat], i) => {
      const p = latLngToSvg(lat, lng);
      return `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    })
    .join(' ');
  return close ? `${d} Z` : d;
}

/* Sequential fill for the cases-by-state choropleth: zero-case states keep a
   neutral wash; reported burden ramps warm sand → deep red. */
function choroplethFill(total: number, max: number): string {
  if (total <= 0 || max <= 0) return 'rgba(33, 145, 208, 0.06)';
  const t = Math.sqrt(total / max); // sqrt so mid-range states stay readable
  const from = [249, 231, 205];
  const to = [194, 65, 53];
  const c = from.map((f, i) => Math.round(f + (to[i] - f) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function geoCentroid(state: GeoState): { x: number; y: number } {
  // Label anchor: mean of the largest ring's vertices — good enough at this scale.
  const ring = state.rings.reduce((a, b) => (b.length > a.length ? b : a), state.rings[0]);
  const lng = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  return latLngToSvg(lat, lng);
}


// Alert level → semantic Badge tone (emergency→danger, warning/watch→warning,
// normal→success).
const alertLevelTone: Record<string, BadgeTone> = {
  emergency: 'danger',
  warning: 'warning',
  watch: 'warning',
  normal: 'success',
};

const alertDotColors: Record<string, string> = {
  emergency: 'var(--color-danger)',
  warning: 'var(--color-warning)',
  watch: 'var(--color-warning)',
  normal: 'var(--color-success)',
};

// IDSR Weekly Report Summary
//
// We aggregate live disease_alert documents by disease, splitting by ISO
// week so we can show "this week vs previous week" deltas plus a case
// fatality rate (CFR). The legacy hard-coded numbers were highly
// suggestive of a real outbreak picture and would be reported to MOH —
// computing from real PouchDB content avoids that.
type IDSRRow = { disease: string; casesThisWeek: number; casesPrevWeek: number; deaths: number; cfrPercent: number };

function isoWeek(iso: string): { year: number; week: number } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return { year: target.getUTCFullYear(), week };
}

function buildIDSRSummary(alerts: Array<{ disease: string; cases: number; deaths: number; reportDate: string }>): IDSRRow[] {
  // Latest week present in the data is "this week"; the one before is "prev week".
  const weeks = new Set<string>();
  for (const a of alerts) {
    const w = isoWeek(a.reportDate);
    if (w) weeks.add(`${w.year}-${String(w.week).padStart(2, '0')}`);
  }
  const sortedWeeks = Array.from(weeks).sort();
  if (sortedWeeks.length === 0) return [];
  const thisWeek = sortedWeeks[sortedWeeks.length - 1];
  const prevWeek = sortedWeeks.length > 1 ? sortedWeeks[sortedWeeks.length - 2] : '';

  const byDisease = new Map<string, { thisWeek: number; prevWeek: number; deaths: number }>();
  for (const a of alerts) {
    const w = isoWeek(a.reportDate);
    if (!w) continue;
    const wk = `${w.year}-${String(w.week).padStart(2, '0')}`;
    const row = byDisease.get(a.disease) ?? { thisWeek: 0, prevWeek: 0, deaths: 0 };
    if (wk === thisWeek) {
      row.thisWeek += a.cases || 0;
      row.deaths += a.deaths || 0;
    } else if (wk === prevWeek) {
      row.prevWeek += a.cases || 0;
    }
    byDisease.set(a.disease, row);
  }
  return Array.from(byDisease.entries())
    .filter(([, v]) => v.thisWeek > 0 || v.prevWeek > 0)
    .map(([disease, v]) => ({
      disease,
      casesThisWeek: v.thisWeek,
      casesPrevWeek: v.prevWeek,
      deaths: v.deaths,
      cfrPercent: v.thisWeek > 0 ? Number(((v.deaths / v.thisWeek) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.casesThisWeek - a.casesThisWeek);
}

// Disease key map for chart aggregation (same keys as the chart components)
const DISEASE_CHART_KEYS = ['malaria', 'cholera', 'measles', 'pneumonia', 'diarrhea'] as const;
const STATE_DISEASE_KEYS = ['malaria', 'cholera', 'measles', 'tb', 'hiv'] as const;
const NAME_TO_KEY: Record<string, string> = {
  malaria: 'malaria',
  cholera: 'cholera',
  measles: 'measles',
  pneumonia: 'pneumonia',
  diarrhea: 'diarrhea',
  'acute watery diarrhea': 'diarrhea',
  awd: 'diarrhea',
  tuberculosis: 'tb',
  tb: 'tb',
  hiv: 'hiv',
  'hiv/aids': 'hiv',
};

// Custom tooltip for charts
function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload) return null;
  return (
    <div className="card-elevated p-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', fontSize: '0.8rem' }}>
      <p className="font-semibold mb-1.5" style={{ color: 'var(--text-primary)' }}>{label}</p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: entry.color }} />
          <span style={{ color: 'var(--text-secondary)' }}>{entry.name}:</span>
          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{entry.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

const REPORTABLE_DISEASES = [
  'Malaria', 'Cholera', 'Measles', 'Meningitis', 'Pneumonia', 'Tuberculosis',
  'HIV/AIDS', 'Hepatitis E', 'Kala-azar', 'Yellow Fever', 'Ebola', 'Lassa Fever',
  'Acute Watery Diarrhea', 'Polio (AFP)', 'Neonatal Tetanus', 'Rabies',
  'Typhoid Fever', 'COVID-19', 'Dengue', 'Anthrax',
];

export default function SurveillancePage() {
  const { t } = useTranslation();
  const [hoveredHospital, setHoveredHospital] = useState<string | null>(null);
  const [showNewAlert, setShowNewAlert] = useState(false);
  const [alertForm, setAlertForm] = useState({
    disease: '',
    state: '',
    county: '',
    cases: 0,
    deaths: 0,
    alertLevel: 'watch' as 'normal' | 'watch' | 'warning' | 'emergency',
    trend: 'increasing' as 'increasing' | 'stable' | 'decreasing',
  });
  const [alertSubmitting, setAlertSubmitting] = useState(false);

  const { currentUser } = useAuth();
  const { canRecordVitalEvents, isGovernment, isSuperAdmin } = usePermissions();
  const canReportAlert = canRecordVitalEvents || isGovernment || isSuperAdmin;
  const { showToast } = useToast();
  const { alerts: diseaseAlerts, create: createAlert } = useSurveillance();
  const { hospitals } = useHospitals();

  const handleCreateAlert = async () => {
    if (!alertForm.disease || !alertForm.state || alertForm.cases <= 0) {
      showToast(t('surveillance.validationRequired'), 'error');
      return;
    }
    try {
      setAlertSubmitting(true);
      await createAlert({
        disease: alertForm.disease,
        state: alertForm.state,
        county: alertForm.county || 'Unknown',
        cases: alertForm.cases,
        deaths: alertForm.deaths,
        alertLevel: alertForm.alertLevel,
        reportDate: new Date().toISOString().slice(0, 10),
        trend: alertForm.trend,
        orgId: currentUser?.orgId,
      });
      const { logAudit } = await import('@/lib/services/audit-service');
      await logAudit('DISEASE_ALERT_REPORTED', currentUser?._id, currentUser?.username,
        `${alertForm.alertLevel.toUpperCase()}: ${alertForm.disease} in ${alertForm.state} — ${alertForm.cases} cases, ${alertForm.deaths} deaths`
      ).catch(() => {});
      showToast(t('surveillance.alertReported'), 'success');
      setShowNewAlert(false);
      setAlertForm({ disease: '', state: '', county: '', cases: 0, deaths: 0, alertLevel: 'watch', trend: 'increasing' });
    } catch (err) {
      console.error(err);
      showToast(t('surveillance.alertFailed'), 'error');
    } finally {
      setAlertSubmitting(false);
    }
  };

  function getHospitalAlertLevel(hospitalState: string): string {
    const stateAlerts = (diseaseAlerts || []).filter(a => a.state === hospitalState);
    if (stateAlerts.some(a => a.alertLevel === 'emergency')) return 'emergency';
    if (stateAlerts.some(a => a.alertLevel === 'warning')) return 'warning';
    if (stateAlerts.some(a => a.alertLevel === 'watch')) return 'watch';
    return 'normal';
  }

  const filteredAlerts = [...(diseaseAlerts || [])].sort((a, b) => (severityOrder[a.alertLevel] ?? 3) - (severityOrder[b.alertLevel] ?? 3));

  const totalAlerts = (diseaseAlerts || []).length;
  const emergencies = (diseaseAlerts || []).filter(a => a.alertLevel === 'emergency').length;
  const warnings = (diseaseAlerts || []).filter(a => a.alertLevel === 'warning').length;
  const watchItems = (diseaseAlerts || []).filter(a => a.alertLevel === 'watch').length;
  const totalCases = (diseaseAlerts || []).reduce((sum, a) => sum + (a.cases || 0), 0);
  const totalDeaths = (diseaseAlerts || []).reduce((sum, a) => sum + (a.deaths || 0), 0);

  // ── Aggregations derived from the live alert feed (replaces the
  // previous hard-coded weeklyDiseaseData / casesByState / idsrSummary).
  const idsrSummary = useMemo(() => buildIDSRSummary(diseaseAlerts || []), [diseaseAlerts]);

  const weeklyDiseaseData = useMemo(() => {
    const byWeek = new Map<string, Record<string, number | string> & { _sortKey: string }>();
    for (const a of diseaseAlerts || []) {
      const key = NAME_TO_KEY[(a.disease || '').toLowerCase()];
      if (!key || !DISEASE_CHART_KEYS.includes(key as typeof DISEASE_CHART_KEYS[number])) continue;
      if (!a.reportDate) continue;
      const d = new Date(a.reportDate);
      if (Number.isNaN(d.getTime())) continue;
      const w = isoWeek(a.reportDate);
      if (!w) continue;
      const label = `W${w.week} ${d.toLocaleString('en', { month: 'short' })}`;
      const sortKey = a.reportDate.slice(0, 10);
      const existing = byWeek.get(label) ?? {
        week: label, malaria: 0, cholera: 0, measles: 0, pneumonia: 0, diarrhea: 0, _sortKey: sortKey,
      };
      existing[key] = ((existing[key] as number) || 0) + (a.cases || 0);
      if (sortKey < existing._sortKey) existing._sortKey = sortKey;
      byWeek.set(label, existing);
    }
    return Array.from(byWeek.values())
      .sort((a, b) => String(a._sortKey).localeCompare(String(b._sortKey)))
      .map(row => {
        const { _sortKey: _drop, ...rest } = row;
        void _drop;
        return rest;
      });
  }, [diseaseAlerts]);

  const casesByState = useMemo(() => {
    const byState = new Map<string, Record<string, number | string>>();
    for (const a of diseaseAlerts || []) {
      if (!a.state) continue;
      const key = NAME_TO_KEY[(a.disease || '').toLowerCase()];
      if (!key || !STATE_DISEASE_KEYS.includes(key as typeof STATE_DISEASE_KEYS[number])) continue;
      const existing = byState.get(a.state) ?? {
        state: a.state, malaria: 0, cholera: 0, measles: 0, tb: 0, hiv: 0,
      };
      existing[key] = ((existing[key] as number) || 0) + (a.cases || 0);
      byState.set(a.state, existing);
    }
    return Array.from(byState.values()).sort((a, b) => (b.malaria as number) - (a.malaria as number));
  }, [diseaseAlerts]);

  // Choropleth input: total reported cases per state (all diseases summed),
  // keyed by the geoBoundaries state name so polygons and data join directly.
  const caseTotalsByState = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of casesByState) {
      const total = STATE_DISEASE_KEYS.reduce((s, k) => s + ((row[k] as number) || 0), 0);
      totals.set(String(row.state), total);
    }
    const max = Math.max(0, ...totals.values());
    return { totals, max };
  }, [casesByState]);

  // Cholera CFR: deaths / cases × 100, taken from the live alert set.
  const choleraCFR = useMemo(() => {
    const cholera = (diseaseAlerts || []).filter(a => /cholera/i.test(a.disease || ''));
    const cases = cholera.reduce((s, a) => s + (a.cases || 0), 0);
    const deaths = cholera.reduce((s, a) => s + (a.deaths || 0), 0);
    return cases > 0 ? Number(((deaths / cases) * 100).toFixed(1)) : 0;
  }, [diseaseAlerts]);

  // ISO-week label of the most recent alert (e.g. "W6 2026 (Feb 3-9)").
  const reportingWeek = useMemo(() => {
    const dated = (diseaseAlerts || [])
      .map(a => a.reportDate)
      .filter((d): d is string => Boolean(d))
      .sort();
    const latest = dated.length > 0 ? dated[dated.length - 1] : new Date().toISOString().slice(0, 10);
    const w = isoWeek(latest);
    if (!w) return t('surveillance.currentWeek');
    const monday = (() => {
      const d = new Date(latest);
      const day = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() - day);
      return d;
    })();
    const sunday = new Date(monday);
    sunday.setUTCDate(sunday.getUTCDate() + 6);
    const fmt = (dt: Date) => `${dt.toLocaleString('en', { month: 'short' })} ${dt.getUTCDate()}`;
    return `W${w.week} ${w.year} (${fmt(monday)}-${fmt(sunday)})`;
  }, [diseaseAlerts]);

  /**
   * Export the current IDSR report as a JSON blob the user can download.
   * This replaces the previous inert "Export Report" button. We include
   * the alert list, aggregated disease totals, and the reporting week so
   * MOH officers have an offline artifact they can archive.
   */
  const handleExport = () => {
    const payload = {
      reportingWeek,
      generatedAt: new Date().toISOString(),
      totals: { alerts: totalAlerts, emergencies, warnings, watch: watchItems, cases: totalCases, deaths: totalDeaths },
      alerts: diseaseAlerts || [],
      idsrSummary,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `surveillance-report-${reportingWeek.replace(/[ ()]/g, '_')}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <main className="page-container page-enter">

          <div className="dash-card mb-4">
            <EhrListHeader
              title={t('nav.surveillance')}
              actions={
                <>
                  {canReportAlert && (
                    <button className="btn btn-primary btn-sm" onClick={() => setShowNewAlert(true)}>
                      <Plus className="w-4 h-4" />
                      {t('surveillance.reportAlert')}
                    </button>
                  )}
                  <button className="btn btn-secondary btn-sm" onClick={handleExport}>
                    <Download className="w-4 h-4" />
                    {t('surveillance.exportReport')}
                  </button>
                </>
              }
            />
          </div>

          {/* Aggregate summary strip */}
          <div className="card-elevated p-4 mb-6 flex items-center justify-between">
            <div className="flex items-center gap-8">
              <div className="flex items-center gap-2">
                <div className="icon-box-sm">
                  <Activity className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
                </div>
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('surveillance.totalCasesThisWeek')}</span>
                <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{totalCases.toLocaleString()}</span>
              </div>
              <div className="w-px h-5" style={{ background: 'var(--border-light)' }} />
              <div className="flex items-center gap-2">
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('surveillance.totalDeaths')}</span>
                <span className="text-sm font-bold" style={{ color: 'var(--tamamhealth-red)' }}>{totalDeaths}</span>
              </div>
              <div className="w-px h-5" style={{ background: 'var(--border-light)' }} />
              <div className="flex items-center gap-2">
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('surveillance.reportingFacilities')}</span>
                <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                  {(() => {
                    const reporting = new Set(
                      (diseaseAlerts || [])
                        .map(a => (a as { hospitalId?: string; reportedBy?: string }).hospitalId || (a as { reportedBy?: string }).reportedBy)
                        .filter(Boolean)
                    ).size;
                    return `${reporting}/${hospitals.length || 0}`;
                  })()}
                </span>
              </div>
              <div className="w-px h-5" style={{ background: 'var(--border-light)' }} />
              <div className="flex items-center gap-2">
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('surveillance.cfrCholera')}</span>
                <span className="text-sm font-bold" style={{ color: 'var(--tamamhealth-red)' }}>{choleraCFR}%</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('surveillance.updated', { date: formatDate(new Date().toISOString()) })}</span>
            </div>
          </div>

          {/* Main Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Left Column - 2/3 width */}
            <div className="lg:col-span-2 space-y-4">

              {/* Map Placeholder */}
              <div className="card-elevated">
                <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                  <h3 className="font-semibold text-sm flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <MapPin className="w-4 h-4" style={{ color: 'var(--tamamhealth-blue)' }} />
                    {t('surveillance.hospitalNetworkTitle')}
                  </h3>
                  <div className="flex items-center gap-4">
                    {['emergency', 'warning', 'watch', 'normal'].map(level => (
                      <div key={level} className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: alertDotColors[level] }} />
                        <span className="text-[11px] capitalize" style={{ color: 'var(--text-muted)' }}>{level}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="p-4">
                  <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="w-full" style={{ maxHeight: '400px' }}>
                    <defs>
                      {/* Heat blobs blur into a continuous intensity surface. */}
                      <filter id="ssd-heat-blur" x="-60%" y="-60%" width="220%" height="220%">
                        <feGaussianBlur stdDeviation="13" />
                      </filter>
                      {/* Keep the heat inside the national boundary. */}
                      <clipPath id="ssd-country-clip">
                        {SOUTH_SUDAN_STATES.map(s => s.rings.map((ring, i) => (
                          <path key={`${s.name}-${i}`} d={geoRingPath(ring)} />
                        )))}
                      </clipPath>
                    </defs>

                    {/* Real geography: geoBoundaries SSD ADM1, one polygon per state. */}
                    <g>
                      {SOUTH_SUDAN_STATES.map(s => s.rings.map((ring, i) => (
                        <path
                          key={`${s.name}-${i}`}
                          d={geoRingPath(ring)}
                          fill="rgba(33, 145, 208, 0.09)"
                          stroke="rgba(1, 86, 151, 0.22)"
                          strokeWidth="1"
                          strokeLinejoin="round"
                        />
                      )))}
                    </g>

                    {/* State labels at polygon centroids. */}
                    {SOUTH_SUDAN_STATES.map(s => {
                      const c = geoCentroid(s);
                      return (
                        <text key={s.name} x={c.x} y={c.y} textAnchor="middle" fontSize="8"
                          fill="var(--text-muted)" opacity="0.65" fontFamily="'DM Sans', sans-serif">
                          {s.name}
                        </text>
                      );
                    })}

                    {/* White Nile / Bahr el Jebel along its real course. */}
                    <path d={geoRingPath(WHITE_NILE, false)}
                      fill="none" stroke="rgba(33, 145, 208, 0.38)" strokeWidth="2" strokeLinecap="round" />
                    <text x={latLngToSvg(7.5, 31.1).x + 8} y={latLngToSvg(7.5, 31.1).y} fontSize="9"
                      fill="rgba(1, 86, 151, 0.45)" fontStyle="italic">
                      White Nile
                    </text>

                    {/* Heat layer: blurred alert-coloured intensity under the dots,
                        clipped to the border so it reads as a heat map of the country. */}
                    <g filter="url(#ssd-heat-blur)" clipPath="url(#ssd-country-clip)" opacity="0.4">
                      {hospitals.map(h => {
                        // Facilities without coordinates (possible on
                        // hand-created records) can't be placed on the map.
                        if (!Number.isFinite(h.lat) || !Number.isFinite(h.lng)) return null;
                        const pos = latLngToSvg(h.lat, h.lng);
                        const level = getHospitalAlertLevel(h.state);
                        const r = level === 'emergency' ? 40 : level === 'warning' ? 30 : level === 'watch' ? 22 : 16;
                        return <circle key={`heat-${h._id}`} cx={pos.x} cy={pos.y} r={r} fill={alertDotColors[level]} />;
                      })}
                    </g>

                    {/* Hospital dots */}
                    {hospitals.map(h => {
                      if (!Number.isFinite(h.lat) || !Number.isFinite(h.lng)) return null;
                      const pos = latLngToSvg(h.lat, h.lng);
                      const alertLevel = getHospitalAlertLevel(h.state);
                      const dotColor = alertDotColors[alertLevel];
                      const isHovered = hoveredHospital === h._id;
                      const radius = h.facilityType === 'national_referral' ? 10 : 7;

                      return (
                        <g key={h._id}
                          onMouseEnter={() => setHoveredHospital(h._id)}
                          onMouseLeave={() => setHoveredHospital(null)}
                          style={{ cursor: 'pointer' }}>
                          {/* Pulse ring for emergencies */}
                          {alertLevel === 'emergency' && (
                            <circle cx={pos.x} cy={pos.y} r={radius + 6} fill="none"
                              stroke={dotColor} strokeWidth="1.5" opacity="0.3">
                              <animate attributeName="r" from={String(radius + 2)} to={String(radius + 10)} dur="1.5s" repeatCount="indefinite" />
                              <animate attributeName="opacity" from="0.4" to="0" dur="1.5s" repeatCount="indefinite" />
                            </circle>
                          )}

                          {/* Shadow */}
                          <circle cx={pos.x} cy={pos.y + 1} r={radius} fill="rgba(0,0,0,0.1)" />

                          {/* Main dot */}
                          <circle cx={pos.x} cy={pos.y} r={isHovered ? radius + 2 : radius}
                            fill={dotColor} stroke="#0F1A2E" strokeWidth="2.5"
                            style={{ transition: 'r 0.15s ease' }} />

                          {/* National referral indicator */}
                          {h.facilityType === 'national_referral' && (
                            <text x={pos.x} y={pos.y + 3.5} textAnchor="middle" fontSize="9"
                              fill="white" fontWeight="700">+</text>
                          )}

                          {/* Hover tooltip */}
                          {isHovered && (
                            <g>
                              <rect x={pos.x - 80} y={pos.y - 58} width="160" height="48"
                                rx="6" ry="6" fill="#0F1A2E" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
                              <polygon
                                points={`${pos.x - 5},${pos.y - 10} ${pos.x + 5},${pos.y - 10} ${pos.x},${pos.y - 3}`}
                                fill="#0F1A2E" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
                              <rect x={pos.x - 80} y={pos.y - 58} width="160" height="48"
                                rx="6" ry="6" fill="#0F1A2E" />
                              <text x={pos.x} y={pos.y - 40} textAnchor="middle" fontSize="10.5"
                                fontWeight="600" fill="#D4CFC5">{h.name}</text>
                              <text x={pos.x} y={pos.y - 27} textAnchor="middle" fontSize="9"
                                fill="#8A9E9A">{h.state}</text>
                              <text x={pos.x} y={pos.y - 15} textAnchor="middle" fontSize="9"
                                fill={dotColor} fontWeight="500">
                                {alertLevel.toUpperCase()} -- {h.patientCount.toLocaleString()} patients
                              </text>
                            </g>
                          )}
                        </g>
                      );
                    })}
                  </svg>
                </div>
              </div>

              {/* Weekly Disease Trends */}
              <ChartCard
                title={t('surveillance.weeklyTrendsTitle')}
                subtitle={t('surveillance.sourceIdsrReports')}
                defaultType="line"
                defaultPeriod="month"
              >
                {({ chartType, period }) => {
                  const sliced = period === 'week' ? weeklyDiseaseData.slice(-7)
                    : period === 'quarter' ? weeklyDiseaseData
                    : weeklyDiseaseData.slice(-30);
                  const data = sliced.length > 0 ? sliced : weeklyDiseaseData;
                  if (data.length === 0) {
                    return (
                      <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <EmptyState icon={TrendingUp} title="No data yet" message="No weekly disease trends for this period." />
                      </div>
                    );
                  }
                  const diseaseLines = [
                    { key: 'malaria', name: t('surveillance.diseaseMalaria'), color: COLORS.malaria },
                    { key: 'cholera', name: t('surveillance.diseaseCholera'), color: COLORS.cholera },
                    { key: 'measles', name: t('surveillance.diseaseMeasles'), color: COLORS.measles },
                    { key: 'pneumonia', name: t('surveillance.diseasePneumonia'), color: COLORS.pneumonia },
                    { key: 'diarrhea', name: t('surveillance.diseaseDiarrhea'), color: COLORS.diarrhea },
                  ];
                  const commonProps = { data, margin: { top: 10, right: 20, left: 0, bottom: 5 } };
                  const legendProps = { iconType: 'circle' as const, iconSize: 8, wrapperStyle: { fontSize: '0.75rem', paddingTop: '8px' } };
                  if (chartType === 'area') {
                    return (
                      <ResponsiveContainer width="100%" height={300}>
                        <AreaChart {...commonProps}>
                          <AreaGradients />
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
                          <XAxis dataKey="week" tick={axisTick} axisLine={{ stroke: 'var(--border-light)' }} tickLine={false} />
                          <YAxis tick={axisTick} axisLine={{ stroke: 'var(--border-light)' }} tickLine={false} />
                          <Tooltip {...chartTooltipStyle} />
                          <Legend {...legendProps} />
                          {diseaseLines.map(d => <Area key={d.key} type="natural" dataKey={d.key} name={d.name} stroke={d.color} fill={d.color} fillOpacity={0.12} strokeWidth={2} />)}
                        </AreaChart>
                      </ResponsiveContainer>
                    );
                  }
                  if (chartType === 'bar') {
                    return (
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart {...commonProps}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
                          <XAxis dataKey="week" tick={axisTick} axisLine={{ stroke: 'var(--border-light)' }} tickLine={false} />
                          <YAxis tick={axisTick} axisLine={{ stroke: 'var(--border-light)' }} tickLine={false} />
                          <Tooltip {...chartTooltipStyle} />
                          <Legend {...{ ...legendProps, iconType: 'square' as const }} />
                          {diseaseLines.map(d => <Bar key={d.key} dataKey={d.key} name={d.name} fill={d.color} radius={[2, 2, 0, 0]} />)}
                        </BarChart>
                      </ResponsiveContainer>
                    );
                  }
                  return (
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart {...commonProps}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
                        <XAxis dataKey="week" tick={axisTick} axisLine={{ stroke: 'var(--border-light)' }} tickLine={false} />
                        <YAxis tick={axisTick} axisLine={{ stroke: 'var(--border-light)' }} tickLine={false} />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend {...legendProps} />
                        {diseaseLines.map(d => <Line key={d.key} type="natural" dataKey={d.key} name={d.name} stroke={d.color} strokeWidth={d.key === 'malaria' ? 2.5 : 2} dot={{ r: 3, fill: d.color }} activeDot={{ r: 5 }} />)}
                      </LineChart>
                    </ResponsiveContainer>
                  );
                }}
              </ChartCard>

              {/* Cases by State — choropleth on the real South Sudan map.
                  Each state polygon is shaded by its total reported cases
                  (same alert data that fed the old bar chart). */}
              <div className="card-elevated">
                <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                  <h3 className="font-semibold text-sm flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <MapPin className="w-4 h-4" style={{ color: 'var(--tamamhealth-blue)' }} />
                    {t('surveillance.casesByStateTitle')}
                  </h3>
                  {caseTotalsByState.max > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>0</span>
                      <span aria-hidden="true" style={{
                        width: 96, height: 8, borderRadius: 999,
                        background: 'linear-gradient(90deg, #EEF4F6, #F3C489, var(--color-danger))',
                        border: '1px solid var(--border-light)',
                      }} />
                      <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        {caseTotalsByState.max.toLocaleString()} cases
                      </span>
                    </div>
                  )}
                </div>
                <div className="p-4">
                  {caseTotalsByState.max === 0 ? (
                    <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <EmptyState icon={BarChart3} title="No data yet" message="No cases reported by state." />
                    </div>
                  ) : (
                    <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="w-full" style={{ maxHeight: '400px' }}>
                      {SOUTH_SUDAN_STATES.map(s => {
                        const total = caseTotalsByState.totals.get(s.name) || 0;
                        return s.rings.map((ring, i) => (
                          <path
                            key={`${s.name}-${i}`}
                            d={geoRingPath(ring)}
                            fill={choroplethFill(total, caseTotalsByState.max)}
                            stroke="rgba(1, 86, 151, 0.25)"
                            strokeWidth="1"
                            strokeLinejoin="round"
                          >
                            <title>{`${s.name}: ${total.toLocaleString()} reported cases`}</title>
                          </path>
                        ));
                      })}
                      {SOUTH_SUDAN_STATES.map(s => {
                        const c = geoCentroid(s);
                        const total = caseTotalsByState.totals.get(s.name) || 0;
                        const heavy = caseTotalsByState.max > 0 && total / caseTotalsByState.max > 0.55;
                        return (
                          <g key={s.name} pointerEvents="none">
                            <text x={c.x} y={c.y - 3} textAnchor="middle" fontSize="8.5" fontWeight="700"
                              fill={heavy ? '#fff' : 'var(--text-secondary)'} fontFamily="'DM Sans', sans-serif">
                              {s.name}
                            </text>
                            <text x={c.x} y={c.y + 8} textAnchor="middle" fontSize="9" fontWeight="800"
                              fill={heavy ? '#fff' : '#B04A3B'} fontFamily="var(--font-platform-mono)">
                              {total > 0 ? total.toLocaleString() : ''}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  )}
                </div>
              </div>
            </div>

            {/* Right Column - 1/3 width */}
            <div className="space-y-4">

              {/* Active Disease Alerts */}
              <div className="card-elevated">
                <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                  <h3 className="font-semibold text-sm flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <AlertTriangle className="w-4 h-4" style={{ color: 'var(--color-danger)' }} />
                    {t('surveillance.activeAlertsTitle')}
                  </h3>
                </div>
                <div className="p-3 data-row-divider-sm" style={{ maxHeight: '480px', overflowY: 'auto' }}>
                  {filteredAlerts.length === 0 && (
                    <EmptyState
                      icon={Shield}
                      title="No active alerts"
                      message="Disease surveillance alerts will appear here as they're reported."
                    />
                  )}
                  {filteredAlerts.map(alert => {
                    const config = alertLevelConfig[alert.alertLevel];
                    return (
                      <div key={alert._id} className="p-3 rounded-lg" style={{ background: config.bg }}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <div className="icon-box-sm">
                              {alert.alertLevel === 'normal' ? (
                                <Shield className="w-3.5 h-3.5" style={{ color: 'var(--color-success)' }} />
                              ) : (
                                <AlertTriangle className="w-3.5 h-3.5" style={{ color: config.iconColor }} />
                              )}
                            </div>
                            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{alert.disease}</span>
                          </div>
                          <Badge tone={alertLevelTone[alert.alertLevel] ?? 'neutral'} uppercase>
                            {alert.alertLevel.toUpperCase()}
                          </Badge>
                        </div>
                        <p className="text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                          {alert.county}, {alert.state}
                        </p>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                              <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{alert.cases}</span> {t('surveillance.cases')}
                            </span>
                            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                              <span className="font-semibold" style={{ color: 'var(--tamamhealth-red)' }}>{alert.deaths}</span> {t('surveillance.deaths')}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            {alert.trend === 'increasing' ? (
                              <TrendingUp className="w-3 h-3" style={{ color: 'var(--color-danger)' }} />
                            ) : alert.trend === 'decreasing' ? (
                              <TrendingDown className="w-3 h-3" style={{ color: 'var(--color-success)' }} />
                            ) : (
                              <Minus className="w-3 h-3" style={{ color: 'var(--color-warning)' }} />
                            )}
                            <span className="text-[10px] font-medium" style={{
                              color: alert.trend === 'increasing' ? 'var(--color-danger-text)' : alert.trend === 'decreasing' ? 'var(--color-success-text)' : 'var(--color-warning-text)'
                            }}>
                              {alert.trend}
                            </span>
                          </div>
                        </div>
                        <hr className="section-divider" />
                        <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                          {t('surveillance.reported', { date: formatDate(alert.reportDate) })}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* IDSR Weekly Report Summary */}
              <div className="card-elevated">
                <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                  <h3 className="font-semibold text-sm flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <FileText className="w-4 h-4" style={{ color: 'var(--tamamhealth-blue)' }} />
                    {t('surveillance.idsrWeeklySummary')}
                  </h3>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: 'var(--accent-light)', color: 'var(--accent-primary)' }}>
                    {reportingWeek}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full" style={{ borderCollapse: 'collapse', minWidth: 720 }}>
                    <thead>
                      <tr>
                        <th className="text-left text-[10px] font-semibold uppercase tracking-wider px-3 py-2.5"
                          style={{ color: 'var(--text-secondary)', background: 'var(--overlay-subtle)', borderBottom: '1px solid var(--border-light)' }}>
                          {t('surveillance.colDisease')}
                        </th>
                        <th className="text-right text-[10px] font-semibold uppercase tracking-wider px-3 py-2.5"
                          style={{ color: 'var(--text-secondary)', background: 'var(--overlay-subtle)', borderBottom: '1px solid var(--border-light)' }}>
                          {t('surveillance.colCases')}
                        </th>
                        <th className="text-right text-[10px] font-semibold uppercase tracking-wider px-3 py-2.5"
                          style={{ color: 'var(--text-secondary)', background: 'var(--overlay-subtle)', borderBottom: '1px solid var(--border-light)' }}>
                          {t('surveillance.colPrev')}
                        </th>
                        <th className="text-center text-[10px] font-semibold uppercase tracking-wider px-3 py-2.5"
                          style={{ color: 'var(--text-secondary)', background: 'var(--overlay-subtle)', borderBottom: '1px solid var(--border-light)' }}>
                          {t('surveillance.colTrend')}
                        </th>
                        <th className="text-right text-[10px] font-semibold uppercase tracking-wider px-3 py-2.5"
                          style={{ color: 'var(--text-secondary)', background: 'var(--overlay-subtle)', borderBottom: '1px solid var(--border-light)' }}>
                          {t('surveillance.colDeaths')}
                        </th>
                        <th className="text-right text-[10px] font-semibold uppercase tracking-wider px-3 py-2.5"
                          style={{ color: 'var(--text-secondary)', background: 'var(--overlay-subtle)', borderBottom: '1px solid var(--border-light)' }}>
                          {t('surveillance.colCfr')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {idsrSummary.map((row, idx) => {
                        const change = row.casesThisWeek - row.casesPrevWeek;
                        const isUp = change > 0;
                        const isDown = change < 0;
                        return (
                          <tr key={idx} className="hover:bg-white/5 transition-colors">
                            <td className="px-3 py-2 text-xs font-medium" style={{ color: 'var(--text-primary)', borderBottom: '1px solid var(--table-row-border)' }}>
                              {row.disease}
                            </td>
                            <td className="px-3 py-2 text-xs text-right font-semibold" style={{ color: 'var(--text-primary)', borderBottom: '1px solid var(--table-row-border)' }}>
                              {row.casesThisWeek.toLocaleString()}
                            </td>
                            <td className="px-3 py-2 text-xs text-right" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--table-row-border)' }}>
                              {row.casesPrevWeek.toLocaleString()}
                            </td>
                            <td className="px-3 py-2 text-center" style={{ borderBottom: '1px solid var(--table-row-border)' }}>
                              <div className="inline-flex items-center gap-0.5">
                                {isUp ? (
                                  <TrendingUp className="w-3 h-3" style={{ color: 'var(--color-danger)' }} />
                                ) : isDown ? (
                                  <TrendingDown className="w-3 h-3" style={{ color: 'var(--color-success)' }} />
                                ) : (
                                  <Minus className="w-3 h-3" style={{ color: 'var(--color-warning)' }} />
                                )}
                                <span className="text-[10px] font-medium" style={{
                                  color: isUp ? 'var(--color-danger-text)' : isDown ? 'var(--color-success-text)' : 'var(--color-warning-text)'
                                }}>
                                  {isUp ? '+' : ''}{change}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-xs text-right font-medium" style={{
                              color: row.deaths > 0 ? 'var(--tamamhealth-red)' : 'var(--text-muted)',
                              borderBottom: '1px solid var(--table-row-border)'
                            }}>
                              {row.deaths}
                            </td>
                            <td className="px-3 py-2 text-xs text-right" style={{
                              color: row.cfrPercent >= 10 ? 'var(--color-danger-text)' : row.cfrPercent >= 5 ? 'var(--color-warning-text)' : 'var(--text-secondary)',
                              fontWeight: row.cfrPercent >= 10 ? 600 : 400,
                              borderBottom: '1px solid var(--table-row-border)'
                            }}>
                              {(row.cfrPercent ?? 0).toFixed(1)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: 'var(--overlay-subtle)' }}>
                        <td className="px-3 py-2 text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{t('surveillance.total')}</td>
                        <td className="px-3 py-2 text-xs text-right font-bold" style={{ color: 'var(--text-primary)' }}>
                          {idsrSummary.reduce((s, r) => s + r.casesThisWeek, 0).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-xs text-right font-bold" style={{ color: 'var(--text-muted)' }}>
                          {idsrSummary.reduce((s, r) => s + r.casesPrevWeek, 0).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <div className="inline-flex items-center gap-0.5">
                            <TrendingUp className="w-3 h-3" style={{ color: 'var(--color-danger)' }} />
                            <span className="text-[10px] font-medium" style={{ color: 'var(--color-danger-text)' }}>
                              +{idsrSummary.reduce((s, r) => s + r.casesThisWeek, 0) - idsrSummary.reduce((s, r) => s + r.casesPrevWeek, 0)}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs text-right font-bold" style={{ color: 'var(--tamamhealth-red)' }}>
                          {idsrSummary.reduce((s, r) => s + r.deaths, 0)}
                        </td>
                        <td className="px-3 py-2 text-xs text-right font-medium" style={{ color: 'var(--text-secondary)' }}>
                          {(() => {
                            const totalDeathsSum = idsrSummary.reduce((s, r) => s + r.deaths, 0);
                            const totalCasesSum = idsrSummary.reduce((s, r) => s + r.casesThisWeek, 0);
                            return totalCasesSum > 0 ? ((totalDeathsSum / totalCasesSum) * 100).toFixed(1) : '0.0';
                          })()}%
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div className="px-4 py-3 border-t" style={{ borderColor: 'var(--border-light)' }}>
                  <button onClick={handleExport} className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--tamamhealth-blue)' }}>
                    <div className="icon-box-sm">
                      <FileText className="w-3.5 h-3.5" />
                    </div>
                    {t('surveillance.downloadFullReport')}
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Report Disease Alert Modal */}
          {showNewAlert && (
            <Modal onClose={() => !alertSubmitting && setShowNewAlert(false)}>
              <div className="modal-content card-elevated p-6 max-w-lg w-full" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="icon-box-sm">
                      <AlertTriangle className="w-3.5 h-3.5" style={{ color: 'var(--color-danger)' }} />
                    </div>
                    <h3 className="text-base font-semibold">{t('surveillance.modalTitle')}</h3>
                  </div>
                  <button onClick={() => setShowNewAlert(false)} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <hr className="section-divider" />
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('surveillance.labelDisease')}</label>
                    <Select value={alertForm.disease} onChange={e => setAlertForm({ ...alertForm, disease: e.target.value })}>
                      <option value="">{t('surveillance.selectDisease')}</option>
                      {REPORTABLE_DISEASES.map(d => <option key={d} value={d}>{d}</option>)}
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('surveillance.labelState')}</label>
                      <Select value={alertForm.state} onChange={e => setAlertForm({ ...alertForm, state: e.target.value })}>
                        <option value="">{t('surveillance.selectGeneric')}</option>
                        {states.map(s => <option key={s} value={s}>{s}</option>)}
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('surveillance.labelCounty')}</label>
                      <input type="text" value={alertForm.county} onChange={e => setAlertForm({ ...alertForm, county: e.target.value })} placeholder={t('surveillance.countyPlaceholder')} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('surveillance.labelSuspectedCases')}</label>
                      <input type="number" min={0} value={alertForm.cases || ''} onChange={e => setAlertForm({ ...alertForm, cases: parseInt(e.target.value) || 0 })} />
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('surveillance.labelDeaths')}</label>
                      <input type="number" min={0} value={alertForm.deaths || ''} onChange={e => setAlertForm({ ...alertForm, deaths: parseInt(e.target.value) || 0 })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('surveillance.labelAlertLevel')}</label>
                      <Select value={alertForm.alertLevel} onChange={e => setAlertForm({ ...alertForm, alertLevel: e.target.value as typeof alertForm.alertLevel })}>
                        <option value="watch">{t('surveillance.levelWatch')}</option>
                        <option value="warning">{t('surveillance.levelWarning')}</option>
                        <option value="emergency">{t('surveillance.levelEmergency')}</option>
                        <option value="normal">{t('surveillance.levelNormal')}</option>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('surveillance.labelTrend')}</label>
                      <Select value={alertForm.trend} onChange={e => setAlertForm({ ...alertForm, trend: e.target.value as typeof alertForm.trend })}>
                        <option value="increasing">{t('surveillance.trendIncreasing')}</option>
                        <option value="stable">{t('surveillance.trendStable')}</option>
                        <option value="decreasing">{t('surveillance.trendDecreasing')}</option>
                      </Select>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 mt-5">
                  <button onClick={() => setShowNewAlert(false)} className="btn btn-secondary flex-1" disabled={alertSubmitting}>{t('action.cancel')}</button>
                  <button onClick={handleCreateAlert} className="btn btn-primary flex-1" disabled={alertSubmitting}>
                    {alertSubmitting ? t('surveillance.submitting') : t('surveillance.submitAlert')}
                  </button>
                </div>
              </div>
            </Modal>
          )}
      </main>
    </>
  );
}
