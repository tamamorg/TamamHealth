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
  /**
   * True when `memberRoles` was derived from the operator-supplied
   * `memberOrgIds` list rather than from the database's own identity.
   *
   * This is the difference between "this database is meant to have no members"
   * (a server-only database — the empty list IS the answer) and "nobody told us
   * which organizations to grant" (a shared aggregate with the list omitted —
   * the empty list is the ABSENCE of an answer). The deployment script has to
   * tell those apart: writing an empty member list over a live shared aggregate
   * revokes replication for every organization on it, which is exactly the
   * "one idempotent re-run takes tenants offline" failure this module exists to
   * prevent.
   */
  membersFromOperatorList: boolean;
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
      // Read from the database's own name — never from the operator list.
      memberRoles: [`org:${tenant.orgId}`],
      membersFromOperatorList: false,
    };
  }

  if (BROWSER_DATABASES.has(databaseName)) {
    const orgScoped = ORG_SCOPED_DATABASES.has(databaseName);
    // Cutover revokes browser membership on the ORG-SCOPED aggregates, whose
    // rows moved into per-organization databases — any member role left there
    // would be a cross-tenant read.
    //
    // It must not revoke the two that are not org-scoped. `organizations` and
    // `platform_config` are global reference data with no tenant successor:
    // the migration creates no `--org-…` variant of them because there is
    // nothing to split. Emptying their member roles locked every browser out
    // of the record that names its own organization and the document carrying
    // platform policy — a permanent 403 on every pull, on databases that are
    // already read-only to the browser (`serverOnlyValidator` below refuses
    // every non-admin write, so membership grants reading and nothing else).
    const revoked = options.tenantDatabasesEnabled && orgScoped;
    const memberOrgIds = revoked ? [] : (options.memberOrgIds ?? []);
    return {
      baseName: databaseName,
      orgId: null,
      orgScopedValidator: orgScoped,
      serverOnlyValidator: READ_ONLY_DATABASES.includes(databaseName),
      memberRoles: memberOrgIds.map(orgId => `org:${orgId}`),
      // Before cutover — and always, for the global reference databases — the
      // list is the operator's, and its absence means "unknown" rather than
      // "none".
      membersFromOperatorList: !revoked,
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
    membersFromOperatorList: false,
  };
}

export interface ResolvedMembers {
  /** The `members.roles` to write. */
  roles: string[];
  /** True when the database's existing roles were kept instead of the policy's. */
  preserved: boolean;
}

/**
 * The member roles to write, given what the policy computed and what the
 * database already has.
 *
 * Only one case is ambiguous: a shared aggregate whose member list comes from
 * the operator's `COUCHDB_MEMBER_ORG_IDS`, when that list is empty. That is
 * "nobody said", not "grant nobody" — so the roles already on the database are
 * kept. Every other case is an answer the policy is sure of, and is written
 * as-is.
 *
 * This exists because the deployment script is documented as idempotent and is
 * run as a routine step: forgetting one environment variable must not write
 * `members: []` over every shared aggregate and cut every organization off from
 * replication. `revokeUnlisted` is the explicit way to ask for exactly that —
 * the intended end state once tenant databases are live.
 */
export function resolveMemberRoles(
  policy: Pick<DatabasePolicy, 'memberRoles' | 'membersFromOperatorList'>,
  currentRoles: readonly string[],
  options: { revokeUnlisted?: boolean } = {},
): ResolvedMembers {
  const wouldRevoke =
    policy.membersFromOperatorList &&
    policy.memberRoles.length === 0 &&
    currentRoles.length > 0;
  if (wouldRevoke && !options.revokeUnlisted) {
    return { roles: [...currentRoles], preserved: true };
  }
  return { roles: policy.memberRoles, preserved: false };
}
