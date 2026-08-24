/**
 * PouchDB database accessors.
 *
 * Two runtime environments, one API:
 *
 * - Browser → `pouchdb-browser` with the IndexedDB backend. Each getDB() call
 *   returns a local PouchDB instance. Clinicians' work is stored offline-first
 *   and replicates to CouchDB via the sync manager when online.
 *
 * - Server (Node) → `pouchdb` with the http adapter, pointed directly at the
 *   shared CouchDB cluster. This lets API routes (`/api/*`) read and write the
 *   same databases that browser clients replicate to, so external consumers
 *   (mobile, integrations, server cron) can use the REST surface without a
 *   browser in the loop.
 *
 * All service functions call the same accessors (usersDB(), patientsDB(),
 * etc.), so nothing above this layer has to care which runtime it's in.
 */

import { DATABASE_SYNC_CONFIGS } from './sync/sync-config';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PouchDBCtor = any;
type PouchDatabase = PouchDB.Database;

const IS_BROWSER = typeof window !== 'undefined';

let PouchDBRef: PouchDBCtor | null = null;
const databases: Record<string, PouchDatabase> = {};

// pouchdb-find still calls PouchDB's internal, deprecated `db.type()` on every
// query. The warning is harmless but fires on each find(), flooding dev logs.
// Drop only that exact message (once); every other console.warn is untouched.
let deprecationFilterInstalled = false;
function installPouchDeprecationFilter(): void {
  if (deprecationFilterInstalled) return;
  deprecationFilterInstalled = true;
  const original = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('db.type() is deprecated')) return;
    original(...args);
  };
}

function loadPouchDB(): PouchDBCtor {
  if (PouchDBRef) return PouchDBRef;
  installPouchDeprecationFilter();

  if (IS_BROWSER) {
    // Browser path — pouchdb-browser uses IndexedDB and imports browser-only
    // globals at module load, so it must not be evaluated server-side.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const PouchDBModule = require('pouchdb-browser');
    const PouchDB = PouchDBModule.default || PouchDBModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const PouchDBFindModule = require('pouchdb-find');
    const PouchDBFind = PouchDBFindModule.default || PouchDBFindModule;
    PouchDB.plugin(PouchDBFind);
    PouchDBRef = PouchDB;
  } else {
    // Server path — use pouchdb-core with ONLY the http + mapreduce + find
    // plugins. The full `pouchdb` package bundles leveldb, which needs
    // platform-specific native binaries (they don't exist for every
    // runtime + arch combo the platform gets deployed to). http-only is
    // stateless on our end; all persistence happens in CouchDB.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const coreMod = require('pouchdb-core');
    const PouchDB = coreMod.default || coreMod;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const httpMod = require('pouchdb-adapter-http');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mapReduceMod = require('pouchdb-mapreduce');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const findMod = require('pouchdb-find');
    PouchDB
      .plugin(httpMod.default || httpMod)
      .plugin(mapReduceMod.default || mapReduceMod)
      .plugin(findMod.default || findMod);
    PouchDBRef = PouchDB;
  }
  return PouchDBRef;
}

/**
 * Resolve the server-side CouchDB base URL — credentials are NOT embedded
 * here; they're attached per-request via a fetch override in getDB() so they
 * never end up in cached PouchDB instance URLs or in log lines.
 */
function serverCouchBaseUrl(): string {
  const base =
    process.env.COUCHDB_URL ||
    process.env.NEXT_PUBLIC_COUCHDB_URL ||
    'http://couchdb:5984';
  const user = process.env.COUCHDB_ADMIN_USER || process.env.COUCHDB_USER;
  const pass = process.env.COUCHDB_ADMIN_PASSWORD || process.env.COUCHDB_PASSWORD;

  if (!user || !pass) {
    throw new Error(
      '[db] Server-side CouchDB access requires COUCHDB_ADMIN_USER and ' +
      'COUCHDB_ADMIN_PASSWORD (or COUCHDB_USER / COUCHDB_PASSWORD). Set them ' +
      'in platform/.env.production or the compose root .env before any /api/* ' +
      'route that reads the database is hit.'
    );
  }

  return base.replace(/\/$/, '');
}

/**
 * Computed once at module load: `Basic <base64(user:pass)>` for the server
 * fetch override. Returns null if creds are missing — getDB() will then call
 * serverCouchBaseUrl() which throws the loud config error.
 */
function computeServerAuthHeader(): string | null {
  if (IS_BROWSER) return null;
  const user = process.env.COUCHDB_ADMIN_USER || process.env.COUCHDB_USER;
  const pass = process.env.COUCHDB_ADMIN_PASSWORD || process.env.COUCHDB_PASSWORD;
  if (!user || !pass) return null;
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}
const serverAuthHeader = computeServerAuthHeader();

export function getDB(name: string): PouchDatabase {
  if (!databases[name]) {
    const PouchDB = loadPouchDB();
    if (IS_BROWSER) {
      databases[name] = new PouchDB(name, { auto_compaction: true });
      // Each live changes() feed (usePatients, useLabResults, …) attaches a
      // listener to the DB's EventEmitter; a data-heavy screen mounts well over
      // the default 10, tripping a spurious MaxListenersExceededWarning. Raise
      // the cap — the feeds are cancelled on unmount, so this isn't a leak.
      (databases[name] as unknown as { setMaxListeners?: (n: number) => void }).setMaxListeners?.(50);
    } else {
      const base = serverCouchBaseUrl();
      const authHeader = serverAuthHeader!; // serverCouchBaseUrl() above already threw if missing
      // skip_setup: false → PouchDB will PUT /<db> on first access if it does
      // not exist. The admin credentials are attached per-request via the
      // fetch override below, so they never appear in the cached PouchDB URL.
      databases[name] = new PouchDB(`${base}/${name}`, {
        skip_setup: false,
        fetch: (url: RequestInfo | URL, opts?: RequestInit) => {
          // PouchDB passes `opts.headers` as a Headers instance. Spreading it
          // into a plain object copies internal symbol keys (Symbol(map)),
          // which the Headers/fetch constructor rejects as non-ByteString keys.
          // Merge through the Headers API instead — it accepts a Headers
          // object, a plain object, or [key,value][] tuples.
          const headers = new Headers(opts?.headers as HeadersInit | undefined);
          headers.set('Authorization', authHeader);
          return fetch(url, { ...(opts ?? {}), headers });
        },
      } as PouchDB.Configuration.RemoteDatabaseConfiguration);
    }
  }
  return databases[name];
}

/** Remove one browser database and release its cached IndexedDB handle. */
export async function destroyLocalDatabase(name: string): Promise<void> {
  if (!IS_BROWSER) return;
  const PouchDB = loadPouchDB();
  const db = databases[name] ?? new PouchDB(name);
  delete databases[name];
  try {
    await db.destroy();
  } finally {
    delete databases[name];
  }
}

// Typed database accessors
export const usersDB = () => getDB('tamamhealth_users');
export const patientsDB = () => getDB('tamamhealth_patients');
export const hospitalsDB = () => getDB('tamamhealth_hospitals');
export const medicalRecordsDB = () => getDB('tamamhealth_medical_records');
export const referralsDB = () => getDB('tamamhealth_referrals');
export const labResultsDB = () => getDB('tamamhealth_lab_results');
export const diseaseAlertsDB = () => getDB('tamamhealth_disease_alerts');
export const prescriptionsDB = () => getDB('tamamhealth_prescriptions');
export const auditLogDB = () => getDB('tamamhealth_audit_log');
export const usageEventsDB = () => getDB('tamamhealth_usage_events');
export const messagesDB = () => getDB('tamamhealth_messages');
export const conversationsDB = () => getDB('tamamhealth_conversations');
export const patientNotesDB = () => getDB('tamamhealth_patient_notes');
export const phoneNotesDB = () => getDB('tamamhealth_phone_notes');
export const assessmentsDB = () => getDB('tamamhealth_assessments');
export const birthsDB = () => getDB('tamamhealth_births');
export const deathsDB = () => getDB('tamamhealth_deaths');
export const facilityAssessmentsDB = () => getDB('tamamhealth_facility_assessments');
export const immunizationsDB = () => getDB('tamamhealth_immunizations');
export const ancDB = () => getDB('tamamhealth_anc');
export const followUpsDB = () => getDB('tamamhealth_follow_ups');
export const organizationsDB = () => getDB('tamamhealth_organizations');
export const platformConfigDB = () => getDB('tamamhealth_platform_config');
export const appointmentsDB = () => getDB('tamamhealth_appointments');
export const availabilityDB = () => getDB('tamamhealth_availability');
export const announcementsDB = () => getDB('tamamhealth_announcements');
export const pharmacyInventoryDB = () => getDB('tamamhealth_pharmacy_inventory');
export const triageDB = () => getDB('tamamhealth_triage');
export const billingDB = () => getDB('tamamhealth_billing');
export const feeScheduleDB = () => getDB('tamamhealth_fee_schedule');
export const wardDB = () => getDB('tamamhealth_wards');
export const staffSchedulesDB = () => getDB('tamamhealth_staff_schedules');
export const bloodBankDB = () => getDB('tamamhealth_blood_bank');
export const emergencyPlansDB = () => getDB('tamamhealth_emergency_plans');
export const assetsDB = () => getDB('tamamhealth_assets');
export const leaveRequestsDB = () => getDB('tamamhealth_leave_requests');
export const payrollEntriesDB = () => getDB('tamamhealth_payroll_entries');
export const patientFeedbackDB = () => getDB('tamamhealth_patient_feedback');
export const controlledSubstanceLogDB = () => getDB('tamamhealth_controlled_substance_log');
export const problemsDB = () => getDB('tamamhealth_problems');
// Care-program enrollment (ART/HIV, TB, PMTCT, ANC, Nutrition, EPI, NCD, other).
export const programEnrollmentsDB = () => getDB('tamamhealth_program_enrollments');
// Procedures performed on a patient (bedside/theatre) — anchored to the patient.
export const proceduresDB = () => getDB('tamamhealth_procedures');
// Order sets / clinical protocols (reference data) — reusable bundles of
// labs + medications keyed to a presenting condition (WHO/IMCI/ETAT/STG).
export const orderSetsDB = () => getDB('tamamhealth_order_sets');
// Nurse shift handoff records (SBAR + tasks), retrievable & acknowledgeable by
// the oncoming shift.
export const handoffsDB = () => getDB('tamamhealth_handoffs');
// In-progress / paused clinical encounters (consultation workflow state machine).
export const encountersDB = () => getDB('tamamhealth_encounters');
export const consultationProgressDB = () => getDB('tamamhealth_consultation_progress');
// Fingerprint minutiae templates (no raw images) — see db-types-biometrics.ts
export const biometricTemplatesDB = () => getDB('tamamhealth_biometric_templates');

// Per-clinician clinical favorites (one-tap diagnosis/medicine/procedure picks).
export const clinicalFavoritesDB = () => getDB('tamamhealth_clinical_favorites');

// Clinician-saved consultation templates (reusable diagnosis+medicine bundles).
export const consultationTemplatesDB = () => getDB('tamamhealth_consultation_templates');

// Per-clinician personal tasks / to-dos with reminders.
export const clinicianTasksDB = () => getDB('tamamhealth_clinician_tasks');

// Scanned / uploaded chart documents (radiology, referral letters, IDs, etc.).
export const patientDocumentsDB = () => getDB('tamamhealth_patient_documents');

// Queued patient reminders (e.g. "come fasted in 3 weeks") worked by staff.
export const patientRemindersDB = () => getDB('tamamhealth_patient_reminders');

// MUAC nutrition screenings (children 6–59m + ANC mothers).
export const nutritionScreeningsDB = () => getDB('tamamhealth_nutrition_screenings');

// Nutrition supply inventory (RUTF, therapeutic milk, ORS, micronutrients, ...).
export const nutritionSuppliesDB = () => getDB('tamamhealth_nutrition_supplies');

// Sync + conflict databases (Phase 1 closeout)
export const syncEventsDB = () => getDB('tamamhealth_sync_events');
export const conflictQueueDB = () => getDB('tamamhealth_conflict_queue');

// Patient Insurance & Payments databases
export const insurancePoliciesDB = () => getDB('tamamhealth_insurance_policies');
export const eligibilityChecksDB = () => getDB('tamamhealth_eligibility_checks');
export const chargesDB = () => getDB('tamamhealth_charges');
export const claimsDB = () => getDB('tamamhealth_claims');
export const adjustmentsDB = () => getDB('tamamhealth_adjustments');
export const paymentsDB = () => getDB('tamamhealth_payments');
export const refundsDB = () => getDB('tamamhealth_refunds');
export const savedPaymentMethodsDB = () => getDB('tamamhealth_saved_payment_methods');
export const paymentPlansDB = () => getDB('tamamhealth_payment_plans');
export const invoicesDB = () => getDB('tamamhealth_invoices');
export const ledgerDB = () => getDB('tamamhealth_ledger');

// ── Online booking (see db-types-booking.ts) ──
// Patient-facing service menu ("Reason for visit"), per org/facility.
export const visitReasonsDB = () => getDB('tamamhealth_visit_reasons');
// Per-facility rules every booking surface obeys (lead time, buffers, consent
// wording, whether online booking is on at all).
export const bookingPoliciesDB = () => getDB('tamamhealth_booking_policies');
// Public-facing clinician profiles. Deliberately NOT fields on the user doc,
// which carries password and PIN hashes.
export const providerProfilesDB = () => getDB('tamamhealth_provider_profiles');
// Short-lived claims on a slot while a patient fills in the booking form.
export const slotHoldsDB = () => getDB('tamamhealth_slot_holds');
// Patient reviews of completed visits, moderated before publication.
export const providerReviewsDB = () => getDB('tamamhealth_provider_reviews');

// Internal transfers of care ownership (provider/department/facility), with
// their request → accept → complete workflow and append-only audit trail.
// Distinct from `tamamhealth_referrals`, which moves a patient between
// facilities and ships a copy of the chart.
export const patientTransfersDB = () => getDB('tamamhealth_patient_transfers');

// Bump this version to force a re-seed (destroys all data and re-creates).
// Bumped to 34: v2 demo deployment flipped to demo mode — force browsers that
// previously seeded in production mode (admin-only) to re-seed the full demo
// dataset (sample patients + the complete user roster).
// Bumped to 37: added today-dated reception walk-ins + appointments so the
// front-desk queue is populated on seed day.
// Bumped to 38: every seeded user now carries department + specialty + a
// canonical phone + presence, so the staff directory / HR / messaging / provider
// pickers are populated for all roles. (Demo re-seed only — never bump against a
// live production DB.)
// Bumped to 39: generated per-patient billing (charges, saved payment method,
// ledger entries, a payment for most, insurance for some) for every demo patient
// beyond the original five, so any patient's Billing tab shows populated cards.
// Bumped to 40: seeded order sets / clinical protocols (WHO/IMCI/ETAT/STG
// bundles) so the consultation "Apply protocol" picker is populated on seed.
// Bumped to 41: shared sample structured allergies + directives attached to
// every demo patient so the chart-summary Allergies & Directives windows are
// populated and scrollable.
// Bumped to 42: per-patient sample problem list + current medications for every
// patient (all rosters) so all four chart-summary windows are populated.
// Bumped to 44: seeded appointments no longer double-book — each facility's
// today bookings draw from a shared slot allocator (and the handful of static
// rows that collided were re-timed), so the day calendar shows one
// appointment per slot.
// Bumped to 45: added an active inpatient admission at Wau State Hospital
// (admission-6 / bed-9, pat-00063) — that facility previously had zero
// currently-admitted patients, so the day-activity chart always read
// "0 inpatient" for the Clinical Officer demo account.
// Bumped to 46-48: Dr. Peter Garang Deng (clinician.peter, the login-picker's
// Juba doctor) now rotates through today's appointment fill so his schedule
// board isn't empty, his two care-assigned patients get real bookings with
// him, the blood bank inventory is seeded (the Blood Bank screen previously
// showed an all-zero availability grid), and date-only seed fields use the
// browser's local calendar instead of UTC so "today's" bookings land on the
// dashboards' local today.
// Bumped to 49: data-flow audit fixes — hand-crafted ledger entries now carry
// orgId (they were invisible to every scoped user, so the five showcase
// billing patients had empty ledgers) and three intake-form providerName
// denorms corrected to match their providerId's user doc.
// Bumped to 50: Bentiu State Hospital (hosp-004) now has a seeded lab-order
// queue + walk-in roster, so lab.gatluak's Lab Command Center shows real data
// instead of an empty "No pending orders" queue.
// Bumped to 51: data/mock.ts roster generation switched from Math.random to a
// fixed-seed PRNG so browser-seeded patients match the server's demo-fallback
// roster (portal login matches on hospital number + phone). Old profiles hold
// the last random draw and must reseed to the deterministic identities.
// Bumped to 52: added named workflow-showcase patients with linked appointments,
// triage, lab/imaging, pharmacy, referrals, billing and ledger rows so module
// dashboards visualize real handoffs instead of isolated sample records.
// Bumped to 53: disease-alert seed replication now covers 8 recent weekly
// buckets with wavy sigmoid-style case factors for surveillance trend charts.
// Bumped to 54: added more Juba Teaching Hospital assignable doctors so the
// Assign provider popup demonstrates fixed-height scrolling and A-Z sorting.
// Bumped to 55: Mercy General Hospital (hosp-mercy-001, private org) now has
// its own real roster — 4 new staff users, 8 patients, wards/beds/admissions,
// pharmacy inventory/prescriptions, blood bank stock and today's appointments
// — instead of borrowed hosp-001 public data, so org.admin's dashboards show
// a coherent Mercy-only dataset.
// Bumped to 59: lab seed rows now carry accession numbers, specimen condition,
// collection/receipt timestamps, and a rejection/recollection example so the
// LIMS workflow additions are visible in fresh demo data.
// Bumped to 60: patient-education messages (msg-edu-1..3) for three patients
// who also have referrals, so the chart's Documents ▸ Patient education view
// has delivered material to show in fresh demo data.
// Bumped to 61: chart documents (pdoc-seed-001..010) — reports, referral
// letters, education handouts and a consent form, as real one-page PDFs — so
// all three views of the chart's Documents section open with content.
// Bumped to 62: generated disease-alert weekly buckets (introduced at v53)
// now carry orgId: PUBLIC_ORG_ID. filterByScope was recently threaded into
// several more read paths and rejects any doc with no orgId at all — the
// alert docs had none, so every surveillance trend chart silently rendered
// empty for every scoped (non-super_admin/government) user.
// Bumped to 64: nurse-board data coherence. Curated docs' denormalized
// patient names/phones are normalized against the generated registry at
// write time (pat-00005 "Nyamal" had drifted to "Grace Mabior Deng", etc.);
// admitted inpatients (admission-1..4) no longer hold same-day outpatient
// appointments or pending triage; the antenatal triage moved off the
// 60-year-old the registry generates for pat-00005; and the VIS visit
// generator now books one visit per patient per day, never marks a
// future-slot appointment checked-in/completed, and staggers walk-in
// arrival times.
// Bumped to 69: no double-booked slots. `migrateRemoveOverlappingAppointments`
// sweeps out appointments that overlap another live booking at the same
// facility on the same day — duration-aware, so it also catches the pairs the
// seed's exact-start-time de-collision pass leaves behind. Runs on fresh seeds
// and on already-seeded browsers, keeping the earliest-created booking.
// Bumped to 70: concurrent bookings across clinicians are legal. Double-booking
// is now judged per PROVIDER (and per room) instead of per facility, in the
// booking guard, the seed's de-collision pass, and the overlap sweep — so a
// clinic with two doctors seeing two patients at 09:00 keeps both bookings, and
// the day view draws them as equal side-by-side columns. Re-seed so demo days
// show real parallel clinics rather than one single-file queue.
// Bumped to 71: Malakal Teaching Hospital (hosp-003) is now a live facility
// instead of an empty shell — nurse.stella and midwife.nyakong previously had
// no doctor, no provider availability, no wards/beds/admissions and no
// handoffs/rooming activity there, so the merged nurse dashboard and the
// "Book appointment" booking wizard were both empty for the canonical nurse
// demo login. Added: a Malakal doctor (dr.ochalla) with recurring clinic
// hours; one ward (4 beds, 3 occupied) with three active admissions attended
// by him and nursed by nurse.stella; MAR-ready scheduled prescriptions for
// each admitted patient (q8h/q12h so a dose is always due/overdue); a signed
// night-shift handoff from midwife.nyakong awaiting stella's acknowledgement;
// and two rooming-station encounters. `seedAvailability` also now carries a
// per-row facility (the four Juba rows are unchanged in output).
// Bumped to 72: every admitted patient now has the arrival triage that sent
// them to a bed (triage-3b, triage-m5, triage-m6). Three inpatients had none
// at all, so their worklist rows showed no vitals beside beds that did.
// Bumped to 73: the patient intake-forms feature is gone (staff queue, public
// token form, API and DB). The four seeded intake docs and the
// tamamhealth_intake_forms database go with it; the bump purges the orphaned
// local DB from browsers seeded while the feature existed.
// Bumped to 74: operator-requested full reset. The server-side CouchDB volume
// was destroyed and recreated empty, so a browser still holding the version-73
// stores would have replicated its old documents straight back into the fresh
// database — the wipe would have undone itself on the first page load. The
// bump is what makes the two halves agree: `resetAllDatabases()` destroys the
// local stores (destroy, not delete, so no tombstones propagate) and the seed
// re-runs against the empty server.
export const SEED_VERSION = 74;

/**
 * Delete local PouchDB databases whose IndexedDB backing is corrupt.
 *
 * The signature is a database that EXISTS with zero object stores — the
 * remains of a create or delete that was interrupted (crash, tab kill,
 * storage eviction mid-versionchange). PouchDB cannot open one: its upgrade
 * transaction aborts ("Version change transaction was aborted") and every
 * later touch throws NotFoundError — and because `listLocalDatabases()`
 * enumerates IndexedDB by name, the wipe check, the dirty-database check and
 * the sync manager all re-open the corpse forever. One such database left a
 * dashboard on "Loading facility data…" indefinitely.
 *
 * Deleting is safe by construction: zero object stores means zero documents —
 * there is nothing inside to lose. Runs in a few milliseconds when nothing is
 * wrong; never throws (a repair that crashes boot is worse than the corruption
 * it repairs).
 */
export async function repairCorruptLocalDatabases(): Promise<string[]> {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return [];
  const repaired: string[] = [];
  try {
    const names = (await indexedDB.databases())
      .map(d => d.name)
      .filter((n): n is string => !!n && n.startsWith('_pouch_'));
    for (const name of names) {
      const stores = await Promise.race([
        new Promise<number | null>(resolve => {
          const req = indexedDB.open(name);
          req.onsuccess = () => { const db = req.result; const n = db.objectStoreNames.length; db.close(); resolve(n); };
          req.onerror = () => resolve(null);
          req.onblocked = () => resolve(-1);
        }),
        new Promise<number>(resolve => setTimeout(() => resolve(-1), 2000)),
      ]);
      // null = unopenable, 0 = the zero-store corpse. Both are unusable and
      // both hold nothing; -1 (blocked/slow) is a healthy database someone
      // else has open, so it is left alone.
      if (stores === 0 || stores === null) {
        await new Promise<void>(resolve => {
          const del = indexedDB.deleteDatabase(name);
          del.onsuccess = del.onerror = del.onblocked = () => resolve();
        });
        repaired.push(name);
      }
    }
    if (repaired.length) console.warn('[db] repaired corrupt local databases:', repaired);
  } catch {
    // Enumeration itself failing means nothing can be repaired this boot.
  }
  return repaired;
}

export async function isSeeded(): Promise<boolean> {
  try {
    const db = getDB('tamamhealth_meta');
    const doc = await db.get('seeded') as { version?: number };
    return doc.version === SEED_VERSION;
  } catch {
    return false;
  }
}

/**
 * True when a seed at the CURRENT version started but never wrote the final
 * 'seeded' marker — i.e. the browser reloaded (dev recompile, tab close, hard
 * navigation) mid-seed. Seed writes are idempotent skip-if-exists puts, so the
 * caller can resume and fill the gaps WITHOUT wiping; wiping again re-opens
 * the same interruption window and is how sessions end up with randomly empty
 * modules (no patients at the front desk, no conversations, empty lab queue).
 */
export async function isSeedInProgress(): Promise<boolean> {
  try {
    const db = getDB('tamamhealth_meta');
    const doc = await db.get('seed-started') as { version?: number };
    return doc.version === SEED_VERSION;
  } catch {
    return false;
  }
}

export async function markSeedStarted(): Promise<void> {
  const db = getDB('tamamhealth_meta');
  try {
    try {
      const existing = await db.get('seed-started');
      await db.remove(existing);
    } catch {
      // No existing marker
    }
    await db.put({ _id: 'seed-started', version: SEED_VERSION, timestamp: new Date().toISOString() });
  } catch (err: unknown) {
    const e = err as { status?: number };
    if (e.status === 409) return; // Already marked
    throw err;
  }
}

export async function markSeeded(): Promise<void> {
  const db = getDB('tamamhealth_meta');
  try {
    // Remove old marker if it exists
    try {
      const existing = await db.get('seeded');
      await db.remove(existing);
    } catch {
      // No existing marker
    }
    await db.put({ _id: 'seeded', version: SEED_VERSION, timestamp: new Date().toISOString() });
  } catch (err: unknown) {
    const e = err as { status?: number };
    if (e.status === 409) return; // Already marked
    throw err;
  }
}

// Reset all databases (useful for debugging).
// Browser-only: destroying a remote CouchDB database from a server process
// would take out data for every clinic on the cluster.
/**
 * Databases the browser opens that do NOT replicate, so they cannot be derived
 * from the sync map.
 *
 * `tamamhealth_users` is here for its legacy copy: user documents carry
 * password and PIN hashes and are no longer replicated, but browsers seeded
 * before that change still hold one and it has to be wipeable.
 */
const NON_REPLICATING_LOCAL_DATABASES: readonly string[] = [
  'tamamhealth_users',
  'tamamhealth_meta',
  // Retired with the account-request feature (Aug 2026). Kept for the same
  // reason as the intake forms below: a browser seeded while the feature
  // existed still holds this database, and dropping the name would leave it
  // orphaned on the device forever instead of wiped.
  'tamamhealth_account_requests',
  'tamamhealth_usage_events',
  'tamamhealth_slot_holds',
  // Retired with the patient intake-forms feature (v73). Kept so a browser
  // seeded while the feature existed still has the orphaned database purged.
  'tamamhealth_intake_forms',
];

/**
 * Every PouchDB database this app opens in the browser, by name.
 *
 * DERIVED from the sync map rather than hand-listed. The hand-written version
 * had drifted by eight databases — `clinical_notes` (signed encounter notes),
 * `consultation_progress`, `facility_census`, `text_shortcuts` and the four
 * online-booking stores — partly because three of those are opened by a
 * module-local `getDB('…')` call rather than an accessor in this file, so
 * adding one never prompted anybody to update the list here.
 *
 * The cost of a missing name is not theoretical: `resetAllDatabases()` uses
 * this list ONLY (no runtime discovery), so on a seed-version bump the omitted
 * databases survived on the device and replicated their stale documents back
 * up — which is the exact failure the v74 bump was made to stop.
 *
 * `src/__tests__/db-database-lists.test.ts` asserts the derivation stays whole.
 */
export const LOCAL_DATABASE_NAMES: readonly string[] = [
  ...DATABASE_SYNC_CONFIGS.map(config => config.localName),
  ...NON_REPLICATING_LOCAL_DATABASES,
];

/**
 * Databases `resetAllDatabases()` must leave alone.
 *
 * The controlled-substance log is an append-only regulatory trail and the reset
 * runs on production seed-version bumps. It is still a member of
 * `LOCAL_DATABASE_NAMES`, so the security wipe in `lib/security/local-wipe.ts`
 * does clear it off a device at logout — the two callers want different
 * answers, and conflating them previously left the register behind in both.
 */
const RESET_EXCLUDED_DATABASES: readonly string[] = [
  'tamamhealth_controlled_substance_log',
];

export async function resetAllDatabases(): Promise<void> {
  if (!IS_BROWSER) return;
  const PouchDB = loadPouchDB();
  const dbNames = LOCAL_DATABASE_NAMES.filter(
    name => !RESET_EXCLUDED_DATABASES.includes(name),
  );
  for (const name of dbNames) {
    try {
      // Prefer the cached instance — destroying a NEW PouchDB while the cached
      // one still holds an open IndexedDB connection causes the IndexedDB
      // deleteDatabase request to block until the open connection is closed.
      // Destroying the cached instance first releases the connection.
      const db = databases[name] ?? new PouchDB(name);
      // Remove from cache before destroy so any in-flight getDB() that fires
      // during the destroy doesn't get a half-deleted handle.
      delete databases[name];
      await db.destroy();
    } catch {
      // OK — may not exist yet, or already destroyed in a concurrent call
      delete databases[name];
    }
  }
  // Clear any remaining cached instances (entries created since the loop
  // started, e.g. by a parallel render that called getDB() while we were
  // mid-destroy).
  for (const key of Object.keys(databases)) {
    delete databases[key];
  }
}
