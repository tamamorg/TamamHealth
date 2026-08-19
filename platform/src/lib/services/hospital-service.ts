import { hospitalsDB } from '../db';
import type { HospitalDoc } from '../db-types';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { emitSyncEvent } from './sync-event-service';
import { findByType } from './db-query';
import { ValidationError } from '../validation';

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
  // A facility with no organisation is not a saved facility, however cleanly
  // the local write succeeds — the same two failure modes `createPatient`
  // refuses for a patient:
  //   • CouchDB's tenant validator rejects every document without an `orgId`,
  //     so the facility is written to the device's replica, pushed, rejected,
  //     and never seen again — under a "Hospital created successfully" toast.
  //   • `filterByScope` requires an `orgId` match for every role except
  //     super_admin and government, so even on that one device the facility is
  //     invisible to the organization that just created it. That is exactly
  //     how an org admin ends up reading "Active Facilities 0" while their
  //     staff accounts are right there.
  // Unlike a patient there is no facility to infer the org from, so the caller
  // must supply it. Settings → Manage did not (its hospital form had no orgId
  // field at all); /org-admin/hospitals and /api/hospitals always have.
  if (!data.orgId) {
    throw new ValidationError({
      orgId: 'Select the organization this facility belongs to — a facility cannot be saved without one.',
    });
  }

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
