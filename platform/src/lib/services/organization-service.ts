import { organizationsDB } from '../db';
import type { OrganizationDoc } from '../db-types';
import { emitSyncEvent } from './sync-event-service';
import { findByType } from './db-query';

/**
 * Organization writes are provisioned CENTRALLY, like user accounts.
 *
 * `tamamhealth_organizations` carries a `validate_doc_update` that refuses
 * every non-`_admin` write, so a document written into the browser's local
 * PouchDB replica is rejected the moment replication tries to push it. The
 * write looked like it worked — the super-admin saw the toast and the row —
 * while the server never learned the organization existed. Everything the
 * server checks against it then failed: creating a staff account answered
 * "Assigned organization was not found or is inactive", so an organization
 * admin could not add a single member of staff.
 *
 * Routing through /api/organizations puts the write where the admin
 * credentials are. Same shape, and same reason, as user-service.
 */
const isBrowserRuntime = () => typeof window !== 'undefined' && !process.env.JEST_WORKER_ID;

/** POST an action to /api/organizations and translate failures into readable errors. */
async function postOrganizationsApi(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { apiFetch } = await import('../api-fetch');
  let res: Response;
  try {
    res = await apiFetch('/api/organizations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Do NOT fall back to a local write: it cannot replicate, so it would
    // report success and leave the organization invisible to the server.
    throw new Error('Organizations are managed centrally and require a connection. Check your internet and try again.');
  }
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error((body.error as string) || `Organization request failed (${res.status})`);
  }
  return body;
}

export async function getAllOrganizations(): Promise<OrganizationDoc[]> {
  // Server truth first, local replica as the offline answer.
  //
  // Organizations are written SERVER-side (the browser posts to the API), so
  // the local replica only learns about one when pull replication delivers it
  // — up to a poll interval later, and never on a device whose sync is off.
  // The registry read from the replica alone, so a just-created organization
  // was missing from the very console that created it: the handoff modal said
  // "Administrator created" and the list behind it still showed the old
  // tenants. The API applies the caller's scope (an org admin gets only their
  // own organization), so this widens nothing.
  if (isBrowserRuntime()) {
    try {
      const { apiFetch } = await import('../api-fetch');
      const res = await apiFetch('/api/organizations');
      if (res.ok) {
        const body = await res.json() as { organizations?: OrganizationDoc[] };
        if (Array.isArray(body.organizations)) return body.organizations;
      }
    } catch {
      // Offline — the replica below is the answer that keeps the app working.
    }
  }
  const db = organizationsDB();
  return findByType<OrganizationDoc>(db, 'organization');
}

export async function getOrganizationById(id: string): Promise<OrganizationDoc | null> {
  try {
    const db = organizationsDB();
    return await db.get(id) as OrganizationDoc;
  } catch {
    // Not in the local replica. Organizations are written server-side (see the
    // note at the top of this file), so a browser only receives them by
    // replication — and an organization created after this device last pulled,
    // or any device with sync switched off, simply does not have it. Ask the
    // server directly rather than reporting that the signed-in user's own
    // organization does not exist, which is what left the org admin's Role
    // picker unable to see which roles their organization employs.
    if (isBrowserRuntime()) {
      try {
        const { apiFetch } = await import('../api-fetch');
        const res = await apiFetch(`/api/organizations?id=${encodeURIComponent(id)}`);
        if (!res.ok) return null;
        const body = await res.json() as { organization?: OrganizationDoc };
        return body.organization ?? null;
      } catch {
        // Offline, or a role the organizations API does not serve. Callers all
        // treat a missing organization as "no org-specific configuration",
        // which is the same answer they got before this fallback existed.
        return null;
      }
    }
    return null;
  }
}

export async function getOrganizationBySlug(slug: string): Promise<OrganizationDoc | null> {
  const all = await getAllOrganizations();
  return all.find(o => o.slug === slug) || null;
}

export async function createOrganization(
  data: Omit<OrganizationDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>,
  actorId?: string,
  actorUsername?: string
): Promise<OrganizationDoc> {
  if (isBrowserRuntime()) {
    const body = await postOrganizationsApi({ ...data });
    return body.organization as OrganizationDoc;
  }

  const db = organizationsDB();
  const now = new Date().toISOString();

  const slug = data.slug.toLowerCase().replace(/[^a-z0-9-]/g, '');
  const existing = await getOrganizationBySlug(slug);
  if (existing) {
    throw new Error(`Organization with slug "${slug}" already exists`);
  }

  // The slug check alone let the same tenant in twice. "Ministry of Health -
  // Republic of South Sudan" and "Ministry of Health — Republic of South
  // Sudan" differ by one dash, produce different slugs, and are one ministry:
  // the console listed both, each with its own facilities and user quota.
  // Compare the names the way a person reads them.
  const { isSameEntityName } = await import('../entity-names');
  const sameName = (await getAllOrganizations()).find(o => isSameEntityName(o.name, data.name));
  if (sameName) {
    throw new Error(
      `"${sameName.name}" already exists (${sameName._id}). Rename this one or open the existing organization.`,
    );
  }

  const doc: OrganizationDoc = {
    ...data,
    _id: `org-${slug}`,
    type: 'organization',
    slug,
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
  };

  // Provision the physical tenant boundary before publishing the organization
  // as active. This runs only on the server/API path. If CouchDB provisioning
  // fails, creation fails closed and no login can be issued into a tenant that
  // has nowhere safe to sync clinical data.
  if (
    typeof window === 'undefined' &&
    process.env.NEXT_PUBLIC_COUCHDB_TENANT_DATABASES_ENABLED === 'true'
  ) {
    const { provisionOrganizationDatabases } = await import('../sync/couch-auth');
    await provisionOrganizationDatabases(doc._id);
  }

  const resp = await db.put(doc);
  doc._rev = resp.rev;
  const { logAudit } = await import('./audit-service');
  await logAudit('organization_created', actorId, actorUsername, `Created organization "${data.name}"`, true);
  emitSyncEvent({
    resourceType: 'organization',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    userId: actorId,
    username: actorUsername,
    orgId: doc._id,
  });
  return doc;
}

export async function updateOrganization(
  id: string,
  data: Partial<Omit<OrganizationDoc, '_id' | '_rev' | 'type' | 'createdAt'>>,
  actorId?: string,
  actorUsername?: string
): Promise<OrganizationDoc> {
  if (isBrowserRuntime()) {
    const body = await postOrganizationsApi({ action: 'update', orgId: id, ...data });
    return body.organization as OrganizationDoc;
  }

  const db = organizationsDB();
  const existing = await db.get(id) as OrganizationDoc;

  const updated: OrganizationDoc = {
    ...existing,
    ...data,
    _id: existing._id,
    _rev: existing._rev,
    updatedAt: new Date().toISOString(),
  };

  const resp = await db.put(updated);
  updated._rev = resp.rev;
  const { logAudit } = await import('./audit-service');
  await logAudit('organization_updated', actorId, actorUsername, `Updated organization "${existing.name}"`, true);
  emitSyncEvent({
    resourceType: 'organization',
    resourceId: updated._id,
    operation: 'update',
    resourceVersion: updated._rev,
    userId: actorId,
    username: actorUsername,
    orgId: updated._id,
  });
  return updated;
}

export async function deactivateOrganization(
  id: string,
  actorId?: string,
  actorUsername?: string
): Promise<void> {
  if (isBrowserRuntime()) {
    await postOrganizationsApi({ action: 'deactivate', orgId: id });
    return;
  }

  const db = organizationsDB();
  const existing = await db.get(id) as OrganizationDoc;

  const updated: OrganizationDoc = {
    ...existing,
    isActive: false,
    updatedAt: new Date().toISOString(),
  };

  const resp = await db.put(updated);
  updated._rev = resp.rev;
  const { logAudit } = await import('./audit-service');
  await logAudit('organization_deactivated', actorId, actorUsername, `Deactivated organization "${existing.name}"`, true);
  emitSyncEvent({
    resourceType: 'organization',
    resourceId: updated._id,
    operation: 'update',
    resourceVersion: updated._rev,
    userId: actorId,
    username: actorUsername,
    orgId: updated._id,
  });
}

/**
 * Put a deactivated tenant back into service.
 *
 * The inverse of `deactivateOrganization`, and the reason deactivation only
 * ever flips `isActive`: the plan, the limits, the branding and the billing
 * status are all still on the document, so restoring returns the tenant to
 * exactly what it was rather than to a default.
 */
export async function restoreOrganization(
  id: string,
  actorId?: string,
  actorUsername?: string
): Promise<void> {
  if (isBrowserRuntime()) {
    await postOrganizationsApi({ action: 'restore', orgId: id });
    return;
  }

  const db = organizationsDB();
  const existing = await db.get(id) as OrganizationDoc;

  const updated: OrganizationDoc = {
    ...existing,
    isActive: true,
    updatedAt: new Date().toISOString(),
  };

  const resp = await db.put(updated);
  updated._rev = resp.rev;
  const { logAudit } = await import('./audit-service');
  await logAudit('organization_restored', actorId, actorUsername, `Restored organization "${existing.name}"`, true);
  emitSyncEvent({
    resourceType: 'organization',
    resourceId: updated._id,
    operation: 'update',
    resourceVersion: updated._rev,
    userId: actorId,
    username: actorUsername,
    orgId: updated._id,
  });
}

/** Thrown when a tenant still owns records, so deleting it would orphan them. */
export class OrganizationNotEmptyError extends Error {
  constructor(
    public readonly counts: { userCount: number; hospitalCount: number; patientCount: number },
    /**
     * Whether a platform operator could clear this by cascading. False means
     * the tenant still holds patients, which no cascade here will remove.
     */
    public readonly cascadable = false,
  ) {
    super('This organization still holds records.');
    this.name = 'OrganizationNotEmptyError';
  }
}

/** Options for {@link purgeOrganization}. */
export interface PurgeOrganizationOptions {
  /**
   * Delete the tenant's facilities and staff accounts along with it, instead
   * of refusing because they exist.
   *
   * This is the platform operator's offboarding path, and it is deliberately
   * narrower than "delete everything": it covers the two record kinds that
   * belong to the tenant as an administrative entity and reference nothing
   * clinical. A tenant that still holds PATIENTS is refused even here —
   * a patient's chart is spread across ~70 databases keyed by patientId, so
   * removing the patient document would strand the clinical record instead of
   * deleting it, which is the exact harm this guard exists to prevent. Export
   * or transfer the patients first; then the cascade has nothing to orphan.
   */
  cascade?: boolean;
}

/**
 * Delete every `hospital` or `user` document owned by one tenant.
 *
 * Used only by the cascade path of {@link purgeOrganization}. Deletions go out
 * as a single `bulkDocs` write so a tenant with hundreds of staff is one round
 * trip rather than hundreds, and each one emits a sync event so downstream
 * consumers see the removal rather than silently keeping a record of a person
 * who no longer has an account.
 *
 * Returns how many documents were removed, for the audit line.
 */
async function removeOrgOwnedDocs(
  orgId: string,
  type: 'hospital' | 'user',
  actorId?: string,
  actorUsername?: string,
): Promise<number> {
  const { usersDB, hospitalsDB } = await import('../db');
  const db = type === 'user' ? usersDB() : hospitalsDB();
  await ensureOrgIdIndex(db, type);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (db as any).find({
    selector: { type, orgId },
    fields: ['_id', '_rev'],
    limit: 100000,
  });
  const docs = (result.docs || []) as Array<{ _id: string; _rev: string }>;
  if (docs.length === 0) return 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).bulkDocs(docs.map(d => ({ ...d, _deleted: true })));
  for (const doc of docs) {
    emitSyncEvent({
      resourceType: type,
      resourceId: doc._id,
      operation: 'delete',
      userId: actorId,
      username: actorUsername,
      orgId,
    });
  }
  return docs.length;
}

/**
 * Delete a tenant for good.
 *
 * REFUSES while the tenant still owns facilities, staff accounts or patients,
 * and that refusal is the point. Deleting the organization document does not
 * delete anything underneath it — the facilities, users and charts carry the
 * `orgId` as a plain string, and `filterByScope` matches on it. Removing the
 * parent would leave every one of those documents pointing at a tenant that no
 * longer exists: invisible to every scoped query, unreachable through any
 * screen, and still on disk holding patient data. An empty tenant is the only
 * one that can be removed without creating that.
 *
 * `options.cascade` is the platform operator's way through: instead of
 * refusing because the tenant owns facilities and staff accounts, delete those
 * with it, so nothing is left pointing at a tenant that is gone. Patients are
 * not part of that and never will be — see PurgeOrganizationOptions.
 *
 * Only reachable from Trash, which only holds deactivated tenants, so nothing
 * live can be deleted by a single mistaken click.
 */
export async function purgeOrganization(
  id: string,
  actorId?: string,
  actorUsername?: string,
  options: PurgeOrganizationOptions = {},
): Promise<void> {
  if (isBrowserRuntime()) {
    await postOrganizationsApi({ action: 'purge', orgId: id, cascade: options.cascade === true });
    return;
  }

  const db = organizationsDB();
  const existing = await db.get(id) as OrganizationDoc;
  const stats = await getOrganizationStats(id);
  const counts = {
    userCount: stats.userCount,
    hospitalCount: stats.hospitalCount,
    patientCount: stats.patientCount,
  };

  // Patients block every path. See PurgeOrganizationOptions.cascade.
  if (stats.patientCount > 0) throw new OrganizationNotEmptyError(counts, false);

  const blockers = stats.hospitalCount > 0 || stats.userCount > 0;
  if (blockers && !options.cascade) throw new OrganizationNotEmptyError(counts, true);

  if (blockers) {
    // Order matters only for the audit trail: the dependants are recorded as
    // removed before the tenant is, so a reader of the log never sees a
    // deletion attributed to an organization that the log says was already gone.
    const removedHospitals = await removeOrgOwnedDocs(id, 'hospital', actorId, actorUsername);
    const removedUsers = await removeOrgOwnedDocs(id, 'user', actorId, actorUsername);
    const { logAudit: logCascade } = await import('./audit-service');
    await logCascade(
      'organization_cascade_deleted', actorId, actorUsername,
      `Deleted ${removedHospitals} facility record(s) and ${removedUsers} staff account(s) `
      + `owned by organization "${existing.name}" as part of a permanent delete`,
      true,
    );
  }

  await db.remove(existing._id, existing._rev as string);
  const { logAudit } = await import('./audit-service');
  await logAudit(
    'organization_deleted', actorId, actorUsername,
    `Permanently deleted organization "${existing.name}"`, true,
  );
  emitSyncEvent({
    resourceType: 'organization',
    resourceId: id,
    operation: 'delete',
    userId: actorId,
    username: actorUsername,
    orgId: id,
  });
}

// One-shot per-DB "we tried to create the orgId index" cache. createIndex is
// idempotent server-side but every call still makes an HTTP round-trip; doing
// it once per process per DB is enough.
const orgIndexed = new Set<string>();

async function ensureOrgIdIndex(db: PouchDB.Database, type: string): Promise<void> {
  const dbName = (db as unknown as { name?: string }).name || 'unknown';
  const key = `${dbName}:${type}`;
  if (orgIndexed.has(key)) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).createIndex({ index: { fields: ['type', 'orgId'] } });
  } catch {
    // older CouchDB / index conflict — find() falls back to a scan. We still
    // cache the attempt to avoid retrying every call.
  }
  orgIndexed.add(key);
}

export async function getOrganizationStats(orgId: string): Promise<{
  userCount: number;
  hospitalCount: number;
  /** How many of those facilities are currently reporting `syncStatus: 'offline'`. */
  offlineHospitalCount: number;
  patientCount: number;
}> {
  const { usersDB, hospitalsDB, patientsDB } = await import('../db');

  // Fan out three Mango find() queries in parallel. Each one cherry-picks
  // only the rows for this orgId instead of streaming every doc in the DB.
  // At 50 orgs × 1M patients the previous all-docs path read ~50M rows per
  // page render; the indexed find collapses that to ~20k per org per page.
  const [users, hospitals, patients] = await Promise.all([
    (async () => {
      const db = usersDB();
      await ensureOrgIdIndex(db, 'user');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await (db as any).find({
        selector: { type: 'user', orgId },
        fields: ['_id'],
        limit: 100000,
      });
      return (r.docs as unknown[]).length;
    })(),
    (async () => {
      const db = hospitalsDB();
      await ensureOrgIdIndex(db, 'hospital');
      // syncStatus rides along in `fields` so the tenant list can show a sync
      // figure without a second pass over the same rows.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await (db as any).find({
        selector: { type: 'hospital', orgId },
        fields: ['_id', 'syncStatus'],
        limit: 100000,
      });
      const docs = r.docs as Array<{ syncStatus?: string }>;
      return { total: docs.length, offline: docs.filter(d => d.syncStatus === 'offline').length };
    })(),
    (async () => {
      const db = patientsDB();
      await ensureOrgIdIndex(db, 'patient');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await (db as any).find({
        selector: { type: 'patient', orgId },
        fields: ['_id'],
        limit: 1000000,
      });
      return (r.docs as unknown[]).length;
    })(),
  ]);

  return {
    userCount: users,
    hospitalCount: hospitals.total,
    offlineHospitalCount: hospitals.offline,
    patientCount: patients,
  };
}
