/**
 * Clinician personal tasks — the HealthBridge "tasks" panel that replaces the
 * sticky note on the file: quick to-dos like "phone John" or "contact Dr Smith",
 * each with an optional reminder date and patient link. Completing a task keeps
 * it (moved to the done list) rather than deleting it.
 *
 * Owned by one clinician; synced org-scoped so a task set follows them across
 * workstations, but excluded from national analytics — see the coverage matrix.
 */
import { v4 as uuidv4 } from 'uuid';
import { clinicianTasksDB } from '../db';
import type { ClinicianTaskDoc } from '../db-types';
import { findByType } from './db-query';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, normal: 2, low: 3 };

/** Open tasks first; then priority; then earliest due date; then newest. */
function taskOrder(a: ClinicianTaskDoc, b: ClinicianTaskDoc): number {
  if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
  const ap = PRIORITY_RANK[a.priority || 'normal'] ?? 2;
  const bp = PRIORITY_RANK[b.priority || 'normal'] ?? 2;
  if (ap !== bp) return ap - bp;
  const ad = a.dueDate || '9999-12-31';
  const bd = b.dueDate || '9999-12-31';
  if (ad !== bd) return ad < bd ? -1 : 1;
  return new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime();
}

/** All of a clinician's tasks (open + completed), sensibly ordered. */
export async function getTasks(userId: string): Promise<ClinicianTaskDoc[]> {
  const rows = await findByType<ClinicianTaskDoc>(
    clinicianTasksDB(),
    'clinician_task',
    { userId },
    { indexFields: ['type', 'userId'] },
  );
  return rows.sort(taskOrder);
}

export interface CreateTaskInput {
  userId: string;
  userName?: string;
  title: string;
  description?: string;
  dueDate?: string;
  priority?: 'low' | 'normal' | 'medium' | 'high';
  patientId?: string;
  patientName?: string;
  hospitalId?: string;
  orgId?: string;
}

export async function createTask(input: CreateTaskInput): Promise<ClinicianTaskDoc> {
  const title = (input.title || '').trim();
  if (!title) throw new Error('A task title is required');
  const db = clinicianTasksDB();
  const now = new Date().toISOString();
  const doc: ClinicianTaskDoc = {
    _id: `task-${uuidv4().slice(0, 8)}`,
    type: 'clinician_task',
    userId: input.userId,
    title,
    description: input.description?.trim() || undefined,
    dueDate: input.dueDate || undefined,
    status: 'open',
    priority: input.priority ?? 'normal',
    patientId: input.patientId,
    patientName: input.patientName,
    hospitalId: input.hospitalId,
    orgId: input.orgId,
    createdAt: now,
    updatedAt: now,
  };
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe('CREATE_TASK', input.userId, input.userName, `Task "${title}"`);
  emitSyncEvent({ resourceType: 'clinician_task', resourceId: doc._id, operation: 'create', resourceVersion: doc._rev, hospitalId: doc.hospitalId, orgId: doc.orgId });
  return doc;
}

async function patchTask(id: string, patch: Partial<ClinicianTaskDoc>, action: string, detail: string): Promise<ClinicianTaskDoc | null> {
  const db = clinicianTasksDB();
  let existing: ClinicianTaskDoc;
  try {
    existing = (await db.get(id)) as ClinicianTaskDoc;
  } catch {
    return null;
  }
  const updated: ClinicianTaskDoc = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  const resp = await db.put(updated);
  updated._rev = resp.rev;
  await logAuditSafe(action, existing.userId, undefined, detail);
  emitSyncEvent({ resourceType: 'clinician_task', resourceId: updated._id, operation: 'update', resourceVersion: updated._rev, hospitalId: updated.hospitalId, orgId: updated.orgId });
  return updated;
}

/** Mark a task done (kept in the list as completed). */
export async function completeTask(id: string): Promise<ClinicianTaskDoc | null> {
  return patchTask(id, { status: 'completed', completedAt: new Date().toISOString() }, 'COMPLETE_TASK', `Completed task ${id}`);
}

/** Reopen a completed task. */
export async function reopenTask(id: string): Promise<ClinicianTaskDoc | null> {
  return patchTask(id, { status: 'open', completedAt: undefined }, 'REOPEN_TASK', `Reopened task ${id}`);
}

/** Reschedule a task's reminder date. */
export async function rescheduleTask(id: string, dueDate: string): Promise<ClinicianTaskDoc | null> {
  return patchTask(id, { dueDate }, 'RESCHEDULE_TASK', `Rescheduled task ${id} to ${dueDate}`);
}

/** Edit a task's editable fields. */
export async function updateTask(id: string, patch: Partial<Pick<ClinicianTaskDoc, 'title' | 'description' | 'dueDate' | 'priority'>>): Promise<ClinicianTaskDoc | null> {
  return patchTask(id, patch, 'UPDATE_TASK', `Updated task ${id}`);
}

/** Permanently delete a task. Returns true if it existed. */
export async function deleteTask(id: string): Promise<boolean> {
  const db = clinicianTasksDB();
  try {
    const doc = (await db.get(id)) as ClinicianTaskDoc;
    await db.remove({ _id: doc._id, _rev: doc._rev! });
    await logAuditSafe('DELETE_TASK', doc.userId, undefined, `Deleted task ${id}`);
    emitSyncEvent({ resourceType: 'clinician_task', resourceId: id, operation: 'delete', hospitalId: doc.hospitalId, orgId: doc.orgId });
    return true;
  } catch {
    return false;
  }
}
