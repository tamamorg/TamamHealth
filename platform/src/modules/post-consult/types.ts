export const POST_CONSULT_TASKS = ['education', 'treatments', 'investigations', 'followup'] as const;
export type PostConsultTaskKind = typeof POST_CONSULT_TASKS[number];
export interface PostConsultTask {
  kind: PostConsultTaskKind;
  status: 'pending' | 'done' | 'deferred';
  note?: string;
  ownerId?: string;
  dueAt?: string;
  recordedBy?: string;
  recordedAt?: string;
}
export interface PostConsultHandoff {
  createdAt: string;
  reviewedPlan?: string;
  history?: { at: string; actorId: string; reason: string; handoff: Omit<PostConsultHandoff, 'history'> }[];
  transfers?: { at: string; actorId: string; from?: string; to: string; reason: string }[];
  ownerId?: string;
  acceptedAt?: string;
  tasks: PostConsultTask[];
  bypass?: { reason: string; actorId: string; at: string };
}
export function newPostConsultHandoff(): PostConsultHandoff {
  return { createdAt: new Date().toISOString(), tasks: POST_CONSULT_TASKS.map(kind => ({ kind, status: 'pending' })) };
}
export function postConsultReady(handoff: PostConsultHandoff | undefined): boolean {
  // Historical records are not silently migrated.
  if (!handoff) return true;
  if (handoff.bypass) return Boolean(handoff.bypass.reason.trim() && handoff.bypass.actorId);
  return Boolean(handoff.ownerId && handoff.acceptedAt) && POST_CONSULT_TASKS.every(kind => {
    const task = handoff.tasks.find(t => t.kind === kind);
    return !!task?.recordedBy && !!task.recordedAt && (task.status === 'done'
      || (task.status === 'deferred' && !!task.note?.trim() && !!task.ownerId && Number.isFinite(Date.parse(task.dueAt || ''))));
  });
}
