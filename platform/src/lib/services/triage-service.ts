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
async function resolvePatientAgeYears(patientId?: string): Promise<number | undefined> {
  if (!patientId) return undefined;
  try {
    const patient = await patientsDB().get(patientId) as PatientDoc;
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
async function computeVitalUrgencyRecommendation(doc: Partial<TriageDoc>, capillaryRefill: number | null): Promise<TriagePriority> {
  const patientAgeYears = await resolvePatientAgeYears(doc.patientId);
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

async function assertTriageVitalSafety(doc: Partial<TriageDoc>): Promise<void> {
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
  const recommendation = await computeVitalUrgencyRecommendation(doc, capillaryRefill);
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
}

export async function createTriage(
  data: Omit<TriageDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>,
  options: CreateTriageOptions = {},
): Promise<TriageDoc> {
  if (options.resumePendingId) {
    return updateTriage(options.resumePendingId, data, options.actor);
  }

  const existingActive = await findActiveTriageForPatient(data.patientId);
  if (existingActive) {
    throw new DuplicateActiveTriageError(existingActive._id, data.patientId);
  }

  await assertTriageVitalSafety(data);
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
  return doc;
}

// Fields with their own dedicated audit entry below (status transitions,
// vital-urgency overrides) — excluded from the generic "amendment" diff so a
// single call doesn't log the same change twice under two different actions.
const AMENDMENT_AUDIT_EXCLUDED_FIELDS = new Set<keyof TriageDoc>([
  'status', 'vitalUrgencyOverridden', 'vitalUrgencyOverrideReason',
  'vitalUrgencyRecommendation', 'vitalUrgencyWarnings', 'updatedAt', '_rev',
]);

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
    await assertTriageVitalSafety(updated);
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
        key => !AMENDMENT_AUDIT_EXCLUDED_FIELDS.has(key) && updates[key] !== existing[key],
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
