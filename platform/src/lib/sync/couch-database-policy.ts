/**
 * What each live CouchDB database is allowed to be, expressed once.
 *
 * The deployment script that installs design documents and `_security` objects
 * used to decide this inline, by asking whether a database name appeared in the
 * browser sync map. That is wrong the moment tenant databases exist: CouchDB
 * reports `tamamhealth_patients--org-a` in `_all_dbs`, the name is absent from
 * the sync map, and the script would classify a browser-facing tenant database
 * as server-only — installing a deny-all validator over it and clearing the
 * `org:` member role that replication depends on. Re-running a routine,
 * idempotent deployment step would have taken every tenant offline.
 *
 * So the decision lives here, in one tested function, and the script applies
 * whatever it returns.
 */

import { DATABASE_SYNC_CONFIGS } from './sync-config';
import { parseTenantDatabaseName } from './tenant-database';

/** Design doc holding the org-scoping, role-aware validator. */
export const ORG_SCOPE_DESIGN_DOC_ID = '_design/tamamhealth-org-scope';
/** Design doc holding the deny-all-but-admin validator. */
export const SERVER_ONLY_DESIGN_DOC_ID = '_design/tamamhealth-server-writes-only';

/**
 * Databases the server owns outright: browsers replicate them to read
 * reference data, but every write must go through an API route.
 */
export const READ_ONLY_DATABASES: readonly string[] = [
  'tamamhealth_organizations',
  'tamamhealth_platform_config',
  'tamamhealth_fee_schedule',
];

const BROWSER_DATABASES = new Set(DATABASE_SYNC_CONFIGS.map(config => config.localName));
const ORG_SCOPED_DATABASES = new Set(
  DATABASE_SYNC_CONFIGS.filter(config => config.orgScoped).map(config => config.localName),
);

export interface DatabasePolicy {
  /** The aggregate database this name refers to (itself, for non-tenant DBs). */
  baseName: string;
  /** Owning organization, for a tenant database. */
  orgId: string | null;
  /** Install the org-scoping, role-aware validator. */
  orgScopedValidator: boolean;
  /** Install the deny-all-but-admin validator alongside it. */
  serverOnlyValidator: boolean;
  /** Exact `members.roles` to write into `_security`. */
  memberRoles: string[];
}

export interface DatabasePolicyOptions {
  /**
   * True once browsers replicate per-organization databases. The shared
   * aggregates then keep flowing only through server-side `_replicator` jobs
   * and must not be reachable by any browser role.
   *
   * Leave false during the migration window: v6 browsers are still replicating
   * the aggregates directly, and revoking their membership early cuts them off
   * before the cutover is verified.
   */
  tenantDatabasesEnabled: boolean;
  /** Organizations granted membership on shared aggregates before cutover. */
  memberOrgIds?: readonly string[];
}

/**
 * Decide how a single database found in `_all_dbs` must be configured.
 */
export function databasePolicy(
  databaseName: string,
  options: DatabasePolicyOptions,
): DatabasePolicy {
  const tenant = parseTenantDatabaseName(databaseName);

  // A tenant database inherits its aggregate's policy and is scoped to exactly
  // one organization — read from the name, which CouchDB itself reports.
  if (tenant && BROWSER_DATABASES.has(tenant.baseName)) {
    return {
      baseName: tenant.baseName,
      orgId: tenant.orgId,
      orgScopedValidator: ORG_SCOPED_DATABASES.has(tenant.baseName),
      serverOnlyValidator: READ_ONLY_DATABASES.includes(tenant.baseName),
      memberRoles: [`org:${tenant.orgId}`],
    };
  }

  if (BROWSER_DATABASES.has(databaseName)) {
    const memberOrgIds = options.tenantDatabasesEnabled ? [] : (options.memberOrgIds ?? []);
    return {
      baseName: databaseName,
      orgId: null,
      orgScopedValidator: ORG_SCOPED_DATABASES.has(databaseName),
      serverOnlyValidator: READ_ONLY_DATABASES.includes(databaseName),
      memberRoles: memberOrgIds.map(orgId => `org:${orgId}`),
    };
  }

  // Anything absent from the browser sync map is server-only by definition —
  // users, slot holds, usage events. No member roles, and a
  // validator that refuses every non-admin write as defence in depth.
  return {
    baseName: databaseName,
    orgId: null,
    orgScopedValidator: false,
    serverOnlyValidator: true,
    memberRoles: [],
  };
}
