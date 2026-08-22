/**
 * A document type that no layer knows about cannot replicate.
 *
 * Three lists have to agree before a write leaves the device:
 *
 *   `DATABASE_DOCUMENT_TYPES`  the sync gateway's allowlist per database
 *   `DOC_WRITE_ROLES`          the CouchDB validator's per-type role row
 *   the push filter            drops any type absent from the matrix
 *
 * Miss any one and the write still succeeds — against the local PouchDB
 * replica, where it looks saved — and is then refused upstream or never even
 * offered. Nothing surfaces an error, because nothing failed on the device.
 *
 * Two types shipped in exactly that state, both written to the hospitals
 * database and listed in neither place:
 *
 *   `system_config`      Settings → System administration. Every app,
 *                        extension, privilege and global-property override an
 *                        admin set was device-local.
 *   `facility_settings`  Facility configuration — registration rules, clinical
 *                        policy, reporting obligations, integrations. Same.
 *
 * These are configuration, so nobody noticed a missing patient; the setting
 * simply did not hold anywhere else, and a second device disagreed with the
 * first about facility policy.
 */
import { DOC_WRITE_ROLES } from '@/lib/sync/write-permissions';
import { DATABASE_DOCUMENT_TYPES, DATABASE_SYNC_CONFIGS } from '@/lib/sync/sync-config';

const SYNCED = new Set(DATABASE_SYNC_CONFIGS.map(config => config.localName));

describe('every storable document type is judgeable', () => {
  it('gives each permitted type a write-roles row', () => {
    // Without a row the generated validator throws "unknown document type" and
    // the push filter refuses to offer the document at all.
    const orphans: string[] = [];
    for (const [database, types] of Object.entries(DATABASE_DOCUMENT_TYPES)) {
      for (const type of types) {
        if (!DOC_WRITE_ROLES[type]) orphans.push(`${database} → ${type}`);
      }
    }
    expect(orphans).toEqual([]);
  });

  it('permits each type in exactly one database', () => {
    // A type accepted by two databases makes "where does this live" ambiguous
    // for readers and for the analytics projection.
    const homes = new Map<string, string[]>();
    for (const [database, types] of Object.entries(DATABASE_DOCUMENT_TYPES)) {
      for (const type of types) homes.set(type, [...(homes.get(type) ?? []), database]);
    }
    const shared = [...homes.entries()].filter(([, dbs]) => dbs.length > 1);
    expect(Object.fromEntries(shared)).toEqual({});
  });

  it('only lists databases that actually replicate', () => {
    const unsynced = Object.keys(DATABASE_DOCUMENT_TYPES).filter(db => !SYNCED.has(db));
    expect(unsynced).toEqual([]);
  });
});

describe('the two configuration types that shipped unregistered', () => {
  // Pinned by name: both were silently device-local, and both are the kind of
  // document nobody notices is missing until two devices disagree.
  it.each(['system_config', 'facility_settings'])('%s can be written and stored', type => {
    expect(DOC_WRITE_ROLES[type]).toBeDefined();
    expect(DOC_WRITE_ROLES[type].length).toBeGreaterThan(0);
    expect(DATABASE_DOCUMENT_TYPES.tamamhealth_hospitals).toContain(type);
  });

  it('keeps both to administrative roles', () => {
    // Facility policy and platform configuration are not clinical writes.
    for (const type of ['system_config', 'facility_settings']) {
      for (const role of ['nurse', 'doctor', 'cashier', 'lab_tech', 'front_desk']) {
        expect(DOC_WRITE_ROLES[type]).not.toContain(role);
      }
      expect(DOC_WRITE_ROLES[type]).toContain('org_admin');
    }
  });
});
