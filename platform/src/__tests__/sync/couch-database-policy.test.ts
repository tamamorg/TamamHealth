/**
 * The deployment script installs design docs and `_security` objects from this
 * policy. A wrong answer here is not a bad test run — it is either a tenant
 * that cannot sync or an aggregate database a browser can read across
 * organizations. Both are one idempotent re-run away, so pin the behaviour.
 */
import {
  databasePolicy,
  resolveMemberRoles,
  READ_ONLY_DATABASES,
  ORG_SCOPE_DESIGN_DOC_ID,
  SERVER_ONLY_DESIGN_DOC_ID,
} from '@/lib/sync/couch-database-policy';

const beforeCutover = { tenantDatabasesEnabled: false, memberOrgIds: ['org-a', 'org-b'] };
const afterCutover = { tenantDatabasesEnabled: true, memberOrgIds: ['org-a', 'org-b'] };

describe('CouchDB database policy', () => {
  it('keeps the two validators on separate design documents', () => {
    expect(ORG_SCOPE_DESIGN_DOC_ID).not.toBe(SERVER_ONLY_DESIGN_DOC_ID);
  });

  describe('an omitted member list means "unknown", not "nobody"', () => {
    const unlisted = { tenantDatabasesEnabled: false, memberOrgIds: [] };
    const live = ['org:org-moh-ss', 'org:org-mercy-hospital'];

    it('marks a shared aggregate\'s membership as coming from the operator list', () => {
      const policy = databasePolicy('tamamhealth_patients', beforeCutover);
      expect(policy.membersFromOperatorList).toBe(true);
    });

    it('does not claim operator authorship for a tenant or server-only database', () => {
      // These two know their own answer: the tenant from its name, the
      // server-only database from being absent from the browser sync map.
      expect(databasePolicy('tamamhealth_patients--org-a', afterCutover).membersFromOperatorList).toBe(false);
      expect(databasePolicy('tamamhealth_slot_holds', beforeCutover).membersFromOperatorList).toBe(false);
    });

    it('keeps the members a live aggregate already has when the list is omitted', () => {
      // The regression: running the deployment script without
      // COUCHDB_MEMBER_ORG_IDS used to write members: [] over every shared
      // aggregate, cutting off replication for every organization at once.
      const policy = databasePolicy('tamamhealth_patients', unlisted);
      expect(resolveMemberRoles(policy, live)).toEqual({ roles: live, preserved: true });
    });

    it('still clears them when the operator asks for it explicitly', () => {
      const policy = databasePolicy('tamamhealth_patients', unlisted);
      expect(resolveMemberRoles(policy, live, { revokeUnlisted: true }))
        .toEqual({ roles: [], preserved: false });
    });

    it('writes an empty list for a server-only database, which genuinely has none', () => {
      const policy = databasePolicy('tamamhealth_slot_holds', unlisted);
      expect(resolveMemberRoles(policy, ['org:org-moh-ss']))
        .toEqual({ roles: [], preserved: false });
    });

    it('grants exactly what the operator listed, replacing what was there', () => {
      const policy = databasePolicy('tamamhealth_patients', beforeCutover);
      expect(resolveMemberRoles(policy, live))
        .toEqual({ roles: ['org:org-a', 'org:org-b'], preserved: false });
    });
  });

  describe('tenant databases', () => {
    it('treats a tenant database as browser-facing, not server-only', () => {
      const policy = databasePolicy('tamamhealth_patients--org-a', afterCutover);
      // Regression: classifying this as server-only installed a deny-all
      // validator over live tenant data and cleared its member role.
      expect(policy.serverOnlyValidator).toBe(false);
      expect(policy.orgScopedValidator).toBe(true);
      expect(policy.memberRoles).toEqual(['org:org-a']);
    });

    it('scopes membership to the owning organization, not the configured list', () => {
      const policy = databasePolicy('tamamhealth_patients--org-c', afterCutover);
      expect(policy.memberRoles).toEqual(['org:org-c']);
      expect(policy.orgId).toBe('org-c');
      expect(policy.baseName).toBe('tamamhealth_patients');
    });

    it('applies the same scoping before cutover, while aggregates stay shared', () => {
      expect(databasePolicy('tamamhealth_patients--org-a', beforeCutover).memberRoles)
        .toEqual(['org:org-a']);
    });

    it('carries a read-only aggregate’s server-only rule onto its tenant copy', () => {
      const policy = databasePolicy('tamamhealth_fee_schedule--org-a', afterCutover);
      expect(READ_ONLY_DATABASES).toContain('tamamhealth_fee_schedule');
      expect(policy.serverOnlyValidator).toBe(true);
      expect(policy.memberRoles).toEqual(['org:org-a']);
    });

    it('refuses to read an organization out of a malformed suffix', () => {
      const policy = databasePolicy('tamamhealth_patients--NOT_AN_ORG', afterCutover);
      expect(policy.orgId).toBeNull();
      expect(policy.memberRoles).toEqual([]);
      expect(policy.serverOnlyValidator).toBe(true);
    });
  });

  describe('shared aggregate databases', () => {
    it('grants the configured organizations membership during migration', () => {
      expect(databasePolicy('tamamhealth_patients', beforeCutover).memberRoles)
        .toEqual(['org:org-a', 'org:org-b']);
    });

    it('revokes all browser membership once tenants are live', () => {
      // After cutover the aggregates flow only through server-side _replicator
      // jobs; any member role here would be a cross-tenant read.
      expect(databasePolicy('tamamhealth_patients', afterCutover).memberRoles).toEqual([]);
    });

    it('still installs the org-scoping validator on the aggregate', () => {
      expect(databasePolicy('tamamhealth_patients', afterCutover).orgScopedValidator).toBe(true);
    });
  });

  describe('server-only databases', () => {
    it.each([
      'tamamhealth_users',
      'tamamhealth_usage_events',
      'tamamhealth_unknown_future_database',
    ])('locks %s away from every browser role', name => {
      const policy = databasePolicy(name, afterCutover);
      expect(policy.memberRoles).toEqual([]);
      expect(policy.serverOnlyValidator).toBe(true);
      expect(policy.orgScopedValidator).toBe(false);
    });

    it('does not grant them membership before cutover either', () => {
      expect(databasePolicy('tamamhealth_users', beforeCutover).memberRoles).toEqual([]);
    });
  });

  it('defaults to no aggregate membership when no organizations are configured', () => {
    const policy = databasePolicy('tamamhealth_patients', { tenantDatabasesEnabled: false });
    expect(policy.memberRoles).toEqual([]);
  });
});
