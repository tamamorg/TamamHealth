/**
 * Per-role replication filter (security audit 2026-11-05, H2/H6).
 *
 * One org key decrypts every catalogued PHI field on any device that HOLDS the
 * data, so the real barrier is not replicating clinical databases to a role
 * that never reads them. A billing-only role (cashier, medical_biller) must not
 * replicate the clinical-content databases; every clinical/admin role must keep
 * replicating everything it does today (a wrong entry silently breaks a role).
 */
import { databasesForRole } from '@/lib/sync/sync-manager';
import { DATABASE_SYNC_CONFIGS } from '@/lib/sync/sync-config';

const ALL = DATABASE_SYNC_CONFIGS.map(c => c.localName);
const CLINICAL = [
  'tamamhealth_clinical_notes', 'tamamhealth_medical_records', 'tamamhealth_prescriptions',
  'tamamhealth_lab_results', 'tamamhealth_medication_administrations', 'tamamhealth_triage',
];
const BILLING_ONLY = ['cashier', 'medical_biller'];
const KEEPS_FOR_BILLING = [
  'tamamhealth_billing', 'tamamhealth_payments', 'tamamhealth_patients',
  'tamamhealth_appointments', 'tamamhealth_referrals', 'tamamhealth_encounters',
];

describe('databasesForRole', () => {
  it('gives every clinical/admin role (and undefined) the full replicating set', () => {
    for (const role of ['doctor', 'nurse', 'pharmacist', 'lab_tech', 'org_admin', 'super_admin', 'front_desk', 'medical_superintendent', undefined]) {
      const dbs = databasesForRole(role);
      for (const name of ALL) expect(dbs.has(name)).toBe(true);
    }
  });

  it.each(BILLING_ONLY)('withholds clinical-content DBs from %s', (role) => {
    const dbs = databasesForRole(role);
    for (const clinical of CLINICAL) expect(dbs.has(clinical)).toBe(false);
  });

  it.each(BILLING_ONLY)('still gives %s the billing / demographics / workflow DBs it needs', (role) => {
    const dbs = databasesForRole(role);
    for (const keep of KEEPS_FOR_BILLING) expect(dbs.has(keep)).toBe(true);
  });

  it('only withholds the six clinical-content DBs from a billing role — nothing else', () => {
    const cashier = databasesForRole('cashier');
    const withheld = ALL.filter(name => !cashier.has(name));
    expect(withheld.sort()).toEqual([...CLINICAL].sort());
  });
});
