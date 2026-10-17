/**
 * Which chart sections exist, which of them a viewer may open, and how a
 * `?tab=` value maps onto one. Lives outside the chart component so anything
 * that links into the chart (worklists, the checkout gate) can ask "will this
 * link land where it says?" without importing the chart itself.
 */

// Administrative tabs are the only ones a non-clinical role (e.g. Medical
// Receptionist) may see — the "minimum necessary" rule: contact details,
// referral follow-up, and billing/scheduling, but NOT clinical notes, test
// results, diagnoses, vitals, or medications.
// 'transfers' is admin-visible because "who is responsible for this patient?"
// is a question the front desk fields constantly. The panel redacts the
// clinical detail (reason, hand-off notes, problem/medication snapshot) for
// these roles — see TransferHistoryPanel's canViewClinical prop — so the tab
// answers accountability without exposing the chart.
const ADMIN_TAB_IDS = ['overview', 'appointments', 'demographics', 'billing', 'documents', 'recall', 'referrals'];
// A lab technician works orders inside the chart (the bench steps live on the
// Labs tab) but has no business in the notes, medications or problem list, so
// their chart is exactly the two tabs the work needs: who the patient is, and
// the labs. Minimum necessary access, enforced the same way ADMIN_TAB_IDS is.
const LAB_TAB_IDS = ['overview', 'labs'];
// A pharmacist dispenses against the prescription and the allergy list; a
// radiographer reads the order and reports on it. Each gets the tabs their work
// needs and nothing else — same minimum-necessary rule as LAB_TAB_IDS.
const PHARMACY_TAB_IDS = ['overview', 'prescriptions', 'allergies'];
const IMAGING_TAB_IDS = ['overview', 'labs'];

/** The capabilities that decide how much of the chart a viewer gets. */
export interface ChartAccess {
  canViewClinical: boolean;
  canEnterLabResults: boolean;
  canDispense: boolean;
  role?: string;
}

/**
 * The tab ids a viewer may open, or `null` for "the whole chart".
 *
 * Exported so the minimum-necessary rule can be asserted directly: this is the
 * only thing standing between a cashier looking up a balance and the patient's
 * notes, and the order of these branches is load-bearing — a clinical role is
 * checked first, so a doctor who also happens to hold a lab permission is not
 * narrowed to the bench's two tabs.
 */
export function allowedChartTabIds(access: ChartAccess): string[] | null {
  if (access.canViewClinical) return null;
  if (access.canEnterLabResults) return LAB_TAB_IDS;
  if (access.canDispense) return PHARMACY_TAB_IDS;
  if (access.role === 'radiologist') return IMAGING_TAB_IDS;
  return ADMIN_TAB_IDS;
}

/**
 * Where a restricted viewer lands when the tab they asked for isn't theirs —
 * the tab their role came for, not a generic overview.
 */
export function chartLandingTab(allowedIds: string[] | null): string {
  if (!allowedIds) return 'overview';
  return allowedIds.find(id => id !== 'overview') || 'overview';
}

// Tab ids that a `?tab=` deep-link is allowed to open. Mirrors `allTabs` (in the
// component) plus the other reachable `activeTab` targets (`referrals`, `sbar`).
// Clinical-permission gating still runs in the effect below, so a non-clinical
// user deep-linked to a clinical tab is bounced back to overview.
const DEEP_LINK_TAB_IDS = new Set([
    'overview', 'appointments', 'history', 'problems', 'prescriptions', 'immunizations',
  'allergies', 'vitals', 'notes', 'labs', 'demographics', 'billing', 'careChecklist',
    'documents', 'recall', 'referrals', 'sbar', 'transfers',
    'orders', 'procedures', 'programs', 'medicalHistory', 'messages',
]);

/** Legacy/alias `?tab=` values that don't have a section of their own: transfers
 *  are read on Care coordination, recall reminders on Appointments. */
const TAB_ALIASES: Record<string, string> = {
  transfers: 'referrals',
  recall: 'appointments',
  // The Medications section's id is `prescriptions`. The prescribe page and the
  // progress feed both link `?tab=medications`, which resolved to nothing and
  // dropped the prescriber on the summary instead of the list they just changed.
  medications: 'prescriptions',
  // The rail shows these sections under their labels, so a hand-typed or
  // copied `?tab=` used the label and silently opened the summary instead.
  results: 'labs',
  conditions: 'problems',
  visits: 'history',
  careplan: 'careChecklist',
};

/** The section a `?tab=` value opens, or null when the value isn't a section.
 *  Shared by the initial read and the browser-navigation resync so a Back
 *  button and a deep link can never resolve the same URL differently. */
export function resolveChartTab(tabParam: string | null | undefined): string | null {
  if (!tabParam) return null;
  const mapped = TAB_ALIASES[tabParam] ?? tabParam;
  return DEEP_LINK_TAB_IDS.has(mapped) ? mapped : null;
}

/** A chart section's URL. `returnTo` rides along so the chart's Back button
 *  still returns to the worklist the chart was opened from after the
 *  clinician has moved between sections. */
export function chartTabHref(pathname: string, tab: string, returnTo?: string | null): string {
  const params = new URLSearchParams({ tab });
  if (returnTo) params.set('returnTo', returnTo);
  return `${pathname}?${params.toString()}`;
}

/** Whether a viewer with `allowedIds` lands on the section an href names, or
 *  would be bounced to their landing tab. Non-chart hrefs are not judged. */
export function chartHrefOpensForViewer(href: string, allowedIds: string[] | null): boolean {
  if (!allowedIds || !href.startsWith('/patients/')) return true;
  const tab = resolveChartTab(new URL(href, 'http://local').searchParams.get('tab')) ?? 'overview';
  return allowedIds.includes(tab);
}
