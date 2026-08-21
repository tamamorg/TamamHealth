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

  it('never forwards a deletion to an append-only database', () => {
    // A tombstone has no `type` for the allowlist to catch, so without this the
    // audit trail, the narcotics register and the patient ledger were erasable
    // by the staff they record.
    for (const name of ['audit_log', 'controlled_substance_log', 'ledger']) {
      const db = resolveGatewayDatabase(`tamamhealth_${name}--org-clinic-a`, 'org-clinic-a')!;
      expect(validateGatewayWriteBody(db, 'POST', ['_bulk_docs'], {
        docs: [{ _id: `${name}-1`, _rev: '2-x', _deleted: true }],
      })).toMatch(/append-only/);
      expect(validateGatewayWriteBody(db, 'DELETE', [`${name}-1`], null)).toMatch(/append-only/);
    }
  });

  it('still lets append-only databases receive new entries', () => {
    const audit = resolveGatewayDatabase('tamamhealth_audit_log--org-clinic-a', 'org-clinic-a')!;
    expect(validateGatewayWriteBody(audit, 'POST', ['_bulk_docs'], {
      docs: [{ _id: 'aud-1', type: 'audit_log', orgId: 'org-clinic-a' }],
    })).toBeNull();
  });

  it('leaves deletes alone on databases that are not append-only', () => {
    const patients = resolveGatewayDatabase('tamamhealth_patients--org-clinic-a', 'org-clinic-a')!;
    expect(validateGatewayWriteBody(patients, 'DELETE', ['pat-1'], null)).toBeNull();
  });
});
