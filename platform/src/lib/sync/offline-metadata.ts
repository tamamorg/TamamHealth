import type { BaseDoc } from '../db-types';

export type OfflineSyncMeta = NonNullable<BaseDoc['offlineSync']>;

/**
 * True for a doc whose latest write has not reached the server. Shared by
 * every "N pending sync" summary and filter (patients registry, front-desk
 * board) so one screen's count can never disagree with another's.
 *
 * It lived next to the per-row sync chip until that chip was removed
 * (2026-09-01); the counts and the registry filter outlived it.
 */
export function hasUnsyncedWrite(doc?: { offlineSync?: OfflineSyncMeta }): boolean {
  return !!doc?.offlineSync && doc.offlineSync.status !== 'synced';
}

type PouchDoc = BaseDoc & PouchDB.Core.IdMeta & PouchDB.Core.GetMeta;

function isDesignDoc(doc: { _id?: string } | null | undefined): boolean {
  return !!doc?._id?.startsWith('_design/');
}

export function withPendingOfflineSync<T extends BaseDoc>(doc: T, at = new Date().toISOString()): T {
  return {
    ...doc,
    offlineSync: {
      ...(doc.offlineSync || {}),
      status: 'pending',
      lastLocalChangeAt: at,
      error: undefined,
    },
  };
}

export function withFailedOfflineSync<T extends BaseDoc>(doc: T, error: string, at = new Date().toISOString()): T {
  return {
    ...doc,
    offlineSync: {
      ...(doc.offlineSync || {}),
      status: 'failed',
      lastLocalChangeAt: doc.offlineSync?.lastLocalChangeAt || at,
      error,
    },
  };
}

export async function markDocsSynced(
  db: PouchDB.Database,
  docs: Array<{ _id?: string; _rev?: string }>,
  at = new Date().toISOString(),
): Promise<void> {
  for (const landed of docs) {
    if (isDesignDoc(landed) || !landed._id) continue;
    try {
      const current = await db.get(landed._id, { conflicts: true }) as PouchDoc & { _conflicts?: string[] };
      if (isDesignDoc(current)) continue;
      // Already marked: STOP. This write is itself a doc revision that
      // replicates and comes back through the push 'change' event, so without
      // a terminating condition every marked doc re-marks forever — that loop
      // drove seed patients to 4000+ revisions before it was caught. "status
      // is already synced" is the correct terminator because every real edit
      // goes through withPendingOfflineSync and resets the status to pending;
      // comparing lastSyncedRev to the CURRENT rev (the old check) can never
      // be true for the revision this function just created.
      if (current.offlineSync?.status === 'synced') continue;
      // A doc with live sibling revisions belongs to the conflict path — do
      // not paper over it with "synced".
      if (current._conflicts?.length) continue;
      await db.put({
        ...current,
        offlineSync: {
          ...(current.offlineSync || {}),
          status: 'synced',
          lastSyncedAt: at,
          lastSyncedRev: current._rev,
          error: undefined,
        },
        updatedAt: current.updatedAt,
      });
    } catch {
      // Best-effort metadata only; never interrupt replication.
    }
  }
}

export async function markDocsConflicted(
  db: PouchDB.Database,
  docs: Array<{ _id?: string; _rev?: string }>,
  at = new Date().toISOString(),
): Promise<void> {
  for (const landed of docs) {
    if (isDesignDoc(landed) || !landed._id) continue;
    try {
      const current = await db.get(landed._id, { conflicts: true }) as PouchDoc & { _conflicts?: string[] };
      if (!current._conflicts?.length) continue;
      // Already stamped: STOP. Re-stamping writes a new revision, which
      // replicates to every other device, whose own re-stamp replicates
      // back — the cross-device ping-pong that (with the markDocsSynced
      // loop) buried conflicted docs under thousands of revisions.
      if (current.offlineSync?.status === 'conflict') continue;
      await db.put({
        ...current,
        offlineSync: {
          ...(current.offlineSync || {}),
          status: 'conflict',
          error: `${current._conflicts.length} conflicting revision${current._conflicts.length === 1 ? '' : 's'}`,
          lastLocalChangeAt: current.offlineSync?.lastLocalChangeAt || at,
        },
        updatedAt: current.updatedAt,
      });
    } catch {
      // Best-effort metadata only.
    }
  }
}

/**
 * One-time repair for metadata the bugs above left behind: docs whose latest
 * write reached the server long ago but whose `offlineSync.status` still says
 * pending/failed (writes marked before the marking ran reliably), plus docs
 * stamped `conflict` whose sibling revisions have since been resolved.
 *
 * Only correct to run at a moment when the push stream is fully caught up —
 * "everything local is on the server" is the premise that makes flipping a
 * stale `pending` to `synced` truthful. The sync service calls it once per
 * session, from the push replication's first no-error 'paused' (idle) event.
 * Docs that still carry live `_conflicts` keep (or gain) their `conflict`
 * status — healing must not hide a real disagreement.
 *
 * `wouldPush` is the service's push filter: a doc it excludes (a type this
 * role may not write) will never reach the server, so its `pending` is the
 * truth and stays.
 */
export async function healStaleOfflineMetadata(
  db: PouchDB.Database,
  wouldPush?: (doc: { _id?: string; _deleted?: boolean; type?: string; [key: string]: unknown }) => boolean,
  at = new Date().toISOString(),
): Promise<number> {
  const all = await db.allDocs({ include_docs: true, conflicts: true });
  const fixes: PouchDoc[] = [];
  for (const row of all.rows) {
    const doc = row.doc as (PouchDoc & { _conflicts?: string[] }) | undefined;
    if (!doc || isDesignDoc(doc) || !doc.offlineSync) continue;
    const status = doc.offlineSync.status;
    if (doc._conflicts?.length) {
      if (status === 'conflict') continue;
      fixes.push({
        ...doc,
        offlineSync: {
          ...doc.offlineSync,
          status: 'conflict',
          error: `${doc._conflicts.length} conflicting revision${doc._conflicts.length === 1 ? '' : 's'}`,
          lastLocalChangeAt: doc.offlineSync.lastLocalChangeAt || at,
        },
        updatedAt: doc.updatedAt,
      });
      continue;
    }
    if (status === 'synced') continue;
    // PouchDoc has no index signature; the filter's shape is wider on purpose.
    if (wouldPush && !wouldPush(doc as unknown as Parameters<typeof wouldPush>[0])) continue;
    fixes.push({
      ...doc,
      offlineSync: {
        ...doc.offlineSync,
        status: 'synced',
        lastSyncedAt: at,
        lastSyncedRev: doc._rev,
        error: undefined,
      },
      updatedAt: doc.updatedAt,
    });
  }
  if (fixes.length > 0) await db.bulkDocs(fixes as object[]);
  return fixes.length;
}
