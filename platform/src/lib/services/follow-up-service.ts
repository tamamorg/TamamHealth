import { followUpsDB } from '../db';
import type { FollowUpDoc } from '../db-types';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { findByType } from './db-query';

// `scope` is optional and defaults to ungated for back-compat with callers
// (CHV/Boma worker dashboards) that already pre-filter by `workerId`. New
// hook callers should pass a scope so org/hospital isolation is enforced.
export async function getAllFollowUps(scope?: DataScope): Promise<FollowUpDoc[]> {
  const db = followUpsDB();
  const docs = await findByType<FollowUpDoc>(db, 'follow_up');
  /* istanbul ignore next -- defensive null-safety in sort */
  docs.sort((a, b) => new Date(a.scheduledDate || '').getTime() - new Date(b.scheduledDate || '').getTime());
  return scope ? filterByScope(docs, scope) : docs;
}

export async function getFollowUpsByWorker(workerId: string): Promise<FollowUpDoc[]> {
  const all = await getAllFollowUps();
  return all.filter(f => f.assignedWorker === workerId);
}

export async function getFollowUpsByPatient(patientId: string): Promise<FollowUpDoc[]> {
  const all = await getAllFollowUps();
  return all.filter(f => f.patientId === patientId);
}

export async function getPendingFollowUps(workerId?: string, scope?: DataScope): Promise<FollowUpDoc[]> {
  const all = workerId ? await getFollowUpsByWorker(workerId) : await getAllFollowUps(scope);
  const filtered = scope && workerId ? filterByScope(all, scope) : all;
  return filtered.filter(f => f.status === 'active' || f.status === 'missed');
}

export async function createFollowUp(
  data: Omit<FollowUpDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>
): Promise<FollowUpDoc> {
  const db = followUpsDB();
  const now = new Date().toISOString();
  const doc: FollowUpDoc = {
    _id: `followup-${uuidv4()}`,
    type: 'follow_up',
    ...data,
    createdAt: now,
    updatedAt: now,
  };
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe('CREATE_FOLLOW_UP', doc.assignedWorker, undefined, `Follow-up ${doc._id}: patient ${doc.patientId}, condition: ${doc.condition}`);
  emitSyncEvent({
    resourceType: 'follow_up',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
  });
  return doc;
}

export async function updateFollowUp(
  id: string,
  data: Partial<FollowUpDoc>,
  scope?: DataScope,
): Promise<FollowUpDoc | null> {
  const db = followUpsDB();
  try {
    const existing = await db.get(id) as FollowUpDoc;
    if (scope && filterByScope([existing], scope).length === 0) return null;
    const updated = {
      ...existing,
      ...data,
      _id: existing._id,
      _rev: existing._rev,
      orgId: existing.orgId,
      hospitalId: existing.hospitalId,
      updatedAt: new Date().toISOString(),
    };
    const resp = await db.put(updated);
    updated._rev = resp.rev;
    await logAuditSafe('UPDATE_FOLLOW_UP', updated.assignedWorker, undefined, `Follow-up ${id}: status=${updated.status}${updated.outcome ? `, outcome=${updated.outcome}` : ''}`);
    emitSyncEvent({
      resourceType: 'follow_up',
      resourceId: updated._id,
      operation: 'update',
      resourceVersion: updated._rev,
      orgId: updated.orgId,
    });
    return updated;
  } catch {
    return null;
  }
}

export async function getFollowUpStats(workerId?: string, scope?: DataScope) {
  const base = workerId ? await getFollowUpsByWorker(workerId) : await getAllFollowUps(scope);
  const all = scope && workerId ? filterByScope(base, scope) : base;
  const active = all.filter(f => f.status === 'active');
  const completed = all.filter(f => f.status === 'completed');
  const missed = all.filter(f => f.status === 'missed');
  const lost = all.filter(f => f.status === 'lost_to_followup');

  const recovered = completed.filter(f => f.outcome === 'recovered').length;
  const died = completed.filter(f => f.outcome === 'died').length;

  return {
    total: all.length,
    active: active.length,
    completed: completed.length,
    missed: missed.length,
    lostToFollowUp: lost.length,
    recovered,
    died,
  };
}
