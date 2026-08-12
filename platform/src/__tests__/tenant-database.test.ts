import {
  assertOrganizationId,
  isTenantDatabaseName,
  tenantDatabaseName,
  tenantReplicationDocuments,
} from '@/lib/sync/tenant-database';
import { getRemoteUrl } from '@/lib/sync/sync-config';

describe('database-per-organization naming', () => {
  it('creates a deterministic tenant database name and URL', () => {
    expect(tenantDatabaseName('tamamhealth_patients', 'org-tamam-health'))
      .toBe('tamamhealth_patients--org-tamam-health');
    expect(getRemoteUrl('tamamhealth_patients', 'https://couch.example.org/', {
      orgScoped: true,
      orgId: 'org-tamam-health',
      tenantDatabasesEnabled: true,
    })).toBe('https://couch.example.org/tamamhealth_patients--org-tamam-health');
  });

  it('leaves global databases un-namespaced', () => {
    expect(getRemoteUrl('tamamhealth_platform_config', 'https://couch.example.org', {
      orgScoped: false,
      tenantDatabasesEnabled: true,
    })).toBe('https://couch.example.org/tamamhealth_platform_config');
  });

  it.each([
    '',
    'public-health',
    'org-UPPER',
    'org-a/../b',
    'org-a_b',
    'org-a--',
  ])('rejects unsafe or non-canonical org IDs: %s', (orgId) => {
    expect(() => assertOrganizationId(orgId)).toThrow();
  });

  it('recognizes only valid tenant database names', () => {
    expect(isTenantDatabaseName('tamamhealth_triage--org-clinic-1')).toBe(true);
    expect(isTenantDatabaseName('tamamhealth_triage--org-CLINIC')).toBe(false);
    expect(isTenantDatabaseName('tamamhealth_triage')).toBe(false);
  });

  it('builds stable, org-filtered replication jobs in both directions', () => {
    expect(tenantReplicationDocuments('tamamhealth_patients', 'org-clinic')).toEqual([
      expect.objectContaining({
        _id: 'tamamhealth-out--patients--org-clinic',
        source: 'tamamhealth_patients',
        target: 'tamamhealth_patients--org-clinic',
        selector: { orgId: { $eq: 'org-clinic' } },
      }),
      expect.objectContaining({
        _id: 'tamamhealth-in--patients--org-clinic',
        source: 'tamamhealth_patients--org-clinic',
        target: 'tamamhealth_patients',
        selector: { orgId: { $eq: 'org-clinic' } },
      }),
    ]);
  });

  it('honours push-only and pull-only topology', () => {
    expect(tenantReplicationDocuments('tamamhealth_audit_log', 'org-clinic', 'push'))
      .toEqual([expect.objectContaining({ source: 'tamamhealth_audit_log--org-clinic', target: 'tamamhealth_audit_log' })]);
    expect(tenantReplicationDocuments('tamamhealth_fee_schedule', 'org-clinic', 'pull'))
      .toEqual([expect.objectContaining({ source: 'tamamhealth_fee_schedule', target: 'tamamhealth_fee_schedule--org-clinic' })]);
  });
});
