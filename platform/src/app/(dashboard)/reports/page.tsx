'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  FileText, Download, Activity, Users, Pill, BedDouble, TrendingUp,
  ChevronUp, ChevronLeft, ChevronRight, Loader2, BarChart3, PieChart, Layers, List,
  AlertTriangle, type LucideIcon
} from '@/components/icons/lucide';
import { buildReportChart, type ReportChart as ReportChartData } from '@/lib/reports/report-chart-data';
import { supportsPartToWhole, type ReportChartKind } from './_ReportCharts';
import { DISEASE_COLOR } from '@/lib/chart-colors';
import { useTranslation } from '@/lib/i18n/useTranslation';
import EmptyState from '@/components/EmptyState';
import { usePatients } from '@/lib/hooks/usePatients';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { useReferrals } from '@/lib/hooks/useReferrals';
import { useSurveillance } from '@/lib/hooks/useSurveillance';
import { useLabResults } from '@/lib/hooks/useLabResults';
import { usePharmacyInventory } from '@/lib/hooks/usePharmacyInventory';
import { usePayments, useLedger } from '@/lib/hooks/usePayments';
import { useDataScope } from '@/lib/hooks/useDataScope';
import type { BillingDoc } from '@/lib/db-types-billing';
import { ESSENTIAL_MEDICINES } from '@/lib/services/supply-chain-service';
import { classifyStockStatus, dispensedTodayOf } from '@/lib/services/pharmacy-inventory-service';
import Select from '@/components/Select';
import { downloadCsv, safeFilenamePart } from '@/lib/export-file';

/* ── Charts ────────────────────────────────────────────────────────
 * recharts (~80-100 KB) sits behind a dynamic boundary so the catalogue —
 * which is what most visits are here for — does not pay for it. The fixed
 * `loading` heights stop the page reflowing as each chart arrives. */
const ReportChart = dynamic(
  () => import('./_ReportCharts').then(m => m.ReportChart),
  { ssr: false, loading: () => <div style={{ height: '100%' }} /> },
);

/** The forms on offer, in the order their buttons appear — standing columns
 *  lead because they are the default. `partToWhole` marks the two that need
 *  values which add up — see `supportsPartToWhole`. */
const CHART_KINDS: { id: ReportChartKind; labelKey: string; icon: LucideIcon; partToWhole?: true }[] = [
  { id: 'column', labelKey: 'reports.chartColumn', icon: BarChart3 },
  { id: 'bar', labelKey: 'reports.chartBar', icon: List },
  { id: 'lollipop', labelKey: 'reports.chartLollipop', icon: Activity },
  { id: 'donut', labelKey: 'reports.chartDonut', icon: PieChart, partToWhole: true },
  { id: 'treemap', labelKey: 'reports.chartTreemap', icon: Layers, partToWhole: true },
];

/** The one hue a section's ranked charts draw in. Bright categorical slots
 *  from globals.css — identity per SECTION, stable as you step through its
 *  reports; within one chart a single series stays a single hue. Disease
 *  surveillance points that name an actual disease override this with the
 *  entity colour that disease holds on every other screen. */
const SECTION_ACCENT: Record<string, string> = {
  'Patient Statistics': 'var(--chart-2)',      // brand blue
  'Disease Surveillance': 'var(--chart-3)',    // rose
  'Pharmacy & Supply Chain': 'var(--chart-4)', // teal
  'Hospital Operations': 'var(--chart-6)',     // violet
  'Financial': 'var(--chart-5)',               // orange
};

/* ── Static report definitions ─────────────────────────────────── */
// NOTE: this page does not yet track per-report refresh times — every report
// is regenerated on demand from live PouchDB queries. The "Last:" stamp
// shown next to each card therefore reports today's date (the date the page
// was rendered) rather than a stored last-run timestamp. When per-report
// refresh history is wired up (e.g. via a `report_runs` doc keyed by report
// name), replace `todayIso` below with that lookup.
const reports = [
  {
    category: 'Patient Statistics',
    icon: Users,
    items: [
      { name: 'Daily Patient Census', description: 'Summary of admissions, discharges, and bed occupancy', period: 'Daily' },
      { name: 'Monthly OPD Summary', description: 'Outpatient department visits by department and diagnosis', period: 'Monthly' },
      { name: 'Patient Demographics Report', description: 'Age, gender, ethnicity, and geographic distribution', period: 'Quarterly' },
    ],
  },
  {
    category: 'Disease Surveillance',
    icon: Activity,
    items: [
      { name: 'IDSR Weekly Report', description: 'Integrated Disease Surveillance & Response for WHO', period: 'Weekly' },
      { name: 'Notifiable Diseases Report', description: 'Cholera, measles, meningitis, and other notifiable conditions', period: 'Weekly' },
      { name: 'Malaria Indicators Report', description: 'RDT positivity, treatment outcomes, and geographic distribution', period: 'Monthly' },
      { name: 'TB Treatment Outcomes', description: 'Case detection, cure rates, and default tracking', period: 'Quarterly' },
      { name: 'HIV/AIDS Program Report', description: 'ART enrollment, viral load suppression, PMTCT', period: 'Monthly' },
    ],
  },
  {
    category: 'Pharmacy & Supply Chain',
    icon: Pill,
    items: [
      { name: 'Drug Consumption Report', description: 'Medication usage patterns and dispensing statistics', period: 'Monthly' },
      { name: 'Stock Status Report', description: 'Inventory levels, stockouts, and expiry alerts', period: 'Weekly' },
      { name: 'Essential Medicines Availability', description: 'Availability of WHO essential medicines tracer list', period: 'Monthly' },
    ],
  },
  {
    category: 'Hospital Operations',
    icon: BedDouble,
    items: [
      { name: 'Bed Occupancy Report', description: 'Ward-wise bed utilization and average length of stay', period: 'Daily' },
      { name: 'Referral Summary', description: 'Incoming and outgoing referrals by hospital and diagnosis', period: 'Monthly' },
      { name: 'Staff Productivity Report', description: 'Patient-to-provider ratio and consultation volumes', period: 'Monthly' },
    ],
  },
  {
    category: 'Financial',
    icon: TrendingUp,
    items: [
      { name: 'Revenue Report', description: 'Cost-recovery service charges and collections', period: 'Monthly' },
      { name: 'Donor Reporting Pack', description: 'GAVI, Global Fund, and partner reporting requirements', period: 'Quarterly' },
    ],
  },
];

/* ── Display-text translation lookups (keyed by stable identifiers) ──
 * Module-scope so the search/filter memo below keeps stable deps. */
const categoryKey: Record<string, string> = {
  'Patient Statistics': 'reports.categoryPatientStatistics',
  'Disease Surveillance': 'reports.categoryDiseaseSurveillance',
  'Pharmacy & Supply Chain': 'reports.categoryPharmacySupplyChain',
  'Hospital Operations': 'reports.categoryHospitalOperations',
  'Financial': 'reports.categoryFinancial',
};
const reportNameKey: Record<string, string> = {
  'Daily Patient Census': 'reports.nameDailyPatientCensus',
  'Monthly OPD Summary': 'reports.nameMonthlyOpdSummary',
  'Patient Demographics Report': 'reports.namePatientDemographics',
  'IDSR Weekly Report': 'reports.nameIdsrWeekly',
  'Notifiable Diseases Report': 'reports.nameNotifiableDiseases',
  'Malaria Indicators Report': 'reports.nameMalariaIndicators',
  'TB Treatment Outcomes': 'reports.nameTbTreatmentOutcomes',
  'HIV/AIDS Program Report': 'reports.nameHivAidsProgram',
  'Drug Consumption Report': 'reports.nameDrugConsumption',
  'Stock Status Report': 'reports.nameStockStatus',
  'Essential Medicines Availability': 'reports.nameEssentialMedicines',
  'Bed Occupancy Report': 'reports.nameBedOccupancy',
  'Referral Summary': 'reports.nameReferralSummary',
  'Staff Productivity Report': 'reports.nameStaffProductivity',
  'Revenue Report': 'reports.nameRevenue',
  'Donor Reporting Pack': 'reports.nameDonorReporting',
};
const reportDescKey: Record<string, string> = {
  'Daily Patient Census': 'reports.descDailyPatientCensus',
  'Monthly OPD Summary': 'reports.descMonthlyOpdSummary',
  'Patient Demographics Report': 'reports.descPatientDemographics',
  'IDSR Weekly Report': 'reports.descIdsrWeekly',
  'Notifiable Diseases Report': 'reports.descNotifiableDiseases',
  'Malaria Indicators Report': 'reports.descMalariaIndicators',
  'TB Treatment Outcomes': 'reports.descTbTreatmentOutcomes',
  'HIV/AIDS Program Report': 'reports.descHivAidsProgram',
  'Drug Consumption Report': 'reports.descDrugConsumption',
  'Stock Status Report': 'reports.descStockStatus',
  'Essential Medicines Availability': 'reports.descEssentialMedicines',
  'Bed Occupancy Report': 'reports.descBedOccupancy',
  'Referral Summary': 'reports.descReferralSummary',
  'Staff Productivity Report': 'reports.descStaffProductivity',
  'Revenue Report': 'reports.descRevenue',
  'Donor Reporting Pack': 'reports.descDonorReporting',
};
const periodKey: Record<string, string> = {
  Daily: 'reports.periodDaily',
  Weekly: 'reports.periodWeekly',
  Monthly: 'reports.periodMonthly',
  Quarterly: 'reports.periodQuarterly',
};

/* ── Component ─────────────────────────────────────────────────── */
export default function ReportsPage() {
  const { t } = useTranslation();
  const { patients, loading: patientsLoading } = usePatients();
  const { hospitals, loading: hospitalsLoading } = useHospitals();
  const { referrals, loading: referralsLoading } = useReferrals();
  const { alerts, loading: alertsLoading } = useSurveillance();
  const { results: labResults, loading: labLoading } = useLabResults();
  const { items: inventoryItems, loading: inventoryLoading } = usePharmacyInventory();
  const { payments, loading: paymentsLoading } = usePayments();
  const { ledger, loading: ledgerLoading } = useLedger();
  const scope = useDataScope();
  const [bills, setBills] = useState<BillingDoc[]>([]);
  const [billsLoading, setBillsLoading] = useState(true);

  const loadBills = useCallback(async () => {
    if (!scope) {
      setBills([]);
      setBillsLoading(false);
      return;
    }
    setBillsLoading(true);
    try {
      const { getAllBills } = await import('@/lib/services/billing-service');
      setBills(await getAllBills(scope));
    } catch (err) {
      console.error('Failed to load report billing data', err);
      setBills([]);
    } finally {
      setBillsLoading(false);
    }
  }, [scope]);

  useEffect(() => { loadBills(); }, [loadBills]);

  const dataLoading = patientsLoading || hospitalsLoading || referralsLoading || alertsLoading || labLoading
    || inventoryLoading || paymentsLoading || ledgerLoading || billsLoading;

  // Whether the selected report's table is shown under the graph. One flag,
  // not a per-card open/closed map: there is one report on screen now.
  const [tableOpen, setTableOpen] = useState(false);
  // Which form the graph takes. Standing columns by default; held across
  // report changes on purpose: a reader who chose a treemap wants treemaps,
  // not a reset on every step.
  const [chartKind, setChartKind] = useState<ReportChartKind>('column');
  // No period selector: the old dropdown offered three hardcoded months
  // (stale within weeks of shipping) and filtered NOTHING — every report is
  // generated over all records, and the control labelled that all-time data
  // as a specific past month. Until report generation takes a real date
  // filter, the page states the true window instead of simulating a choice.

  // Which report the page's one graph is showing. Every report reduces to the
  // same shape, so drawing each of them its own chart — sixteen card
  // sparklines, four fixed overview panels, one more inside each expanded
  // report — was the same graph twenty-one times. There is one now, and this
  // is what it points at.
  const [chartReport, setChartReport] = useState<string>(reports[0].items[0].name);

  /* ── Generate report data ───────────────────────────────────── */
  const generateReportData = useMemo(() => {
    return (reportName: string): { rows: Record<string, unknown>[]; title: string; placeholder?: string } => {
      switch (reportName) {
        /* ─── Daily Patient Census ─────────────────────────── */
        case 'Daily Patient Census': {
          const byState: Record<string, { total: number; male: number; female: number; active: number }> = {};
          patients.forEach(p => {
            const st = p.state || 'Unknown';
            if (!byState[st]) byState[st] = { total: 0, male: 0, female: 0, active: 0 };
            byState[st].total++;
            if (p.gender === 'Male') byState[st].male++;
            else byState[st].female++;
            if (p.isActive) byState[st].active++;
          });
          const rows = Object.entries(byState).map(([state, d]) => ({
            State: state,
            'Total Patients': d.total,
            Male: d.male,
            Female: d.female,
            'Active Patients': d.active,
          }));
          rows.push({
            State: 'TOTAL',
            'Total Patients': patients.length,
            Male: patients.filter(p => p.gender === 'Male').length,
            Female: patients.filter(p => p.gender === 'Female').length,
            'Active Patients': patients.filter(p => p.isActive).length,
          });
          return { rows, title: 'Daily Patient Census' };
        }

        /* ─── Monthly OPD Summary ─────────────────────────── */
        case 'Monthly OPD Summary': {
          // `lastVisitHospital` stores an id, so the rows (and the chart's
          // category axis) read "hosp-002" unless it is resolved against the
          // facilities already loaded on this page.
          const hospitalName = (idOrName: string) =>
            hospitals.find(h => h._id === idOrName)?.name || idOrName;
          const byHospital: Record<string, number> = {};
          patients.forEach(p => {
            const h = hospitalName(p.lastVisitHospital || p.registrationHospital || 'Unknown');
            byHospital[h] = (byHospital[h] || 0) + 1;
          });
          const rows = Object.entries(byHospital)
            .sort((a, b) => b[1] - a[1])
            .map(([hospital, count]) => ({
              Hospital: hospital,
              'Patient Visits': count,
            }));
          return { rows, title: 'Monthly OPD Summary' };
        }

        /* ─── Patient Demographics Report ─────────────────── */
        case 'Patient Demographics Report': {
          const byTribe: Record<string, number> = {};
          const byGender: Record<string, number> = { Male: 0, Female: 0 };
          const byBloodType: Record<string, number> = {};
          patients.forEach(p => {
            const t = p.tribe || 'Unknown';
            byTribe[t] = (byTribe[t] || 0) + 1;
            if (p.gender === 'Male') byGender.Male++;
            else byGender.Female++;
            const bt = p.bloodType || 'Unknown';
            byBloodType[bt] = (byBloodType[bt] || 0) + 1;
          });
          const rows = Object.entries(byTribe)
            .sort((a, b) => b[1] - a[1])
            .map(([tribe, count]) => ({
              Tribe: tribe,
              Count: count,
              'Percentage (%)': patients.length > 0 ? ((count / patients.length) * 100).toFixed(1) : '0',
            }));
          return { rows, title: 'Patient Demographics Report' };
        }

        /* ─── IDSR Weekly Report ──────────────────────────── */
        case 'IDSR Weekly Report': {
          const byDisease: Record<string, { cases: number; deaths: number; alertLevel: string; states: Set<string> }> = {};
          alerts.forEach(a => {
            if (!byDisease[a.disease]) {
              byDisease[a.disease] = { cases: 0, deaths: 0, alertLevel: 'normal', states: new Set() };
            }
            byDisease[a.disease].cases += a.cases;
            byDisease[a.disease].deaths += a.deaths;
            byDisease[a.disease].states.add(a.state);
            // Keep the highest alert level
            const levels = ['normal', 'watch', 'warning', 'emergency'];
            if (levels.indexOf(a.alertLevel) > levels.indexOf(byDisease[a.disease].alertLevel)) {
              byDisease[a.disease].alertLevel = a.alertLevel;
            }
          });
          const rows = Object.entries(byDisease)
            .sort((a, b) => b[1].cases - a[1].cases)
            .map(([disease, d]) => ({
              Disease: disease,
              'Total Cases': d.cases,
              Deaths: d.deaths,
              'CFR (%)': d.cases > 0 ? ((d.deaths / d.cases) * 100).toFixed(1) : '0',
              'Alert Level': d.alertLevel,
              'Affected States': d.states.size,
            }));
          return { rows, title: 'IDSR Weekly Report' };
        }

        /* ─── Notifiable Diseases Report ──────────────────── */
        case 'Notifiable Diseases Report': {
          const notifiable = alerts.filter(a =>
            ['Cholera', 'Measles', 'Meningitis', 'Hepatitis E'].includes(a.disease)
          );
          const rows = notifiable.map(a => ({
            Disease: a.disease,
            State: a.state,
            County: a.county,
            Cases: a.cases,
            Deaths: a.deaths,
            'Alert Level': a.alertLevel,
            'Report Date': a.reportDate,
            Trend: a.trend,
          }));
          return { rows, title: 'Notifiable Diseases Report' };
        }

        /* ─── Malaria Indicators Report ───────────────────── */
        case 'Malaria Indicators Report': {
          const malariaAlerts = alerts.filter(a => a.disease === 'Malaria');
          const rows: Record<string, unknown>[] = malariaAlerts.map(a => ({
            State: a.state,
            County: a.county,
            Cases: a.cases,
            Deaths: a.deaths,
            'CFR (%)': a.cases > 0 ? ((a.deaths / a.cases) * 100).toFixed(1) : '0',
            Trend: a.trend,
            'Alert Level': a.alertLevel,
          }));
          if (rows.length === 0) {
            return { rows: [], title: 'Malaria Indicators Report', placeholder: t('reports.placeholderMalaria') };
          }
          return { rows, title: 'Malaria Indicators Report' };
        }

        /* ─── TB Treatment Outcomes ───────────────────────── */
        case 'TB Treatment Outcomes': {
          const tbAlerts = alerts.filter(a => a.disease === 'Tuberculosis');
          const rows = tbAlerts.map(a => ({
            State: a.state,
            County: a.county,
            Cases: a.cases,
            Deaths: a.deaths,
            'Alert Level': a.alertLevel,
            Trend: a.trend,
          }));
          if (rows.length === 0) {
            return { rows: [], title: 'TB Treatment Outcomes', placeholder: t('reports.placeholderTb') };
          }
          return { rows, title: 'TB Treatment Outcomes' };
        }

        /* ─── HIV/AIDS Program Report ─────────────────────── */
        case 'HIV/AIDS Program Report': {
          // Program indicators derived from HIV-related lab activity
          // (rapid tests, confirmatory tests, CD4 counts, viral loads).
          const HIV_TEST_RE = /hiv|cd4|viral\s*load|art\b/i;
          const hivResults = labResults.filter(r => HIV_TEST_RE.test(r.testName));
          if (hivResults.length === 0) {
            return { rows: [], title: 'HIV/AIDS Program Report', placeholder: t('reports.placeholderHivAids') };
          }
          const POSITIVE_RE = /positive|reactive|detected/i;
          const byTest: Record<string, {
            ordered: number; completed: number; positive: number; abnormal: number; facilities: Set<string>;
          }> = {};
          hivResults.forEach(r => {
            const key = r.testName;
            if (!byTest[key]) byTest[key] = { ordered: 0, completed: 0, positive: 0, abnormal: 0, facilities: new Set() };
            const d = byTest[key];
            d.ordered++;
            if (r.status === 'completed') {
              d.completed++;
              if (POSITIVE_RE.test(r.result || '')) d.positive++;
              if (r.abnormal) d.abnormal++;
            }
            d.facilities.add(r.hospitalName || r.hospitalId || 'Unknown');
          });
          const rows: Record<string, unknown>[] = Object.entries(byTest)
            .sort((a, b) => b[1].ordered - a[1].ordered)
            .map(([test, d]) => ({
              Test: test,
              Ordered: d.ordered,
              Completed: d.completed,
              'Positive / Reactive': d.positive,
              'Positivity Rate (%)': d.completed > 0 ? ((d.positive / d.completed) * 100).toFixed(1) : '0.0',
              Abnormal: d.abnormal,
              Facilities: d.facilities.size,
            }));
          const totals = Object.values(byTest).reduce(
            (acc, d) => ({
              ordered: acc.ordered + d.ordered,
              completed: acc.completed + d.completed,
              positive: acc.positive + d.positive,
              abnormal: acc.abnormal + d.abnormal,
            }),
            { ordered: 0, completed: 0, positive: 0, abnormal: 0 },
          );
          rows.push({
            Test: 'TOTAL',
            Ordered: totals.ordered,
            Completed: totals.completed,
            'Positive / Reactive': totals.positive,
            'Positivity Rate (%)': totals.completed > 0 ? ((totals.positive / totals.completed) * 100).toFixed(1) : '0.0',
            Abnormal: totals.abnormal,
            Facilities: '',
          });
          return { rows, title: 'HIV/AIDS Program Report' };
        }

        /* ─── Drug Consumption Report ─────────────────────── */
        case 'Drug Consumption Report': {
          const byMedication: Record<string, { dispensedToday: number; currentStock: number; reorderLevel: number; facilities: Set<string>; unit: string }> = {};
          inventoryItems.forEach(item => {
            const key = item.medicationName || 'Unknown';
            if (!byMedication[key]) {
              byMedication[key] = {
                dispensedToday: 0,
                currentStock: 0,
                reorderLevel: 0,
                facilities: new Set(),
                unit: item.unit || '',
              };
            }
            // Day-guarded read — the raw counter can hold a stale or (on
            // pre-stamp docs) lifetime total (see dispensedTodayOf).
            byMedication[key].dispensedToday += dispensedTodayOf(item);
            byMedication[key].currentStock += item.stockLevel || 0;
            byMedication[key].reorderLevel += item.reorderLevel || 0;
            byMedication[key].facilities.add(item.hospitalName || item.hospitalId || 'Unknown');
          });
          const rows = Object.entries(byMedication)
            .sort((a, b) => b[1].dispensedToday - a[1].dispensedToday)
            .map(([medication, d]) => ({
              Medication: medication,
              'Dispensed Today': d.dispensedToday,
              'Current Stock': d.currentStock,
              'Reorder Level': d.reorderLevel,
              Unit: d.unit,
              Facilities: d.facilities.size,
            }));
          return { rows, title: 'Drug Consumption Report' };
        }

        /* ─── Stock Status Report ─────────────────────────── */
        case 'Stock Status Report': {
          const rows = inventoryItems
            .map(item => {
              const status = item.stockLevel <= 0 ? 'stockout' : classifyStockStatus(item);
              return {
                Facility: item.hospitalName || item.hospitalId,
                Medication: item.medicationName,
                Category: item.category,
                Status: status,
                'Stock Level': item.stockLevel,
                'Reorder Level': item.reorderLevel,
                Unit: item.unit,
                'Batch Number': item.batchNumber,
                'Expiry Date': item.expiryDate,
                'Dispensed Today': item.dispensedToday || 0,
              };
            })
            .sort((a, b) => String(a.Status).localeCompare(String(b.Status)) || String(a.Medication).localeCompare(String(b.Medication)));
          if (rows.length === 0) {
            return { rows: [], title: 'Stock Status Report', placeholder: t('reports.placeholderStockStatus') };
          }
          return { rows, title: 'Stock Status Report' };
        }

        /* ─── Essential Medicines Availability ────────────── */
        case 'Essential Medicines Availability': {
          const rows = ESSENTIAL_MEDICINES.map(medicine => {
            const matches = inventoryItems.filter(item =>
              item.medicationName.toLowerCase().includes(medicine.toLowerCase())
            );
            const totalStock = matches.reduce((sum, item) => sum + (item.stockLevel || 0), 0);
            const facilitiesStocked = new Set(matches.filter(item => (item.stockLevel || 0) > 0).map(item => item.hospitalId)).size;
            const lowestStatus = matches.reduce<string>((worst, item) => {
              const status = item.stockLevel <= 0 ? 'stockout' : classifyStockStatus(item);
              const rank: Record<string, number> = { adequate: 0, low: 1, critical: 2, expired: 3, stockout: 4, missing: 5 };
              return rank[status] > rank[worst] ? status : worst;
            }, matches.length ? 'adequate' : 'missing');
            return {
              Medicine: medicine,
              Availability: totalStock > 0 ? 'Available' : 'Gap',
              Status: lowestStatus,
              'Total Stock': totalStock,
              'Facilities Stocked': facilitiesStocked,
              'SKUs Tracked': matches.length,
            };
          });
          return { rows, title: 'Essential Medicines Availability' };
        }

        /* ─── Bed Occupancy Report ────────────────────────── */
        case 'Bed Occupancy Report': {
          const rows = hospitals.map(h => ({
            Hospital: h.name,
            State: h.state,
            'Facility Type': h.facilityType,
            'Total Beds': h.totalBeds,
            'ICU Beds': h.icuBeds ?? 0,
            'Maternity Beds': h.maternityBeds ?? 0,
            'Pediatric Beds': h.pediatricBeds ?? 0,
          }));
          return { rows, title: 'Bed Occupancy Report' };
        }

        /* ─── Referral Summary ────────────────────────────── */
        case 'Referral Summary': {
          const byStatus: Record<string, number> = {};
          const byUrgency: Record<string, number> = {};
          const byToHospital: Record<string, number> = {};
          referrals.forEach(r => {
            byStatus[r.status] = (byStatus[r.status] || 0) + 1;
            byUrgency[r.urgency] = (byUrgency[r.urgency] || 0) + 1;
            byToHospital[r.toHospital] = (byToHospital[r.toHospital] || 0) + 1;
          });
          const rows: Record<string, unknown>[] = [];
          rows.push({ Category: 'BY STATUS', Metric: '', Count: '' });
          Object.entries(byStatus).forEach(([status, count]) => {
            rows.push({ Category: '', Metric: status.charAt(0).toUpperCase() + status.slice(1), Count: count });
          });
          rows.push({ Category: 'BY URGENCY', Metric: '', Count: '' });
          Object.entries(byUrgency).forEach(([urgency, count]) => {
            rows.push({ Category: '', Metric: urgency.charAt(0).toUpperCase() + urgency.slice(1), Count: count });
          });
          rows.push({ Category: 'BY DESTINATION', Metric: '', Count: '' });
          Object.entries(byToHospital).sort((a, b) => b[1] - a[1]).forEach(([hospital, count]) => {
            rows.push({ Category: '', Metric: hospital, Count: count });
          });
          return { rows, title: 'Referral Summary' };
        }

        /* ─── Staff Productivity Report ───────────────────── */
        case 'Staff Productivity Report': {
          const rows = hospitals.map(h => ({
            Hospital: h.name,
            Doctors: h.doctors ?? 0,
            'Clinical Officers': h.clinicalOfficers ?? 0,
            Nurses: h.nurses ?? 0,
            'Lab Technicians': h.labTechnicians ?? 0,
            Pharmacists: h.pharmacists ?? 0,
            'Total Beds': h.totalBeds,
            // Real registrations — HospitalDoc.patientCount is a
            // write-once-zero registry field (2026-08 hardcoded-data sweep).
            'Patients Registered': patients.filter(p => p.registrationHospital === h._id).length,
          }));
          return { rows, title: 'Staff Productivity Report' };
        }

        /* ─── Revenue Report ──────────────────────────────── */
        case 'Revenue Report': {
          const byFacility: Record<string, {
            charged: number;
            collected: number;
            outstanding: number;
            waived: number;
            bills: number;
            payments: number;
            currency: string;
          }> = {};
          const ensure = (facility: string, currency = 'SSP') => {
            if (!byFacility[facility]) {
              byFacility[facility] = { charged: 0, collected: 0, outstanding: 0, waived: 0, bills: 0, payments: 0, currency };
            }
            return byFacility[facility];
          };
          bills.forEach(bill => {
            const row = ensure(bill.facilityName || bill.facilityId || 'Unknown', bill.currency);
            row.charged += bill.totalAmount || 0;
            row.outstanding += bill.balanceDue || 0;
            row.waived += bill.status === 'waived' ? (bill.totalAmount || 0) : 0;
            row.bills += 1;
          });
          payments
            .filter(payment => payment.status === 'posted')
            .forEach(payment => {
              const relatedBill = payment.invoiceId ? bills.find(bill => bill._id === payment.invoiceId) : undefined;
              const row = ensure(relatedBill?.facilityName || relatedBill?.facilityId || 'Unallocated payments', payment.currency);
              row.collected += payment.amount || 0;
              row.payments += 1;
            });
          if (payments.length === 0) {
            ledger
              .filter(entry => entry.entryType === 'payment' || entry.entryType === 'insurance_payment')
              .forEach(entry => {
                const row = ensure(entry.facilityId || 'Ledger collections', entry.currency);
                row.collected += Math.abs(entry.amount || 0);
              });
          }
          const rows = Object.entries(byFacility)
            .sort((a, b) => b[1].charged - a[1].charged)
            .map(([facility, d]) => ({
              Facility: facility,
              Currency: d.currency,
              'Bills Issued': d.bills,
              'Payments Posted': d.payments,
              'Gross Charges': d.charged.toFixed(2),
              'Collected': d.collected.toFixed(2),
              'Outstanding': d.outstanding.toFixed(2),
              'Waived': d.waived.toFixed(2),
              'Collection Rate (%)': d.charged > 0 ? ((d.collected / d.charged) * 100).toFixed(1) : '0.0',
            }));
          if (rows.length === 0) {
            return { rows: [], title: 'Revenue Report', placeholder: t('reports.placeholderRevenue') };
          }
          return { rows, title: 'Revenue Report' };
        }

        /* ─── Donor Reporting Pack ────────────────────────── */
        case 'Donor Reporting Pack': {
          const totalCases = alerts.reduce((sum, a) => sum + a.cases, 0);
          const totalDeaths = alerts.reduce((sum, a) => sum + a.deaths, 0);
          const rows: Record<string, unknown>[] = [
            { Indicator: 'Total Registered Patients', Value: patients.length },
            { Indicator: 'Active Patients', Value: patients.filter(p => p.isActive).length },
            { Indicator: 'Hospitals in Network', Value: hospitals.length },
            { Indicator: 'Total Referrals Processed', Value: referrals.length },
            { Indicator: 'Completed Referrals', Value: referrals.filter(r => r.status === 'completed').length },
            { Indicator: 'Lab Tests Conducted', Value: labResults.length },
            { Indicator: 'Lab Tests Completed', Value: labResults.filter(r => r.status === 'completed').length },
            { Indicator: 'Disease Alerts Active', Value: alerts.length },
            { Indicator: 'Total Disease Cases Reported', Value: totalCases },
            { Indicator: 'Total Deaths Reported', Value: totalDeaths },
          ];
          return { rows, title: 'Donor Reporting Pack' };
        }

        default:
          return { rows: [], title: reportName, placeholder: t('reports.placeholderNoGenerator') };
      }
    };
  }, [patients, hospitals, referrals, alerts, labResults, inventoryItems, bills, payments, ledger, t]);

  /* ── Catalogue previews ──────────────────────────────────────
   * Every report reduced to its bars once, rather than on each keystroke of
   * the search box: the memo is keyed on the generator (which is keyed on the
   * data), not on the filter state, so typing re-filters an existing map
   * instead of re-aggregating sixteen reports over every patient and SKU. */
  const reportPreviews = useMemo(() => {
    const map = new Map<string, { chart: ReportChartData | null; rowCount: number }>();
    for (const section of reports) {
      for (const item of section.items) {
        const { rows } = generateReportData(item.name);
        map.set(item.name, { chart: buildReportChart(rows), rowCount: rows.length });
      }
    }
    return map;
  }, [generateReportData]);

  /* ── Overview band ───────────────────────────────────────────
   * The page loads every dataset the sixteen reports draw on and, until now,
   * showed none of it until something was expanded — a reporting screen with
   * no numbers on it. These are the headline figures those reports are about. */
  /** Every report, flattened — the list the dropdown lists and the arrows
   *  step through. The catalogue of cards is gone: one graph, and this is how
   *  you choose what it draws. */
  const chartableReports = useMemo(
    () => reports.flatMap(section =>
      section.items.map(item => ({ ...item, category: section.category }))),
    [],
  );

  const chartIndex = chartableReports.findIndex(r => r.name === chartReport);
  const activeReport = chartableReports[chartIndex] ?? chartableReports[0];
  const stepChart = (delta: number) => {
    const next = (chartIndex + delta + chartableReports.length) % chartableReports.length;
    setChartReport(chartableReports[next].name);
    setTableOpen(false);
  };

  /** The selected report, as bars.
   *
   *  Diseases carry their own colour across every screen that charts them, so
   *  a surveillance report whose categories ARE diseases keeps those hues.
   *  All or nothing, though: the six-slot scale has no room for an eighth
   *  disease, and colouring the ones it knows while the rest fall back to the
   *  section accent is worse than colouring none — it painted HIV/AIDS the
   *  same rose as Measles, which reads as "these two are related". So the
   *  hues apply only when EVERY named category has one; otherwise the chart
   *  is one measure in one hue, which is what it actually is. A surveillance
   *  report whose categories are states (Malaria Indicators, TB Outcomes)
   *  lands there too. */
  const activeChart = useMemo(() => {
    const preview = reportPreviews.get(chartReport);
    if (!preview?.chart) return null;
    const named = preview.chart.points.filter(p => p.label !== 'Other');
    const hues = activeReport?.category === 'Disease Surveillance'
      ? named.map(p => DISEASE_COLOR[p.label.trim().toLowerCase()])
      : [];
    const everyCategoryKnown = hues.length > 0 && hues.every(Boolean);
    if (!everyCategoryKnown) return preview.chart;
    return {
      ...preview.chart,
      points: preview.chart.points.map(p => {
        const hue = DISEASE_COLOR[p.label.trim().toLowerCase()];
        return hue && p.label !== 'Other' ? { ...p, color: hue } : p;
      }),
    };
  }, [reportPreviews, chartReport, activeReport]);

  /** Headline figures for the strip above the plot, all read off the chart
   *  the reader is already looking at. Rates cannot be summed (three
   *  facilities at 80% are not 240%), so a rate report leads with its
   *  highest value instead of a total. */
  const chartInsights = useMemo(() => {
    if (!activeChart || activeChart.points.length === 0) return null;
    const isRate = /%|rate|percent/i.test(activeChart.valueLabel);
    const total = activeChart.points.reduce((sum, p) => sum + p.value, 0);
    // Points are sorted descending with "Other" appended last, so the first
    // named point is the leader even when the folded tail out-sums it.
    const top = activeChart.points.find(p => p.label !== 'Other') ?? activeChart.points[0];
    const share = !isRate && total > 0 ? Math.round((top.value / total) * 100) : null;
    return { isRate, total, top, share };
  }, [activeChart]);

  /* Donut and treemap encode a share of a total, so they are offered only when
   * the values actually add up. Falling back rather than disabling silently:
   * stepping from a count report to a rate report while a donut is on screen
   * must not leave a ring of percentages that sum to 240%. */
  const partToWholeOk = activeChart
    ? supportsPartToWhole(activeChart.valueLabel, activeChart.points)
    : false;
  const effectiveKind: ReportChartKind =
    (chartKind === 'donut' || chartKind === 'treemap') && !partToWholeOk ? 'column' : chartKind;

  /* ── Render expanded report section ─────────────────────────── */
  /** The selected report as a table, under the graph. The graph is the shape;
   *  this is the record, and the only place every row and column is visible. */
  const renderTable = (reportName: string) => {
    const { rows, title, placeholder } = generateReportData(reportName);

    if (placeholder || rows.length === 0) {
      return (
        <EmptyState
          icon={AlertTriangle}
          title={title}
          message={placeholder || t('reports.noDataForReport')}
        />
      );
    }

    const headers = Object.keys(rows[0]);
    return (
      <div className="rpt-table-scroll">
        <table className="rpt-table">
          <thead>
            <tr>{headers.map(h => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              // The generators mark their own summary and sub-heading rows;
              // both are read as structure, not as data, so they keep the
              // emphasis they had before this page was rebuilt.
              const first = String(row[headers[0]] ?? '');
              const cls = first === 'TOTAL' ? 'is-total' : /^BY /.test(first) ? 'is-section' : '';
              return (
                <tr key={i} className={cls}>
                  {headers.map(h => <td key={h}>{String(row[h] ?? '')}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <main className="page-container page-enter rpt-page">
      {/* ── The page: one graph, and the controls to choose what it draws ──
           There is no catalogue of cards any more. Sixteen reports all reduce
           to the same shape, so sixteen cards each carrying a preview of that
           shape said nothing the dropdown does not, and pushed the actual
           chart into a corner. Pick a report, read it, generate the table,
           export it — all without leaving one panel. */}
      <section className="rpt-stats">
        <header className="rpt-stats-head">
          <div className="rpt-stats-title">
            <BarChart3 />
            <div>
              <i className="rpt-eyebrow">{t('nav.reports')}</i>
              <b>{t(reportNameKey[chartReport] ?? chartReport)}</b>
              <span>
                {activeChart
                  ? t('reports.chartCaption', {
                      measure: activeChart.valueLabel,
                      category: activeChart.categoryLabel,
                    })
                  : t(reportDescKey[chartReport] ?? '')}
                {activeChart?.truncated && ` ${t('reports.chartTopOnly')}`}
              </span>
            </div>
            {activeReport && (
              <span className={`rpt-chip rpt-chip--${activeReport.period.toLowerCase()}`}>
                {t(periodKey[activeReport.period] ?? activeReport.period)}
              </span>
            )}
          </div>

          <div className="rpt-stats-nav">
            {/* Step to the neighbouring report without opening the dropdown. */}
            <button
              type="button"
              className="rpt-nav-btn"
              aria-label={t('reports.chartPrev')}
              onClick={() => stepChart(-1)}
            >
              <ChevronLeft />
            </button>
            <span className="rpt-nav-pos">{chartIndex + 1}/{chartableReports.length}</span>
            <button
              type="button"
              className="rpt-nav-btn"
              aria-label={t('reports.chartNext')}
              onClick={() => stepChart(1)}
            >
              <ChevronRight />
            </button>

            {/* Grouped by category, so the five groupings the catalogue used
                to spend a screen on survive as the shape of this list. */}
            <Select
              className="rpt-nav-select"
              value={chartReport}
              aria-label={t('reports.chartPick')}
              onChange={e => { setChartReport(e.target.value); setTableOpen(false); }}
            >
              {reports.map(section => (
                <optgroup key={section.category} label={t(categoryKey[section.category] ?? section.category)}>
                  {section.items.map(item => (
                    <option key={item.name} value={item.name}>
                      {t(reportNameKey[item.name] ?? item.name)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>

            {/* The honest period: all records to date (see the note where the
                fake month dropdown used to be defined). */}
            <span className="text-xs font-semibold px-2.5 py-1.5 rounded-lg" style={{ color: 'var(--text-muted)', background: 'var(--overlay-subtle)', whiteSpace: 'nowrap' }}>
              {t('reports.periodAllRecords')}
            </span>

            {/* Chart form. Only the honest ones for this data shape are here
                — see the note at the top of _ReportCharts.tsx for why line and
                area are not among them. */}
            <div className="rpt-kinds" role="radiogroup" aria-label={t('reports.chartForm')}>
              {CHART_KINDS.map(kind => {
                const blocked = kind.partToWhole && !partToWholeOk;
                return (
                  <button
                    key={kind.id}
                    type="button"
                    role="radio"
                    aria-checked={effectiveKind === kind.id}
                    className={effectiveKind === kind.id ? 'is-on' : ''}
                    disabled={blocked}
                    title={blocked ? t('reports.chartFormUnavailable') : t(kind.labelKey)}
                    aria-label={t(kind.labelKey)}
                    onClick={() => setChartKind(kind.id)}
                  >
                    <kind.icon />
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              className={`rpt-nav-generate ${tableOpen ? 'is-on' : ''}`.trim()}
              aria-expanded={tableOpen}
              disabled={dataLoading}
              onClick={() => setTableOpen(open => !open)}
            >
              {tableOpen
                ? <><ChevronUp /> {t('action.close')}</>
                : <><FileText /> {t('reports.generate')}</>}
            </button>

            <button
              type="button"
              className="rpt-nav-csv"
              disabled={dataLoading}
              data-track="reports.export_csv"
              onClick={() => {
                const { rows, title } = generateReportData(chartReport);
                if (rows.length) downloadCsv(rows, safeFilenamePart(title));
              }}
            >
              <Download /> {t('reports.downloadCsv')}
            </button>
          </div>
        </header>

        {/* Headline figures for the selected report — a reporting page should
            lead with its numbers, not make the reader measure bars for them. */}
        {!dataLoading && activeChart && chartInsights && (
          <div className="rpt-insights">
            <div className="rpt-insight">
              <b>{(chartInsights.isRate ? chartInsights.top.value : chartInsights.total).toLocaleString()}</b>
              <span>
                {activeChart.valueLabel}
                {chartInsights.isRate && ` · ${t('reports.insightHighest')}`}
              </span>
            </div>
            <div className="rpt-insight">
              <b>{chartInsights.top.label}</b>
              <span>
                {chartInsights.share !== null
                  ? t('reports.insightTopShare', { value: chartInsights.top.value.toLocaleString(), share: chartInsights.share })
                  : t('reports.insightTopValue', { value: chartInsights.top.value.toLocaleString() })}
              </span>
            </div>
            <div className="rpt-insight">
              <b>{activeChart.categoryCount.toLocaleString()}</b>
              <span>{t('reports.insightCategoryCount', { category: activeChart.categoryLabel })}</span>
            </div>
          </div>
        )}

        <div className="rpt-stats-body">
          {dataLoading ? (
            <p className="rpt-panel-empty">
              <Loader2 className="animate-spin" /> {t('reports.loadingReportData')}
            </p>
          ) : activeChart ? (
            <div className="rpt-plot" data-kind={effectiveKind}>
              <ReportChart
                kind={effectiveKind}
                points={activeChart.points}
                valueLabel={activeChart.valueLabel}
                accent={SECTION_ACCENT[activeReport?.category ?? ''] ?? 'var(--chart-2)'}
              />
            </div>
          ) : (
            <p className="rpt-panel-empty">{t('reports.noDataForReport')}</p>
          )}
        </div>

        {tableOpen && !dataLoading && (
          <div className="rpt-table-wrap">
            <div className="rpt-table-cap">
              <span>{t(reportNameKey[chartReport] ?? chartReport)}</span>
              <b>{t('reports.rowsAvailable', { count: reportPreviews.get(chartReport)?.rowCount ?? 0 })}</b>
            </div>
            {renderTable(chartReport)}
          </div>
        )}
      </section>
    </main>
  );
}
