import { getDB, hospitalsDB } from '../db';
import type { HospitalDoc } from '../db-types';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { emitSyncEvent } from './sync-event-service';
import { findByType } from './db-query';
import { ValidationError } from '../validation';

const IS_BROWSER = typeof window !== 'undefined';

/**
 * Facility WRITES are managed centrally, exactly like organizations and users.
 *
 * The browser used to write facilities to its local replica and rely on push
 * replication to carry them up. Two sessions can never keep that promise:
 *   • super_admin / government have no orgId, so their devices deliberately
 *     sync NO org-scoped database — a facility created in the platform console
 *     stayed on that device forever, while /api/users kept answering that it
 *     "has not reached the server yet";
 *   • any tenant device that is offline (or whose sync is broken) shows a
 *     "created" facility that no other device — and no server check — can see.
 * The server write lands in the aggregate, the per-org continuous replications
 * carry it into the tenant database, and pull replication delivers it to every
 * device — including, eventually, the one that created it.
 */
const isBrowserRuntime = () => typeof window !== 'undefined' && !process.env.JEST_WORKER_ID;

async function postHospitalsApi(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { apiFetch } = await import('../api-fetch');
  let res: Response;
  try {
    res = await apiFetch('/api/hospitals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Do NOT fall back to a local write: on the sessions that most use this
    // form it cannot replicate, so it would report success and leave the
    // facility invisible to the server — the exact failure this path removes.
    throw new Error('Facilities are managed centrally and require a connection. Check your internet and try again.');
  }
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) {
    const error = new Error((body.error as string) || `Facility request failed (${res.status})`);
    // The facility form shows per-field messages when it has them; the API
    // forwards ValidationError fields, so hand them through.
    if (body.fields && typeof body.fields === 'object') {
      (error as Error & { fields?: Record<string, string> }).fields = body.fields as Record<string, string>;
    }
    throw error;
  }
  return body;
}

/**
 * The databases a SERVER read has to consult for one organization's facilities.
 *
 * Server-side `getDB(name)` takes the name verbatim, so `hospitalsDB()` is
 * always the shared aggregate `tamamhealth_hospitals`. The browser does not:
 * with `NEXT_PUBLIC_COUCHDB_TENANT_DATABASES_ENABLED=true` it replicates
 * org-scoped data to `tamamhealth_hospitals--<orgId>` and to nothing else.
 *
 * So after the tenant cutover a facility registered in a clinic reaches
 * `…--<orgId>` and never reaches the aggregate — while `/api/users` asks the
 * aggregate whether that facility exists before it will attach an account to
 * it. The answer is no, forever, and the administrator is told the facility
 * "has not reached the server yet" about a facility that is sitting on the
 * server one database over. Every facility-bound role becomes uncreatable;
 * super_admin, org_admin and government keep working because they need no
 * facility, which is what makes it look like a permissions problem.
 *
 * Both are consulted, tenant first: pre-cutover facilities live in the
 * aggregate, post-cutover ones in the tenant database, and a deployment
 * mid-migration holds some of each.
 */
function serverHospitalDatabases(orgId?: string) {
  const aggregate = hospitalsDB();
  const tenantMode = process.env.NEXT_PUBLIC_COUCHDB_TENANT_DATABASES_ENABLED === 'true';
  if (IS_BROWSER || !tenantMode || !orgId) return [aggregate];
  return [getDB(`tamamhealth_hospitals--${orgId}`), aggregate];
}

export async function getAllHospitals(scope?: DataScope): Promise<HospitalDoc[]> {
  // Server truth first in the browser, the local replica as the offline
  // answer. Facilities are WRITTEN server-side, so the replica only learns of
  // one when pull replication delivers it — and the sessions that manage
  // facilities most (super_admin, government) deliberately sync no org-scoped
  // database at all, so their replica would never learn of it.
  if (isBrowserRuntime()) {
    try {
      const { apiFetch } = await import('../api-fetch');
      const res = await apiFetch('/api/hospitals');
      if (res.ok) {
        const body = await res.json() as { hospitals?: HospitalDoc[] };
        if (Array.isArray(body.hospitals)) {
          const all = body.hospitals;
          return scope ? filterByScope(all, scope) : all;
        }
      }
    } catch {
      // Offline — the replica below is the answer.
    }
  }
  const databases = serverHospitalDatabases(scope?.orgId);
  const seen = new Map<string, HospitalDoc>();
  for (const db of databases) {
    try {
      // Tenant database first, so its copy wins on id — it is the one the
      // clinic writes to and therefore the fresher of the two.
      for (const doc of await findByType<HospitalDoc>(db, 'hospital')) {
        if (!seen.has(doc._id)) seen.set(doc._id, doc);
      }
    } catch {
      // A tenant database that does not exist yet is not an error: the org
      // simply has not been migrated or has never written a facility.
    }
  }
  const all = [...seen.values()];
  return scope ? filterByScope(all, scope) : all;
}

export async function getHospitalById(id: string, scope?: DataScope): Promise<HospitalDoc | null> {
  if (isBrowserRuntime()) {
    try {
      const { apiFetch } = await import('../api-fetch');
      const res = await apiFetch(`/api/hospitals?id=${encodeURIComponent(id)}`);
      if (res.ok) {
        const body = await res.json() as { hospital?: HospitalDoc };
        if (body.hospital) {
          return scope && filterByScope([body.hospital], scope).length === 0 ? null : body.hospital;
        }
      }
      if (res.status === 404) return null;
    } catch {
      // Offline — fall through to the replica.
    }
  }
  try {
    let hospital: HospitalDoc | null = null;
    for (const db of serverHospitalDatabases(scope?.orgId)) {
      try {
        hospital = await db.get(id) as HospitalDoc;
        break;
      } catch {
        // Try the next database before treating this as "not found".
      }
    }
    if (!hospital) throw Object.assign(new Error('missing'), { status: 404 });
    return scope && filterByScope([hospital], scope).length === 0 ? null : hospital;
  } catch (err) {
    // Surface the real failure — a swallowed non-404 here once masqueraded
    // as "Hospital not found" on the manage page.
    console.warn('[hospital-service] getHospitalById failed for', id, err);
    return null;
  }
}

/**
 * Whether a facility is still part of the network.
 *
 * `isActive` is undefined on every facility created before the field existed,
 * so "active" is `!== false`, never `=== true`. Read this rather than testing
 * the field inline — the polarity is easy to get backwards, and getting it
 * backwards empties every facility picker in the app.
 */
export function isFacilityActive(hospital: Pick<HospitalDoc, 'isActive'>): boolean {
  return hospital.isActive !== false;
}

/** The facilities new work may be assigned to. Retired sites stay readable. */
export function activeFacilities<T extends Pick<HospitalDoc, 'isActive'>>(hospitals: T[]): T[] {
  return hospitals.filter(isFacilityActive);
}

/**
 * Edit a facility's own record.
 *
 * Until now the only writer was `updateHospitalStatus`, whose name says what it
 * was built for: flipping status/sync/counters. Everything else about a
 * facility — beds by type, staffing establishment, infrastructure, services,
 * coordinates, even its facility TYPE — was write-once, settable only in the
 * create form and never correctable afterwards.
 *
 * `orgId` is deliberately not editable: moving a facility between tenants would
 * strand every admission, bill and staff record already stamped with it.
 */
export async function updateFacility(
  id: string,
  data: Partial<Omit<HospitalDoc, '_id' | '_rev' | 'type' | 'orgId' | 'createdAt'>>,
  scope?: DataScope,
): Promise<HospitalDoc | null> {
  return updateHospitalStatus(id, data as Partial<HospitalDoc>, scope);
}

/**
 * Retire a facility, or bring one back.
 *
 * A soft flag, never a delete: admissions, visits, bills, prescriptions and
 * staff records all carry `hospitalId`, and removing the document would orphan
 * all of them while leaving the history unreadable. A retired facility keeps
 * its record and its numbers, disappears from the pickers new work is assigned
 * through, and releases the `maxHospitals` slot it was holding.
 */
export async function setFacilityActive(
  id: string,
  isActive: boolean,
  actorId?: string,
  actorUsername?: string,
  scope?: DataScope,
): Promise<HospitalDoc | null> {
  const updated = await updateHospitalStatus(
    id,
    isActive
      ? { isActive: true, retiredAt: undefined, retiredBy: undefined }
      : { isActive: false, retiredAt: new Date().toISOString(), retiredBy: actorId },
    scope,
  );
  if (updated) {
    const { logAudit } = await import('./audit-service');
    await logAudit(
      isActive ? 'hospital_restored' : 'hospital_retired',
      actorId,
      actorUsername,
      `${isActive ? 'Restored' : 'Retired'} facility "${updated.name}"`,
      true,
    );
  }
  return updated;
}

/**
 * Refuse a facility the organization is not entitled to hold — because it is
 * suspended/cancelled/deactivated, or already at its `maxHospitals` limit.
 *
 * Both checks were displayed and never enforced: `maxHospitals` sat in the
 * tenant matrix and the org-settings usage meter as "3 / 10" while every create
 * path ignored it, and a suspended tenant could still be given new sites.
 *
 * Fails OPEN on an unreadable organization record: a transient database error
 * must not stop a clinic registering a facility, and CouchDB's tenant validator
 * on push is the backstop.
 */
async function assertOrganizationCanHoldAnotherFacility(orgId: string): Promise<void> {
  let organization;
  try {
    const { getOrganizationById } = await import('./organization-service');
    organization = await getOrganizationById(orgId);
  } catch {
    return;
  }
  if (!organization) return;

  const { getTenantAccess } = await import('./tenant-control-service');
  const access = await getTenantAccess(orgId);
  if (!access.allowed) {
    throw new ValidationError({
      orgId: `${organization.name} is ${access.reason} — no new facilities can be registered in it.`,
    });
  }

  const max = organization.maxHospitals;
  if (!max || max <= 0) return;
  const inUse = (await getAllHospitals({ orgId, role: 'super_admin' }))
    .filter(h => h.orgId === orgId && h.isActive !== false).length;
  if (inUse >= max) {
    throw new ValidationError({
      orgId: `${organization.name} has registered all ${max} facilities its plan allows. `
        + 'Retire a facility or raise the limit before adding another.',
    });
  }
}

export async function createHospital(
  data: Omit<HospitalDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSync' | 'patientCount' | 'todayVisits'>,
  actorId?: string,
  actorUsername?: string
): Promise<HospitalDoc> {
  if (isBrowserRuntime()) {
    const body = await postHospitalsApi({ ...data });
    return body.hospital as HospitalDoc;
  }

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

  // The organization has to be entitled to hold another facility. This is the
  // single writer both the dialog and /api/hospitals go through, so stating the
  // rule once covers every path.
  await assertOrganizationCanHoldAnotherFacility(data.orgId);

  // ...and it must not already have this one. Facility ids are generated, so
  // nothing here was stopping the same hospital being registered twice: the
  // network list showed two "Juba Teaching Hospital" rows in the same town,
  // each collecting its own staff, wards and stock. Matching is on name AND
  // town, because a name repeats legitimately across towns — two St Mary
  // clinics in different counties are two clinics. A retired facility still
  // counts: the answer to "we already have that one" is to restore it, not to
  // create a second.
  const { findByEntityName } = await import('../entity-names');
  const existingInOrg = (await getAllHospitals()).filter(h => h.orgId === data.orgId);
  const duplicate = findByEntityName(
    existingInOrg,
    { name: data.name, place: data.town },
    h => ({ name: h.name, place: h.town }),
  );
  if (duplicate) {
    throw new ValidationError({
      name: isFacilityActive(duplicate)
        ? `"${duplicate.name}" is already registered${duplicate.town ? ` in ${duplicate.town}` : ''}. Open that facility instead of creating a second one.`
        : `"${duplicate.name}" is already registered${duplicate.town ? ` in ${duplicate.town}` : ''} but retired. Restore it instead of creating a second one.`,
    });
  }

  const db = hospitalsDB();
  const now = new Date().toISOString();
  const { v4: uuidv4 } = await import('uuid');
  const shortId = uuidv4().split('-')[0];

  const doc: HospitalDoc = {
    ...data,
    // A registered site is active and functional unless the operator records
    // otherwise later. Leaving these absent made newly created facilities show
    // an "unknown" status even though every reader already treated absence as
    // active/functional; persist the same truth the UI and filters use.
    isActive: data.isActive ?? true,
    operationalStatus: data.operationalStatus ?? 'functional',
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
  if (isBrowserRuntime()) {
    try {
      const body = await postHospitalsApi({ action: 'update', id, ...data });
      return (body.hospital as HospitalDoc) ?? null;
    } catch {
      // Callers treat null as "update failed" and say so; keeping that
      // contract beats inventing a second error channel here.
      return null;
    }
  }
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
