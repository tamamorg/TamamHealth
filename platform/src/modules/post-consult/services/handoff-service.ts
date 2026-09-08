import { encountersDB } from '@/lib/db';
import type { EncounterDoc } from '@/lib/db-types';
import { filterByScope, type DataScope } from '@/lib/services/data-scope';
import { CLINICIANS, NURSING_AND_CLINICIANS } from '@/lib/sync/write-permissions';
import { emitSyncEvent } from '@/lib/services/sync-event-service';
import { logAuditSafe } from '@/lib/services/audit-service';
import { findByType } from '@/lib/services/db-query';
import { POST_CONSULT_TASKS, newPostConsultHandoff, type PostConsultTaskKind } from '../types';
import { isTerminal } from '@/lib/clinical-flow/encounter-journey';
import { currentPlanRevision } from './plan-service';

export async function ensurePostConsultHandoff(id: string, scope: DataScope) {
  if (!scope?.userId || !CLINICIANS.includes(scope.role)) throw new Error('HANDOFF_FORBIDDEN');
  const doc = await getHandoffEncounter(id, scope);
  if (doc.postConsult || isTerminal(doc.status)) return doc;
  doc.postConsult = newPostConsultHandoff();
  doc.updatedAt = new Date().toISOString();
  const result = await encountersDB().put(doc);
  emitSyncEvent({ resourceType: 'clinical_encounter', resourceId: id, operation: 'update', resourceVersion: result.rev, orgId: doc.orgId, hospitalId: doc.hospitalId });
  await logAuditSafe('POST_CONSULT_CREATED', scope.userId, undefined, `Encounter ${id}: handoff created`);
  return { ...doc, _rev: result.rev };
}

export async function getHandoffEncounter(id: string, scope: DataScope): Promise<EncounterDoc> {
  if (!scope?.userId) throw new Error('HANDOFF_FORBIDDEN');
  const doc = await encountersDB().get(id, { conflicts: true }) as EncounterDoc & { _conflicts?: string[] };
  if (!filterByScope([doc], scope).length) throw new Error('HANDOFF_NOT_FOUND');
  if (doc._conflicts?.length) throw new Error('HANDOFF_CONFLICT');
  return doc;
}
export async function getHandoffQueue(scope: DataScope): Promise<EncounterDoc[]> {
  if (!scope?.userId) return [];
  const rows = filterByScope(await findByType<EncounterDoc>(encountersDB(), 'clinical_encounter'), scope);
  const visible = await Promise.all(rows.filter(e => e.postConsult).map(async e => ({ e,
    changed: !isTerminal(e.status) && e.postConsult!.reviewedPlan !== await currentPlanRevision(e, scope),
  })));
  return visible.filter(({ e, changed }) => changed || (!e.postConsult!.bypass && e.postConsult!.tasks.some(t => t.status !== 'done'))).map(({ e }) => e);
}
export type HandoffAction = { type: 'accept' } | { type: 'bypass'; reason: string }
  | { type: 'reopen'; reason: string }
  | { type: 'transfer'; ownerId: string; reason: string }
  | { type: 'task'; kind: PostConsultTaskKind; status: 'done' | 'deferred'; note: string; ownerId?: string; dueAt?: string };
export async function updateHandoff(id: string, revision: string, action: HandoffAction, scope: DataScope) {
  if (!scope?.userId || !NURSING_AND_CLINICIANS.includes(scope.role)) throw new Error('HANDOFF_FORBIDDEN');
  const doc = await getHandoffEncounter(id, scope);
  if (doc._rev !== revision) throw new Error('HANDOFF_CONFLICT');
  const h = doc.postConsult;
  if (!h || (h.bypass && action.type !== 'reopen')) throw new Error('HANDOFF_NOT_ACTIVE');
  const now = new Date().toISOString();
  const plan = await currentPlanRevision(doc, scope);
  if (action.type === 'reopen') {
    if (isTerminal(doc.status) || !action.reason.trim() || action.reason.length > 2000) throw new Error('HANDOFF_INVALID');
    if (h.ownerId !== scope.userId && !CLINICIANS.includes(scope.role)) throw new Error('HANDOFF_FORBIDDEN');
    const { history, ...snapshot } = h;
    doc.postConsult = { ...newPostConsultHandoff(), reviewedPlan: plan, ownerId: scope.userId, acceptedAt: now,
      history: [...(history || []), { at: now, actorId: scope.userId, reason: action.reason.trim(), handoff: snapshot }] };
  } else if (action.type === 'transfer') {
    if (h.ownerId !== scope.userId && !CLINICIANS.includes(scope.role)) throw new Error('HANDOFF_FORBIDDEN');
    if (!action.reason.trim() || action.reason.length > 2000 || !action.ownerId || action.ownerId === h.ownerId) throw new Error('HANDOFF_INVALID');
    if (action.ownerId !== scope.userId) {
      const { getClientUsers } = await import('@/modules/identity/services/user-client');
      const owner = (await getClientUsers(scope)).find(u => u._id === action.ownerId);
      if (!owner?.isActive || !NURSING_AND_CLINICIANS.includes(owner.role)) throw new Error('HANDOFF_INVALID_OWNER');
    }
    h.transfers = [...(h.transfers || []), { at: now, actorId: scope.userId, from: h.ownerId, to: action.ownerId, reason: action.reason.trim() }];
    h.ownerId = action.ownerId;
    h.acceptedAt = undefined; // New owner must acknowledge; old evidence stays intact.
  } else if (action.type === 'accept') {
    if (h.ownerId && h.ownerId !== scope.userId) throw new Error('HANDOFF_ALREADY_OWNED');
    if (!h.reviewedPlan && h.tasks.every(t => t.status === 'pending')) h.reviewedPlan = plan;
    h.ownerId = scope.userId; h.acceptedAt ||= now;
  } else if (action.type === 'bypass') {
    if (!CLINICIANS.includes(scope.role) || !action.reason.trim() || action.reason.length > 2000) throw new Error('HANDOFF_INVALID');
    if (h.tasks.some(t => t.status !== 'pending')) throw new Error('HANDOFF_ALREADY_STARTED');
    h.reviewedPlan = plan;
    h.bypass = { reason: action.reason.trim(), actorId: scope.userId, at: now };
  } else {
    if (h.reviewedPlan !== plan) throw new Error('HANDOFF_PLAN_CHANGED');
    if (h.ownerId === scope.userId && !h.acceptedAt) throw new Error('HANDOFF_NOT_ACCEPTED');
    const previous = h.tasks.find(t => t.kind === action.kind);
    if ((h.ownerId !== scope.userId && !(previous?.status === 'deferred' && previous.ownerId === scope.userId)) || !POST_CONSULT_TASKS.includes(action.kind)
      || !['done', 'deferred'].includes(action.status) || action.note.length > 2000 || !action.note.trim()) throw new Error('HANDOFF_INVALID');
    if (action.status === 'deferred') {
      if (!action.ownerId || !action.dueAt || !Number.isFinite(Date.parse(action.dueAt)) || Date.parse(action.dueAt) <= Date.now()) throw new Error('HANDOFF_INVALID');
      if (action.ownerId !== scope.userId) {
        const { getClientUsers } = await import('@/modules/identity/services/user-client');
        const owner = (await getClientUsers(scope)).find(u => u._id === action.ownerId);
        if (!owner || !NURSING_AND_CLINICIANS.includes(owner.role) || !owner.isActive) throw new Error('HANDOFF_INVALID_OWNER');
      }
    }
    const task = h.tasks.find(t => t.kind === action.kind)!;
    Object.assign(task, { status: action.status, note: action.note.trim(), ownerId: action.status === 'deferred' ? action.ownerId : scope.userId,
      dueAt: action.status === 'deferred' ? action.dueAt : undefined, recordedBy: scope.userId, recordedAt: now });
  }
  doc.updatedAt = now;
  const result = await encountersDB().put(doc);
  emitSyncEvent({ resourceType: 'clinical_encounter', resourceId: id, operation: 'update', resourceVersion: result.rev, orgId: doc.orgId, hospitalId: doc.hospitalId });
  await logAuditSafe('POST_CONSULT_UPDATED', scope.userId, undefined, `Encounter ${id}: ${action.type}`);
  return { ...doc, _rev: result.rev };
}
