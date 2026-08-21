/**
 * The append-only rule is enforced in three places, and all three have to agree.
 *
 *   1. `APPEND_ONLY_TYPES`        — compiled into the CouchDB validator, which
 *                                   refuses to amend or delete an entry.
 *   2. `APPEND_ONLY_DATABASES`    — derived in the sync gateway, which refuses
 *                                   to forward a deletion at all.
 *   3. `ConflictPolicy.APPEND_ONLY` — in the Postgres projection, which refuses
 *                                   to overwrite or delete the national copy.
 *
 * Two of those are derived from the first, so the drift risk is between the
 * CouchDB list and the Postgres one: they were written at different times for
 * different reasons and neither imports the other. A type protected in CouchDB
 * but not in Postgres leaves the national record erasable; the reverse leaves
 * the store of record erasable, which is worse. Assert they name the same
 * trails.
 */
import { APPEND_ONLY_TYPES } from '@/lib/sync/write-permissions';
import { DATABASE_DOCUMENT_TYPES } from '@/lib/sync/sync-config';
import { ConflictPolicy, TABLE_CONFLICT_POLICY } from '@/lib/db/postgres';

/**
 * CouchDB doc `type` → Postgres table, for the append-only trails only.
 *
 * Deliberately hand-written and tiny: `DB_TABLE_MAP` lives inside an API route
 * module that pulls in the whole `pg` stack, and this file only needs three
 * entries. The test below fails if a fourth append-only type appears without
 * one, which is the reminder to add it.
 */
const TABLE_FOR_TYPE: Record<string, string> = {
  audit_log: 'audit_log',
  controlled_substance_log: 'controlled_substance_log',
  ledger_entry: 'ledger_entries',
};

describe('append-only parity across the three enforcement layers', () => {
  it('names a Postgres table for every append-only document type', () => {
    for (const type of APPEND_ONLY_TYPES) {
      expect(TABLE_FOR_TYPE[type]).toBeDefined();
    }
  });

  it('marks each of those tables APPEND_ONLY in the Postgres conflict policy', () => {
    for (const type of APPEND_ONLY_TYPES) {
      expect(TABLE_CONFLICT_POLICY[TABLE_FOR_TYPE[type]]).toBe(ConflictPolicy.APPEND_ONLY);
    }
  });

  it('protects every table Postgres treats as append-only in CouchDB too', () => {
    const postgresAppendOnly = Object.entries(TABLE_CONFLICT_POLICY)
      .filter(([, policy]) => policy === ConflictPolicy.APPEND_ONLY)
      .map(([table]) => table)
      .sort();
    const couchAppendOnly = APPEND_ONLY_TYPES
      .map(type => TABLE_FOR_TYPE[type])
      .sort();
    expect(couchAppendOnly).toEqual(postgresAppendOnly);
  });

  it('gives each append-only type a database of its own', () => {
    // The gateway's database-level delete block only works when a database
    // holds nothing but append-only types — a mixed database would have to let
    // deletions through for the sake of the other types it carries.
    for (const type of APPEND_ONLY_TYPES) {
      const hosts = Object.entries(DATABASE_DOCUMENT_TYPES)
        .filter(([, types]) => types.includes(type))
        .map(([database, types]) => ({ database, types }));
      expect(hosts).toHaveLength(1);
      expect(hosts[0].types).toEqual([type]);
    }
  });
});
