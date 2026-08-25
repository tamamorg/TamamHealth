'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import Modal from '@/components/Modal';
import {
  AlertTriangle,
  Shield,
  TrendingUp,
  TrendingDown,
  Minus,
  FileText,
  ChevronRight,
  Download,
  Plus,
  X,
} from '@/components/icons/lucide';
import EmptyState from '@/components/EmptyState';
import Badge, { type BadgeTone } from '@/components/Badge';
import { formatDate, isoWeek } from '@/lib/format-utils';
// `states` is the real ADM1 state list — a leaf reference module with no
// mock.ts generator behind it — used to populate the state dropdown.
import { states } from '@/lib/data/south-sudan-reference';
import { SOUTH_SUDAN_STATES, WHITE_NILE } from '@/data/south-sudan-geo';
import { makeProjector } from '@/lib/maps/south-sudan-projection';
import { useSurveillance } from '@/lib/hooks/useSurveillance';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { useFacilityCensus } from '@/lib/hooks/useFacilityCensus';
import { censusFor } from '@/lib/services/facility-census';
import { useAuth } from '@/lib/context';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { downloadJson, safeFilenamePart } from '@/lib/export-file';
import { type ChartType } from '@/components/ChartCard';

/** How many weekly buckets the trend chart shows: six weeks, a quarter, a year. */
type TrendWindow = 6 | 13 | 52;
const TREND_WINDOWS: { weeks: TrendWindow; key: string }[] = [
  { weeks: 6, key: 'surveillance.window6w' },
  { weeks: 13, key: 'surveillance.window13w' },
  { weeks: 52, key: 'surveillance.window52w' },
];
import Select from '@/components/Select';
import { todayIso } from '@/lib/date-utils';

// recharts (~80-100KB) is deferred behind a dynamic boundary so it's fetched
// only when this chart renders — same pattern as
// FacilityManagementDashboard/_FacilityCharts.
const WeeklyDiseaseTrendsChart = dynamic(
  () => import('./_SurveillanceCharts').then(m => m.WeeklyDiseaseTrendsChart),
  { ssr: false, loading: () => <div style={{ height: 300 }} /> },
);

// Alert level ordering for severity sorting
const severityOrder: Record<string, number> = {
  emergency: 0,
  warning: 1,
  watch: 2,
  normal: 3,
};

/* Real-geography projection: uniform (aspect-preserving) equirectangular
   scale over the actual South Sudan bounding box, centred in the viewBox.
   Facility dots and the boundary polygons share this one transform, so the
   markers sit on the true map. */
const MAP_W = 600;
const MAP_H = 460;
const MAP_PAD = 14;

const surveillanceProjector = makeProjector(MAP_W, MAP_H, MAP_PAD);

// Alert level → semantic Badge tone (emergency→danger, warning/watch→warning,
// normal→success). Used for both the list-row chip and the map/legend dots
// so severity reads as one consistent colour everywhere on the page.
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
  const [chartType, setChartType] = useState<ChartType>('line');
  /* The series is one point per ISO WEEK, so the selector offers windows in
     weeks. It used to offer This Week / This Month / This Quarter and slice
     -7 / -30 / everything off a weekly array — so "This Week" drew the last
     seven WEEKS, "This Month" the last thirty (seven months), and "This
     Quarter" every week on file. Every option named a period the chart was
     not showing. */
  const [trendWeeks, setTrendWeeks] = useState<TrendWindow>(13);
  const [focusedAlertId, setFocusedAlertId] = useState<string | null>(null);

  useEffect(() => {
    setFocusedAlertId(new URLSearchParams(window.location.search).get('alert'));
  }, []);

  const { currentUser } = useAuth();
  const { canRecordVitalEvents, isGovernment, isSuperAdmin } = usePermissions();
  const canReportAlert = canRecordVitalEvents || isGovernment || isSuperAdmin;
  const { showToast } = useToast();
  const { alerts: diseaseAlerts, create: createAlert } = useSurveillance();
  const { hospitals } = useHospitals();
  // Real per-facility patient counts for the map tooltip — the stored
  // HospitalDoc.patientCount is write-once-zero (2026-08 sweep).
  const { census } = useFacilityCensus();

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
        reportDate: todayIso(),
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

  useEffect(() => {
    if (!focusedAlertId || filteredAlerts.length === 0) return;
    const row = document.getElementById(`surveillance-alert-${focusedAlertId}`);
    row?.scrollIntoView({ block: 'nearest' });
    row?.focus({ preventScroll: true });
  }, [focusedAlertId, filteredAlerts.length]);

  const totalAlerts = (diseaseAlerts || []).length;
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
    const latest = dated.length > 0 ? dated[dated.length - 1] : todayIso();
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
  }, [diseaseAlerts, t]);

  /**
   * Export the current IDSR report as a JSON blob the user can download.
   * This replaces the previous inert "Export Report" button. We include
   * the alert list, aggregated disease totals, and the reporting week so
   * MOH officers have an offline artifact they can archive.
   */
  const handleExport = () => {
    const emergencies = (diseaseAlerts || []).filter(a => a.alertLevel === 'emergency').length;
    const warnings = (diseaseAlerts || []).filter(a => a.alertLevel === 'warning').length;
    const watchItems = (diseaseAlerts || []).filter(a => a.alertLevel === 'watch').length;
    const payload = {
      reportingWeek,
      generatedAt: new Date().toISOString(),
      totals: { alerts: totalAlerts, emergencies, warnings, watch: watchItems, cases: totalCases, deaths: totalDeaths },
      alerts: diseaseAlerts || [],
      idsrSummary,
    };
    downloadJson(payload, `surveillance-report-${safeFilenamePart(reportingWeek)}`);
  };

  const reportingFacilities = useMemo(() => {
    const reporting = new Set(
      (diseaseAlerts || [])
        .map(a => (a as { hospitalId?: string; reportedBy?: string }).hospitalId || (a as { reportedBy?: string }).reportedBy)
        .filter(Boolean)
    ).size;
    return { reporting, total: hospitals.length || 0 };
  }, [diseaseAlerts, hospitals.length]);

  return (
    <>
      <main className="page-container page-enter">

        {/* ── Header: what/where/when — gov-page-head, no decorative hero ── */}
        <div className="gov-page-head">
          <div>
            <h1>{t('nav.surveillance')}</h1>
            <p>{t('surveillance.dashboardSubtitle', { week: reportingWeek })}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {canReportAlert && (
              <button type="button" className="btn btn-primary" onClick={() => setShowNewAlert(true)}>
                <Plus className="w-4 h-4" />
                {t('surveillance.reportAlert')}
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={handleExport}>
              <Download className="w-4 h-4" />
              {t('surveillance.exportReport')}
            </button>
          </div>
        </div>

        {/* Aggregate summary strip */}
        <section className="gov-panel mb-4">
          <div className="gov-panel-head">
            <h3>This Week</h3>
            <span className="gov-meta">{t('surveillance.updated', { date: formatDate(new Date().toISOString()) })}</span>
          </div>
          <div className="flex items-center gap-8 flex-wrap p-4">
            <div className="flex items-center gap-2">
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('surveillance.totalCasesThisWeek')}</span>
              <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{totalCases.toLocaleString()}</span>
            </div>
            <div className="w-px h-5" style={{ background: 'var(--border-light)' }} />
            <div className="flex items-center gap-2">
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('surveillance.totalDeaths')}</span>
              <span className="text-sm font-bold" style={{ color: 'var(--tamamhealth-red)' }}>{totalDeaths.toLocaleString()}</span>
            </div>
            <div className="w-px h-5" style={{ background: 'var(--border-light)' }} />
            <div className="flex items-center gap-2">
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('surveillance.reportingFacilities')}</span>
              <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                {reportingFacilities.reporting.toLocaleString()}/{reportingFacilities.total.toLocaleString()}
              </span>
            </div>
            <div className="w-px h-5" style={{ background: 'var(--border-light)' }} />
            <div className="flex items-center gap-2">
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('surveillance.cfrCholera')}</span>
              <span className="text-sm font-bold" style={{ color: 'var(--tamamhealth-red)' }}>{choleraCFR}%</span>
            </div>
          </div>
        </section>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left Column - 2/3 width */}
          <div className="lg:col-span-2 space-y-4">

            {/* Hospital network map */}
            <section className="gov-panel">
              <div className="gov-panel-head">
                <h3>{t('surveillance.hospitalNetworkTitle')}</h3>
                <div className="flex items-center gap-3 flex-wrap">
                  {['emergency', 'warning', 'watch', 'normal'].map(level => (
                    <span key={level} className="flex items-center gap-1.5">
                      <i aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: alertDotColors[level], display: 'inline-block', flexShrink: 0 }} />
                      <span className="gov-meta capitalize">{level}</span>
                    </span>
                  ))}
                </div>
              </div>
              <div className="gov-chart-body">
                <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="w-full" style={{ maxHeight: '400px' }}>
                  <defs>
                    {/* Heat blobs blur into a continuous intensity surface. */}
                    <filter id="ssd-heat-blur" x="-60%" y="-60%" width="220%" height="220%">
                      <feGaussianBlur stdDeviation="13" />
                    </filter>
                    {/* Keep the heat inside the national boundary. */}
                    <clipPath id="ssd-country-clip">
                      {SOUTH_SUDAN_STATES.map(s => s.rings.map((ring, i) => (
                        <path key={`${s.name}-${i}`} d={surveillanceProjector.ringPath(ring)} />
                      )))}
                    </clipPath>
                  </defs>

                  {/* Real geography: geoBoundaries SSD ADM1, one polygon per state. */}
                  <g>
                    {SOUTH_SUDAN_STATES.map(s => s.rings.map((ring, i) => (
                      <path
                        key={`${s.name}-${i}`}
                        d={surveillanceProjector.ringPath(ring)}
                        fill="rgba(33, 145, 208, 0.09)"
                        stroke="rgba(1, 86, 151, 0.22)"
                        strokeWidth="1"
                        strokeLinejoin="round"
                      />
                    )))}
                  </g>

                  {/* State labels at polygon centroids. */}
                  {SOUTH_SUDAN_STATES.map(s => {
                    const c = surveillanceProjector.centroid(s);
                    return (
                      <text key={s.name} x={c.x} y={c.y} textAnchor="middle" fontSize="8"
                        fill="var(--text-muted)" opacity="0.65" fontFamily="'DM Sans', sans-serif">
                        {s.name}
                      </text>
                    );
                  })}

                  {/* White Nile / Bahr el Jebel along its real course. */}
                  <path d={surveillanceProjector.ringPath(WHITE_NILE, false)}
                    fill="none" stroke="rgba(33, 145, 208, 0.38)" strokeWidth="2" strokeLinecap="round" />
                  <text x={surveillanceProjector.project(7.5, 31.1).x + 8} y={surveillanceProjector.project(7.5, 31.1).y} fontSize="9"
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
                      const pos = surveillanceProjector.project(h.lat, h.lng);
                      const level = getHospitalAlertLevel(h.state);
                      const r = level === 'emergency' ? 40 : level === 'warning' ? 30 : level === 'watch' ? 22 : 16;
                      return <circle key={`heat-${h._id}`} cx={pos.x} cy={pos.y} r={r} fill={alertDotColors[level]} />;
                    })}
                  </g>

                  {/* Hospital dots */}
                  {hospitals.map(h => {
                    if (!Number.isFinite(h.lat) || !Number.isFinite(h.lng)) return null;
                    const pos = surveillanceProjector.project(h.lat, h.lng);
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
                          fill={dotColor} stroke="#001D3F" strokeWidth="2.5"
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
                              rx="6" ry="6" fill="#001D3F" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
                            <polygon
                              points={`${pos.x - 5},${pos.y - 10} ${pos.x + 5},${pos.y - 10} ${pos.x},${pos.y - 3}`}
                              fill="#001D3F" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
                            <rect x={pos.x - 80} y={pos.y - 58} width="160" height="48"
                              rx="6" ry="6" fill="#001D3F" />
                            <text x={pos.x} y={pos.y - 40} textAnchor="middle" fontSize="10.5"
                              fontWeight="600" fill="#CFD6DD">{h.name}</text>
                            <text x={pos.x} y={pos.y - 27} textAnchor="middle" fontSize="9"
                              fill="#94A2B3">{h.state}</text>
                            <text x={pos.x} y={pos.y - 15} textAnchor="middle" fontSize="9"
                              fill={dotColor} fontWeight="500">
                              {alertLevel.toUpperCase()} -- {censusFor(census, h._id).patients.toLocaleString()} patients
                            </text>
                          </g>
                        )}
                      </g>
                    );
                  })}
                </svg>
              </div>
            </section>

            {/* Weekly Disease Trends */}
            <section className="gov-panel">
              <div className="gov-panel-head">
                <h3>{t('surveillance.weeklyTrendsTitle')}</h3>
                <span className="gov-meta">{t('surveillance.sourceIdsrReports')}</span>
              </div>
              <div className="gov-map-layers" style={{ justifyContent: 'space-between', paddingBottom: 10 }}>
                <div className="flex items-center gap-1.5">
                  {(['line', 'area', 'bar'] as ChartType[]).map(ct => (
                    <button
                      key={ct}
                      type="button"
                      onClick={() => setChartType(ct)}
                      className={chartType === ct ? 'is-active' : undefined}
                    >
                      {ct}
                    </button>
                  ))}
                </div>
                <Select
                  value={String(trendWeeks)}
                  onChange={e => setTrendWeeks(Number(e.target.value) as TrendWindow)}
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
                  {TREND_WINDOWS.map(w => (
                    <option key={w.weeks} value={w.weeks}>{t(w.key)}</option>
                  ))}
                </Select>
              </div>
              <div className="gov-chart-body">
                {(() => {
                  const sliced = weeklyDiseaseData.slice(-trendWeeks);
                  const data = sliced.length > 0 ? sliced : weeklyDiseaseData;
                  return <WeeklyDiseaseTrendsChart data={data} chartType={chartType} />;
                })()}
              </div>
            </section>

          </div>

          {/* Right Column - 1/3 width */}
          <div className="space-y-4">

            {/* Active Disease Alerts */}
            <section data-tour="surv-alerts-panel" className="gov-panel">
              <div className="gov-panel-head">
                <h3>{t('surveillance.activeAlertsTitle')}</h3>
                <span className="gov-meta">{totalAlerts.toLocaleString()} {totalAlerts === 1 ? 'alert' : 'alerts'}</span>
              </div>
              <div style={{ maxHeight: 480, overflowY: 'auto' }}>
                {filteredAlerts.length === 0 && (
                  <div className="p-4">
                    <EmptyState
                      icon={Shield}
                      title="No active alerts"
                      message="Disease surveillance alerts will appear here as they're reported."
                    />
                  </div>
                )}
                {filteredAlerts.map((alert, idx) => (
                  <div
                    key={alert._id}
                    id={`surveillance-alert-${alert._id}`}
                    tabIndex={focusedAlertId === alert._id ? 0 : undefined}
                    aria-current={focusedAlertId === alert._id ? 'true' : undefined}
                    className="px-3.5 py-3"
                    style={{
                      borderBottom: idx < filteredAlerts.length - 1 ? '1px solid var(--border-light)' : 'none',
                      background: focusedAlertId === alert._id ? 'var(--overlay-subtle)' : undefined,
                      outline: focusedAlertId === alert._id ? '2px solid var(--accent-primary)' : undefined,
                      outlineOffset: focusedAlertId === alert._id ? -2 : undefined,
                    }}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        {alert.alertLevel === 'normal' ? (
                          <Shield className="w-3.5 h-3.5 flex-shrink-0" style={{ color: alertDotColors.normal }} />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: alertDotColors[alert.alertLevel] }} />
                        )}
                        <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{alert.disease}</span>
                      </div>
                      <Badge tone={alertLevelTone[alert.alertLevel] ?? 'neutral'} uppercase>
                        {alert.alertLevel}
                      </Badge>
                    </div>
                    <p className="text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                      {alert.county}, {alert.state}
                    </p>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{(alert.cases || 0).toLocaleString()}</span> {t('surveillance.cases')}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          <span className="font-semibold" style={{ color: 'var(--tamamhealth-red)' }}>{(alert.deaths || 0).toLocaleString()}</span> {t('surveillance.deaths')}
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
                        <span className="text-[10px] font-semibold" style={{
                          color: alert.trend === 'increasing' ? 'var(--color-danger-text)' : alert.trend === 'decreasing' ? 'var(--color-success-text)' : 'var(--color-warning-text)'
                        }}>
                          {alert.trend}
                        </span>
                      </div>
                    </div>
                    <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                      {t('surveillance.reported', { date: formatDate(alert.reportDate) })}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            {/* IDSR Weekly Report Summary */}
            <section className="gov-panel">
              <div className="gov-panel-head">
                <h3>{t('surveillance.idsrWeeklySummary')}</h3>
                <span className="gov-meta">{reportingWeek}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full" style={{ borderCollapse: 'collapse', minWidth: 720 }}>
                  <thead>
                    <tr>
                      <th className="text-start text-[10px] font-semibold uppercase tracking-wider px-3 py-2.5"
                        style={{ color: 'var(--text-secondary)', background: 'var(--overlay-subtle)', borderBottom: '1px solid var(--border-light)' }}>
                        {t('surveillance.colDisease')}
                      </th>
                      <th className="text-end text-[10px] font-semibold uppercase tracking-wider px-3 py-2.5"
                        style={{ color: 'var(--text-secondary)', background: 'var(--overlay-subtle)', borderBottom: '1px solid var(--border-light)' }}>
                        {t('surveillance.colCases')}
                      </th>
                      <th className="text-end text-[10px] font-semibold uppercase tracking-wider px-3 py-2.5"
                        style={{ color: 'var(--text-secondary)', background: 'var(--overlay-subtle)', borderBottom: '1px solid var(--border-light)' }}>
                        {t('surveillance.colPrev')}
                      </th>
                      <th className="text-center text-[10px] font-semibold uppercase tracking-wider px-3 py-2.5"
                        style={{ color: 'var(--text-secondary)', background: 'var(--overlay-subtle)', borderBottom: '1px solid var(--border-light)' }}>
                        {t('surveillance.colTrend')}
                      </th>
                      <th className="text-end text-[10px] font-semibold uppercase tracking-wider px-3 py-2.5"
                        style={{ color: 'var(--text-secondary)', background: 'var(--overlay-subtle)', borderBottom: '1px solid var(--border-light)' }}>
                        {t('surveillance.colDeaths')}
                      </th>
                      <th className="text-end text-[10px] font-semibold uppercase tracking-wider px-3 py-2.5"
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
                          <td className="px-3 py-2 text-xs font-semibold" style={{ color: 'var(--text-primary)', borderBottom: '1px solid var(--table-row-border)' }}>
                            {row.disease}
                          </td>
                          <td className="px-3 py-2 text-xs text-end font-semibold" style={{ color: 'var(--text-primary)', borderBottom: '1px solid var(--table-row-border)' }}>
                            {row.casesThisWeek.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-xs text-end" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--table-row-border)' }}>
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
                              <span className="text-[10px] font-semibold" style={{
                                color: isUp ? 'var(--color-danger-text)' : isDown ? 'var(--color-success-text)' : 'var(--color-warning-text)'
                              }}>
                                {isUp ? '+' : ''}{change.toLocaleString()}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs text-end font-semibold" style={{
                            color: row.deaths > 0 ? 'var(--tamamhealth-red)' : 'var(--text-muted)',
                            borderBottom: '1px solid var(--table-row-border)'
                          }}>
                            {row.deaths.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-xs text-end" style={{
                            color: row.cfrPercent >= 10 ? 'var(--color-danger-text)' : row.cfrPercent >= 5 ? 'var(--color-warning-text)' : 'var(--text-secondary)',
                            fontWeight: row.cfrPercent >= 10 ? 700 : 600,
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
                      <td className="px-3 py-2 text-xs text-end font-bold" style={{ color: 'var(--text-primary)' }}>
                        {idsrSummary.reduce((s, r) => s + r.casesThisWeek, 0).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-xs text-end font-bold" style={{ color: 'var(--text-muted)' }}>
                        {idsrSummary.reduce((s, r) => s + r.casesPrevWeek, 0).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <div className="inline-flex items-center gap-0.5">
                          <TrendingUp className="w-3 h-3" style={{ color: 'var(--color-danger)' }} />
                          <span className="text-[10px] font-semibold" style={{ color: 'var(--color-danger-text)' }}>
                            +{(idsrSummary.reduce((s, r) => s + r.casesThisWeek, 0) - idsrSummary.reduce((s, r) => s + r.casesPrevWeek, 0)).toLocaleString()}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-end font-bold" style={{ color: 'var(--tamamhealth-red)' }}>
                        {idsrSummary.reduce((s, r) => s + r.deaths, 0).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-xs text-end font-bold" style={{ color: 'var(--text-secondary)' }}>
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
                <button onClick={handleExport} className="flex items-center gap-1.5 text-xs font-bold" style={{ color: 'var(--tamamhealth-blue)' }}>
                  <FileText className="w-3.5 h-3.5" />
                  {t('surveillance.downloadFullReport')}
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </section>
          </div>
        </div>

        {/* Report Disease Alert Modal */}
        {showNewAlert && (
          <Modal onClose={() => !alertSubmitting && setShowNewAlert(false)}>
            <div className="modal-content p-6 max-w-lg w-full" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" style={{ color: 'var(--color-danger)' }} />
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
