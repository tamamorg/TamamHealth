#!/usr/bin/env node
/**
 * Locale parity check.
 *
 * en.ts is the source of truth. Every other locale under src/lib/i18n/locales
 * must define the same key set, with the same {{placeholders}} in each value.
 *
 * Without this, a missing key silently falls back to English (loadTranslations
 * merges over the en base) and a dropped {{placeholder}} silently renders a
 * sentence with a hole in it — both invisible until someone runs the app in
 * that language. Run via `npm run i18n:check`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES_DIR = join(ROOT, 'src', 'lib', 'i18n', 'locales');
const ENTRY = /^\s*'((?:[^'\\]|\\.)*)':\s*'((?:[^'\\]|\\.)*)',?\s*$/gm;

function parse(file) {
  const src = readFileSync(join(LOCALES_DIR, file), 'utf8');
  const out = new Map();
  let m;
  ENTRY.lastIndex = 0;
  while ((m = ENTRY.exec(src))) out.set(m[1], m[2]);
  return out;
}

const placeholders = (value) => [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(',');

const en = parse('en.ts');
const others = readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.ts') && f !== 'en.ts');

let failures = 0;
const report = (msg) => { console.error(msg); failures++; };

console.log(`en.ts: ${en.size} keys`);

for (const file of others) {
  const locale = parse(file);
  const missing = [...en.keys()].filter((k) => !locale.has(k));
  const extra = [...locale.keys()].filter((k) => !en.has(k));
  const drift = [...en].filter(([k, v]) => locale.has(k) && placeholders(v) !== placeholders(locale.get(k)));

  console.log(`${file}: ${locale.size} keys`);
  for (const k of missing.slice(0, 20)) report(`  MISSING  ${file} ${k}`);
  if (missing.length > 20) report(`  MISSING  ${file} …and ${missing.length - 20} more`);
  for (const k of extra.slice(0, 20)) report(`  ORPHAN   ${file} ${k} (not in en.ts)`);
  if (extra.length > 20) report(`  ORPHAN   ${file} …and ${extra.length - 20} more`);
  for (const [k, v] of drift.slice(0, 20)) {
    report(`  PLACEHOLDER ${file} ${k} — en has {{${placeholders(v) || '—'}}}, locale has {{${placeholders(locale.get(k)) || '—'}}}`);
  }
  if (drift.length > 20) report(`  PLACEHOLDER ${file} …and ${drift.length - 20} more`);
}

// ── Untranslated UI text ────────────────────────────────────────────────────
//
// Everything above is a PARITY check: it proves apd covers en.ts. It is good at
// that and blind to the thing people assume it catches — a string that never
// became a key at all. A sentence hardcoded into JSX passes every assertion
// above, because there is no key for it to be missing.
//
// So AGENTS.md said "every new user-facing string needs both locales —
// npm run i18n:check fails otherwise", the check passed, and 25 dashboard pages
// were English-only in a bilingual RTL product.
//
// This pass is a RATCHET, not a gate. The list below records the files that are
// KNOWN PENDING TRANSLATION — every one of them has no `useTranslation` at all,
// so the fix is "translate the page", not "translate this line". The build fails
// when a file NOT on that list gains hardcoded text, and when a listed file is
// finally translated but its entry is left behind.
//
// It deliberately does NOT track a per-file count. An earlier version did, and
// it fired the moment somebody added two more action labels to a page that was
// already 100% untranslated — noise that says nothing new and trains people to
// bump the number. What matters is a clean file going bad.
const SCAN_ROOTS = ['src/app', 'src/components'];

/** Files known to be pending translation. Delete an entry once its page adopts
 *  `useTranslation`; never add one to silence a new violation. */
const UNTRANSLATED_BASELINE = new Map(Object.entries({
  'src/app/(dashboard)/billing/[id]/page.tsx': 34,
  'src/components/patients/PatientDetailPage.tsx': 33,
  'src/app/(dashboard)/anc/page.tsx': 31,
  'src/components/ehr/EhrClinicalDashboard.tsx': 20,
  'src/app/(dashboard)/births/page.tsx': 18,
  'src/components/patients/TransferHistoryPanel.tsx': 17,
  'src/components/clinical-notes/ClinicalNoteEditor.tsx': 15,
  'src/components/nurse/TriageWorkflow.tsx': 14,
  'src/components/settings/FacilitySettingsView.tsx': 14,
  'src/components/settings/RoleSettingsView.tsx': 13,
  'src/app/(dashboard)/blood-bank/page.tsx': 11,
  'src/components/patients/BillingTab.tsx': 11,
  'src/app/(dashboard)/emergency-preparedness/page.tsx': 9,
  'src/app/(dashboard)/messages/page.tsx': 9,
  'src/components/ehr/chart/sections/DirectivesSection.tsx': 9,
  'src/components/front-desk/CheckoutModal.tsx': 9,
  'src/components/clinical-notes/MedicationsModal.tsx': 8,
  'src/components/clinical-notes/assessment/IncludeProblemsModal.tsx': 8,
  'src/components/ehr/EhrVisitPopup.tsx': 8,
  'src/app/(dashboard)/billing/page.tsx': 7,
  'src/components/appointments/BookAppointmentModal.tsx': 7,
  'src/components/clinical-notes/prescribe/DrugInfoSection.tsx': 7,
  'src/components/dashboards/FacilityManagementDashboard.tsx': 7,
  'src/components/patient-portal/PatientLogin.tsx': 7,
  'src/components/patients/DocumentsPanel.tsx': 7,
  'src/app/(dashboard)/data-quality/page.tsx': 6,
  'src/components/ehr/chart/ChartHeader.tsx': 6,
  'src/components/ehr/chart/sections/OrdersSection.tsx': 6,
  'src/components/payments/ClaimsPanel.tsx': 6,
  'src/app/(dashboard)/admin/audit/page.tsx': 5,
  'src/app/(dashboard)/dashboard/pharmacy/page.tsx': 5,
  'src/app/(dashboard)/government/equity/page.tsx': 5,
  'src/app/(dashboard)/government/page.tsx': 5,
  'src/app/(dashboard)/immunizations/page.tsx': 5,
  'src/app/(dashboard)/surveillance/page.tsx': 5,
  'src/components/clinical-notes/CareCoordinationModal.tsx': 5,
  'src/components/ehr/chart/sections/ImmunizationsSection.tsx': 5,
  'src/components/patients/TransferPatientModal.tsx': 5,
  'src/app/(dashboard)/dashboard/front-desk/page.tsx': 4,
  'src/app/(dashboard)/inquiries/page.tsx': 4,
  'src/app/accept-invite/page.tsx': 4,
  'src/app/checkout/[linkId]/page.tsx': 4,
  'src/app/patient-portal/page.tsx': 4,
  'src/app/terms/page.tsx': 4,
  'src/components/MessagingDock.tsx': 4,
  'src/components/admin/ItOperationsPanel.tsx': 4,
  'src/components/appointments/AppointmentDetailFields.tsx': 4,
  'src/components/clinical-notes/NotesList.tsx': 4,
  'src/components/ehr/chart/panels/VisitNotePanel.tsx': 4,
  'src/components/ehr/chart/sections/AllergiesSection.tsx': 4,
  'src/components/ehr/chart/sections/ProgramsSection.tsx': 4,
  'src/components/lab/order/LabRequisition.tsx': 4,
  'src/components/patients/AllergyList.tsx': 4,
  'src/components/patients/PhoneNotes.tsx': 4,
  'src/components/settings/NetworkDefaultsView.tsx': 4,
  'src/app/(dashboard)/admin/data/page.tsx': 3,
  'src/app/(dashboard)/government/alerts/page.tsx': 3,
  'src/app/(dashboard)/my-facility/page.tsx': 3,
  'src/app/global-error.tsx': 3,
  'src/components/ForcePasswordChange.tsx': 3,
  'src/components/TasksPanel.tsx': 3,
  'src/components/appointments/AppointmentEditModal.tsx': 3,
  'src/components/booking/PracticeBooking.tsx': 3,
  'src/components/clinical-notes/prescribe/DrugMonographPanel.tsx': 3,
  'src/components/clinical-notes/prescribe/PrescribeModal.tsx': 3,
  'src/components/ehr/chart/ChartVitalsBand.tsx': 3,
  'src/components/ehr/chart/panels/TaskListPanel.tsx': 3,
  'src/components/ehr/chart/sections/ConditionsSection.tsx': 3,
  'src/components/mobile/patients/MobileChartDrillIn.tsx': 3,
  'src/components/nurse/RoomingWorkflow.tsx': 3,
  'src/components/patients/CareAlertsBanner.tsx': 3,
  'src/components/patients/SuperbillPanel.tsx': 3,
  'src/components/payments/BillingOverviewCards.tsx': 3,
  'src/app/(dashboard)/admin/conflicts/page.tsx': 2,
  'src/app/(dashboard)/admin/page.tsx': 2,
  'src/app/(dashboard)/admin/security/page.tsx': 2,
  'src/app/(dashboard)/controlled-substances/page.tsx': 2,
  'src/app/(dashboard)/lab/page.tsx': 2,
  'src/app/(dashboard)/org-admin/pricing/page.tsx': 2,
  'src/app/(dashboard)/patients/page.tsx': 2,
  'src/app/(dashboard)/pharmacy/page.tsx': 2,
  'src/app/(dashboard)/referrals/page.tsx': 2,
  'src/app/(dashboard)/rooming/[patientId]/page.tsx': 2,
  'src/app/(dashboard)/transfers/page.tsx': 2,
  'src/app/(dashboard)/wards/handoff/page.tsx': 2,
  'src/app/(dashboard)/wards/page.tsx': 2,
  'src/components/AnnouncementsPanel.tsx': 2,
  'src/components/AvailabilityModal.tsx': 2,
  'src/components/PrintListDialog.tsx': 2,
  'src/components/booking/primitives.tsx': 2,
  'src/components/clinical-notes/AllergiesModal.tsx': 2,
  'src/components/create-dialogs/AddInquiryDialog.tsx': 2,
  'src/components/ehr/EhrTopRail.tsx': 2,
  'src/components/ehr/chart/sections/MedicationsSection.tsx': 2,
  'src/components/ehr/chart/sections/ProceduresSection.tsx': 2,
  'src/components/ehr/chart/sections/ResultsSection.tsx': 2,
  'src/components/nurse/NurseVitalsModal.tsx': 2,
  'src/components/onboarding/GetStartedCard.tsx': 2,
  'src/components/patient-portal/BillingTab.tsx': 2,
  'src/components/patients/AssessmentsPanel.tsx': 2,
  'src/components/patients/RecordSignatureBar.tsx': 2,
  'src/components/patients/RemindersPanel.tsx': 2,
  'src/components/patients/ScreeningsPanel.tsx': 2,
  'src/components/settings/FacilityPolicySections.tsx': 2,
  'src/app/(booking)/book/[practice]/[provider]/page.tsx': 1,
  'src/app/(dashboard)/appointments/page.tsx': 1,
  'src/app/(dashboard)/consultation/page.tsx': 1,
  'src/app/(dashboard)/dashboard/radiology/page.tsx': 1,
  'src/app/(dashboard)/dashboard/state/page.tsx': 1,
  'src/app/(dashboard)/dhis2-export/page.tsx': 1,
  'src/app/(dashboard)/government/briefing/page.tsx': 1,
  'src/app/(dashboard)/hr/schedule/page.tsx': 1,
  'src/app/(dashboard)/layout.tsx': 1,
  'src/app/(dashboard)/notifications/page.tsx': 1,
  'src/app/checkout/layout.tsx': 1,
  'src/app/login/page.tsx': 1,
  'src/app/not-found.tsx': 1,
  'src/components/AssignDoctorModal.tsx': 1,
  'src/components/NotificationsPanel.tsx': 1,
  'src/components/PatientTimeline.tsx': 1,
  'src/components/PublicLegalShell.tsx': 1,
  'src/components/admin/sadb-ui.tsx': 1,
  'src/components/booking/BookingFlow.tsx': 1,
  'src/components/booking/SlotPicker.tsx': 1,
  'src/components/clinical-notes/FollowUpModal.tsx': 1,
  'src/components/clinical-notes/prescribe/PatientCostSection.tsx': 1,
  'src/components/clinical-notes/prescribe/PharmacyInfoSection.tsx': 1,
  'src/components/ehr/EhrCareDashboard.tsx': 1,
  'src/components/ehr/EhrListHeader.tsx': 1,
  'src/components/ehr/EhrMiniCalendar.tsx': 1,
  'src/components/ehr/EhrWorkItemProgress.tsx': 1,
  'src/components/front-desk/AssignmentControls.tsx': 1,
  'src/components/mobile/dashboard/MobileOutstandingList.tsx': 1,
  'src/components/mobile/patients/tabs/MobileVitalsTab.tsx': 1,
  'src/components/patients/AddAllergyModal.tsx': 1,
  'src/components/patients/CareAlertFields.tsx': 1,
  'src/components/patients/PatientSBAR.tsx': 1,
  'src/components/payments/BillingWorkspace.tsx': 1,
  'src/components/payments/PaymentPanel.tsx': 1,
  'src/components/settings/FacilitySyncPanel.tsx': 1,
  'src/components/settings/SystemAdminSections.tsx': 1,
  'src/components/settings/VisitTypesSection.tsx': 1,
}));

/**
 * JSX text nodes that read as a user-facing sentence.
 *
 * Counted the same way whether or not the file imports `useTranslation`. An
 * earlier version exempted files that did, on the theory that they had opted
 * in — which hid the worse case: 41 files import the hook AND still carry 231
 * literal strings between them. A fully-English screen is at least honest; a
 * half-translated one shows a Juba Arabic reader Arabic and English in the
 * same sentence.
 */
function untranslatedCount(source) {
  const matches = source.match(/>\s*[A-Z][a-zA-Z]+(?: [a-zA-Z&/]+){1,6}\s*</g) || [];
  return matches.length;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry.name)) out.push(full);
  }
  return out;
}

let scanned = 0;
const regressions = [];
const improved = [];
for (const root of SCAN_ROOTS) {
  for (const file of walk(join(ROOT, root))) {
    const rel = relative(ROOT, file);
    const count = untranslatedCount(readFileSync(file, 'utf8'));
    scanned++;
    const pending = UNTRANSLATED_BASELINE.has(rel);
    if (count > 0 && !pending) {
      regressions.push(`  UNTRANSLATED ${rel} — ${count} literal string(s) on a file that had none`);
    } else if (count === 0 && pending) {
      improved.push(`  ${rel} is translated — remove it from UNTRANSLATED_BASELINE in scripts/check-i18n.mjs`);
    }
  }
}
console.log(`\nscanned ${scanned} components for untranslated text`);
for (const r of regressions) report(r);
if (improved.length) {
  console.error('\nThese pages are now translated — the pending list is stale:');
  for (const i of improved) report(i);
}

if (failures) {
  console.error(`\ni18n check failed with ${failures} problem(s).`);
  process.exit(1);
}
console.log('\ni18n check passed — locales cover en.ts, and no new untranslated UI text.');
