/**
 * Longitudinal Problem List service.
 *
 * Each problem is anchored to a patient (not an encounter) and persists
 * across visits. The Storyboard sidebar and SBAR handoff both read from
 * here so a clinician sees the same active list everywhere in the app.
 */
import { problemsDB, hospitalsDB } from '../db';
import type { ProblemDoc, HospitalDoc, ProblemStatus } from '../db-types';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { findByType } from './db-query';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { todayIso } from '@/lib/date-utils';

async function inferOrgIdFromHospital(hospitalId?: string): Promise<string | undefined> {
  if (!hospitalId) return undefined;
  try {
    const hosp = await hospitalsDB().get(hospitalId) as HospitalDoc;
    return hosp.orgId;
  } catch {
    return undefined;
  }
}

export async function getAllProblems(scope?: DataScope): Promise<ProblemDoc[]> {
  const db = problemsDB();
  const all = (await findByType<ProblemDoc>(db, 'problem'))
    .sort((a, b) => (b.onsetDate || b.createdAt || '').localeCompare(a.onsetDate || a.createdAt || ''));
  return scope ? filterByScope(all, scope) : all;
}

export async function getProblemsByPatient(patientId: string, scope?: DataScope): Promise<ProblemDoc[]> {
  const rows = await findByType<ProblemDoc>(
    problemsDB(),
    'problem',
    { patientId },
    { indexFields: ['type', 'patientId'] },
  );
  const visible = scope ? filterByScope(rows, scope) : rows;
  return visible.sort((a, b) => (b.onsetDate || b.createdAt || '').localeCompare(a.onsetDate || a.createdAt || ''));
}

export async function createProblem(
  data: Omit<ProblemDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>
): Promise<ProblemDoc> {
  const db = problemsDB();
  const now = new Date().toISOString();
  const orgId = data.orgId || await inferOrgIdFromHospital(data.hospitalId);
  const doc: ProblemDoc = {
    _id: `problem-${uuidv4()}`,
    type: 'problem',
    ...data,
    orgId,
    createdAt: now,
    updatedAt: now,
  } as ProblemDoc;
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe(
    'PROBLEM_CREATED',
    undefined,
    data.recordedByName,
    `Problem record ${doc._id} created; status=${doc.status}`,
  );
  emitSyncEvent({
    resourceType: 'problem',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.hospitalId,
  });
  return doc;
}

export async function updateProblem(id: string, data: Partial<ProblemDoc>): Promise<ProblemDoc | null> {
  const db = problemsDB();
  try {
    const existing = await db.get(id) as ProblemDoc;
    const updated: ProblemDoc = {
      ...existing,
      ...data,
      _id: existing._id,
      _rev: existing._rev,
      type: 'problem',
      updatedAt: new Date().toISOString(),
    };
    const resp = await db.put(updated);
    updated._rev = resp.rev;
    await logAuditSafe('PROBLEM_UPDATED', undefined, undefined, `Problem ${id} status: ${updated.status}`);
    emitSyncEvent({
      resourceType: 'problem',
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

export async function deleteProblem(id: string): Promise<boolean> {
  const db = problemsDB();
  try {
    const doc = await db.get(id);
    const typed = doc as unknown as ProblemDoc;
    await db.remove(doc);
    await logAuditSafe('DELETE_PROBLEM', undefined, undefined, `Problem record ${id} deleted`);
    emitSyncEvent({
      resourceType: 'problem',
      resourceId: id,
      operation: 'delete',
      orgId: typed.orgId,
      hospitalId: typed.hospitalId,
    });
    return true;
  } catch {
    return false;
  }
}

export async function setProblemStatus(id: string, status: ProblemStatus): Promise<ProblemDoc | null> {
  const patch: Partial<ProblemDoc> = { status };
  if (status === 'resolved') {
    patch.resolvedDate = todayIso();
  }
  return updateProblem(id, patch);
}
