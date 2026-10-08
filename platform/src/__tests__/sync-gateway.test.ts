import {
  gatewayRequestAllowed,
  requiresRetainedDeletionCheck,
  resolveGatewayDatabase,
  retainedDeletionAllowed,
  tombstoneParentRev,
  tombstonesInBody,
  validateGatewayWriteBody,
} from '@/lib/sync/sync-gateway';
import { DATABASE_SYNC_CONFIGS } from '@/lib/sync/sync-config';

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

  describe('retained records: messages and conversations', () => {
    const live = (rev: string) => ({ _rev: rev });
    const dead = (rev: string) => ({ _rev: rev, _deleted: true });

    it('checks deletions on the message and conversation databases only', () => {
      const cfg = (name: string) => DATABASE_SYNC_CONFIGS.find(c => c.localName === name)!;
      expect(requiresRetainedDeletionCheck(cfg('tamamhealth_messages'))).toBe(true);
      expect(requiresRetainedDeletionCheck(cfg('tamamhealth_conversations'))).toBe(true);
      expect(requiresRetainedDeletionCheck(cfg('tamamhealth_patients'))).toBe(false);
    });

    it('refuses to delete the only live revision — that is erasing the record', () => {
      expect(retainedDeletionAllowed('2-b', [live('2-b')])).toBe(false);
      expect(retainedDeletionAllowed('2-b', [live('2-b'), dead('3-x')])).toBe(false);
      expect(retainedDeletionAllowed(null, [live('2-b')])).toBe(false);
    });

    it('allows pruning a conflict loser while the winner survives', () => {
      expect(retainedDeletionAllowed('2-b', [live('2-b'), live('2-c')])).toBe(true);
    });

    it('allows a tombstone for a document the server never held or already lost', () => {
      expect(retainedDeletionAllowed('1-a', [])).toBe(true);
      expect(retainedDeletionAllowed('1-a', [dead('2-z')])).toBe(true);
    });

    it('reads the destroyed revision from a replication tombstone and from a plain one', () => {
      expect(tombstoneParentRev({ _rev: '3-ccc', _revisions: { start: 3, ids: ['ccc', 'bbb', 'aaa'] } })).toBe('2-bbb');
      expect(tombstoneParentRev({ _rev: '2-bbb' })).toBe('2-bbb');
      expect(tombstoneParentRev({ _rev: '1-aaa', _revisions: { start: 1, ids: ['aaa'] } })).toBeNull();
    });

    it('finds every tombstone in a push batch by its position', () => {
      const body = { new_edits: false, docs: [
        { _id: 'msg-1', type: 'message' },
        { _id: 'msg-2', _deleted: true, _rev: '2-b', _revisions: { start: 2, ids: ['b', 'a'] } },
      ] };
      expect(tombstonesInBody(body)).toEqual([{ index: 1, id: 'msg-2', parentRev: '1-a' }]);
      expect(tombstonesInBody({ _deleted: true, _rev: '1-a' }, 'msg-9')).toEqual([{ index: 0, id: 'msg-9', parentRev: '1-a' }]);
    });
  });
});
