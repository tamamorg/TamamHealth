import { patientsDB, hospitalsDB } from '../db';
import type { PatientDoc, HospitalDoc } from '../db-types';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { v4 as uuidv4 } from 'uuid';
import { validatePatientData, ValidationError, normalizeGender } from '../validation';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { findByType } from './db-query';
import { getSettings } from '../settings/settings-store';
import { normalizePhone, normalizeEmail, normalizeNationalId } from '../field-formats';
import { withPendingOfflineSync } from '../sync/offline-metadata';
import {
  buildGeocodeId,
  buildUnknownId,
  householdPrefix,
  nextPatientSuffix,
} from '../clinical-flow/patient-identity';

/**
 * Canonicalize contact/identity fields before validation + storage so every
 * patient record holds the same format (phones as +211XXXXXXXXX, email
 * lower-cased, national ID upper-cased). Invalid phones are left untouched so
 * validation surfaces a clear error rather than silently dropping the value.
 */
function normalizePatientContact<T extends Record<string, unknown>>(data: T): T {
  const out = { ...data } as Record<string, unknown>;
  for (const f of ['phone', 'altPhone', 'whatsapp', 'nokPhone']) {
    if (out[f]) {
      const n = normalizePhone(out[f]);
      if (n) out[f] = n;
    }
  }
  if (out.email) out.email = normalizeEmail(out.email);
  if (out.nationalId) out.nationalId = normalizeNationalId(out.nationalId);
  // Canonical casing so storage never accumulates a second spelling of the
  // same value (KAN-17). Left untouched when unrecognised so validation can
  // report it rather than this silently dropping the field.
  if (out.gender !== undefined) {
    const g = normalizeGender(out.gender);
    if (g) out.gender = g;
  }
  return out as T;
}

/**
 * Generate a geocode ID from boma code and household number.
 * Format: BOMA-{bomaCode}-HH{householdNumber}
 * Expert recommendation: Use household geocoding instead of national IDs.
 */
export function generateGeocodeId(bomaCode: string, householdNumber: number): string {
  const code = bomaCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `BOMA-${code}-HH${householdNumber}`;
}

export async function getAllPatients(scope?: DataScope): Promise<PatientDoc[]> {
  const db = patientsDB();
  const all = await findByType<PatientDoc>(db, 'patient');
  /* istanbul ignore next -- scope filter: tested with and without */
  return scope ? filterByScope(all, scope) : all;
}

export async function getPatientById(id: string): Promise<PatientDoc | null> {
  try {
    const db = patientsDB();
    return await db.get(id) as PatientDoc;
  } catch {
    return null;
  }
}

export async function searchPatients(query: string, scope?: DataScope): Promise<PatientDoc[]> {
  const all = await getAllPatients(scope);
  const q = query.toLowerCase();
  /* istanbul ignore next -- defensive null-safety in search filter */
  return all.filter(p =>
    `${p.firstName} ${p.middleName || ''} ${p.surname}`.toLowerCase().includes(q) ||
    (p.hospitalNumber || '').toLowerCase().includes(q) ||
    (p.phone || '').includes(q) ||
    (p.geocodeId || '').toLowerCase().includes(q) ||
    (p.boma || '').toLowerCase().includes(q)
  );
}

/**
 * Default fallback prefix used in hospital-number generation when a facility's
 * own prefix can't be resolved (no hospitalId, hospitalsDB lookup miss, no
 * `code`/`name` field on the doc). Override at deploy time via
 * `NEXT_PUBLIC_HOSPITAL_NUMBER_DEFAULT_PREFIX` so non-South-Sudan deploys
 * don't ship with a Tamam-branded code.
 */
const DEFAULT_HOSPITAL_PREFIX =
  process.env.NEXT_PUBLIC_HOSPITAL_NUMBER_DEFAULT_PREFIX || 'TAB';

/**
 * Effective default hospital-number prefix: prefer the live facility setting,
 * then the env-configured default, then 'TAB'. The settings default mirrors
 * 'TAB', so behaviour is identical until an admin changes it.
 */
function defaultHospitalPrefix(): string {
  return getSettings().hospitalNumberPrefix || DEFAULT_HOSPITAL_PREFIX;
}

/**
 * Derive a 3-letter prefix from a hospital's display name when no explicit
 * `code` field exists on the doc. Picks initials of the first three words
 * (e.g. "Juba Teaching Hospital" -> "JTH"). Falls back to the first three
 * upper-cased letters if the name is a single word.
 */
function deriveHospitalPrefix(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return DEFAULT_HOSPITAL_PREFIX;
  if (words.length >= 2) {
    return words.slice(0, 3).map(w => w[0]?.toUpperCase() || '').join('').padEnd(3, 'X').slice(0, 3);
  }
  return words[0].slice(0, 3).toUpperCase().padEnd(3, 'X');
}

/* istanbul ignore next -- private utility: hospital prefix lookup */
async function getHospitalPrefix(hospitalId?: string): Promise<string> {
  if (!hospitalId) return defaultHospitalPrefix();

  // Prefer the hospital's own `code` (or derived from name) when the doc is
  // present in hospitalsDB. This works for any deployment, not just the demo
  // seed, because every facility document carries its own identifying info.
  try {
    const hosp = await hospitalsDB().get(hospitalId) as HospitalDoc & { code?: string };
    if (hosp.code && typeof hosp.code === 'string' && hosp.code.length > 0) {
      return hosp.code.toUpperCase();
    }
    if (hosp.name) return deriveHospitalPrefix(hosp.name);
  } catch {
    // Fall through to ID-pattern heuristics below.
  }

  // Structural ID prefixes — independent of any specific deployment's data.
  if (hospitalId.startsWith('phcc-')) return 'PHC';
  if (hospitalId.startsWith('phcu-')) return 'BMU';
  if (hospitalId.startsWith('county-')) return 'CTY';
  return defaultHospitalPrefix();
}

/* istanbul ignore next -- private utility: org ID inference */
async function inferOrgIdFromHospital(hospitalId?: string): Promise<string | undefined> {
  if (!hospitalId) return undefined;
  try {
    const hdb = hospitalsDB();
    const hosp = await hdb.get(hospitalId) as HospitalDoc;
    return hosp.orgId;
  } catch {
    return undefined;
  }
}

/**
 * ISO 3166-1 alpha-2 code for the jurisdiction that owns new records.
 *
 * `BaseDoc.countryId` is documented as being populated at create time so the
 * country-node aggregator can partition for DHIS2 reporting and cross-border
 * referral routing — but nothing was ever setting it, so every patient doc
 * carried `undefined`.
 *
 * Source of truth is deployment config, because a facility node serves exactly
 * one jurisdiction. `HospitalDoc` has no country field today; if one is added
 * later it should win over the env var, so that lookup goes first.
 */
const COUNTRY_NAME_TO_ISO: Readonly<Record<string, string>> = {
  'south sudan': 'SS',
  'republic of south sudan': 'SS',
  sudan: 'SD',
  kenya: 'KE',
  uganda: 'UG',
  ethiopia: 'ET',
  somalia: 'SO',
};

export function resolveConfiguredCountryId(): string | undefined {
  // Explicit ISO code wins — unambiguous and what operators should set.
  const explicit = process.env.NEXT_PUBLIC_ORG_COUNTRY_CODE?.trim();
  if (explicit) return explicit.toUpperCase();

  // Fall back to deriving it from the display name already in .env.example.
  const name = process.env.NEXT_PUBLIC_ORG_COUNTRY?.trim().toLowerCase();
  if (name && COUNTRY_NAME_TO_ISO[name]) return COUNTRY_NAME_TO_ISO[name];

  // Unknown/unset: leave undefined rather than guessing. A wrong country code
  // misroutes cross-border referrals, which is worse than an absent one.
  return undefined;
}

async function inferCountryIdFromHospital(hospitalId?: string): Promise<string | undefined> {
  if (hospitalId) {
    try {
      const hdb = hospitalsDB();
      const hosp = await hdb.get(hospitalId) as HospitalDoc & { countryId?: string };
      if (hosp.countryId) return hosp.countryId.toUpperCase();
    } catch {
      // Fall through to deployment config.
    }
  }
  return resolveConfiguredCountryId();
}

/**
 * Assign the per-patient geocode identifier (Principle 2.7).
 *
 * Previously `geocodeId` was only ever read — for search and duplicate
 * detection — and never written, so the field stayed empty for every patient
 * registered through the app. Where it *was* constructed elsewhere it omitted
 * the patient suffix, so an entire household collided on one ID.
 *
 * Returns undefined when the boma code or household number is unknown; those
 * patients are legitimately "transient" per the identity model and can be
 * upgraded later without changing their UUID.
 */
async function assignGeocodeId(data: Record<string, unknown>, scope?: DataScope): Promise<string | undefined> {
  const bomaCode = (data.bomaCode as string | undefined)?.trim();
  const householdNumber = data.householdNumber as string | number | undefined;
  const all = await getAllPatients(scope);

  // No boma/household yet — displaced, transient, or an emergency admission.
  // Issue a temporary UNKNOWN- identifier rather than leaving the field empty:
  // an empty geocodeId is indistinguishable from "not yet looked up", whereas
  // UNKNOWN- is explicitly upgradeable and `isTemporaryId()` can find them for
  // follow-up. The patient's UUID never changes when it is upgraded.
  if (!bomaCode || householdNumber === undefined || householdNumber === null || householdNumber === '') {
    const facility = (data.registrationHospital as string | undefined) || 'UNSPEC';
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const todaysPrefix = `UNKNOWN-${facility}-${date}-`;
    // Sequence within this facility/day, again taking highest + 1 so a deleted
    // record cannot collide with a live one.
    let highest = 0;
    for (const p of all) {
      if (typeof p.geocodeId === 'string' && p.geocodeId.startsWith(todaysPrefix)) {
        const seq = Number(p.geocodeId.slice(todaysPrefix.length));
        if (!isNaN(seq)) highest = Math.max(highest, seq);
      }
    }
    return buildUnknownId({ facility, date, seq: highest + 1 });
  }

  const prefix = householdPrefix({ bomaCode, householdNumber });
  const siblings = all
    .map((p) => p.geocodeId)
    .filter((id): id is string => typeof id === 'string' && id.startsWith(`${prefix}-`));

  return buildGeocodeId({
    bomaCode,
    householdNumber,
    patientSuffix: nextPatientSuffix(siblings),
  });
}

/**
 * Generate a unique hospital number using UUID suffix to avoid race conditions.
 * Format: PREFIX-XXXXXX (e.g., JTH-A3F2B1)
 */
/**
 * Monotonic counter for hospital numbers, stored per facility prefix.
 *
 * `_local/` documents are deliberate: they are NOT replicated, so each facility
 * node keeps its own sequence and two facilities can never fight over the same
 * counter revision. The number is already namespaced by facility prefix, so
 * per-node counters are the correct model.
 *
 * Replaces a `db.allDocs().total_rows` count, which was wrong in two ways:
 * it was O(N) on every registration, and — worse — deleting a patient lowered
 * the count so the NEXT registration reissued a number that already belonged
 * to someone. In an EMR a reused patient identifier is a safety problem, not
 * just an integrity one.
 */
async function nextHospitalSequence(prefix: string): Promise<number> {
  const db = patientsDB();
  const counterId = `_local/hospital_number_counter_${prefix}`;

  for (let attempt = 0; attempt < 5; attempt++) {
    let current: { _id: string; _rev?: string; seq: number };
    try {
      current = await db.get(counterId) as unknown as { _id: string; _rev?: string; seq: number };
    } catch (err) {
      const e = err as { name?: string; status?: number } | undefined;
      if (!e || (e.name !== 'not_found' && e.status !== 404)) throw err;
      // First registration for this prefix. Seed above any number already in
      // use so an existing dataset (seeded or migrated) can't collide.
      current = { _id: counterId, seq: await highestExistingSequence(prefix) };
    }

    const next = { ...current, seq: current.seq + 1 };
    try {
      await db.put(next as unknown as Record<string, unknown>);
      return next.seq;
    } catch (err) {
      const e = err as { name?: string; status?: number } | undefined;
      // Another tab/worker incremented first — re-read and try again.
      if (e && (e.name === 'conflict' || e.status === 409)) continue;
      throw err;
    }
  }
  throw new Error('Could not allocate a hospital number after 5 attempts');
}

/** Highest sequence already present for a prefix, so a fresh counter starts above it. */
async function highestExistingSequence(prefix: string): Promise<number> {
  const all = await getAllPatients();
  let highest = 0;
  for (const p of all) {
    if (typeof p.hospitalNumber === 'string' && p.hospitalNumber.startsWith(`${prefix}-`)) {
      // Format is PREFIX-NNNNXX; take the leading digits of the suffix.
      const m = /^(\d+)/.exec(p.hospitalNumber.slice(prefix.length + 1));
      if (m) highest = Math.max(highest, Number(m[1]));
    }
  }
  return highest;
}

async function generateHospitalNumber(hospitalId?: string): Promise<string> {
  const prefix = await getHospitalPrefix(hospitalId);
  const seq = await nextHospitalSequence(prefix);
  // The 2-char random tail is retained as belt-and-braces against a counter
  // that gets rolled back by a restore; the sequence carries the ordering.
  const suffix = `${String(seq).padStart(4, '0')}${uuidv4().slice(0, 2).toUpperCase()}`;
  return `${prefix}-${suffix}`;
}

/**
 * Check for potential duplicate patients by name+DOB, phone, geocodeId, or nationalId.
 */
async function checkDuplicates(data: Record<string, unknown>, scope?: DataScope): Promise<string | null> {
  const all = await getAllPatients(scope);
  const firstName = ((data.firstName as string) || '').toLowerCase().trim();
  const surname = ((data.surname as string) || '').toLowerCase().trim();
  const dob = data.dateOfBirth as string | undefined;
  const phone = data.phone as string | undefined;
  const geocodeId = data.geocodeId as string | undefined;
  const nationalId = data.nationalId as string | undefined;

  for (const p of all) {
    // Match by name + DOB
    if (firstName && surname && dob &&
        p.firstName.toLowerCase() === firstName &&
        p.surname.toLowerCase() === surname &&
        p.dateOfBirth === dob) {
      return `A patient named "${p.firstName} ${p.surname}" with the same date of birth already exists (${p.hospitalNumber})`;
    }
    // Match by phone. Compared on digits only so "0912 345 678" and
    // "+211912345678" are recognised as the same number rather than as two
    // patients — sharing a household phone is normal here, but the same string
    // typed two ways is not a different person.
    if (phone && digitsOf(phone).length >= MIN_PHONE_DIGITS && digitsOf(p.phone) === digitsOf(phone)) {
      return `A patient with phone number ${phone} already exists (${p.firstName} ${p.surname}, ${p.hospitalNumber})`;
    }
    // Match by geocode ID
    if (geocodeId && p.geocodeId === geocodeId) {
      return `A patient with Geocode ID ${geocodeId} already exists (${p.firstName} ${p.surname})`;
    }
    // Match by national ID
    if (nationalId && nationalId.trim().length >= MIN_NATIONAL_ID_LENGTH && p.nationalId === nationalId) {
      return `A patient with National ID ${nationalId} already exists (${p.firstName} ${p.surname})`;
    }
  }
  return null;
}

/**
 * Minimum length before a national ID is treated as identifying (KAN-15).
 *
 * The old threshold was 3 characters, which is not an identifier — it is a
 * fragment. Two unrelated patients whose partially-recorded IDs both read "123"
 * would block each other's registration, and a clerk faced with "this patient
 * already exists" for someone standing in front of them will work around the
 * system. A wrong duplicate-block is worse than a missed one here, because the
 * missed one is recoverable by a later MPI merge and the wrong one loses the
 * registration entirely.
 */
const MIN_NATIONAL_ID_LENGTH = 6;

/** Minimum digits before a phone number is treated as identifying. */
const MIN_PHONE_DIGITS = 9;

/** Digits only, so formatting differences don't read as different numbers. */
function digitsOf(value: string | undefined): string {
  return (value || '').replace(/\D/g, '');
}

/**
 * Atomically claim a strong identifier before writing the patient (KAN-15).
 *
 * `checkDuplicates` reads, then `createPatient` writes. Between those two steps
 * nothing holds the identifier, so two concurrent registrations of the same
 * person both pass the check and both insert — the classic TOCTOU race. A
 * duplicated patient record is not a cosmetic problem in an EMR: the two charts
 * accumulate different allergies, medications and results, and a clinician
 * reads whichever one they opened.
 *
 * PouchDB has no unique secondary index, so the claim is expressed the way
 * CouchDB does it — as a document whose `_id` IS the identifier. A second
 * concurrent writer gets a 409 conflict from the database itself rather than
 * from a check it can race.
 *
 * `_local/` deliberately, for the same reason as the hospital-number counter:
 * these documents do not replicate. That means:
 *   - The race THIS ticket describes (concurrent writes against one node) is
 *     genuinely closed.
 *   - Two *different facilities* registering the same person offline still
 *     produce two records. That is cross-facility de-duplication, which is
 *     `mpi-service`'s job and needs a human merge decision — not something to
 *     silently resolve at write time.
 *   - Nothing leaks into the analytics projection: a replicating claim doc in
 *     the patients database would reach `/api/sync` and be mapped as if it
 *     were a patient.
 *
 * Returns true when the claim is ours, false when someone already holds it.
 */
async function claimIdentifier(kind: 'geocode' | 'national', value: string): Promise<boolean> {
  const db = patientsDB();
  const claimId = `_local/patient_uid_${kind}_${value.trim().toLowerCase()}`;
  try {
    await db.get(claimId);
    return false; // Already claimed.
  } catch (err) {
    const e = err as { name?: string; status?: number } | undefined;
    if (e && (e.name === 'not_found' || e.status === 404)) {
      try {
        await db.put({ _id: claimId, claimedAt: new Date().toISOString() } as never);
        return true;
      } catch (putErr) {
        const pe = putErr as { name?: string; status?: number } | undefined;
        // Lost the race to a concurrent writer — exactly the case this exists for.
        if (pe && (pe.name === 'conflict' || pe.status === 409)) return false;
        throw putErr;
      }
    }
    throw err;
  }
}

/**
 * Hand an identifier claim back, so a failed registration doesn't permanently
 * lock a patient out of their own geocode/national ID. Best-effort: a leaked
 * claim blocks one identifier, which a later merge can clear, whereas throwing
 * here would mask the real registration error.
 */
async function releaseIdentifier(kind: 'geocode' | 'national', value: string): Promise<void> {
  const db = patientsDB();
  const claimId = `_local/patient_uid_${kind}_${value.trim().toLowerCase()}`;
  try {
    const existing = await db.get(claimId) as { _id: string; _rev: string };
    await db.remove(existing);
  } catch {
    /* already gone, or unreachable — nothing useful to do */
  }
}

export async function createPatient(rawData: Omit<PatientDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>): Promise<PatientDoc> {
  const data = normalizePatientContact(rawData as unknown as Record<string, unknown>) as typeof rawData;
  const errors = validatePatientData(data as unknown as Record<string, unknown>);

  // Check for duplicate patients
  const duplicateMsg = await checkDuplicates(data as unknown as Record<string, unknown>);
  if (duplicateMsg) {
    errors.duplicate = duplicateMsg;
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError(errors);
  }
  const db = patientsDB();
  const now = new Date().toISOString();
  const id = `pat-${uuidv4().slice(0, 8)}`;
  // Resolved BEFORE the hospital number so a patient that cannot be saved does
  // not burn an MRN on the way to being refused.
  const orgId = data.orgId || await inferOrgIdFromHospital(data.registrationHospital);
  // A patient with no organisation is not a saved patient, however cleanly the
  // local write succeeds:
  //   • CouchDB's tenant validator refuses every document without an orgId
  //     ('orgId is required on this database'), so the record is written to the
  //     device's replica, pushed, rejected, and never seen again — under a
  //     "Registered" toast.
  //   • `filterByScope` matches on orgId for every role except super_admin and
  //     government, so even on that one device the front desk, the clinician
  //     and the pharmacy cannot see the person who was just registered.
  // It happened whenever the registering user carried no facility of their own
  // (a platform super_admin, an org_admin between postings): registrationHospital
  // came through empty, the org could not be inferred from it, and nothing
  // checked. Refuse it here, keyed to the field the form asks for.
  if (!orgId) {
    throw new ValidationError({
      registrationHospital:
        'Select the facility this patient is being registered at — a patient cannot be saved without one.',
    });
  }
  const hospitalNumber = data.hospitalNumber || await generateHospitalNumber(data.registrationHospital);
  const countryId = data.countryId || await inferCountryIdFromHospital(data.registrationHospital);
  const geocodeId = data.geocodeId
    || await assignGeocodeId(data as unknown as Record<string, unknown>);

  // Close the TOCTOU window between checkDuplicates() above and db.put() below
  // (KAN-15). Claims are taken here, immediately before the write, so a
  // concurrent registration of the same person loses at the database rather
  // than passing a check it raced.
  const heldClaims: Array<{ kind: 'geocode' | 'national'; value: string }> = [];
  const releaseClaims = async () => {
    for (const c of heldClaims) await releaseIdentifier(c.kind, c.value);
  };
  if (geocodeId) {
    if (!(await claimIdentifier('geocode', geocodeId))) {
      throw new ValidationError({ duplicate: `A patient with Geocode ID ${geocodeId} is already registered.` });
    }
    heldClaims.push({ kind: 'geocode', value: geocodeId });
  }
  const nationalIdValue = (data.nationalId || '').trim();
  if (nationalIdValue.length >= MIN_NATIONAL_ID_LENGTH) {
    if (!(await claimIdentifier('national', nationalIdValue))) {
      await releaseClaims();
      throw new ValidationError({ duplicate: `A patient with National ID ${nationalIdValue} is already registered.` });
    }
    heldClaims.push({ kind: 'national', value: nationalIdValue });
  }

  const doc: PatientDoc = withPendingOfflineSync({
    _id: id,
    type: 'patient',
    ...data,
    orgId,
    countryId,
    ...(geocodeId ? { geocodeId } : {}),
    hospitalNumber,
    registeredAt: data.registeredAt || now,
    createdAt: now,
    updatedAt: now,
  } as PatientDoc, now);
  let resp;
  try {
    resp = await db.put(doc);
  } catch (err) {
    // The claims exist to protect this write. If it fails, hand them back —
    // otherwise a transient error would permanently block the patient from
    // ever being registered with their own identifiers.
    await releaseClaims();
    throw err;
  }
  doc._rev = resp.rev;
  await logAuditSafe('CREATE_PATIENT', undefined, undefined, `Created patient ${doc._id}: ${data.firstName} ${data.surname} (${hospitalNumber})`);
  emitSyncEvent({
    resourceType: 'patient',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.registrationHospital,
  });
  return doc;
}

export async function updatePatient(id: string, rawData: Partial<PatientDoc>): Promise<PatientDoc | null> {
  const data = normalizePatientContact(rawData as unknown as Record<string, unknown>) as Partial<PatientDoc>;
  const db = patientsDB();
  let existing: PatientDoc;
  try {
    existing = await db.get(id) as PatientDoc;
  } catch (err) {
    // PouchDB / CouchDB throws on missing docs (name === 'not_found' / status 404).
    // Translate that into the null contract the route relies on, so callers can
    // distinguish "doesn't exist" (404) from "real server error" (500).
    const e = err as { name?: string; status?: number } | undefined;
    if (e && (e.name === 'not_found' || e.status === 404)) return null;
    throw err;
  }
  const inferredOrg = data.orgId || existing.orgId || await inferOrgIdFromHospital(data.registrationHospital || existing.registrationHospital);
  const updated = withPendingOfflineSync({
    ...existing,
    ...data,
    orgId: inferredOrg,
    _id: existing._id,
    _rev: existing._rev,
    updatedAt: new Date().toISOString(),
  } as PatientDoc);
  // Validate the merged document, but only *block* on errors for fields the
  // caller is actually writing. Full-document validation here used to reject
  // any partial update to a record with pre-existing gaps (e.g. legacy/seed
  // patients created before `primaryLanguage` became required), which made
  // those records permanently un-updatable — referral acceptance could never
  // re-home the patient (its transfer patches only hospital/org fields). The
  // invariant we keep: a write cannot *introduce* invalid data — any invalid
  // value in the patch itself still throws. Pre-existing gaps in untouched
  // fields are tolerated and left for the next full-form edit to fill.
  const errors = validatePatientData(updated as unknown as Record<string, unknown>);
  const blockingErrors = Object.fromEntries(
    Object.entries(errors).filter(([field]) => field in data),
  );
  if (Object.keys(blockingErrors).length > 0) {
    throw new ValidationError(blockingErrors);
  }
  const resp = await db.put(updated);
  updated._rev = resp.rev;
  // Record which fields changed (names only, no PII values) so patient-record
  // edits are attributable at the field level for audit/compliance.
  const changedFields = Object.keys(data).filter(
    (k) => !['_id', '_rev', 'updatedAt'].includes(k),
  );
  await logAuditSafe(
    'UPDATE_PATIENT',
    undefined,
    undefined,
    `Updated patient ${id}${changedFields.length ? ` — fields: ${changedFields.join(', ')}` : ''}`,
  );
  emitSyncEvent({
    resourceType: 'patient',
    resourceId: updated._id,
    operation: 'update',
    resourceVersion: updated._rev,
    orgId: updated.orgId,
    hospitalId: updated.registrationHospital,
  });
  return updated;
}

/**
 * Atomically read-modify-write a patient document with optimistic-concurrency
 * retry. The `mutate` callback receives the LATEST persisted patient on each
 * attempt and returns the field patch to apply (or null to abort as a no-op).
 * On a revision conflict (concurrent write) the read+mutate is retried against
 * fresh data, so two simultaneous edits to array fields like `structuredAllergies`
 * can't silently drop each other (audit finding H2).
 *
 * Used for the on-chart structured lists (allergies, directives, care alerts).
 */
export async function mutatePatient(
  id: string,
  mutate: (patient: PatientDoc) => Partial<PatientDoc> | null,
  maxRetries = 5,
): Promise<PatientDoc | null> {
  const db = patientsDB();
  for (let attempt = 0; ; attempt++) {
    let existing: PatientDoc;
    try {
      existing = await db.get(id) as PatientDoc;
    } catch (err) {
      const e = err as { name?: string; status?: number } | undefined;
      if (e && (e.name === 'not_found' || e.status === 404)) return null;
      throw err;
    }
    const patch = mutate(existing);
    if (patch === null) return existing;
    const updated = withPendingOfflineSync({
      ...existing,
      ...patch,
      _id: existing._id,
      _rev: existing._rev,
      updatedAt: new Date().toISOString(),
    } as PatientDoc);
    const errors = validatePatientData(updated as unknown as Record<string, unknown>);
    if (Object.keys(errors).length > 0) {
      throw new ValidationError(errors);
    }
    try {
      const resp = await db.put(updated);
      updated._rev = resp.rev;
      // Audit every mutation that lands, not just those routed through
      // updatePatient(). This path was previously silent, leaving a hole in
      // the PHI trail for anything that mutates a patient in a retry loop.
      // Field NAMES only — never values.
      const changedFields = Object.keys(patch).filter(
        (k) => !['_id', '_rev', 'type', 'createdAt', 'updatedAt', 'offlineSync'].includes(k),
      );
      await logAuditSafe(
        'UPDATE_PATIENT',
        undefined,
        undefined,
        `Updated patient ${updated._id}${changedFields.length ? ` — fields: ${changedFields.join(', ')}` : ''}`,
      );
      emitSyncEvent({
        resourceType: 'patient',
        resourceId: updated._id,
        operation: 'update',
        resourceVersion: updated._rev,
        orgId: updated.orgId,
        hospitalId: updated.registrationHospital,
      });
      return updated;
    } catch (err) {
      const e = err as { name?: string; status?: number } | undefined;
      if (e && (e.name === 'conflict' || e.status === 409) && attempt < maxRetries) {
        continue; // re-read latest revision and re-apply the mutation
      }
      throw err;
    }
  }
}

// One-shot per-process index creation. Mango createIndex is idempotent
// server-side but each call costs an HTTP round-trip, so we cache.
const hospitalIndexCreated = { done: false };

export async function getPatientsByHospital(hospitalId: string): Promise<PatientDoc[]> {
  const db = patientsDB();
  if (!hospitalIndexCreated.done) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any).createIndex({ index: { fields: ['type', 'registrationHospital'] } });
    } catch {
      // older couchdb / index conflict — find() will fall back to a full
      // scan once. Cache the attempt either way.
    }
    hospitalIndexCreated.done = true;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await (db as any).find({
    selector: { type: 'patient', registrationHospital: hospitalId },
    limit: 1000000,
  });
  return (r.docs || []) as PatientDoc[];
}

export async function archivePatient(id: string, actor?: string): Promise<PatientDoc | null> {
  const db = patientsDB();
  // PouchDB.get throws on not-found (it never returns falsy), so translate that
  // into the documented null contract instead of letting it propagate.
  let existing: PatientDoc;
  try {
    existing = await db.get(id) as PatientDoc;
  } catch {
    return null;
  }
  const updated: PatientDoc = withPendingOfflineSync({
    ...existing,
    isActive: false,
    updatedAt: new Date().toISOString(),
  });
  const resp = await db.put(updated);
  updated._rev = resp.rev;
  await logAuditSafe('ARCHIVE_PATIENT', undefined, actor, `Archived patient ${id}`);
  emitSyncEvent({
    resourceType: 'patient',
    resourceId: updated._id,
    operation: 'archive',
    resourceVersion: updated._rev,
    username: actor,
    orgId: updated.orgId,
    hospitalId: updated.registrationHospital,
  });
  return updated;
}

export async function unarchivePatient(id: string, actor?: string): Promise<PatientDoc | null> {
  const db = patientsDB();
  let existing: PatientDoc;
  try {
    existing = await db.get(id) as PatientDoc;
  } catch {
    return null;
  }
  const updated: PatientDoc = withPendingOfflineSync({
    ...existing,
    isActive: true,
    updatedAt: new Date().toISOString(),
  });
  const resp = await db.put(updated);
  updated._rev = resp.rev;
  await logAuditSafe('UNARCHIVE_PATIENT', undefined, actor, `Restored patient ${id}`);
  emitSyncEvent({
    resourceType: 'patient',
    resourceId: updated._id,
    operation: 'update',
    resourceVersion: updated._rev,
    username: actor,
    orgId: updated.orgId,
    hospitalId: updated.registrationHospital,
  });
  return updated;
}
