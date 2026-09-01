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
      const current = await db.get(landed._id) as PouchDoc;
      if (isDesignDoc(current)) continue;
      if (current.offlineSync?.status === 'synced' && current.offlineSync.lastSyncedRev === current._rev) {
        continue;
      }
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
