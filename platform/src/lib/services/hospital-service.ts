import { hospitalsDB } from '../db';
import type { HospitalDoc } from '../db-types';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { emitSyncEvent } from './sync-event-service';
import { findByType } from './db-query';

export async function getAllHospitals(scope?: DataScope): Promise<HospitalDoc[]> {
  const db = hospitalsDB();
  const all = await findByType<HospitalDoc>(db, 'hospital');
  return scope ? filterByScope(all, scope) : all;
}

export async function getHospitalById(id: string, scope?: DataScope): Promise<HospitalDoc | null> {
  try {
    const db = hospitalsDB();
    const hospital = await db.get(id) as HospitalDoc;
    return scope && filterByScope([hospital], scope).length === 0 ? null : hospital;
  } catch (err) {
    // Surface the real failure — a swallowed non-404 here once masqueraded
    // as "Hospital not found" on the manage page.
    console.warn('[hospital-service] getHospitalById failed for', id, err);
    return null;
  }
}

export async function createHospital(
  data: Omit<HospitalDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSync' | 'patientCount' | 'todayVisits'>,
  actorId?: string,
  actorUsername?: string
): Promise<HospitalDoc> {
  const db = hospitalsDB();
  const now = new Date().toISOString();
  const { v4: uuidv4 } = await import('uuid');
  const shortId = uuidv4().split('-')[0];

  const doc: HospitalDoc = {
    ...data,
    _id: `hosp-${shortId}`,
    type: 'hospital',
    syncStatus: 'offline',
    lastSync: now,
    patientCount: 0,
    todayVisits: 0,
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
  };

  const resp = await db.put(doc);
  doc._rev = resp.rev;
  const { logAudit } = await import('./audit-service');
  await logAudit('hospital_created', actorId, actorUsername, `Created hospital "${data.name}"`, true);
  emitSyncEvent({
    resourceType: 'hospital',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    userId: actorId,
    username: actorUsername,
    orgId: doc.orgId,
    hospitalId: doc._id,
  });
  return doc;
}

export async function updateHospitalStatus(
  id: string,
  data: Partial<HospitalDoc>,
  scope?: DataScope,
): Promise<HospitalDoc | null> {
  const db = hospitalsDB();
  try {
    const existing = await db.get(id) as HospitalDoc;
    if (scope && filterByScope([existing], scope).length === 0) return null;
    const updated = {
      ...existing,
      ...data,
      _id: existing._id,
      _rev: existing._rev,
      orgId: existing.orgId,
      updatedAt: new Date().toISOString(),
    };
    const resp2 = await db.put(updated);
    updated._rev = resp2.rev;
    emitSyncEvent({
      resourceType: 'hospital',
      resourceId: updated._id,
      operation: 'update',
      resourceVersion: updated._rev,
      orgId: updated.orgId,
      hospitalId: updated._id,
    });
    return updated;
  } catch {
    return null;
  }
}
