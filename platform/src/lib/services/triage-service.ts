import { patientsDB, triageDB } from '../db';
import type { PatientDoc, TriageDoc, TriagePriority } from '../db-types';
import { v4 as uuidv4 } from 'uuid';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { findByType } from './db-query';
import { jubaDate } from '../time-juba';
import { withPendingOfflineSync } from '../sync/offline-metadata';
import { getTriageVitalWarnings, isLowerTriagePriority, parseStrictVitalNumber, recommendTriagePriority, validateTriageVitals } from '../clinical/vitals';
import { isNoAllergySentinel } from '../clinical-roles';
import { highestTriagePriority, priorityFromIittCriteria } from '../clinical/iitt';
import { patientAgeYearsExact } from '../patient-utils';

/**
 * The patient's fractional age, for feeding `getTriageVitalWarnings`'
 * age-banded thresholds. Best-effort: a missing/unreadable patient record
 * (offline lag, bad id) resolves to `undefined` rather than blocking the
 * triage write — `getTriageVitalWarnings` already treats unknown age as
 * "apply adult ranges" and flags every such warning as resting on that
 * assumption.
 */
async function resolvePatientAgeYears(patientId?: string, scope?: DataScope): Promise<number | undefined> {
  if (!patientId) return undefined;
  try {
    const patient = await patientsDB().get(patientId) as PatientDoc;
    // Scoped, not just present: a `scope` from an authenticated caller (the
    // /api/triage route) must resolve an out-of-tenant patient exactly like
    // a lookup failure — age unknown — rather than let their real age reach
    // the vitals-warning text and become a cross-tenant existence oracle.
    // Callers with no scope (e.g. the browser's own PouchDB, which only
    // ever holds documents the device is entitled to) keep the bare lookup.
    if (scope && filterByScope([patient], scope).length === 0) return undefined;
    return patientAgeYearsExact(patient) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Recompute the vitals-based recommendation server-side from the doc's own
 * vitals + the patient's age, combined with the structured IITT red/yellow
 * criteria. This is what the override-reason gate below enforces against —
 * never `doc.vitalUrgencyRecommendation`, which is caller-supplied and, for
 * any caller other than the reviewed nurse triage form, unverified. A caller
 * that wants to save a priority below what the vitals actually justify must
 * go through the override path regardless of what it claims the
 * recommendation was.
 */
async function computeVitalUrgencyRecommendation(doc: Partial<TriageDoc>, capillaryRefill: number | null, scope?: DataScope): Promise<TriagePriority> {
  const patientAgeYears = await resolvePatientAgeYears(doc.patientId, scope);
  const warnings = getTriageVitalWarnings(
    {
      temperature: doc.temperature,
      pulse: doc.pulse,
      respiratoryRate: doc.respiratoryRate,
      oxygenSaturation: doc.oxygenSaturation,
      systolic: doc.systolic,
      diastolic: doc.diastolic,
      painScore: doc.painScore,
      bloodGlucose: doc.bloodGlucose,
      gcs: doc.gcs,
      muac: doc.muac,
    },
    patientAgeYears,
    { isPregnant: doc.pregnancyStatus === 'pregnant' },
  );
  const structuredRecommendation = priorityFromIittCriteria(doc.redCriteria || [], doc.yellowCriteria || [], capillaryRefill);
  // Baseline 'GREEN' is truthy, so `recommendTriagePriority` never takes its
  // `''`-for-incomplete-assessment branch here — the cast reflects that,
  // not a loosening of its general (ABCC-facing) contract.
  const vitalsRecommendation = recommendTriagePriority('GREEN', warnings) as TriagePriority;
  // Always at least 'GREEN': a triage with no elevated finding recommends
  // GREEN, which never itself requires an override.
  return highestTriagePriority(structuredRecommendation, vitalsRecommendation) as TriagePriority;
}

async function assertTriageVitalSafety(doc: Partial<TriageDoc>, scope?: DataScope): Promise<void> {
  const errors = validateTriageVitals({
    temperature: doc.temperature,
    pulse: doc.pulse,
    respiratoryRate: doc.respiratoryRate,
    oxygenSaturation: doc.oxygenSaturation,
    systolic: doc.systolic,
    diastolic: doc.diastolic,
    weight: doc.weight,
    height: doc.height,
    painScore: doc.painScore,
    bloodGlucose: doc.bloodGlucose,
    gcs: doc.gcs,
    muac: doc.muac,
  });
  const firstError = Object.values(errors)[0];
  if (firstError) throw new Error(firstError);

  const capillaryRefill = parseStrictVitalNumber(doc.capillaryRefillSeconds);
  if (doc.capillaryRefillSeconds && (capillaryRefill === null || capillaryRefill < 0 || capillaryRefill > 10)) {
    throw new Error('Capillary refill must be between 0 and 10 seconds.');
  }
  const gestationalAge = parseStrictVitalNumber(doc.gestationalAgeWeeks);
  if (
    doc.gestationalAgeWeeks &&
    (gestationalAge === null || !Number.isInteger(gestationalAge) || gestationalAge < 0 || gestationalAge > 45)
  ) {
    throw new Error('Gestational age must be a whole number from 0 to 45 weeks.');
  }

  const overrideReason = doc.vitalUrgencyOverrideReason?.trim();
  if (doc.vitalUrgencyOverridden && !overrideReason) {
    throw new Error('A reason is required to override the recommended triage urgency.');
  }

  // Recomputed, not trusted: a caller that supplies (or omits)
  // `vitalUrgencyRecommendation` cannot use that to bypass the gate — the
  // recommendation enforced here always comes from this doc's own vitals and
  // the patient's real age.
  const recommendation = await computeVitalUrgencyRecommendation(doc, capillaryRefill, scope);
  if (doc.priority && isLowerTriagePriority(doc.priority, recommendation) && (!doc.vitalUrgencyOverridden || !overrideReason)) {
    throw new Error('Saving below the recommended triage urgency requires a recorded override reason.');
  }
}

/**
 * ETAT priority calculator — encodes the WHO decision tree. Returns the
 * priority string or '' if the assessment is incomplete. Single
 * implementation shared with the nurse triage form and the /api/triage
 * route — see `../clinical/etat.ts` for why this used to be three copies.
 */
export { calculatePriority } from '../clinical/etat';

// Valid triage status transitions (state machine)
const VALID_TRANSITIONS: Record<string, string[]> = {
  // 'lwbs' (left without being seen, KAN-100) is reachable from either wait
  // state — a patient can walk out before triage starts or after it's done
  // but before a room/provider is free. It was missing here, so calling
  // updateTriage(id, {status:'lwbs'}) always threw an "invalid transition"
  // caught below and silently returned null.
  pending: ['seen', 'admitted', 'discharged', 'referred', 'lwbs'],
  seen: ['admitted', 'discharged', 'referred', 'lwbs'],
  admitted: ['discharged', 'referred'],
  discharged: [],
  referred: ['discharged'],
  lwbs: [],
};

export async function getAllTriage(scope?: DataScope): Promise<TriageDoc[]> {
  const db = triageDB();
  const all = await findByType<TriageDoc>(db, 'triage');
  /* istanbul ignore next -- defensive null-safety in sort */
  all.sort((a, b) => (b.triagedAt || '').localeCompare(a.triagedAt || ''));
  return scope ? filterByScope(all, scope) : all;
}

/** Exact triage lookup for workflows that must validate a supplied record id. */
export async function getTriageById(id: string): Promise<TriageDoc | null> {
  try {
    return await triageDB().get(id) as TriageDoc;
  } catch {
    return null;
  }
}

/** Triages for a specific patient, newest first. */
export async function getTriageByPatient(patientId: string, scope?: DataScope): Promise<TriageDoc[]> {
  const rows = await findByType<TriageDoc>(
    triageDB(),
    'triage',
    { patientId },
    { indexFields: ['type', 'patientId'] },
  );
  const visible = scope ? filterByScope(rows, scope) : rows;
  return visible.sort((a, b) => (b.triagedAt || '').localeCompare(a.triagedAt || ''));
}

export async function getTriageByEncounter(encounterId: string): Promise<TriageDoc | null> {
  const rows = await findByType<TriageDoc>(triageDB(), 'triage', { encounterId }, { indexFields: ['type', 'encounterId'] });
  return rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0] || null;
}

/** Active (pending) triages for the current facility — feeds the nurse queue. */
export async function getActiveTriage(scope?: DataScope): Promise<TriageDoc[]> {
  const all = await getAllTriage(scope);
  return all.filter(t => t.status === 'pending' || t.status === 'seen');
}

/**
 * Statuses a triage is still "in flight" at: not yet assessed (`pending`,
 * including a front-desk clerical placeholder) or assessed but not yet
 * administratively closed (`seen`). `admitted`/`discharged`/`referred`/
 * `lwbs` are the triage's terminal outcomes — once there, a later visit
 * legitimately starts a fresh triage rather than reopening this one.
 */
const ACTIVE_TRIAGE_STATUSES: ReadonlySet<TriageDoc['status']> = new Set<TriageDoc['status']>(['pending', 'seen']);

/** Thrown by `createTriage` when the patient already has an active triage —
 *  see its contract note below. `existingTriageId` lets the caller switch to
 *  `updateTriage` (or re-call `createTriage` with `resumePendingId`). */
export class DuplicateActiveTriageError extends Error {
  readonly code = 'DUPLICATE_ACTIVE_TRIAGE' as const;
  constructor(readonly existingTriageId: string, readonly patientId: string) {
    super(`Patient ${patientId} already has an active triage (${existingTriageId}). Update it instead of creating a new one.`);
    this.name = 'DuplicateActiveTriageError';
  }
}

/**
 * "Active" is status AND recency. The worklist already defines queue
 * membership as a non-terminal triage from the last 24 hours (see
 * `buildActiveTriageByPatient` in EhrClinicalDashboard — "older docs are
 * unclosed visits, not a patient still waiting"), and the duplicate guard
 * must use the same clock: a week-old `pending` record is an abandoned
 * visit, and treating it as active made `createTriage` refuse every new
 * check-in for that patient forever.
 */
const ACTIVE_TRIAGE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The patient's current non-terminal triage from the active window, if any —
 * see `ACTIVE_TRIAGE_STATUSES` and `ACTIVE_TRIAGE_WINDOW_MS`. Newest first,
 * so a patient with (incorrectly) more than one active record still resolves
 * to a single, most-recent one.
 */
export async function findActiveTriageForPatient(patientId: string, scope?: DataScope): Promise<TriageDoc | undefined> {
  const rows = await getTriageByPatient(patientId, scope);
  const cutoff = Date.now() - ACTIVE_TRIAGE_WINDOW_MS;
  return rows.find(t => {
    if (!ACTIVE_TRIAGE_STATUSES.has(t.status)) return false;
    const at = new Date(t.triagedAt || t.createdAt || 0).getTime();
    return !Number.isNaN(at) && at >= cutoff;
  });
}

export interface TriageActor {
  userId?: string;
  username?: string;
}

export interface CreateTriageOptions {
  /**
   * Resume (update in place) an existing pending/seen triage instead of
   * inserting a new document.
   *
   * Contract: `createTriage` refuses a second active triage for the same
   * patient (see `DuplicateActiveTriageError`) — EXCEPT check-in-service.ts
   * deliberately creates a `pending`, `assessmentSource: 'clerical_checkin'`
   * placeholder for every walk-in, and that placeholder must never be able
   * to refuse the nurse's real ETAT assessment for the same visit. A caller
   * that already knows about that placeholder (via
   * `findActiveTriageForPatient`) passes its id here: the duplicate check is
   * skipped entirely and the submitted data is written over the placeholder
   * through `updateTriage`, which keeps its id, its already-linked
   * `encounterId`, and produces one triage record per visit instead of two.
   */
  resumePendingId?: string;
  /** Forwarded to `updateTriage` when `resumePendingId` is used. */
  actor?: TriageActor;
  /**
   * Scope the duplicate-active-triage lookup and the vitals-safety gate's own
   * patient-age lookup to the caller's tenant — required for an authenticated
   * API caller (e.g. /api/triage) so it neither finds another org's active
   * triage nor lets another org's patient's real age reach the gate. Local
   * PouchDB callers (the browser only ever replicates data it is entitled
   * to) may omit it and keep the previous unscoped lookup — in particular
   * check-in-service.ts's clerical placeholder deliberately checks across
   * every facility the device holds, so a walk-in returning to a DIFFERENT
   * facility is still caught as a duplicate rather than missed.
   */
  scope?: DataScope;
}

/**
 * Merge the triage form's free-text "known allergies" into the patient's
 * canonical `allergies` list — the one source the chart header banner,
 * AllergiesSection and the prescribing safety checks all read. Without this
 * bridge, an allergy a nurse captured at triage lived only on the triage
 * record and the chart header kept claiming the patient had none.
 *
 * Returns the new list, or `null` when there is nothing to write:
 *   - the text parses to no real allergen ("", "none", "NKDA", …) — a
 *     sentinel must never overwrite or dilute recorded allergies;
 *   - every parsed allergen is already on the list (case-insensitively).
 * Additive only: existing entries are never removed, EXCEPT no-allergy
 * sentinel entries ("None known"), which are contradicted by the real
 * allergen being added alongside them.
 */
export function mergeTriageAllergies(
  existing: string[] | undefined,
  knownAllergies: string | undefined,
): string[] | null {
  const incoming = (knownAllergies || '')
    .split(/[,;\n]/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !isNoAllergySentinel(s));
  if (incoming.length === 0) return null;

  const kept = (existing || []).filter(a => a && !isNoAllergySentinel(a));
  const have = new Set(kept.map(a => a.trim().toLowerCase()));
  const additions: string[] = [];
  for (const allergen of incoming) {
    const key = allergen.toLowerCase();
    if (have.has(key)) continue;
    have.add(key);
    additions.push(allergen);
  }
  if (additions.length === 0 && kept.length === (existing?.length ?? 0)) return null;
  return [...kept, ...additions];
}

/** Best-effort follow-up to a triage save: land the captured allergies on the
 *  patient document so the chart reflects them immediately. Never fails the
 *  triage write — the assessment must save even if the patient doc is briefly
 *  in conflict — but a lost merge is made visible via the audit trail's
 *  absence and the console. */
async function applyTriageAllergiesToPatient(
  patientId: string,
  knownAllergies: string | undefined,
  actor?: TriageActor,
): Promise<void> {
  if (!knownAllergies || !knownAllergies.trim()) return;
  const db = patientsDB();
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const patient = await db.get(patientId) as PatientDoc;
      const merged = mergeTriageAllergies(patient.allergies, knownAllergies);
      if (!merged) return;
      try {
        await db.put(withPendingOfflineSync({
          ...patient,
          allergies: merged,
          // A real allergen contradicts a standing "no known drug
          // allergies" attestation — clear it rather than letting the chart
          // claim both at once.
          noKnownDrugAllergies: patient.noKnownDrugAllergies ? false : patient.noKnownDrugAllergies,
          updatedAt: new Date().toISOString(),
        }));
      } catch (error) {
        const conflict = error as { name?: string; status?: number } | undefined;
        if ((conflict?.name === 'conflict' || conflict?.status === 409) && attempt < 2) continue;
        throw error;
      }
      await logAuditSafe('PATIENT_ALLERGIES_UPDATED', actor?.userId, actor?.username,
        `Allergies recorded at triage merged onto patient ${patientId} (${merged.length} on file)`,
      );
      return;
    }
  } catch (err) {
    console.error('[triage] failed to merge triage allergies onto patient', patientId, err);
  }
}

export async function createTriage(
  data: Omit<TriageDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>,
  options: CreateTriageOptions = {},
): Promise<TriageDoc> {
  if (options.resumePendingId) {
    return updateTriage(options.resumePendingId, data, options.actor);
  }

  const existingActive = await findActiveTriageForPatient(data.patientId, options.scope);
  if (existingActive) {
    throw new DuplicateActiveTriageError(existingActive._id, data.patientId);
  }

  await assertTriageVitalSafety(data, options.scope);
  const db = triageDB();
  const now = new Date().toISOString();
  const doc: TriageDoc = withPendingOfflineSync({
    _id: `triage-${uuidv4()}`,
    type: 'triage',
    ...data,
    createdAt: now,
    updatedAt: now,
  }, now);
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe('TRIAGE_RECORDED', data.triagedBy, data.triagedByName,
    `${data.priority} triage for ${data.patientName} (${data.patientId})`
  );
  if (data.vitalUrgencyOverridden) {
    await logAuditSafe('TRIAGE_URGENCY_OVERRIDE', data.triagedBy, data.triagedByName,
      `Vital urgency ${data.vitalUrgencyRecommendation} overridden to ${data.priority} for ${data.patientName} (${data.patientId}). Reason: ${data.vitalUrgencyOverrideReason?.trim()}`
    );
  }
  emitSyncEvent({
    resourceType: 'triage',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });
  await applyTriageAllergiesToPatient(data.patientId, data.knownAllergies, options.actor);
  return doc;
}

// Fields with their own dedicated audit entry below (status transitions,
// vital-urgency overrides) — excluded from the generic "amendment" diff so a
// single call doesn't log the same change twice under two different actions.
const AMENDMENT_AUDIT_EXCLUDED_FIELDS = new Set<keyof TriageDoc>([
  'status', 'vitalUrgencyOverridden', 'vitalUrgencyOverrideReason',
  'vitalUrgencyRecommendation', 'vitalUrgencyWarnings', 'updatedAt', '_rev',
]);

/**
 * Value equality for the update-diff checks below. `redCriteria` /
 * `yellowCriteria` / `infectionRiskSigns` are arrays — comparing them with
 * `!==` is always true for two different array instances holding the SAME
 * codes, which made a caller that simply echoes a field back (a whole-form
 * re-save, `createTriage`'s `resumePendingId` path) look like it had amended
 * or changed it.
 */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return false;
}

/**
 * Fields whose change can move the vitals-urgency recommendation that
 * `assertTriageVitalSafety` enforces `doc.priority` against. Anything else
 * (status, assignedRoom, encounterId, notes, ...) cannot make a previously
 * safe priority unsafe — see the gate below for why that distinction matters.
 */
const VITAL_URGENCY_RECOMPUTE_FIELDS = new Set<keyof TriageDoc>([
  'temperature', 'pulse', 'respiratoryRate', 'oxygenSaturation', 'systolic', 'diastolic',
  'painScore', 'bloodGlucose', 'gcs', 'muac',
  'priority', 'redCriteria', 'yellowCriteria', 'capillaryRefillSeconds', 'pregnancyStatus',
]);

function updateAffectsVitalUrgencyRecommendation(updates: Partial<TriageDoc>, existing: TriageDoc): boolean {
  for (const key of VITAL_URGENCY_RECOMPUTE_FIELDS) {
    if (key in updates && !valuesEqual(updates[key], existing[key])) return true;
  }
  return false;
}

export async function updateTriage(
  id: string,
  updates: Partial<TriageDoc>,
  actor?: TriageActor,
): Promise<TriageDoc> {
  const db = triageDB();
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await db.get(id) as TriageDoc;

    // Enforce valid status transitions
    if (updates.status && updates.status !== existing.status) {
      /* istanbul ignore next -- defensive: all known statuses are in VALID_TRANSITIONS */
      const allowed = VALID_TRANSITIONS[existing.status] || [];
      if (!allowed.includes(updates.status)) {
        throw new Error(`Invalid triage status transition: ${existing.status} → ${updates.status}`);
      }
    }

    const updated: TriageDoc = withPendingOfflineSync({ ...existing, ...updates, updatedAt: new Date().toISOString() });
    // Only recompute-and-enforce when this update actually touches a field
    // the recommendation depends on. The doc's own vitals already passed
    // this gate at whichever earlier write last touched them; re-running it
    // for an update that doesn't (a bare status transition, an assigned-room
    // patch, encounterId re-linking) permanently stranded any doc where the
    // recommendation and the stored priority already disagree — a legacy
    // record predating this gate, or an infant/abnormal-vitals doc — since
    // that call would throw before the transition (e.g. seen → discharged,
    // or the escalate/LWBS encounter transition that runs ahead of it) could
    // ever succeed.
    if (updateAffectsVitalUrgencyRecommendation(updates, existing)) {
      await assertTriageVitalSafety(updated);
    }
    let resp: Awaited<ReturnType<typeof db.put>>;
    try {
      resp = await db.put(updated);
    } catch (error) {
      const conflict = (error as { name?: string; status?: number } | undefined);
      if ((conflict?.name === 'conflict' || conflict?.status === 409) && attempt < 2) continue;
      throw error;
    }
    updated._rev = resp.rev;
    if (updates.status) {
      await logAuditSafe('TRIAGE_STATUS_CHANGE', actor?.userId, actor?.username,
        `Triage ${id}: ${existing.status} → ${updates.status} for ${existing.patientName}`
      );
    } else {
      // No status transition this call — check for a plain content
      // amendment (e.g. correcting a chief complaint or a mistyped vital on
      // an already-saved record) and audit which FIELDS changed. Never the
      // values: this is a compliance trail, not a second copy of the PHI.
      const changedFields = (Object.keys(updates) as Array<keyof TriageDoc>).filter(
        key => !AMENDMENT_AUDIT_EXCLUDED_FIELDS.has(key) && !valuesEqual(updates[key], existing[key]),
      );
      if (changedFields.length > 0) {
        await logAuditSafe('TRIAGE_AMENDED', actor?.userId, actor?.username,
          `Triage ${id} amended for ${existing.patientName} (${existing.patientId}): fields changed — ${changedFields.join(', ')}`
        );
      }
    }
    if (
      updated.vitalUrgencyOverridden &&
      (!existing.vitalUrgencyOverridden ||
        existing.vitalUrgencyOverrideReason !== updated.vitalUrgencyOverrideReason ||
        existing.priority !== updated.priority)
    ) {
      await logAuditSafe('TRIAGE_URGENCY_OVERRIDE', existing.triagedBy, existing.triagedByName,
        `Vital urgency ${updated.vitalUrgencyRecommendation} overridden to ${updated.priority} for ${updated.patientName} (${updated.patientId}). Reason: ${updated.vitalUrgencyOverrideReason?.trim()}`
      );
    }
    emitSyncEvent({
      resourceType: 'triage',
      resourceId: updated._id,
      operation: 'update',
      resourceVersion: updated._rev,
      orgId: updated.orgId,
      hospitalId: updated.facilityId,
    });
    if (typeof updates.knownAllergies === 'string') {
      await applyTriageAllergiesToPatient(updated.patientId, updates.knownAllergies, actor);
    }
    return updated;
  }
  throw new Error('Triage changed on another workstation. Refresh and try again.');
}

/** Stats for the nurse dashboard header (active reds, today's totals). */
export async function getTriageStats(scope?: DataScope) {
  const all = await getAllTriage(scope);
  const today = jubaDate();
  /* istanbul ignore next -- defensive null-safety in filter */
  const todays = all.filter(t => t.triagedAt ? jubaDate(t.triagedAt) === today : false);
  return {
    total: all.length,
    todayTotal: todays.length,
    todayRed: todays.filter(t => t.priority === 'RED').length,
    todayYellow: todays.filter(t => t.priority === 'YELLOW').length,
    todayGreen: todays.filter(t => t.priority === 'GREEN').length,
    pending: all.filter(t => t.status === 'pending').length,
  };
}
