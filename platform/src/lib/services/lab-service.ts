import { labResultsDB, hospitalsDB } from '../db';
import { accessionDay } from '@/lib/accession-date';
import { findByType } from './db-query';
import type { LabResultDoc, HospitalDoc } from '../db-types';
import type { DataScope } from './data-scope';
import { filterByScope, orgOnlyScope } from './data-scope';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { labOrder, getResultReviewSLA, type LabOrderStatus } from '../clinical-flow/order-lifecycles';
import { readReplicatedField, maybeEncryptReplicated } from '../field-encryption';
import { withPendingOfflineSync } from '../sync/offline-metadata';

const ENCRYPTED_LAB_FIELDS = ['result', 'clinicalNotes', 'orderComment'] as const;

function decryptLabResult(doc: LabResultDoc): LabResultDoc {
  const out = { ...doc };
  for (const field of ENCRYPTED_LAB_FIELDS) {
    const value = out[field];
    if (typeof value === 'string') out[field] = readReplicatedField(value);
  }
  return out;
}

function encryptLabFields<T extends Partial<LabResultDoc>>(data: T): T {
  const out = { ...data };
  for (const field of ENCRYPTED_LAB_FIELDS) {
    const value = out[field];
    if (typeof value === 'string' && value.length > 0) out[field] = maybeEncryptReplicated(value);
  }
  return out;
}

/**
 * The granular diagnostics-lifecycle stage of an order, defaulting older
 * orders (no `orderStatus`) from their coarse `status` field.
 */
export function effectiveOrderStatus(doc: Pick<LabResultDoc, 'orderStatus' | 'status'>): LabOrderStatus {
  if (doc.orderStatus) return doc.orderStatus;
  if (doc.status === 'cancelled') return 'cancelled';
  if (doc.status === 'completed') return 'resulted';
  if (doc.status === 'in_progress') return 'in_process';
  return 'ordered';
}

/** Coarse `status` derived from the granular lifecycle stage. */
function coarseFromOrderStatus(s: LabOrderStatus): LabResultDoc['status'] {
  if (s === 'cancelled') return 'cancelled';
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

/**
 * An order that still needs the bench: not resulted and not withdrawn. Use this
 * in place of `status !== 'completed'`, which now also matches cancelled orders.
 */
export function isOpenLabOrder(doc: Pick<LabResultDoc, 'status'>): boolean {
  return doc.status === 'pending' || doc.status === 'in_progress';
}

/** A cancelled order is a record of what was withdrawn, not work to do. */
export function isCancelledLabOrder(doc: Pick<LabResultDoc, 'orderStatus' | 'status'>): boolean {
  return doc.status === 'cancelled' || doc.orderStatus === 'cancelled';
}

/** Outcome of withdrawing the charge a cancelled order raised. */
export type LabCancelBilling = 'none' | 'cancelled' | 'reversed' | 'line_removed' | 'manual';

export interface CancelLabOrderResult {
  order: LabResultDoc;
  /**
   * none = the order was never billed; cancelled = its own unpaid invoice was
   * cancelled; reversed = paid invoice, charge reversed (refund due); manual =
   * the test shares an invoice with other lines (or the write failed) and
   * billing must take the line off.
   */
  billing: LabCancelBilling;
}

/**
 * Withdraw a lab order before its specimen is collected. Only `ordered` can
 * leave this way (LAB_ORDER_TRANSITIONS); after collection the bench's Reject
 * applies. A written reason is required and the actor and time are stamped.
 *
 * The test's charge is withdrawn when the order owns its invoice outright
 * (cancelBill, or reversePaidBillCharge once money was taken), the same two
 * moves a stopped prescription makes. A test billed together with others sits on
 * a shared invoice: a role that may amend bills takes just that test's line off
 * (`line_removed`, totals and ledger corrected by updateBillItems) while the
 * invoice is still open and unpaid; otherwise, or for lab staff, it is reported
 * as `manual` instead of cancelling the other tests' charges.
 */
export async function cancelLabOrder(
  id: string,
  reason: string,
  actor: { id?: string; name: string; role?: string },
): Promise<CancelLabOrderResult> {
  const why = reason.trim();
  if (!why) throw new Error('Cancel reason is required.');
  const existing = await labResultsDB().get(id) as LabResultDoc;
  const from = effectiveOrderStatus(existing);
  if (from !== 'ordered') {
    throw new Error(from === 'cancelled'
      ? 'This order is already cancelled.'
      : 'Specimen already collected, so the order cannot be cancelled. Reject the specimen at the bench instead.');
  }
  const order = (await advanceLabOrder(id, 'cancelled', {
    cancelledReason: why,
    cancelledBy: actor.name,
    cancelledAt: new Date().toISOString(),
  }))!;
  await logAuditSafe('CANCEL_LAB_ORDER', actor.id, actor.name, `Lab order ${id} cancelled before collection; reason recorded on the order`);
  return { order, billing: await withdrawLabCharge(order, why, actor) };
}

const BILL_WITHDRAW_ROLES: readonly string[] = ['doctor', 'clinical_officer', 'clinician', 'super_admin'];

async function hasLabCharge(order: LabResultDoc): Promise<boolean> {
  try {
    const { getBillsByPatient } = await import('./billing-service');
    const bills = await getBillsByPatient(order.patientId, orgOnlyScope(order.orgId));
    return bills.some(b => b.status !== 'cancelled' && !b.chargeReversedAt
      && b.items.some(i => i.referenceType === 'lab_result' && i.referenceId === order._id));
  } catch {
    return true;
  }
}

async function withdrawLabCharge(
  order: LabResultDoc,
  reason: string,
  actor: { id?: string; name: string; role?: string },
): Promise<LabCancelBilling> {
  // The sync validator lets only these roles amend a bill (cancel / reverse);
  // a bench write by anyone else would be refused at replication and wedge the
  // bill document, so billing is left for them to withdraw.
  if (!actor.role || !BILL_WITHDRAW_ROLES.includes(actor.role)) {
    return (await hasLabCharge(order)) ? 'manual' : 'none';
  }
  try {
    const { getBillsByPatient, cancelBill, reversePaidBillCharge, updateBillItems } = await import('./billing-service');
    const scope = orgOnlyScope(order.orgId);
    const bills = await getBillsByPatient(order.patientId, scope);
    let outcome: LabCancelBilling = 'none';
    for (const bill of bills) {
      if (bill.status === 'cancelled' || bill.chargeReversedAt) continue;
      const lines = bill.items.filter(i => i.referenceType === 'lab_result' && i.referenceId === order._id);
      if (!lines.length) continue;
      const note = `Lab test cancelled: ${reason}`;
      const by = actor.id || actor.name;
      if (bill.items.length !== lines.length) {
        // Shared invoice: only this test's line comes off. updateBillItems
        // refuses a finalized or paid bill; that stays for billing to settle.
        const kept = bill.items.filter(i => !(i.referenceType === 'lab_result' && i.referenceId === order._id));
        outcome = (await updateBillItems(bill._id, kept, by, actor.name)) ? 'line_removed' : 'manual';
        continue;
      }
      if (await cancelBill(bill._id, by, actor.name, note)) { outcome = 'cancelled'; continue; }
      if (await reversePaidBillCharge(bill._id, by, actor.name, note)) { outcome = 'reversed'; continue; }
      outcome = 'manual';
    }
    return outcome;
  } catch (err) {
    console.warn('[lab] could not withdraw the charge for a cancelled order:', err);
    return 'manual';
  }
}

/**
 * The bench-side coarse status as the lab dashboard's queue tabs read it:
 * Tests ordered (`pending`) → In progress (`in_progress`) → Completed. The
 * queue's status pill lets the technician move an order between the first
 * two from the row itself.
 *
 * `completed` is deliberately not settable here: a result is what completes
 * a test, and results are entered on the bench (`useLabWorkflow.fileResult`,
 * the batch modal), never picked from a dropdown.
 *
 * "In progress" walks the granular lifecycle forward through every hop the
 * guard requires (ordered → specimen_collected → received_at_lab →
 * in_process), stamping the specimen steps the bench would have stamped had
 * the technician clicked through them, so the /lab stage columns and the
 * chart's bench read the same record either way. A rejected specimen goes
 * back through collection first, which clears the rejection exactly as a
 * fresh collection on the bench does.
 *
 * "Tests ordered" from an in-process order is the undo for a stray pick. The
 * lifecycle table has no backward hops, so this is the one write that steps
 * outside `advanceLabOrder`: back to `received_at_lab` (the specimen is still
 * in hand), audited like every other update. Nothing here moves a resulted
 * order — that throws.
 */
export type LabBenchStatus = 'pending' | 'in_progress';

export async function setLabBenchStatus(
  id: string,
  target: LabBenchStatus,
  actor?: string,
): Promise<LabResultDoc | null> {
  const existing = decryptLabResult(await labResultsDB().get(id) as LabResultDoc);
  let stage = effectiveOrderStatus(existing);
  if (coarseFromOrderStatus(stage) === 'completed') {
    throw new Error('This test already has a result, so it cannot go back to the bench.');
  }
  if (target === 'pending') {
    if (stage !== 'in_process') return existing;
    return updateLabResult(id, { orderStatus: 'received_at_lab', status: 'pending' });
  }
  if (stage === 'in_process') return existing;
  const by = actor || 'Lab';
  const now = new Date().toISOString();
  if (stage === 'ordered' || stage === 'rejected_needs_recollection') {
    await advanceLabOrder(id, 'specimen_collected', {
      specimenCollectedAt: now,
      specimenCollectedBy: by,
      specimenRejectionReason: '',
      specimenRejectionNotes: '',
    });
    stage = 'specimen_collected';
  }
  if (stage === 'specimen_collected') {
    await advanceLabOrder(id, 'received_at_lab', {
      specimenReceivedAt: now,
      specimenReceivedBy: by,
      specimenCondition: 'acceptable',
    });
  }
  return advanceLabOrder(id, 'in_process');
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
  const accessionNumber = data.accessionNumber || `ACC-${accessionDay(now)}-${uuidv4().slice(0, 5).toUpperCase()}`;
  const doc: LabResultDoc = encryptLabFields(withPendingOfflineSync({
    _id: `lab-${uuidv4()}`,
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
  await logAuditSafe('CREATE_LAB_ORDER', undefined, undefined, `Lab order ${plaintextDoc._id} created`);
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
  // Only a missing document is "not found". A conflict, a validator rejection
  // or an encryption failure used to be swallowed into the same null, which
  // callers reported as "not found" or as a bogus "Illegal lab order
  // transition" on the next hop. Those now propagate.
  let existing: LabResultDoc;
  try {
    existing = await db.get(id) as LabResultDoc;
  } catch (err) {
    const status = (err as { status?: number; name?: string } | null)?.status;
    if (status === 404 || (err as { name?: string } | null)?.name === 'not_found') return null;
    throw err;
  }
  {
    const updated = encryptLabFields(withPendingOfflineSync({ ...existing, ...data, _id: existing._id, _rev: existing._rev, updatedAt: new Date().toISOString() }));
    const resp = await db.put(updated);
    updated._rev = resp.rev;
    const plaintextUpdated = decryptLabResult(updated);
    await logAuditSafe('UPDATE_LAB_RESULT', undefined, undefined, `Lab order ${id} updated; status=${plaintextUpdated.status}; stage=${effectiveOrderStatus(plaintextUpdated)}`);
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
    const { getAllUsersUnscoped } = await import('@/modules/identity/services/user-service');
    const users = await getAllUsersUnscoped();
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
    // An outside or walk-in request has no clinician here to review it; its
    // report goes back with the lab, so it must not escalate as unreviewed.
    if (r.requestSource === 'external_facility' || r.requestSource === 'walk_in') return false;
    // The SLA runs from when the result landed. `updatedAt` moves on every
    // later write (review notes, a status touch), which kept resetting the clock.
    const resultedAt = new Date(r.completedAt || r.updatedAt || r.createdAt || '').getTime();
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
  return all.filter(isOpenLabOrder);
}
