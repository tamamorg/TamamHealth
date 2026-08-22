'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import EhrListHeader, { LIST_STAT_COLORS } from '@/components/ehr/EhrListHeader';
import {
  FileText, Download, Users, Activity, Pill, BedDouble, TrendingUp,
  ChevronUp, Loader2, BarChart3, AlertTriangle, Filter, Building2, Banknote
} from '@/components/icons/lucide';
import { buildReportChart, type ReportChart } from '@/lib/reports/report-chart-data';
import { diseaseColor } from '@/lib/chart-colors';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { useTranslation } from '@/lib/i18n/useTranslation';
import EmptyState from '@/components/EmptyState';
import { FilterSelect } from '@/components/filters';
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
import { classifyStockStatus } from '@/lib/services/pharmacy-inventory-service';
import Select from '@/components/Select';
import { todayIso as isoToday } from '@/lib/date-utils';
import { downloadCsv, safeFilenamePart } from '@/lib/export-file';

/* ── Charts ────────────────────────────────────────────────────────
 * recharts (~80-100 KB) sits behind a dynamic boundary so the catalogue —
 * which is what most visits are here for — does not pay for it. The fixed
 * `loading` heights stop the page reflowing as each chart arrives. */
const RankedBarChart = dynamic(
  () => import('./_ReportCharts').then(m => m.RankedBarChart),
  { ssr: false, loading: () => <div style={{ height: '100%' }} /> },
);
const DiseaseBurdenChart = dynamic(
  () => import('./_ReportCharts').then(m => m.DiseaseBurdenChart),
  { ssr: false, loading: () => <div style={{ height: '100%' }} /> },
);
const StockStatusDonut = dynamic(
  () => import('./_ReportCharts').then(m => m.StockStatusDonut),
  { ssr: false, loading: () => <div style={{ height: '100%' }} /> },
);

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

/** The statistics the picker offers, in the order they appear. */
const STAT_VIEWS = [
  { id: 'burden' as const, labelKey: 'reports.statViewBurden' },
  { id: 'patients' as const, labelKey: 'reports.statViewPatients' },
  { id: 'stock' as const, labelKey: 'reports.statViewStock' },
  { id: 'revenue' as const, labelKey: 'reports.statViewRevenue' },
];

/** Report cadences, in the order their stat dots appear in the header. */
const PERIODS = ['Daily', 'Weekly', 'Monthly', 'Quarterly'] as const;

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
  // The ledger's currency is facility policy, not a constant — the KPI label
  // has to name whichever one this facility actually bills in.
  const { currency } = useSettings();
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

  // Today's ISO date (YYYY-MM-DD). Reports are regenerated on demand from
  // live data, so the most accurate "last generated" stamp we can show
  // without a per-report run history is "today".
  const todayIso = isoToday();

  const [expandedReport, setExpandedReport] = useState<string | null>(null);
  // Reporting period selector. Reports regenerate on demand from live data, so
  // this is presentational only — it does not (yet) filter the underlying rows.
  const periodOptions = [
    { value: 'feb2026', label: t('reports.monthFeb2026') },
    { value: 'jan2026', label: t('reports.monthJan2026') },
    { value: 'dec2025', label: t('reports.monthDec2025') },
  ];
  const [reportPeriod, setReportPeriod] = useState('feb2026');

  // One statistic at a time. Four charts stacked down the page pushed the
  // catalogue below the fold and asked the reader to take in every dimension
  // at once; a picker shows the one they came for and keeps the whole page to
  // a single screen.
  const [statView, setStatView] = useState<'burden' | 'stock' | 'patients' | 'revenue'>('burden');

  // Category filter only. The search box was removed: sixteen reports in five
  // named groups are already scannable, and losing the input is what let the
  // statistics band and the catalogue share one screen.
  const [categoryFilter, setCategoryFilter] = useState('all');

  /* ── Visible catalogue (category filter + search) ─────────────── */
  const visibleSections = useMemo(
    () => reports.filter(section => categoryFilter === 'all' || section.category === categoryFilter),
    [categoryFilter],
  );

  // Stat dots: two lead counts plus the four cadences, which partition the
  // visible reports exactly — the row always adds up to the "Reports" count.
  const reportStats = useMemo(() => {
    const items = visibleSections.flatMap(section => section.items);
    return {
      total: items.length,
      categories: visibleSections.length,
      byPeriod: Object.fromEntries(
        PERIODS.map(p => [p, items.filter(i => i.period === p).length]),
      ) as Record<(typeof PERIODS)[number], number>,
    };
  }, [visibleSections]);

  const periodDotColor: Record<(typeof PERIODS)[number], string> = {
    Daily: LIST_STAT_COLORS.green,
    Weekly: LIST_STAT_COLORS.amber,
    Monthly: LIST_STAT_COLORS.bronze,
    Quarterly: LIST_STAT_COLORS.purple,
  };

  /* ── Toggle report ──────────────────────────────────────────── */
  const toggleReport = (reportName: string) => {
    setExpandedReport(prev => (prev === reportName ? null : reportName));
  };

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
          const byHospital: Record<string, number> = {};
          patients.forEach(p => {
            const h = p.lastVisitHospital || p.registrationHospital || 'Unknown';
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
            byMedication[key].dispensedToday += item.dispensedToday || 0;
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
            'Patients Registered': h.patientCount ?? 0,
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
    const map = new Map<string, { chart: ReportChart | null; rowCount: number }>();
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
  const collectedTotal = useMemo(
    () => payments.filter(p => p.status === 'posted').reduce((sum, p) => sum + (p.amount || 0), 0),
    [payments],
  );

  const kpis = useMemo(() => ([
    { key: 'patients', icon: Users, label: t('reports.kpiPatients'), value: patients.length.toLocaleString() },
    { key: 'facilities', icon: Building2, label: t('reports.kpiFacilities'), value: hospitals.length.toLocaleString() },
    { key: 'signals', icon: Activity, label: t('reports.kpiSignals'), value: alerts.length.toLocaleString() },
    {
      key: 'collected', icon: Banknote, label: t('reports.kpiCollected', { currency }),
      value: collectedTotal > 0 ? Math.round(collectedTotal).toLocaleString() : '0',
    },
  ]), [patients.length, hospitals.length, alerts.length, collectedTotal, currency, t]);

  /** Top five diseases by reported cases — the five surveillance reports in
   *  the catalogue are all cuts of this one figure. */
  const diseaseBurden = useMemo(() => {
    const byDisease = new Map<string, number>();
    for (const a of alerts) byDisease.set(a.disease, (byDisease.get(a.disease) ?? 0) + a.cases);
    return [...byDisease.entries()]
      .map(([label, value]) => ({ label, value, color: diseaseColor(label) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [alerts]);

  /** Patients by state — the census reports' headline, ranked. */
  const patientsByState = useMemo(() => {
    const byState = new Map<string, number>();
    for (const p of patients) byState.set(p.state || 'Unknown', (byState.get(p.state || 'Unknown') ?? 0) + 1);
    return [...byState.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [patients]);

  /** Collected revenue by facility — the financial reports' headline. */
  const revenueByFacility = useMemo(() => {
    const byFacility = new Map<string, number>();
    for (const payment of payments) {
      if (payment.status !== 'posted') continue;
      const bill = payment.invoiceId ? bills.find(b => b._id === payment.invoiceId) : undefined;
      const name = bill?.facilityName || bill?.facilityId || t('reports.unallocated');
      byFacility.set(name, (byFacility.get(name) ?? 0) + (payment.amount || 0));
    }
    return [...byFacility.entries()]
      .map(([label, value]) => ({ label, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [payments, bills, t]);

  /** Stock mix for the pharmacy reports. Status colours, not the categorical
   *  palette — "critical" here means critical, which is what that palette is
   *  reserved for. */
  const stockMix = useMemo(() => {
    const counts: Record<string, number> = { adequate: 0, low: 0, critical: 0, expired: 0 };
    for (const item of inventoryItems) {
      const status = item.stockLevel <= 0 ? 'critical' : classifyStockStatus(item);
      counts[status] = (counts[status] ?? 0) + 1;
    }
    const meta: { key: string; label: string; color: string }[] = [
      { key: 'adequate', label: t('reports.stockAdequate'), color: 'var(--color-success)' },
      { key: 'low', label: t('reports.stockLow'), color: 'var(--color-warning)' },
      { key: 'critical', label: t('reports.stockCritical'), color: 'var(--color-danger)' },
      { key: 'expired', label: t('reports.stockExpired'), color: 'var(--text-muted)' },
    ];
    return meta
      .map(m => ({ ...m, value: counts[m.key] ?? 0 }))
      .filter(m => m.value > 0);
  }, [inventoryItems, t]);

  const stockTotal = useMemo(() => stockMix.reduce((sum, s) => sum + s.value, 0), [stockMix]);

  /* ── Render expanded report section ─────────────────────────── */
  const renderExpandedReport = (reportName: string) => {
    const { rows, title, placeholder } = generateReportData(reportName);

    if (placeholder || rows.length === 0) {
      return (
        <div className="mt-3">
          <EmptyState
            icon={AlertTriangle}
            title={title}
            message={placeholder || t('reports.noDataForReport')}
          />
        </div>
      );
    }

    const headers = Object.keys(rows[0]);
    const chart = reportPreviews.get(reportName)?.chart ?? buildReportChart(rows);

    return (
      <div
        className="mt-3 rounded-lg overflow-hidden"
        style={{ border: '1px solid var(--overlay-medium)' }}
      >
        {/* Report header bar */}
        <div
          className="flex items-center justify-between px-4 py-2"
          style={{ background: 'var(--overlay-light)' }}
        >
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4" style={{ color: 'var(--tamamhealth-blue)' }} />
            <span className="text-sm font-bold">{title}</span>
            <span
              className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: 'var(--accent-light)', color: 'var(--tamamhealth-blue)' }}
            >
              {rows.length} {rows.length === 1 ? t('reports.rowSingular') : t('reports.rowPlural')}
            </span>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            data-track="reports.export_csv"
            onClick={(e) => {
              e.stopPropagation();
              downloadCsv(rows, safeFilenamePart(title));
            }}
          >
            <Download className="w-3.5 h-3.5" /> {t('reports.downloadCsv')}
          </button>
        </div>

        {/* The same figures as bars, above the table rather than instead of it.
            The table stays the record — the chart is the shape of it, and a
            reader can always check one against the other. */}
        {chart && (
          <figure className="rpt-figure">
            <figcaption className="rpt-figure-cap">
              {t('reports.chartCaption', { measure: chart.valueLabel, category: chart.categoryLabel })}
              {chart.truncated && <span className="rpt-figure-note">{t('reports.chartTopOnly')}</span>}
            </figcaption>
            <div className="rpt-figure-plot" style={{ height: Math.max(150, chart.points.length * 30 + 40) }}>
              <RankedBarChart points={chart.points} valueLabel={chart.valueLabel} />
            </div>
          </figure>
        )}

        {/* Report table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 760 }}>
            <thead>
              <tr style={{ background: 'var(--overlay-light)' }}>
                {headers.map(h => (
                  <th
                    key={h}
                    className="text-start px-4 py-2 font-bold text-xs"
                    style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--overlay-medium)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const isTotal = String(row[headers[0]] ?? '') === 'TOTAL';
                const isSection = String(row[headers[0]] ?? '').match(/^BY /);
                return (
                  <tr
                    key={i}
                    style={{
                      borderBottom: '1px solid var(--overlay-light)',
                      background: isTotal
                        ? 'rgba(33, 145, 208, 0.06)'
                        : isSection
                          ? 'var(--overlay-light)'
                          : 'transparent',
                    }}
                  >
                    {headers.map(h => (
                      <td
                        key={h}
                        className="px-4 py-2"
                        style={{
                          color: isTotal || isSection ? 'var(--text-primary)' : 'var(--text-secondary)',
                          fontWeight: isTotal || isSection ? 600 : 400,
                        }}
                      >
                        {String(row[h] ?? '')}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <main className="page-container page-enter">
        <div className="card-elevated overflow-hidden mb-6">
          <EhrListHeader
            title={t('nav.reports')}
            stats={[
              { label: t('nav.reports'), value: reportStats.total, color: LIST_STAT_COLORS.muted },
              { label: t('reports.statCategories'), value: reportStats.categories, color: LIST_STAT_COLORS.blue },
              ...PERIODS.map(p => ({
                label: t(periodKey[p]),
                value: reportStats.byPeriod[p],
                color: periodDotColor[p],
              })),
            ]}
            actions={
              <>
                <div
                  className={`listpage-icon-select ${categoryFilter !== 'all' ? 'is-active' : ''}`}
                  title={t('reports.filterByCategory')}
                >
                  <Filter size={16} />
                  <Select
                    value={categoryFilter}
                    onChange={e => setCategoryFilter(e.target.value)}
                    aria-label={t('reports.filterByCategory')}
                  >
                    <option value="all">{t('reports.allCategories')}</option>
                    {reports.map(section => (
                      <option key={section.category} value={section.category}>
                        {t(categoryKey[section.category] ?? section.category)}
                      </option>
                    ))}
                  </Select>
                </div>
                <FilterSelect
                  value={reportPeriod}
                  onChange={setReportPeriod}
                  options={periodOptions}
                  neutralValue="feb2026"
                  aria-label={t('reports.pageTitle')}
                />
              </>
            }
          />
        </div>

        {/* ── At a glance ─────────────────────────────────────────
             The catalogue answers "which report"; this answers "what do they
             currently say". Both come from data already loaded for the
             generators, so it costs a render, not a query. */}
        {/* Rendered whether or not the data has arrived. Gating the whole band
            on `dataLoading` moved the catalogue down the page the moment it
            resolved, and `dataLoading` is the OR of nine hooks — one of them
            stalling would have hidden the band for the whole session rather
            than showing it empty. */}
        <section className="rpt-overview" aria-label={t('reports.overviewTitle')} aria-busy={dataLoading}>
            <div className="rpt-kpis">
              {kpis.map(kpi => (
                <div key={kpi.key} className="rpt-kpi">
                  <span className="rpt-kpi-icon"><kpi.icon /></span>
                  <div className="rpt-kpi-body">
                    <b>{dataLoading ? '—' : kpi.value}</b>
                    <span>{kpi.label}</span>
                  </div>
                </div>
              ))}
            </div>

            <section className="rpt-stats">
              <header className="rpt-stats-head">
                <div className="rpt-stats-title">
                  <BarChart3 />
                  <b>{t('reports.statsTitle')}</b>
                </div>
                {/* Radio group, not buttons: these are four views of one
                    panel, exactly one of which is current, and a screen
                    reader should hear it that way. */}
                <div className="rpt-seg" role="radiogroup" aria-label={t('reports.statsTitle')}>
                  {STAT_VIEWS.map(view => (
                    <button
                      key={view.id}
                      type="button"
                      role="radio"
                      aria-checked={statView === view.id}
                      className={statView === view.id ? 'is-on' : ''}
                      onClick={() => setStatView(view.id)}
                    >
                      {t(view.labelKey)}
                    </button>
                  ))}
                </div>
              </header>

              <div className="rpt-stats-body">
                {dataLoading && <p className="rpt-panel-empty">{t('reports.loadingReportData')}</p>}

                {!dataLoading && statView === 'burden' && (
                  diseaseBurden.length > 0
                    ? <div className="rpt-plot"><DiseaseBurdenChart points={diseaseBurden} /></div>
                    : <p className="rpt-panel-empty">{t('reports.burdenEmpty')}</p>
                )}

                {!dataLoading && statView === 'patients' && (
                  patientsByState.length > 0
                    ? <div className="rpt-plot"><RankedBarChart points={patientsByState} valueLabel={t('reports.kpiPatients')} /></div>
                    : <p className="rpt-panel-empty">{t('reports.noDataForReport')}</p>
                )}

                {!dataLoading && statView === 'revenue' && (
                  revenueByFacility.length > 0
                    ? <div className="rpt-plot"><RankedBarChart points={revenueByFacility} valueLabel={t('reports.kpiCollected', { currency })} /></div>
                    : <p className="rpt-panel-empty">{t('reports.placeholderRevenue')}</p>
                )}

                {!dataLoading && statView === 'stock' && (
                  stockTotal > 0 ? (
                    <div className="rpt-donut-row">
                      <div className="rpt-donut">
                        <StockStatusDonut data={stockMix} />
                        <div className="rpt-donut-hole">
                          <b>{stockTotal.toLocaleString()}</b>
                          <span>{t('reports.stockItems')}</span>
                        </div>
                      </div>
                      {/* Legend, not colour alone: every slice is named and counted. */}
                      <ul className="rpt-legend">
                        {stockMix.map(slice => (
                          <li key={slice.key}>
                            <i style={{ background: slice.color }} aria-hidden="true" />
                            <span>{slice.label}</span>
                            <b>{slice.value.toLocaleString()}</b>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : <p className="rpt-panel-empty">{t('reports.stockEmpty')}</p>
                )}
              </div>
            </section>
        </section>

        {/* ── Report categories ───────────────────────────────── */}
        {visibleSections.length === 0 && (
          <div className="card-elevated overflow-hidden">
            <EmptyState
              title={t('reports.noMatches')}
              message={t('reports.noMatchesMessage')}
              action={{
                label: t('reports.clearFilters'),
                onClick: () => setCategoryFilter('all'),
              }}
            />
          </div>
        )}

        <div className="rpt-groups">
          {visibleSections.map(section => {
            const openReport = section.items.find(item => item.name === expandedReport);
            return (
              <section key={section.category} className="rpt-group">
                <header className="rpt-group-head">
                  <section.icon />
                  <h2>{t(categoryKey[section.category] ?? section.category)}</h2>
                  <span className="rpt-group-count">{section.items.length}</span>
                </header>

                <div className="rpt-grid">
                  {section.items.map(report => {
                    const isExpanded = expandedReport === report.name;
                    const preview = reportPreviews.get(report.name);
                    const bars = preview?.chart?.points.slice(0, 5) ?? [];
                    const peak = bars.reduce((max, b) => Math.max(max, b.value), 0);
                    return (
                      <article
                        key={report.name}
                        className={`rpt-card ${isExpanded ? 'is-open' : ''}`.trim()}
                      >
                        <div className="rpt-card-top">
                          <span className="rpt-card-icon"><FileText /></span>
                          <span className={`rpt-chip rpt-chip--${report.period.toLowerCase()}`}>
                            {t(periodKey[report.period] ?? report.period)}
                          </span>
                        </div>

                        <h3 className="rpt-card-title">{t(reportNameKey[report.name] ?? report.name)}</h3>
                        <p className="rpt-card-desc">{t(reportDescKey[report.name] ?? report.description)}</p>

                        {/* Shape-at-a-glance: the report's top rows as bars, so
                            the catalogue shows what each report holds instead of
                            sixteen identical rows. Plain divs rather than a
                            chart library — sixteen of these must stay cheap. */}
                        {bars.length > 0 && peak > 0 ? (
                          <div className="rpt-spark" role="img" aria-label={t('reports.sparkAria', { name: t(reportNameKey[report.name] ?? report.name) })}>
                            {bars.map(bar => (
                              <span key={bar.label} title={`${bar.label}: ${bar.value}`}>
                                <i style={{ height: `${Math.max(8, (bar.value / peak) * 100)}%` }} />
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="rpt-spark is-empty" aria-hidden="true" />
                        )}

                        <footer className="rpt-card-foot">
                          <span className="rpt-card-meta">
                            {preview
                              ? t('reports.rowsAvailable', { count: preview.rowCount })
                              : t('reports.lastGenerated', { date: todayIso })}
                          </span>
                          <button
                            className="rpt-card-btn"
                            aria-expanded={isExpanded}
                            onClick={() => toggleReport(report.name)}
                          >
                            {isExpanded
                              ? <><ChevronUp /> {t('action.close')}</>
                              : <><BarChart3 /> {t('reports.generate')}</>}
                          </button>
                        </footer>
                      </article>
                    );
                  })}
                </div>

                {/* The opened report spans the full width beneath its own
                    group, so the chart and table get the room they need
                    without the card grid reflowing around them. */}
                {openReport && (
                  <div className="rpt-detail">
                    {dataLoading ? (
                      <div className="rpt-detail-loading">
                        <Loader2 className="animate-spin" />
                        <span>{t('reports.loadingReportData')}</span>
                      </div>
                    ) : (
                      renderExpandedReport(openReport.name)
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
    </main>
  );
}
