import type { TourStep } from '../types';
import { finishStep, messagingStep } from './_shared';

// ── Records / HMIS (hrio, records officer, data entry) — §9 ────────────────
// Walked in the order the data actually moves: daily tallies → CRVS vital
// events → rollups → data-quality checks → DHIS2 submission. data_entry_clerk
// has no /reports or /dhis2-export in its route allow-list (role-routes.ts) —
// unlike hrio and records_hmis_officer, who own the full chain through to
// Ministry submission — so the last five steps below are filtered out for
// that role at runtime (see journey-tours.ts's per-role route filter).
export const RECORDS_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/dashboard/data-entry',
    target: '',
    title: 'Welcome to Records & HMIS',
    body: 'From daily census to DHIS2 export — the facility’s reporting spine. Let’s walk it in order.',
  },

  // ── Daily census / service tallies ────────────────────────────────────
  {
    id: 'census-queue',
    route: '/dashboard/data-entry',
    target: '[data-tour="station-queue"]',
    placement: 'right',
    title: 'Every report you file',
    body: 'The running history of daily facility census reports, with who submitted each one and when. This worklist is what the rest of the reporting spine reads from.',
  },
  {
    id: 'module-shortcuts',
    route: '/dashboard/data-entry',
    target: '[data-tour="station-actions"]',
    placement: 'bottom',
    title: 'Every reporting task, one bar',
    body: 'Facility Assessment, Data Quality, Vital Statistics, Immunizations, ANC, Births, and Deaths — jump straight to any of them without leaving the dashboard.',
  },
  {
    // Opens the census modal — kept as the LAST data-entry step: it leaves the
    // modal open, and the following step navigates to /births, unmounting
    // this page (and the modal with it). An earlier position would leave the
    // modal's fixed overlay covering the next same-route step's target.
    id: 'census-form',
    route: '/dashboard/data-entry',
    preClickSelector: '[data-tour="data-entry-new-census"]',
    target: '[data-tour="census-patient-fields"]',
    placement: 'right',
    title: 'The daily tally',
    body: 'OPD visits, admissions, maternity, newborns, deaths, discharges, referrals in and out — filed once here, it feeds bed occupancy, staffing, and the Monthly HMIS 105 return.',
  },

  // ── Vital events (CRVS) ────────────────────────────────────────────────
  {
    id: 'births-list',
    route: '/births',
    target: '.data-table',
    placement: 'top',
    title: 'The birth register',
    body: 'Every registration on file — certificate number, child, parents, delivery details. Click a row to expand it; when the mother matches a registered patient, her name links straight to her chart.',
  },
  {
    id: 'births-register',
    route: '/births',
    target: '[data-tour="register-birth-btn"]',
    placement: 'bottom',
    title: 'Register a birth',
    body: 'Child + parents + birth details. The certificate number auto-generates (SS-B-…) on save — this is the source event behind every birth statistic downstream.',
  },
  {
    id: 'deaths-list',
    route: '/deaths',
    target: '.data-table',
    placement: 'top',
    title: 'The death register',
    body: 'Certificate, cause, manner, and registration status for every death on file. A ward “death” discharge routes here automatically with the encounter already linked.',
  },
  {
    id: 'deaths-register',
    route: '/deaths',
    preClickSelector: '[data-tour="register-death-btn"]',
    target: '[data-tour="death-cause-chain"]',
    placement: 'right',
    title: 'The WHO cause chain',
    body: 'Immediate cause, up to two antecedent causes, and the underlying cause the death is coded against — each with an ICD-11 lookup. National mortality statistics are built from this chain, not a single free-text diagnosis.',
  },

  // ── Rollups ─────────────────────────────────────────────────────────────
  {
    id: 'vitals-stats',
    route: '/vital-statistics',
    target: '[data-tour="vs-section-nav"]',
    placement: 'right',
    title: 'Vital statistics',
    body: 'Read-only rollups from the registers you just saw: birth counts and delivery mix, mortality and top causes of death, and — under CRVS gaps — the death notification, registration, and ICD-11 coding rates that show what still isn’t reaching this office.',
  },

  // ── Data quality, before submission ────────────────────────────────────
  {
    id: 'quality-national',
    route: '/data-quality',
    target: '[data-tour="dq-national-indicators"]',
    placement: 'right',
    title: 'Five national thresholds',
    body: 'Completeness, timeliness, accuracy, facility coverage, and DHIS2 electronic-reporting adoption — each plotted against the target the Ministry expects.',
  },
  {
    id: 'quality-facility',
    route: '/data-quality',
    target: '[data-tour="dq-facility-table"]',
    placement: 'top',
    title: 'Check it before you export',
    body: 'Per-facility completeness, timeliness, and quality-score tables, plus a possible-outliers check — any disease count more than 3x the local median gets flagged to verify at source. Clear these before the DHIS2 push, not after.',
  },

  // ── DHIS2 submission ────────────────────────────────────────────────────
  {
    id: 'dhis2-status',
    route: '/dhis2-export',
    target: '[data-tour="dhis2-status-cards"]',
    placement: 'bottom',
    title: 'DHIS2 export',
    body: 'Connection status, how many data elements last synced, reports still due this period, and the last push time — all read from the real, persisted sync log. “Never synced” means never synced.',
  },
  {
    id: 'dhis2-reports',
    route: '/dhis2-export',
    preClickSelector: '[data-tour="dhis2-tab-reports"]',
    target: '[data-tour="dhis2-reports-list"]',
    placement: 'top',
    title: 'The five standard returns',
    body: 'Monthly HMIS 105, Weekly Epidemiological, Quarterly HIV, Monthly Maternal Health, and Immunization Coverage. Each one’s completeness bar reflects the same underlying sync for the period selected.',
  },
  {
    id: 'dhis2-export-config',
    route: '/dhis2-export',
    preClickSelector: '[data-tour="dhis2-tab-export"]',
    target: '[data-tour="dhis2-export-config"]',
    placement: 'right',
    title: 'Pick the period and level',
    body: 'Facility up to national — the tiers above facility are gated by what’s set on your account. Sync straight to DHIS2, or download JSON/CSV for a manual upload.',
  },
  {
    id: 'dhis2-log',
    route: '/dhis2-export',
    preClickSelector: '[data-tour="dhis2-tab-log"]',
    target: '[data-tour="dhis2-sync-log"]',
    placement: 'top',
    title: 'The submission trail',
    body: 'Every sync attempt, timestamped, success or failure with the real error message — the trail that lets a number the Ministry sees be traced back to the push, and from the push to the encounters that produced it.',
  },

  {
    id: 'reports',
    route: '/reports',
    target: '',
    title: 'Monthly reports',
    body: 'Downloadable facility reports across five categories — patient statistics, disease surveillance, pharmacy & supply chain, hospital operations, and financial — regenerated live from current data, never a stale snapshot. MCH analytics has the maternal/child indicator dashboards.',
  },

  messagingStep('/dashboard/data-entry'),
  finishStep('/dashboard/data-entry'),
];
