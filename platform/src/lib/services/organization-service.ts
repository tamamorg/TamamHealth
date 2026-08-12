import { organizationsDB } from '../db';
import type { OrganizationDoc } from '../db-types';
import { emitSyncEvent } from './sync-event-service';
import { findByType } from './db-query';

export async function getAllOrganizations(): Promise<OrganizationDoc[]> {
  const db = organizationsDB();
  return findByType<OrganizationDoc>(db, 'organization');
}

export async function getOrganizationById(id: string): Promise<OrganizationDoc | null> {
  try {
    const db = organizationsDB();
    return await db.get(id) as OrganizationDoc;
  } catch {
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
  const db = organizationsDB();
  const now = new Date().toISOString();

  const slug = data.slug.toLowerCase().replace(/[^a-z0-9-]/g, '');
  const existing = await getOrganizationBySlug(slug);
  if (existing) {
    throw new Error(`Organization with slug "${slug}" already exists`);
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await (db as any).find({
        selector: { type: 'hospital', orgId },
        fields: ['_id'],
        limit: 100000,
      });
      return (r.docs as unknown[]).length;
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

  return { userCount: users, hospitalCount: hospitals, patientCount: patients };
}
