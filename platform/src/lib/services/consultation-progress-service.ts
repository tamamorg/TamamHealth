import { v4 as uuidv4 } from 'uuid';
import { consultationProgressDB } from '../db';
import type {
  ConsultationProgressDoc,
  ConsultationProgressEvent,
  ConsultationProgressMilestone,
  ConsultationProgressStage,
  ConsultationProgressTask,
  ConsultationProgressTaskStatus,
  UserRole,
} from '../db-types';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { findByType } from './db-query';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';

export const CONSULTATION_PROGRESS_MILESTONES: Array<{ key: string; label: string }> = [
  { key: 'patient_checked_in', label: 'Patient checked in' },
  { key: 'intake_completed', label: 'Intake completed' },
  { key: 'triage_completed', label: 'Triage completed' },
  { key: 'provider_review', label: 'Provider review' },
  { key: 'diagnosis_documented', label: 'Diagnosis documented' },
  { key: 'orders_placed', label: 'Orders placed' },
  { key: 'patient_notified', label: 'Patient notified' },
  { key: 'follow_up_scheduled', label: 'Follow-up scheduled' },
  { key: 'consultation_signed', label: 'Consultation signed' },
];

export function defaultMilestones(): ConsultationProgressMilestone[] {
  return CONSULTATION_PROGRESS_MILESTONES.map(m => ({ ...m, status: 'pending' }));
}

function stageForMilestone(key: string, current: ConsultationProgressStage): ConsultationProgressStage {
  const rank: Record<ConsultationProgressStage, number> = {
    new: 0,
    triage: 1,
    waiting_for_provider: 2,
    in_progress: 3,
    orders_pending: 4,
    follow_up_required: 5,
    completed: 6,
    cancelled: -1,
  };
  let target = current;
  if (key === 'triage_completed') target = 'waiting_for_provider';
  if (key === 'provider_review' || key === 'diagnosis_documented') target = 'in_progress';
  if (key === 'orders_placed') target = 'orders_pending';
  if (key === 'follow_up_scheduled') target = 'follow_up_required';
  if (key === 'consultation_signed') target = 'completed';
  return rank[target] >= rank[current] ? target : current;
}

export async function getAllConsultationProgress(scope?: DataScope): Promise<ConsultationProgressDoc[]> {
  const docs = await findByType<ConsultationProgressDoc>(consultationProgressDB(), 'consultation_progress');
  const visible = scope ? filterByScope(docs, scope) : docs;
  return visible.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export async function getConsultationProgressByPatient(
  patientId: string,
  scope?: DataScope,
): Promise<ConsultationProgressDoc | null> {
  const rows = (await getAllConsultationProgress(scope)).filter(p => p.patientId === patientId);
  return rows[0] ?? null;
}

export interface ProgressActor {
  id?: string;
  name?: string;
  role?: UserRole;
}

function event(kind: ConsultationProgressEvent['kind'], message: string, actor?: ProgressActor): ConsultationProgressEvent {
  return {
    id: `progress-event-${uuidv4()}`,
    kind,
    message,
    actorId: actor?.id,
    actorName: actor?.name,
    actorRole: actor?.role,
    createdAt: new Date().toISOString(),
  };
}

async function writeProgress(
  existing: ConsultationProgressDoc,
  patch: Partial<ConsultationProgressDoc>,
  auditAction: string,
  actor?: ProgressActor,
): Promise<ConsultationProgressDoc> {
  const db = consultationProgressDB();
  const updated: ConsultationProgressDoc = {
    ...existing,
    ...patch,
    _id: existing._id,
    _rev: existing._rev,
    type: 'consultation_progress',
    updatedAt: new Date().toISOString(),
  };
  const response = await db.put(updated);
  updated._rev = response.rev;
  await logAuditSafe(auditAction, actor?.id, actor?.name, `Consultation progress ${existing._id} for ${existing.patientName}`);
  emitSyncEvent({
    resourceType: 'consultation_progress',
    resourceId: updated._id,
    operation: 'update',
    resourceVersion: updated._rev,
    orgId: updated.orgId,
    hospitalId: updated.hospitalId,
  });
  return updated;
}

export async function ensureConsultationProgress(input: {
  patientId: string;
  patientName: string;
  hospitalId: string;
  hospitalName?: string;
  orgId?: string;
  encounterId?: string;
  appointmentId?: string;
  actor?: ProgressActor;
}): Promise<ConsultationProgressDoc> {
  const scope = input.orgId || input.hospitalId ? {
    orgId: input.orgId,
    hospitalId: input.hospitalId,
    role: input.actor?.role || 'doctor',
  } as DataScope : undefined;
  const candidates = (await getAllConsultationProgress(scope))
    .filter(progress => progress.patientId === input.patientId);
  // A tracker belongs to one visit. Reusing a completed tracker from a prior
  // encounter made a new arrival appear completed to every station.
  const existing = input.encounterId
    ? candidates.find(progress => progress.encounterId === input.encounterId)
    : input.appointmentId
      ? candidates.find(progress => progress.appointmentId === input.appointmentId)
      : candidates.find(progress => !progress.encounterId && !progress.appointmentId);
  if (existing) {
    const changed = (!existing.encounterId && input.encounterId) || (!existing.appointmentId && input.appointmentId);
    return changed
      ? writeProgress(existing, { encounterId: input.encounterId || existing.encounterId, appointmentId: input.appointmentId || existing.appointmentId }, 'LINK_CONSULTATION_PROGRESS', input.actor)
      : existing;
  }

  const now = new Date().toISOString();
  const doc: ConsultationProgressDoc = {
    _id: `progress-${input.encounterId || input.appointmentId || input.patientId}`,
    type: 'consultation_progress',
    patientId: input.patientId,
    patientName: input.patientName,
    hospitalId: input.hospitalId,
    hospitalName: input.hospitalName,
    orgId: input.orgId,
    encounterId: input.encounterId,
    appointmentId: input.appointmentId,
    currentStage: 'new',
    ownerId: input.actor?.id,
    ownerName: input.actor?.name,
    ownerRole: input.actor?.role,
    priority: 'routine',
    milestones: defaultMilestones(),
    tasks: [],
    events: [event('note', 'Consultation tracker created', input.actor)],
    createdAt: now,
    updatedAt: now,
  };
  const response = await consultationProgressDB().put(doc);
  doc._rev = response.rev;
  await logAuditSafe('CREATE_CONSULTATION_PROGRESS', input.actor?.id, input.actor?.name, `Created consultation tracker for ${input.patientName}`);
  emitSyncEvent({ resourceType: 'consultation_progress', resourceId: doc._id, operation: 'create', resourceVersion: doc._rev, orgId: doc.orgId, hospitalId: doc.hospitalId });
  return doc;
}

export async function updateProgressStage(
  id: string,
  stage: ConsultationProgressStage,
  actor?: ProgressActor,
  nextAction?: string,
): Promise<ConsultationProgressDoc | null> {
  const existing = await getProgressById(id);
  if (!existing) return null;
  const message = `Stage changed to ${stage.replace(/_/g, ' ')}`;
  return writeProgress(existing, {
    currentStage: stage,
    nextAction: nextAction?.trim() || existing.nextAction,
    events: [...existing.events, event('stage', message, actor)].slice(-100),
  }, 'UPDATE_CONSULTATION_PROGRESS_STAGE', actor);
}

/** Ensure the shared tracker exists, then move it with a single operational action. */
export async function syncConsultationProgressStage(input: {
  patientId: string;
  patientName: string;
  hospitalId: string;
  hospitalName?: string;
  orgId?: string;
  encounterId?: string;
  appointmentId?: string;
  stage: ConsultationProgressStage;
  nextAction?: string;
  actor?: ProgressActor;
}): Promise<ConsultationProgressDoc | null> {
  const tracker = await ensureConsultationProgress(input);
  return updateProgressStage(tracker._id, input.stage, input.actor, input.nextAction);
}

export async function assignProgressOwner(
  id: string,
  owner: { id?: string; name?: string; role?: UserRole },
  actor?: ProgressActor,
): Promise<ConsultationProgressDoc | null> {
  const existing = await getProgressById(id);
  if (!existing) return null;
  return writeProgress(existing, {
    ownerId: owner.id,
    ownerName: owner.name,
    ownerRole: owner.role,
    events: [...existing.events, event('assignment', `Assigned to ${owner.name || 'care team'}`, actor)].slice(-100),
  }, 'ASSIGN_CONSULTATION_PROGRESS', actor);
}

export async function addProgressTask(
  id: string,
  input: Pick<ConsultationProgressTask, 'title' | 'priority' | 'dueAt' | 'ownerId' | 'ownerName' | 'ownerRole'>,
  actor?: ProgressActor,
): Promise<ConsultationProgressDoc | null> {
  const existing = await getProgressById(id);
  if (!existing || !input.title.trim()) return null;
  const now = new Date().toISOString();
  const task: ConsultationProgressTask = {
    id: `progress-task-${uuidv4()}`,
    title: input.title.trim(),
    status: 'open',
    priority: input.priority || 'routine',
    dueAt: input.dueAt || undefined,
    ownerId: input.ownerId,
    ownerName: input.ownerName,
    ownerRole: input.ownerRole,
    createdBy: actor?.id,
    createdAt: now,
  };
  return writeProgress(existing, {
    tasks: [...existing.tasks, task],
    events: [...existing.events, event('task', `Task added: ${task.title}`, actor)].slice(-100),
    nextAction: existing.nextAction || task.title,
  }, 'ADD_CONSULTATION_PROGRESS_TASK', actor);
}

export async function updateProgressTask(
  id: string,
  taskId: string,
  status: ConsultationProgressTaskStatus,
  actor?: ProgressActor,
): Promise<ConsultationProgressDoc | null> {
  const existing = await getProgressById(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  const tasks = existing.tasks.map(task => task.id === taskId
    ? { ...task, status, completedAt: status === 'completed' ? now : undefined, completedBy: status === 'completed' ? actor?.id : undefined }
    : task);
  const changed = existing.tasks.find(task => task.id === taskId);
  if (!changed) return existing;
  return writeProgress(existing, {
    tasks,
    events: [...existing.events, event('task', `Task ${status}: ${changed.title}`, actor)].slice(-100),
  }, 'UPDATE_CONSULTATION_PROGRESS_TASK', actor);
}

export async function updateProgressMilestone(
  id: string,
  key: string,
  status: ConsultationProgressMilestone['status'],
  actor?: ProgressActor,
  note?: string,
): Promise<ConsultationProgressDoc | null> {
  const existing = await getProgressById(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  const milestones = existing.milestones.map(milestone => milestone.key === key
    ? { ...milestone, status, note: note?.trim() || milestone.note, completedAt: status === 'completed' ? now : undefined, completedBy: status === 'completed' ? actor?.id : undefined }
    : milestone);
  const changed = existing.milestones.find(milestone => milestone.key === key);
  if (!changed) return existing;
  const nextStage = status === 'completed' ? stageForMilestone(key, existing.currentStage) : existing.currentStage;
  return writeProgress(existing, {
    milestones,
    currentStage: nextStage,
    nextAction: status === 'completed' ? nextOpenMilestoneLabel(milestones) : existing.nextAction,
    events: [...existing.events, event('milestone', `${changed.label}: ${status}`, actor)].slice(-100),
  }, 'UPDATE_CONSULTATION_PROGRESS_MILESTONE', actor);
}

function nextOpenMilestoneLabel(milestones: ConsultationProgressMilestone[]): string | undefined {
  return milestones.find(milestone => milestone.status !== 'completed')?.label;
}

async function getProgressById(id: string): Promise<ConsultationProgressDoc | null> {
  try { return await consultationProgressDB().get(id) as ConsultationProgressDoc; } catch { return null; }
}
