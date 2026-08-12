/**
 * Sync — replication topology (src/lib/sync/sync-config.ts).
 *
 * The direction of each database is a data-safety decision:
 *  - audit trails push only (a device must never overwrite the server's log),
 *  - identity/config pull only (clients read, never author, users/orgs/config),
 *  - the ledger is bidirectional so a clinic charge and a cashier payment
 *    converge.
 * These assertions pin those choices.
 */
import { DATABASE_SYNC_CONFIGS } from '@/lib/sync/sync-config';

const byName = Object.fromEntries(DATABASE_SYNC_CONFIGS.map((c) => [c.localName, c]));

describe('sync directions', () => {
  test('append-only audit trails are push-only', () => {
    expect(byName['tamamhealth_audit_log'].direction).toBe('push');
    expect(byName['tamamhealth_controlled_substance_log'].direction).toBe('push');
    expect(byName['tamamhealth_sync_events'].direction).toBe('push');
  });

  test('identity and configuration are pull-only', () => {
    expect(byName['tamamhealth_users'].direction).toBe('pull');
    expect(byName['tamamhealth_organizations'].direction).toBe('pull');
    expect(byName['tamamhealth_platform_config'].direction).toBe('pull');
    expect(byName['tamamhealth_fee_schedule'].direction).toBe('pull');
  });

  test('the ledger is bidirectional so charges and payments converge', () => {
    expect(byName['tamamhealth_ledger'].direction).toBe('both');
  });

  test('core clinical data is bidirectional', () => {
    for (const db of ['tamamhealth_patients', 'tamamhealth_medical_records', 'tamamhealth_prescriptions', 'tamamhealth_lab_results']) {
      expect(byName[db].direction).toBe('both');
    }
  });

  test('patient feedback has an org-scoped bidirectional source database', () => {
    expect(byName['tamamhealth_patient_feedback']).toEqual({
      localName: 'tamamhealth_patient_feedback',
      direction: 'both',
      orgScoped: true,
    });
  });
});

describe('org scoping', () => {
  test('patient-bearing databases are org-scoped', () => {
    for (const db of ['tamamhealth_patients', 'tamamhealth_medical_records', 'tamamhealth_lab_results', 'tamamhealth_prescriptions']) {
      expect(byName[db].orgScoped).toBe(true);
    }
  });

  test('shared reference data (organizations, platform_config) is NOT org-scoped', () => {
    expect(byName['tamamhealth_organizations'].orgScoped).toBe(false);
    expect(byName['tamamhealth_platform_config'].orgScoped).toBe(false);
  });

  test('every config names a database and a valid direction', () => {
    for (const c of DATABASE_SYNC_CONFIGS) {
      expect(c.localName).toMatch(/^tamamhealth_/);
      expect(['push', 'pull', 'both']).toContain(c.direction);
      expect(typeof c.orgScoped).toBe('boolean');
    }
  });
});
