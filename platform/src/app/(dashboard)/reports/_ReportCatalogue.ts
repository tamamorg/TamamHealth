/**
 * The report catalogue, and the filter that narrows it.
 *
 * Lifted out of the Reports page (2026-08-24) when the rail grew filters: the
 * page was carrying the sixteen definitions, four translation lookups, the
 * picker markup and every chart generator in one 1,169-line file, and the
 * filter logic is the part most worth testing on its own. Data and pure
 * functions only — no JSX, no hooks — so `_ReportRail` renders it and the page
 * reads from the same source rather than each keeping a copy.
 */

import { Activity, BedDouble, Pill, TrendingUp, Users } from '@/components/icons/lucide';

/* ── Static report definitions ─────────────────────────────────── */
// NOTE: this page does not yet track per-report refresh times — every report
// is regenerated on demand from live PouchDB queries. The "Last:" stamp
// shown next to each card therefore reports today's date (the date the page
// was rendered) rather than a stored last-run timestamp. When per-report
// refresh history is wired up (e.g. via a `report_runs` doc keyed by report
// name), replace `todayIso` below with that lookup.
export const reports = [
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
export const categoryKey: Record<string, string> = {
  'Patient Statistics': 'reports.categoryPatientStatistics',
  'Disease Surveillance': 'reports.categoryDiseaseSurveillance',
  'Pharmacy & Supply Chain': 'reports.categoryPharmacySupplyChain',
  'Hospital Operations': 'reports.categoryHospitalOperations',
  'Financial': 'reports.categoryFinancial',
};
export const reportNameKey: Record<string, string> = {
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
export const reportDescKey: Record<string, string> = {
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
export const periodKey: Record<string, string> = {
  Daily: 'reports.periodDaily',
  Weekly: 'reports.periodWeekly',
  Monthly: 'reports.periodMonthly',
  Quarterly: 'reports.periodQuarterly',
};


/* ── Derived shapes ────────────────────────────────────────────── */

export interface ReportItem {
  name: string;
  description: string;
  period: string;
}

/** One report with the category it came from — the flat list the rail filters
 *  and the chart's prev/next arrows step through. */
export interface FlatReport extends ReportItem {
  category: string;
}

export const allReports: FlatReport[] = reports.flatMap(section =>
  section.items.map(item => ({ ...item, category: section.category })));

/** Every category, in catalogue order — NOT alphabetised: the order the
 *  sections are written in is the order an operator reads them in. */
export const REPORT_CATEGORIES: string[] = reports.map(section => section.category);

/** Every cadence actually present in the catalogue, in reporting order.
 *  Derived rather than hard-coded so a report added on a new cadence cannot
 *  become unfilterable. */
export const REPORT_PERIODS: string[] = (() => {
  const order = ['Daily', 'Weekly', 'Monthly', 'Quarterly'];
  const present = new Set(allReports.map(r => r.period));
  return [
    ...order.filter(p => present.has(p)),
    ...[...present].filter(p => !order.includes(p)).sort(),
  ];
})();

/* ── The filter ────────────────────────────────────────────────── */

export interface ReportFilter {
  /** Free text over the report's name and description. */
  query: string;
  /** '' = every category. */
  category: string;
  /** '' = every cadence. */
  period: string;
}

export const EMPTY_REPORT_FILTER: ReportFilter = { query: '', category: '', period: '' };

export function isFilterActive(filter: ReportFilter): boolean {
  return filter.query.trim() !== '' || filter.category !== '' || filter.period !== '';
}

/**
 * Does one report survive the filter?
 *
 * The text match runs over the ENGLISH name and description, and over the
 * translated name when a translator is supplied — searching an Arabic UI for
 * an Arabic word has to work, and the untranslated identifiers are what the
 * rest of the catalogue is keyed on.
 */
export function matchesReportFilter(
  report: FlatReport,
  filter: ReportFilter,
  translate?: (key: string) => string,
): boolean {
  if (filter.category && report.category !== filter.category) return false;
  if (filter.period && report.period !== filter.period) return false;
  const q = filter.query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    report.name,
    report.description,
    report.category,
    translate?.(reportNameKey[report.name] ?? report.name),
    translate?.(reportDescKey[report.name] ?? report.description),
  ];
  return haystack.some(value => value?.toLowerCase().includes(q));
}

/**
 * The catalogue as the rail draws it: sections in catalogue order, each
 * holding only the reports that survived, and a section that lost everything
 * dropped entirely rather than left as a heading over nothing.
 */
export function filterReportSections(
  filter: ReportFilter,
  translate?: (key: string) => string,
): { category: string; items: ReportItem[] }[] {
  return reports
    .map(section => ({
      category: section.category,
      items: section.items.filter(item =>
        matchesReportFilter({ ...item, category: section.category }, filter, translate)),
    }))
    .filter(section => section.items.length > 0);
}

/** How many reports survive — the count the rail head reports. */
export function countFilteredReports(
  filter: ReportFilter,
  translate?: (key: string) => string,
): number {
  return allReports.filter(report => matchesReportFilter(report, filter, translate)).length;
}
