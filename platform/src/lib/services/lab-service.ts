import { labResultsDB, hospitalsDB } from '../db';
import { findByType } from './db-query';
import type { LabResultDoc, HospitalDoc } from '../db-types';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { labOrder, getResultReviewSLA, type LabOrderStatus } from '../clinical-flow/order-lifecycles';
import { maybeDecrypt, maybeEncrypt } from '../field-encryption';
import { withPendingOfflineSync } from '../sync/offline-metadata';

const ENCRYPTED_LAB_FIELDS = ['result', 'clinicalNotes'] as const;

function decryptLabResult(doc: LabResultDoc): LabResultDoc {
  const out = { ...doc };
  for (const field of ENCRYPTED_LAB_FIELDS) {
    const value = out[field];
    if (typeof value === 'string') out[field] = maybeDecrypt(value);
  }
  return out;
}

function encryptLabFields<T extends Partial<LabResultDoc>>(data: T): T {
  const out = { ...data };
  for (const field of ENCRYPTED_LAB_FIELDS) {
    const value = out[field];
    if (typeof value === 'string' && value.length > 0) out[field] = maybeEncrypt(value);
  }
  return out;
}

/**
 * The granular diagnostics-lifecycle stage of an order, defaulting older
 * orders (no `orderStatus`) from their coarse `status` field.
 */
export function effectiveOrderStatus(doc: Pick<LabResultDoc, 'orderStatus' | 'status'>): LabOrderStatus {
  if (doc.orderStatus) return doc.orderStatus;
  if (doc.status === 'completed') return 'resulted';
  if (doc.status === 'in_progress') return 'in_process';
  return 'ordered';
}

/** Coarse `status` derived from the granular lifecycle stage. */
function coarseFromOrderStatus(s: LabOrderStatus): LabResultDoc['status'] {
  if (s === 'in_process') return 'in_progress';
  if (s === 'resulted' || s === 'reviewed_by_clinician' || s === 'acted_upon' || s === 'communicated_to_patient') return 'completed';
  return 'pending';
}

/**
 * Advance a lab order to the next stage of its lifecycle, validated against
 * LAB_ORDER_TRANSITIONS. Keeps the coarse `status` in sync and stamps
 * `completedAt` when results first land. Throws on an illegal transition.
 */
export async function advanceLabOrder(
  id: string,
  to: LabOrderStatus,
  extra?: Partial<LabResultDoc>,
): Promise<LabResultDoc | null> {
  const db = labResultsDB();
  const existing = await db.get(id) as LabResultDoc;
  const from = effectiveOrderStatus(existing);
  if (from !== to && !labOrder.can(from, to)) {
    throw new Error(`Illegal lab order transition: ${from} → ${to}`);
  }
  const now = new Date().toISOString();
  const status = coarseFromOrderStatus(to);
  const completedAt = (to === 'resulted' && !existing.completedAt)
    ? new Date().toISOString()
    : existing.completedAt;
  return updateLabResult(id, { ...extra, orderStatus: to, status, completedAt, updatedAt: now } as Partial<LabResultDoc>);
}

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

export async function getAllLabResults(scope?: DataScope): Promise<LabResultDoc[]> {
  const db = labResultsDB();
  const all = (await findByType<LabResultDoc>(db, 'lab_result'))
    .map(decryptLabResult)
    .sort((a, b) => (b.orderedAt || '').localeCompare(a.orderedAt || ''));
  return scope ? filterByScope(all, scope) : all;
}

export async function getLabResultsByPatient(patientId: string, scope?: DataScope): Promise<LabResultDoc[]> {
  const rows = (await findByType<LabResultDoc>(labResultsDB(), 'lab_result', { patientId }, { indexFields: ['type', 'patientId'] }))
    .map(decryptLabResult);
  return scope ? filterByScope(rows, scope) : rows;
}

export async function createLabResult(
  data: Omit<LabResultDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>
): Promise<LabResultDoc> {
  const db = labResultsDB();
  const now = new Date().toISOString();
  const orgId = data.orgId || await inferOrgIdFromHospital(data.hospitalId);
  const accessionNumber = data.accessionNumber || `ACC-${now.slice(2, 10).replace(/-/g, '')}-${uuidv4().slice(0, 5).toUpperCase()}`;
  const doc: LabResultDoc = encryptLabFields(withPendingOfflineSync({
    _id: `lab-${uuidv4().slice(0, 8)}`,
    type: 'lab_result',
    ...data,
    orgId,
    accessionNumber,
    createdAt: now,
    updatedAt: now,
  } as LabResultDoc, now));
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  const plaintextDoc = decryptLabResult(doc);
  await logAuditSafe('CREATE_LAB_ORDER', undefined, undefined, `Lab order ${plaintextDoc._id}: ${plaintextDoc.testName} for ${plaintextDoc.patientName}`);
  emitSyncEvent({
    resourceType: 'lab_result',
    resourceId: plaintextDoc._id,
    operation: 'create',
    resourceVersion: plaintextDoc._rev,
    orgId: plaintextDoc.orgId,
    hospitalId: plaintextDoc.hospitalId,
  });
  return plaintextDoc;
}

/**
 * Fetch a single decrypted lab result by id, or null if absent. Used by the
 * `/api/lab/[id]` route to enforce tenant scope before mutating.
 */
export async function getLabResultById(id: string): Promise<LabResultDoc | null> {
  try {
    return decryptLabResult(await labResultsDB().get(id) as LabResultDoc);
  } catch {
    return null;
  }
}

export async function updateLabResult(id: string, data: Partial<LabResultDoc>): Promise<LabResultDoc | null> {
  const db = labResultsDB();
  try {
    const existing = await db.get(id) as LabResultDoc;
    const updated = encryptLabFields(withPendingOfflineSync({ ...existing, ...data, _id: existing._id, _rev: existing._rev, updatedAt: new Date().toISOString() }));
    const resp = await db.put(updated);
    updated._rev = resp.rev;
    const plaintextUpdated = decryptLabResult(updated);
    await logAuditSafe('UPDATE_LAB_RESULT', undefined, undefined, `Lab ${id} status: ${plaintextUpdated.status}${plaintextUpdated.result ? `, result: ${plaintextUpdated.result}` : ''}`);
    emitSyncEvent({
      resourceType: 'lab_result',
      resourceId: plaintextUpdated._id,
      operation: 'update',
      resourceVersion: plaintextUpdated._rev,
      orgId: plaintextUpdated.orgId,
      hospitalId: plaintextUpdated.hospitalId,
    });
    // A critical value that has just come back must reach the ordering
    // clinician actively, not wait to be noticed (KAN-75). Fires only on the
    // transition INTO a critical resulted state, so re-saving the same result
    // does not raise a second task.
    // `status` is the coarse field ('pending' | 'in_progress' | 'completed');
    // `effectiveOrderStatus` resolves the granular lifecycle stage where
    // 'resulted' actually lives.
    const wasCriticalResult =
      existing.critical === true && effectiveOrderStatus(existing) === 'resulted';
    const becameCriticalResult =
      plaintextUpdated.critical === true &&
      effectiveOrderStatus(plaintextUpdated) === 'resulted' &&
      !wasCriticalResult;
    if (becameCriticalResult) {
      await raiseCriticalResultTask(plaintextUpdated);
    }
    return plaintextUpdated;
  } catch {
    return null;
  }
}

/**
 * Put a high-priority task in the ordering clinician's queue for a critical
 * result (KAN-75 / LOW-03).
 *
 * `RESULT_REVIEW_SLA.criticalHours` (24h) previously had no enforcement path at
 * all — nothing read it, so a critical result could sit at `resulted`
 * indefinitely. The dashboard panel covers results that have ALREADY breached;
 * this is the push at the moment the value arrives, which is the point at which
 * acting on it still matters.
 *
 * Due-dated at the critical SLA so it sorts to the top of the task list and the
 * clinician can see the deadline they are working against.
 *
 * Best-effort: the result is already durably written, and failing the save
 * because a notification could not be created would be a worse outcome than a
 * missing task.
 */
/**
 * The task list joins on user `_id` (`getTasks(userId)` → `{ userId }`
 * selector), so the task must be keyed by the ordering clinician's id. New
 * orders carry `orderedById`; legacy orders carry only the free-text name in
 * `orderedBy`, which is resolved against the user directory here. An ambiguous
 * or unknown name falls back to the name itself — invisible to the task list,
 * but the notifications feed still matches it by name, and the overdue panel
 * catches the result either way.
 */
async function resolveOrderingClinicianId(result: LabResultDoc): Promise<string> {
  if (result.orderedById) return result.orderedById;
  try {
    const { getAllUsers } = await import('./user-service');
    const users = await getAllUsers();
    const wanted = result.orderedBy.trim().toLowerCase();
    // Candidates are constrained to the ORDER's own org: the local directory
    // holds every tenant's users, and an unconstrained unique-name match
    // could deliver this PHI-bearing task to a same-named clinician in a
    // different organisation.
    const matches = users.filter(u =>
      (u.name || '').trim().toLowerCase() === wanted &&
      (!result.orgId || !u.orgId || u.orgId === result.orgId));
    if (matches.length === 1) return matches[0]._id;
  } catch {
    // Directory unavailable — fall through to the name.
  }
  return result.orderedBy;
}

async function raiseCriticalResultTask(result: LabResultDoc): Promise<void> {
  try {
    if (!result.orderedBy && !result.orderedById) return; // No one to notify — the panel still catches it.
    const { createTask } = await import('./clinician-task-service');
    const sla = getResultReviewSLA();
    await createTask({
      userId: await resolveOrderingClinicianId(result),
      userName: result.orderedBy,
      title: `Critical result: ${result.testName}`,
      description:
        `${result.patientName} — ${result.testName}: ${result.result || 'see result'}${result.unit ? ' ' + result.unit : ''}. ` +
        `Review within ${sla.criticalHours}h.`,
      dueDate: new Date(Date.now() + sla.criticalHours * 3_600_000).toISOString(),
      priority: 'high',
      patientId: result.patientId,
      patientName: result.patientName,
      hospitalId: result.hospitalId,
      orgId: result.orgId,
    });
  } catch (err) {
    console.warn('[lab] could not raise critical-result task (result was saved):', err);
  }
}

/**
 * Results that are back (`resulted`) but not yet reviewed by a clinician past
 * their review SLA (24h for critical, 7 days for routine — RESULT_REVIEW_SLA).
 * Powers escalation so abnormal/critical results can't sit unseen.
 */
export async function getOverdueUnreviewedResults(scope?: DataScope): Promise<LabResultDoc[]> {
  const all = await getAllLabResults(scope);
  const now = Date.now();
  return all.filter(r => {
    if (effectiveOrderStatus(r) !== 'resulted') return false;
    const resultedAt = new Date(r.updatedAt || r.createdAt || '').getTime();
    if (!Number.isFinite(resultedAt)) return false;
    const sla = getResultReviewSLA();
    const slaHours = r.critical ? sla.criticalHours : sla.routineHours;
    return (now - resultedAt) / 3_600_000 > slaHours;
  });
}

/**
 * Orders still on the bench. Takes a scope like every other list accessor here:
 * the local database holds every organisation's rows, so an unscoped read is a
 * cross-tenant leak rather than a convenience. `scope` is optional only for
 * parity with `getAllLabResults`; callers serving a request must pass one.
 */
export async function getPendingLabResults(scope?: DataScope): Promise<LabResultDoc[]> {
  const all = await getAllLabResults(scope);
  return all.filter(l => l.status === 'pending' || l.status === 'in_progress');
}
