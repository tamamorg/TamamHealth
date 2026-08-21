'use client';

/**
 * Device-side retention for the append-only trails.
 *
 * ## The problem
 *
 * `tamamhealth_audit_log` and `tamamhealth_controlled_substance_log` replicate
 * **push-only**: the device sends entries up and never pulls any back. Nothing
 * ever removed them locally, so a ward tablet that stays signed in accumulates
 * every audit entry it has ever written, for as long as it lives.
 * `auto_compaction` does not help — it reclaims superseded revisions, not
 * documents, and these documents are never superseded.
 *
 * The server keeps the full trail. The device only needs a recent window: the
 * entries are already upstream, and nothing on the device reads them back.
 *
 * ## Why this is safe against the trail it is trimming
 *
 * Deleting locally creates a tombstone, and on a push-only database a tombstone
 * would ordinarily be pushed — which on an append-only trail means asking the
 * server to erase its own audit record. Two things prevent that:
 *
 *   1. The push filter drops tombstones on append-only databases outright
 *      (`sync-service.ts`), so the deletion is never offered.
 *   2. Even if one were, the CouchDB validator refuses to delete an
 *      append-only document (`write-permissions.ts`).
 *
 * The first keeps the push checkpoint healthy; the second is the guarantee.
 *
 * ## And against losing an entry that never reached the server
 *
 * Pruning only runs when the database is **clean** — its `update_seq` matches
 * the sequence recorded at the last successful sync. That is the same test
 * `local-wipe.ts` uses before destroying anything, and for the same reason: an
 * entry that has not replicated is the only copy in existence.
 */

import { getDB } from '../db';
import { getDirtyDatabases } from '../security/local-wipe';

/** How much of each trail a device keeps locally. */
export const LOCAL_AUDIT_RETENTION_DAYS = 90;

/** Push-only trails that are safe to trim locally, and the field holding their date. */
const PRUNABLE_TRAILS: { database: string; timestampField: string }[] = [
  { database: 'tamamhealth_audit_log', timestampField: 'timestamp' },
  { database: 'tamamhealth_controlled_substance_log', timestampField: 'createdAt' },
];

export interface PruneResult {
  /** Documents removed from the device, by database. */
  removed: Record<string, number>;
  /** Databases skipped because they still hold unsynced entries. */
  skipped: string[];
}

const IS_BROWSER = typeof window !== 'undefined';

function cutoffIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/**
 * Trim each device-local trail to the retention window.
 *
 * Never throws: retention is housekeeping, and a device that cannot prune
 * should keep working rather than surface an error to a clinician.
 */
export async function pruneLocalAuditTrails(
  retentionDays: number = LOCAL_AUDIT_RETENTION_DAYS,
): Promise<PruneResult> {
  const result: PruneResult = { removed: {}, skipped: [] };
  if (!IS_BROWSER) return result;

  let dirty: Set<string>;
  try {
    dirty = new Set(await getDirtyDatabases());
  } catch {
    // Cannot prove anything is synced — prune nothing. Unknown means dirty.
    return { removed: {}, skipped: PRUNABLE_TRAILS.map(t => t.database) };
  }

  const cutoff = cutoffIso(retentionDays);

  for (const trail of PRUNABLE_TRAILS) {
    if (dirty.has(trail.database)) {
      result.skipped.push(trail.database);
      continue;
    }
    try {
      const db = getDB(trail.database);
      const rows = await db.allDocs({ include_docs: true });
      const stale = rows.rows
        .map(row => row.doc as (Record<string, unknown> & { _id: string; _rev: string }) | undefined)
        .filter((doc): doc is Record<string, unknown> & { _id: string; _rev: string } => {
          if (!doc || doc._id.startsWith('_design/')) return false;
          const at = doc[trail.timestampField];
          // A record with no usable date is kept: it cannot be proven old, and
          // deleting an audit entry on a guess is the wrong way to be wrong.
          return typeof at === 'string' && at < cutoff;
        });

      if (!stale.length) continue;

      // `_deleted` via bulkDocs rather than remove(): one round trip, and the
      // push filter drops the resulting tombstones before they leave.
      await db.bulkDocs(stale.map(doc => ({
        _id: doc._id,
        _rev: doc._rev,
        _deleted: true,
      })) as unknown as PouchDB.Core.PutDocument<object>[]);
      result.removed[trail.database] = stale.length;
    } catch {
      // A database that will not open or will not bulk-delete is left intact.
      result.skipped.push(trail.database);
    }
  }

  return result;
}
