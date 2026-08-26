/**
 * Procedure service.
 *
 * Bedside/theatre procedures performed on a patient (e.g. wound
 * debridement, incision & drainage, suturing, IUD insertion). Anchored to
 * the patient (not required to be tied to a single encounter, though
 * `encounterId` may record which visit it happened during). Mirrors the
 * Problem List service (`problem-service.ts`) shape/lifecycle.
 */
import { proceduresDB, hospitalsDB } from '../db';
import type { ProcedureDoc, HospitalDoc } from '../db-types';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { findByType } from './db-query';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { procedure as procedureLifecycle, type ProcedureStatus } from '../clinical-flow/order-lifecycles';

async function inferOrgIdFromHospital(hospitalId?: string): Promise<string | undefined> {
  if (!hospitalId) return undefined;
  try {
    const hosp = await hospitalsDB().get(hospitalId) as HospitalDoc;
    return hosp.orgId;
  } catch {
    return undefined;
  }
}

/**
 * Stage 7 states in which the procedure is finished with — nothing about it can
 * still block a discharge.
 *
 * `complication` is deliberately NOT here: a complication is unfinished until
 * it has been reported (`ae_reported`), which is the whole point of that edge
 * in `PROCEDURE_TRANSITIONS`.
 */
const SETTLED_PROCEDURE_STATUSES: readonly ProcedureStatus[] = [
  'released', 'aborted', 'ae_reported',
];

/**
 * Whether a procedure is done with, for the facility-checkout gate.
 *
 * A procedure with NO status is settled. Every procedure written before the
 * lifecycle existed is a historical record of something that had already
 * happened — the document carried only `date`, `performedBy` and `outcome` —
 * so treating a missing status as in-flight would block discharge on every
 * visit with an old procedure on the chart, and train clerks to override the
 * gate as a matter of routine. That is the exact failure the gate's own
 * comments warn about.
 */
export function isProcedureSettled(p: Pick<ProcedureDoc, 'status'>): boolean {
  if (!p.status) return true;
  return SETTLED_PROCEDURE_STATUSES.includes(p.status);
}

/**
 * Advance a procedure through its Stage 7 lifecycle, refusing any move the
 * document's state machine does not allow — the same contract
 * `transitionEncounter` enforces for the visit itself. An untracked (statusless)
 * procedure is adopted at `ordered`, so a record created before this existed can
 * still be picked up rather than being stuck outside the machine forever.
 */
export async function advanceProcedure(
  id: string,
  to: ProcedureStatus,
  opts: { actorId?: string; actorName?: string; reason?: string } = {},
): Promise<ProcedureDoc | null> {
  const db = proceduresDB();
  let existing: ProcedureDoc;
  try {
    existing = await db.get(id) as ProcedureDoc;
  } catch {
    return null;
  }
  const from: ProcedureStatus = existing.status || 'ordered';
  if (from === to) return existing;
  if (!procedureLifecycle.can(from, to)) {
    throw new Error(
      `A procedure cannot move from "${from}" to "${to}". Allowed: ${procedureLifecycle.next(from).join(', ') || 'nothing — this state is final'}.`,
    );
  }
  // "aborted (with reason)" is how the document words it, so the reason is part
  // of the move rather than something to fill in afterwards.
  if (to === 'aborted' && !opts.reason?.trim()) {
    throw new Error('Aborting a procedure requires a reason.');
  }

  const now = new Date().toISOString();
  const updated: ProcedureDoc = {
    ...existing,
    status: to,
    ...(to === 'consented' ? { consentedAt: now, consentedBy: opts.actorName || opts.actorId } : {}),
    ...(to === 'aborted' ? { abortedReason: opts.reason?.trim() } : {}),
    updatedAt: now,
  };
  const resp = await db.put(updated);
  updated._rev = resp.rev;
  await logAuditSafe('PROCEDURE_STATUS_CHANGED', opts.actorId, opts.actorName,
    `Procedure ${id} (${existing.name}): ${from} → ${to}` + (opts.reason ? ` — ${opts.reason}` : ''));
  emitSyncEvent({
    resourceType: 'procedure',
    resourceId: updated._id,
    operation: 'update',
    resourceVersion: updated._rev,
    userId: opts.actorId,
    orgId: updated.orgId,
    hospitalId: updated.hospitalId,
  });
  return updated;
}

export async function getAllProcedures(scope?: DataScope): Promise<ProcedureDoc[]> {
  const db = proceduresDB();
  const all = (await findByType<ProcedureDoc>(db, 'procedure'))
    .sort((a, b) => (b.date || b.createdAt || '').localeCompare(a.date || a.createdAt || ''));
  return scope ? filterByScope(all, scope) : all;
}

export async function getProceduresByPatient(patientId: string, scope?: DataScope): Promise<ProcedureDoc[]> {
  const all = await getAllProcedures(scope);
  return all.filter(p => p.patientId === patientId);
}

export async function createProcedure(
  data: Omit<ProcedureDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>
): Promise<ProcedureDoc> {
  const db = proceduresDB();
  const now = new Date().toISOString();
  const orgId = data.orgId || await inferOrgIdFromHospital(data.hospitalId);
  const doc: ProcedureDoc = {
    _id: `procedure-${uuidv4()}`,
    type: 'procedure',
    ...data,
    orgId,
    createdAt: now,
    updatedAt: now,
  } as ProcedureDoc;
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe(
    'PROCEDURE_CREATED',
    undefined,
    data.performedByName,
    `Procedure ${doc._id}: ${doc.name} for ${doc.patientName || doc.patientId}`,
  );
  emitSyncEvent({
    resourceType: 'procedure',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.hospitalId,
  });
  return doc;
}

export async function updateProcedure(id: string, data: Partial<ProcedureDoc>): Promise<ProcedureDoc | null> {
  const db = proceduresDB();
  try {
    const existing = await db.get(id) as ProcedureDoc;
    const updated: ProcedureDoc = {
      ...existing,
      ...data,
      _id: existing._id,
      _rev: existing._rev,
      type: 'procedure',
      updatedAt: new Date().toISOString(),
    };
    const resp = await db.put(updated);
    updated._rev = resp.rev;
    await logAuditSafe('PROCEDURE_UPDATED', undefined, undefined, `Procedure ${id}: ${updated.name}`);
    emitSyncEvent({
      resourceType: 'procedure',
      resourceId: updated._id,
      operation: 'update',
      resourceVersion: updated._rev,
      orgId: updated.orgId,
      hospitalId: updated.hospitalId,
    });
    return updated;
  } catch {
    return null;
  }
}

/** Correct procedure details without deleting the original clinical event. */
export async function amendProcedure(
  id: string,
  data: Pick<Partial<ProcedureDoc>, 'name' | 'code' | 'date' | 'bodySite' | 'outcome' | 'notes'>,
  reason: string,
  actor?: { id?: string; name?: string },
): Promise<ProcedureDoc> {
  const cleanReason = reason.trim();
  if (cleanReason.length < 3) throw new Error('A reason is required to correct a procedure.');
  const updated = await updateProcedure(id, {
    ...data,
    amended: true,
    amendedAt: new Date().toISOString(),
    amendedBy: actor?.name || actor?.id,
    amendmentReason: cleanReason,
  });
  if (!updated) throw new Error('The procedure could not be corrected. Reload the chart and try again.');
  await logAuditSafe('PROCEDURE_AMENDED', actor?.id, actor?.name, `Procedure ${id}: ${cleanReason}`);
  return updated;
}

/** Retire an incorrectly charted procedure while preserving its history. */
export async function deleteProcedure(
  id: string,
  reason: string,
  actor?: { id?: string; name?: string },
): Promise<boolean> {
  const cleanReason = reason.trim();
  if (cleanReason.length < 3) throw new Error('A reason is required to mark a procedure as entered in error.');
  const updated = await updateProcedure(id, {
    recordStatus: 'entered_in_error',
    statusReason: cleanReason,
    statusChangedAt: new Date().toISOString(),
    statusChangedBy: actor?.name || actor?.id,
  });
  if (!updated) return false;
  await logAuditSafe('PROCEDURE_ENTERED_IN_ERROR', actor?.id, actor?.name, `Procedure ${id}: ${cleanReason}`);
  return true;
}
