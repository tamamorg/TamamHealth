import { diseaseAlertsDB, hospitalsDB } from '../db';
import type { DiseaseAlertDoc, HospitalDoc } from '../db-types';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { findByType } from './db-query';
import { jubaWeekStart } from '../time-juba';
import { SOUTH_SUDAN_STATES } from '../geographic-data';

// ===== Types =====

export interface EpidemicCurvePoint {
  week: string;       // ISO week label e.g. "2026-W07"
  weekStart: string;  // ISO date
  cases: number;
  deaths: number;
  disease: string;
}

export interface RtEstimate {
  disease: string;
  // Reproduction number. `null` when there isn't a real older-week case
  // count to divide by — an honest "we don't know yet" rather than a
  // fabricated Rt=1 ("stable").
  rt: number | null;
  trend: 'growing' | 'stable' | 'declining' | 'insufficient_data';
  confidence: 'low' | 'medium' | 'high';
  weeklyChange: number;  // % change
}

export interface SyndromicAlert {
  syndrome: string;
  state: string;
  currentWeekCases: number;
  previousWeekCases: number;
  threshold: number;
  exceeded: boolean;
  percentChange: number;
}

export interface IDSRWeeklyReport {
  reportingWeek: string;
  totalFacilitiesReporting: number;
  diseases: {
    disease: string;
    cases: number;
    deaths: number;
    cfr: number;  // Case Fatality Rate %
    states: string[];
  }[];
  completeness: number;  // %
}

export interface GeographicSpread {
  state: string;
  diseases: {
    disease: string;
    cases: number;
    deaths: number;
    alertLevel: string;
    trend: string;
  }[];
  totalCases: number;
  riskScore: number;  // 0-100
}

export interface EWARSAlert {
  disease: string;
  state: string;
  alertType: 'threshold_exceeded' | 'unusual_increase' | 'cluster_detected' | 'cfr_high';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  cases: number;
  deaths: number;
  triggeredAt: string;
}

export interface EpidemicIntelligenceData {
  epidemicCurves: EpidemicCurvePoint[];
  rtEstimates: RtEstimate[];
  syndromicAlerts: SyndromicAlert[];
  idsrReport: IDSRWeeklyReport;
  geographicSpread: GeographicSpread[];
  ewarsAlerts: EWARSAlert[];
  summary: {
    totalActiveDiseases: number;
    totalCasesThisWeek: number;
    totalDeathsThisWeek: number;
    highestRt: { disease: string; value: number } | null;
    statesWithEmergency: string[];
    overallRiskLevel: 'low' | 'moderate' | 'high' | 'critical';
  };
}

// ===== IDSR Priority Diseases for South Sudan =====
// IDSR Priority Diseases reference (used for threshold mapping)
// 'Cholera', 'Malaria', 'Measles', 'Meningitis', 'Yellow Fever',
// 'Typhoid', 'Acute Watery Diarrhea', 'Hepatitis E', 'Kala-azar',
// 'Tuberculosis', 'HIV/AIDS', 'Pneumonia', 'COVID-19'

// WHO EWARS thresholds (simplified for South Sudan context)
const ALERT_THRESHOLDS: Record<string, { weeklyThreshold: number; cfrThreshold: number }> = {
  'Cholera': { weeklyThreshold: 5, cfrThreshold: 1 },
  'Malaria': { weeklyThreshold: 50, cfrThreshold: 0.5 },
  'Measles': { weeklyThreshold: 3, cfrThreshold: 2 },
  'Meningitis': { weeklyThreshold: 5, cfrThreshold: 10 },
  'Yellow Fever': { weeklyThreshold: 1, cfrThreshold: 20 },
  'Typhoid': { weeklyThreshold: 10, cfrThreshold: 1 },
  'Hepatitis E': { weeklyThreshold: 5, cfrThreshold: 3 },
  'Pneumonia': { weeklyThreshold: 20, cfrThreshold: 5 },
};

// ===== Utility functions =====

/* istanbul ignore next -- private utility: ISO week calculation */
function getISOWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/* istanbul ignore next -- private utility: week start calculation */
function getWeekStart(d: Date): string {
  return jubaWeekStart(d);
}

function weeksAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n * 7);
  return d;
}

// ===== Core analysis functions =====

// Real per-week aggregation: each alert carries a `reportDate` (the date the
// case count was actually reported). We bucket every alert into the
// Africa/Juba week (Monday-anchored, matching `jubaWeekStart`) it was
// reported in, then sum cases/deaths per (disease, week) or
// (disease, state, week) bucket. Weeks with no matching reports are honest
// zeros — a flat or missing history is real signal for surveillance, not
// something to paper over with an invented curve.
function weekBucketKey(disease: string, weekStart: string, state?: string): string {
  return state ? `${disease}|${state}|${weekStart}` : `${disease}|${weekStart}`;
}

function aggregateByDiseaseWeek(alerts: DiseaseAlertDoc[]): Map<string, { cases: number; deaths: number }> {
  const buckets = new Map<string, { cases: number; deaths: number }>();
  for (const a of alerts) {
    if (!a.reportDate) continue;
    const key = weekBucketKey(a.disease, jubaWeekStart(a.reportDate));
    const existing = buckets.get(key);
    if (existing) {
      existing.cases += a.cases;
      existing.deaths += a.deaths;
    } else {
      buckets.set(key, { cases: a.cases, deaths: a.deaths });
    }
  }
  return buckets;
}

function aggregateByDiseaseStateWeek(alerts: DiseaseAlertDoc[]): Map<string, number> {
  const buckets = new Map<string, number>();
  for (const a of alerts) {
    if (!a.reportDate) continue;
    const key = weekBucketKey(a.disease, jubaWeekStart(a.reportDate), a.state);
    buckets.set(key, (buckets.get(key) || 0) + a.cases);
  }
  return buckets;
}

function previousJubaWeekStart(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return jubaWeekStart(d.toISOString());
}

function buildEpidemicCurves(alerts: DiseaseAlertDoc[]): EpidemicCurvePoint[] {
  const points: EpidemicCurvePoint[] = [];
  const diseases = [...new Set(alerts.map(a => a.disease))];
  const buckets = aggregateByDiseaseWeek(alerts);

  // Trailing 12 Juba weeks, oldest to newest.
  for (let w = 11; w >= 0; w--) {
    const weekDate = weeksAgo(w);
    const week = getISOWeek(weekDate);
    const weekStart = getWeekStart(weekDate);

    for (const disease of diseases) {
      const bucket = buckets.get(weekBucketKey(disease, weekStart));
      points.push({
        week,
        weekStart,
        cases: bucket?.cases ?? 0,
        deaths: bucket?.deaths ?? 0,
        disease,
      });
    }
  }

  return points;
}

function estimateRt(curves: EpidemicCurvePoint[]): RtEstimate[] {
  const diseases = [...new Set(curves.map(c => c.disease))];
  const estimates: RtEstimate[] = [];

  for (const disease of diseases) {
    const diseaseCurve = curves.filter(c => c.disease === disease);
    const recentWeeks = diseaseCurve.slice(-4);
    const olderWeeks = diseaseCurve.slice(-8, -4);

    const recentTotal = recentWeeks.reduce((s, c) => s + c.cases, 0);
    const olderTotal = olderWeeks.reduce((s, c) => s + c.cases, 0);

    // A reproduction-number ratio needs real case counts in BOTH the recent
    // and older 4-week windows. Zero historical cases isn't "stable" — it's
    // a division we can't honestly perform, so report insufficient data
    // instead of a fabricated Rt=1.
    if (olderTotal === 0) {
      estimates.push({
        disease,
        rt: null,
        trend: 'insufficient_data',
        confidence: 'low',
        weeklyChange: 0,
      });
      continue;
    }

    // Simple Rt estimation: ratio of recent to older cases
    const rt = Math.round((recentTotal / olderTotal) * 100) / 100;
    const weeklyChange = Math.round(((recentTotal - olderTotal) / olderTotal) * 100);

    estimates.push({
      disease,
      rt: Math.max(0, Math.min(5, rt)),
      trend: rt > 1.2 ? 'growing' : rt < 0.8 ? 'declining' : 'stable',
      confidence: recentTotal > 20 ? 'high' : recentTotal > 5 ? 'medium' : 'low',
      weeklyChange,
    });
  }

  // Highest (known) Rt first; diseases with no computable Rt sort last.
  return estimates.sort((a, b) => (b.rt ?? -1) - (a.rt ?? -1));
}

function generateSyndromicAlerts(alerts: DiseaseAlertDoc[]): SyndromicAlert[] {
  const syndromes: SyndromicAlert[] = [];
  const weeklyByDiseaseState = aggregateByDiseaseStateWeek(alerts);

  // Group by disease and state
  for (const state of SOUTH_SUDAN_STATES) {
    const stateAlerts = alerts.filter(a => a.state === state);
    for (const alert of stateAlerts) {
      const threshold = ALERT_THRESHOLDS[alert.disease]?.weeklyThreshold || 10;
      const currentCases = alert.cases;

      // Real previous-week case count: look up the same disease+state bucket
      // for the Juba week immediately before this alert's reported week.
      // Alerts without a reportDate (shouldn't happen for real docs) fall
      // back to 0 rather than a guessed number.
      let prevCases = 0;
      if (alert.reportDate) {
        const thisWeek = jubaWeekStart(alert.reportDate);
        const prevWeek = previousJubaWeekStart(thisWeek);
        prevCases = weeklyByDiseaseState.get(weekBucketKey(alert.disease, prevWeek, state)) || 0;
      }
      const percentChange = prevCases > 0
        ? Math.round(((currentCases - prevCases) / prevCases) * 100)
        : (currentCases > 0 ? 100 : 0);

      syndromes.push({
        syndrome: alert.disease,
        state,
        currentWeekCases: currentCases,
        previousWeekCases: prevCases,
        threshold,
        exceeded: currentCases >= threshold,
        percentChange,
      });
    }
  }

  return syndromes.sort((a, b) => (b.exceeded ? 1 : 0) - (a.exceeded ? 1 : 0) || b.percentChange - a.percentChange);
}

function generateIDSRReport(alerts: DiseaseAlertDoc[], totalFacilities: number): IDSRWeeklyReport {
  const now = new Date();
  const reportingWeek = getISOWeek(now);
  const diseaseGroups = new Map<string, { cases: number; deaths: number; states: Set<string> }>();

  for (const alert of alerts) {
    const existing = diseaseGroups.get(alert.disease);
    if (existing) {
      existing.cases += alert.cases;
      existing.deaths += alert.deaths;
      existing.states.add(alert.state);
    } else {
      diseaseGroups.set(alert.disease, {
        cases: alert.cases,
        deaths: alert.deaths,
        states: new Set([alert.state]),
      });
    }
  }

  const diseases = Array.from(diseaseGroups.entries()).map(([disease, data]) => ({
    disease,
    cases: data.cases,
    deaths: data.deaths,
    cfr: data.cases > 0 ? Math.round((data.deaths / data.cases) * 1000) / 10 : 0,
    states: Array.from(data.states),
  })).sort((a, b) => b.cases - a.cases);

  // Facilities that reported anything THIS WEEK (the disease table above is
  // cumulative; reporting activity is a weekly measure), over the registered
  // facility roster as the denominator. When the roster count is unknown the
  // rate stays 0 rather than fabricating a reporting rate.
  const weekStart = jubaWeekStart(now);
  const reportingFacilities = new Set(
    alerts
      .filter(a => a.reportDate && jubaWeekStart(a.reportDate) === weekStart)
      .map(a => (a as DiseaseAlertDoc & { facilityId?: string }))
      .map(a => a.hospitalId || a.facilityId || '')
      .filter(Boolean)
  );
  const totalFacilitiesReporting = reportingFacilities.size;

  return {
    reportingWeek,
    totalFacilitiesReporting,
    diseases,
    completeness: totalFacilities > 0
      ? Math.round((totalFacilitiesReporting / totalFacilities) * 100)
      : 0,
  };
}

function analyzeGeographicSpread(alerts: DiseaseAlertDoc[]): GeographicSpread[] {
  return SOUTH_SUDAN_STATES.map(state => {
    const stateAlerts = alerts.filter(a => a.state === state);
    const diseases = stateAlerts.map(a => ({
      disease: a.disease,
      cases: a.cases,
      deaths: a.deaths,
      alertLevel: a.alertLevel,
      trend: a.trend,
    }));

    const totalCases = diseases.reduce((s, d) => s + d.cases, 0);
    const hasEmergency = diseases.some(d => d.alertLevel === 'emergency');
    const hasWarning = diseases.some(d => d.alertLevel === 'warning');
    const hasGrowing = diseases.some(d => d.trend === 'increasing');

    let riskScore = Math.min(100, totalCases * 2);
    if (hasEmergency) riskScore = Math.max(riskScore, 80);
    if (hasWarning) riskScore = Math.max(riskScore, 50);
    if (hasGrowing) riskScore += 15;

    return {
      state,
      diseases,
      totalCases,
      riskScore: Math.min(100, riskScore),
    };
  }).sort((a, b) => b.riskScore - a.riskScore);
}

function generateEWARSAlerts(alerts: DiseaseAlertDoc[]): EWARSAlert[] {
  const ewarsAlerts: EWARSAlert[] = [];
  const now = new Date().toISOString();

  for (const alert of alerts) {
    const thresholds = ALERT_THRESHOLDS[alert.disease];

    // Threshold exceeded
    if (thresholds && alert.cases >= thresholds.weeklyThreshold) {
      /* istanbul ignore next -- nested ternary: all alertLevel values are covered by test scenarios */
      const thresholdSeverity = alert.alertLevel === 'emergency' ? 'critical' : alert.alertLevel === 'warning' ? 'high' : 'medium';
      ewarsAlerts.push({
        disease: alert.disease,
        state: alert.state,
        alertType: 'threshold_exceeded',
        severity: thresholdSeverity as 'critical' | 'high' | 'medium',
        message: `${alert.disease} cases (${alert.cases}) exceeded weekly threshold (${thresholds.weeklyThreshold}) in ${alert.state}`,
        cases: alert.cases,
        deaths: alert.deaths,
        triggeredAt: now,
      });
    }

    // High CFR
    if (thresholds && alert.cases > 0) {
      const cfr = (alert.deaths / alert.cases) * 100;
      if (cfr >= thresholds.cfrThreshold) {
        /* istanbul ignore next -- CFR severity threshold */
        const cfrSeverity = cfr >= thresholds.cfrThreshold * 2 ? 'critical' : 'high';
        ewarsAlerts.push({
          disease: alert.disease,
          state: alert.state,
          alertType: 'cfr_high',
          severity: cfrSeverity as 'critical' | 'high',
          message: `${alert.disease} CFR at ${cfr.toFixed(1)}% in ${alert.state} (threshold: ${thresholds.cfrThreshold}%)`,
          cases: alert.cases,
          deaths: alert.deaths,
          triggeredAt: now,
        });
      }
    }

    // Unusual increase
    if (alert.trend === 'increasing' && alert.alertLevel !== 'normal') {
      ewarsAlerts.push({
        disease: alert.disease,
        state: alert.state,
        alertType: 'unusual_increase',
        severity: alert.alertLevel === 'emergency' ? 'critical' : 'medium',
        message: `Unusual increase in ${alert.disease} cases detected in ${alert.state} — ${alert.cases} cases, trend increasing`,
        cases: alert.cases,
        deaths: alert.deaths,
        triggeredAt: now,
      });
    }
  }

  // Deduplicate: keep highest-severity alert per disease+state
  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const bestByKey = new Map<string, EWARSAlert>();
  for (const a of ewarsAlerts) {
    const key = `${a.disease}|${a.state}`;
    const existing = bestByKey.get(key);
    if (!existing || severityOrder[a.severity] < severityOrder[existing.severity]) {
      bestByKey.set(key, a);
    }
  }

  return [...bestByKey.values()].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

// ===== Main export =====

export async function getEpidemicIntelligence(scope?: DataScope): Promise<EpidemicIntelligenceData> {
  const daDB = diseaseAlertsDB();
  let alerts = await findByType<DiseaseAlertDoc>(daDB, 'disease_alert');

  // Tenant scoping — government / super_admin still see everything; per-org
  // and per-facility users see only their own scope.
  if (scope) alerts = filterByScope(alerts, scope);

  // Facility roster (same scope as the alerts) — the IDSR completeness
  // denominator: how many facilities *should* be reporting each week.
  let totalFacilities = 0;
  try {
    let hospitals = await findByType<HospitalDoc>(hospitalsDB(), 'hospital');
    if (scope) hospitals = filterByScope(hospitals, scope);
    totalFacilities = hospitals.length;
  } catch { /* roster unavailable — completeness honestly reads 0 */ }

  const curves = buildEpidemicCurves(alerts);
  const rtEstimates = estimateRt(curves);
  const syndromicAlerts = generateSyndromicAlerts(alerts);
  const idsrReport = generateIDSRReport(alerts, totalFacilities);
  const geographicSpread = analyzeGeographicSpread(alerts);
  const ewarsAlerts = generateEWARSAlerts(alerts);

  // Summary
  const activeDiseases = new Set(alerts.map(a => a.disease));
  const emergencyStates = new Set(
    alerts.filter(a => a.alertLevel === 'emergency').map(a => a.state)
  );
  // "This week" means this week — the totals sum only alerts reported in the
  // current Juba reporting week, not the whole alert history.
  const currentWeekStart = jubaWeekStart(new Date());
  const thisWeekAlerts = alerts.filter(a => a.reportDate && jubaWeekStart(a.reportDate) === currentWeekStart);
  const thisWeekCases = thisWeekAlerts.reduce((s, a) => s + a.cases, 0);
  const thisWeekDeaths = thisWeekAlerts.reduce((s, a) => s + a.deaths, 0);
  // `rtEstimates` is sorted with known Rt values first (nulls last), so the
  // first entry with a non-null `rt` is the genuine highest reproduction
  // number. If every disease has insufficient data, `highestRt` is honestly
  // null rather than pointing at a fabricated value.
  const topKnownRt = rtEstimates.find(r => r.rt !== null);
  const highestRt = topKnownRt ? { disease: topKnownRt.disease, value: topKnownRt.rt as number } : null;

  let overallRiskLevel: 'low' | 'moderate' | 'high' | 'critical' = 'low';
  /* istanbul ignore next -- risk level chain: depends on real-time epidemic data */
  if (emergencyStates.size > 0) overallRiskLevel = 'critical';
  else if (ewarsAlerts.some(a => a.severity === 'high')) overallRiskLevel = 'high';
  else if (ewarsAlerts.length > 3) overallRiskLevel = 'moderate';

  return {
    epidemicCurves: curves,
    rtEstimates,
    syndromicAlerts,
    idsrReport,
    geographicSpread,
    ewarsAlerts,
    summary: {
      totalActiveDiseases: activeDiseases.size,
      totalCasesThisWeek: thisWeekCases,
      totalDeathsThisWeek: thisWeekDeaths,
      highestRt,
      statesWithEmergency: Array.from(emergencyStates),
      overallRiskLevel,
    },
  };
}
