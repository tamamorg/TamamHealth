import { encountersDB } from '../db';
import type { WorkflowRepairDoc } from '../db-types';
import { withPendingOfflineSync } from '../sync/offline-metadata';
import { emitSyncEvent } from './sync-event-service';

export async function upsertWorkflowRepair(
  id: string,
  data: Omit<WorkflowRepairDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>,
): Promise<WorkflowRepairDoc> {
  const db = encountersDB();
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await db.get(id).catch(() => null) as WorkflowRepairDoc | null;
    const now = new Date().toISOString();
    const doc: WorkflowRepairDoc = withPendingOfflineSync({
      ...(existing || {}),
      _id: id,
      type: 'workflow_repair',
      ...data,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    } as WorkflowRepairDoc, now);
    try {
      const response = await db.put(doc);
      doc._rev = response.rev;
      emitSyncEvent({
        resourceType: doc.type, resourceId: doc._id, operation: existing ? 'update' : 'create',
        resourceVersion: doc._rev, orgId: doc.orgId, hospitalId: doc.hospitalId,
      });
      return doc;
    } catch (error) {
      const candidate = error as { status?: number; name?: string };
      if (attempt < 2 && (candidate.status === 409 || candidate.name === 'conflict')) continue;
      throw error;
    }
  }
  throw new Error('Workflow repair state could not be saved after concurrent updates.');
}

export async function resolveWorkflowRepair(id: string, currentStep = 'complete'): Promise<void> {
  const db = encountersDB();
  const existing = await db.get(id).catch(() => null) as WorkflowRepairDoc | null;
  if (!existing || existing.status === 'resolved') return;
  const now = new Date().toISOString();
  await upsertWorkflowRepair(id, {
    workflow: existing.workflow,
    patientId: existing.patientId,
    appointmentId: existing.appointmentId,
    encounterId: existing.encounterId,
    triageId: existing.triageId,
    admissionId: existing.admissionId,
    hospitalId: existing.hospitalId,
    orgId: existing.orgId,
    status: 'resolved',
    currentStep,
    lastError: existing.lastError,
    resolvedAt: now,
  });
}
