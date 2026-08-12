/**
 * CouchDB database-per-organization naming.
 *
 * Database names are an authorization boundary, so this module deliberately
 * rejects unexpected identifiers instead of lossy "sanitizing" them. Lossy
 * conversion can map two organization IDs to the same database.
 */

const BASE_DATABASE_RE = /^tamamhealth_[a-z0-9_]+$/;
const ORG_ID_RE = /^org-[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

export const TENANT_DATABASE_SEPARATOR = '--';

export function assertBaseDatabaseName(name: string): string {
  if (!BASE_DATABASE_RE.test(name)) {
    throw new Error(`Invalid TamamHealth database name: ${name}`);
  }
  return name;
}

export function assertOrganizationId(orgId: string | undefined): string {
  if (!orgId || !ORG_ID_RE.test(orgId)) {
    throw new Error(
      'A canonical organization ID (org- followed by lowercase letters, numbers, or hyphens) is required for tenant sync.',
    );
  }
  return orgId;
}

export function tenantDatabaseName(baseName: string, orgId: string): string {
  return `${assertBaseDatabaseName(baseName)}${TENANT_DATABASE_SEPARATOR}${assertOrganizationId(orgId)}`;
}

/**
 * Split a tenant database name back into the aggregate it mirrors and the
 * organization that owns it, or return null when `name` is not one.
 *
 * The name is authoritative: it is what CouchDB enumerates in `_all_dbs`, so
 * deployment tooling can decide policy for a live database without being told
 * which organizations exist.
 */
export function parseTenantDatabaseName(
  name: string,
): { baseName: string; orgId: string } | null {
  const separatorAt = name.lastIndexOf(TENANT_DATABASE_SEPARATOR);
  if (separatorAt < 1) return null;
  const baseName = name.slice(0, separatorAt);
  const orgId = name.slice(separatorAt + TENANT_DATABASE_SEPARATOR.length);
  try {
    tenantDatabaseName(baseName, orgId);
    return { baseName, orgId };
  } catch {
    return null;
  }
}

export function isTenantDatabaseName(name: string): boolean {
  return parseTenantDatabaseName(name) !== null;
}

export interface TenantReplicationDocument {
  _id: string;
  source: string;
  target: string;
  continuous: true;
  create_target: false;
  selector: { orgId: { $eq: string } };
}

/** Durable `_replicator` documents connecting the server aggregate and tenant DB. */
export function tenantReplicationDocuments(
  baseName: string,
  orgIdInput: string,
  direction: 'both' | 'push' | 'pull' = 'both',
): TenantReplicationDocument[] {
  const orgId = assertOrganizationId(orgIdInput);
  const source = assertBaseDatabaseName(baseName);
  const tenant = tenantDatabaseName(source, orgId);
  const idBase = `${source.replace(/^tamamhealth_/, '')}--${orgId}`;
  const common = {
    continuous: true as const,
    create_target: false as const,
    selector: { orgId: { $eq: orgId } },
  };
  const jobs: TenantReplicationDocument[] = [];
  if (direction !== 'push') {
    jobs.push({ _id: `tamamhealth-out--${idBase}`, source, target: tenant, ...common });
  }
  if (direction !== 'pull') {
    jobs.push({ _id: `tamamhealth-in--${idBase}`, source: tenant, target: source, ...common });
  }
  return jobs;
}
