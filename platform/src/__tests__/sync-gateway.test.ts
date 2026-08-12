import {
  gatewayRequestAllowed,
  resolveGatewayDatabase,
  validateGatewayWriteBody,
} from '@/lib/sync/sync-gateway';

describe('server-authorized CouchDB sync gateway', () => {
  it('routes a user only to their physical tenant database', () => {
    expect(resolveGatewayDatabase('tamamhealth_patients--org-clinic-a', 'org-clinic-a')?.localName)
      .toBe('tamamhealth_patients');
    expect(resolveGatewayDatabase('tamamhealth_patients--org-clinic-b', 'org-clinic-a')).toBeNull();
    expect(resolveGatewayDatabase('tamamhealth_patients', 'org-clinic-a')).toBeNull();
  });

  it('allows global reference databases without granting clinical aggregates', () => {
    expect(resolveGatewayDatabase('tamamhealth_platform_config', 'org-clinic-a')?.orgScoped).toBe(false);
  });

  it('blocks writes to pull-only databases and reads from push-only history', () => {
    const fee = resolveGatewayDatabase('tamamhealth_fee_schedule--org-clinic-a', 'org-clinic-a')!;
    expect(gatewayRequestAllowed(fee, 'POST', ['_find'])).toBe(true);
    expect(gatewayRequestAllowed(fee, 'POST', ['_bulk_docs'])).toBe(false);

    const audit = resolveGatewayDatabase('tamamhealth_audit_log--org-clinic-a', 'org-clinic-a')!;
    expect(gatewayRequestAllowed(audit, 'POST', ['_bulk_docs'])).toBe(true);
    expect(gatewayRequestAllowed(audit, 'POST', ['_all_docs'])).toBe(false);
    expect(gatewayRequestAllowed(audit, 'POST', ['_revs_diff'])).toBe(true);
  });

  it('blocks security, design, and compaction operations', () => {
    const patients = resolveGatewayDatabase('tamamhealth_patients--org-clinic-a', 'org-clinic-a')!;
    for (const endpoint of ['_security', '_design', '_compact']) {
      expect(gatewayRequestAllowed(patients, 'PUT', [endpoint])).toBe(false);
    }
    expect(gatewayRequestAllowed(patients, 'POST', ['_unknown_admin_endpoint'])).toBe(false);
  });

  it('rejects unknown, untyped, and cross-module documents in bulk writes', () => {
    const patients = resolveGatewayDatabase('tamamhealth_patients--org-clinic-a', 'org-clinic-a')!;
    expect(validateGatewayWriteBody(patients, 'POST', ['_bulk_docs'], {
      docs: [{ _id: 'pat-1', type: 'patient', orgId: 'org-clinic-a' }],
    })).toBeNull();
    expect(validateGatewayWriteBody(patients, 'POST', ['_bulk_docs'], {
      docs: [{ _id: 'rx-1', type: 'prescription', orgId: 'org-clinic-a' }],
    })).toMatch(/not permitted/);
    expect(validateGatewayWriteBody(patients, 'PUT', ['pat-2'], { _id: 'pat-2' }))
      .toMatch(/not permitted/);
  });

  it('allows replication tombstones and checkpoint metadata', () => {
    const patients = resolveGatewayDatabase('tamamhealth_patients--org-clinic-a', 'org-clinic-a')!;
    expect(validateGatewayWriteBody(patients, 'POST', ['_bulk_docs'], {
      docs: [{ _id: 'pat-1', _rev: '2-x', _deleted: true }],
    })).toBeNull();
    expect(validateGatewayWriteBody(patients, 'PUT', ['_local', 'checkpoint'], {})).toBeNull();
  });
});
