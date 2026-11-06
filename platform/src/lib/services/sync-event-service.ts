/**
 * Sync-event outbox writer.
 *
 * Every clinical mutation should emit a sync_event so downstream consumers
 * (country node ingestion, external integrations, audit pipelines) have a
 * durable, queryable stream of changes separate from PouchDB's internal
 * _changes feed.
 *
 * The writer is best-effort — a failed outbox write never blocks the
 * underlying mutation. Duplicates are harmless (consumers are expected to be
 * idempotent on (resourceType, resourceId, resourceVersion)).
 */
import { syncEventsDB } from '../db';
import type { SyncEventDoc } from '../db-types';
import { findByType } from './db-query';
import { filterByScope, type DataScope } from './data-scope';
import { v4 as uuidv4 } from 'uuid';

export interface SyncEventInput {
  resourceType: string;
  resourceId: string;
  operation: SyncEventDoc['operation'];
  resourceVersion?: string;
  userId?: string;
  username?: string;
  hospitalId?: string;
  orgId?: string;
  countryId?: string;
  payload?: unknown;
}

export async function emitSyncEvent(input: SyncEventInput): Promise<void> {
  try {
    const now = new Date().toISOString();
    const doc: SyncEventDoc = {
      _id: `syncev-${uuidv4()}`,
      type: 'sync_event',
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      operation: input.operation,
      resourceVersion: input.resourceVersion,
      occurredAt: now,
      userId: input.userId,
      username: input.username,
      hospitalId: input.hospitalId,
      orgId: input.orgId,
      countryId: input.countryId,
      syncStatus: 'pending',
      payloadJson: input.payload ? JSON.stringify(input.payload).slice(0, 65536) : undefined,
      createdAt: now,
      updatedAt: now,
    };
    await syncEventsDB().put(doc);
  } catch {
    // Never block the primary mutation on outbox write failures.
  }
}

/**
 * Mark a batch of sync events as synced (called by the country-node push job).
 */
export async function markEventsSynced(eventIds: string[]): Promise<void> {
  const db = syncEventsDB();
  const now = new Date().toISOString();
  for (const id of eventIds) {
    try {
      const doc = await db.get(id) as SyncEventDoc;
      await db.put({ ...doc, syncStatus: 'synced', updatedAt: now });
    } catch {
      // doc may have been deleted — ignore
    }
  }
}

/**
 * Push pending events to a configured country-node endpoint.
 * No-op when SYNC_PUSH_URL is unset — facility still works fully offline.
 *
 * Protocol: POST SYNC_PUSH_URL with JSON body { events: SyncEventDoc[] }.
 * Country node replies 200 with { acceptedIds: string[] } to acknowledge.
 * Shared-secret auth via SYNC_PUSH_SECRET header to prevent spoofed pushes.
 */
export async function pushPendingToCountryNode(batchSize = 200): Promise<{
  pushed: number;
  acknowledged: number;
  skipped: boolean;
  error?: string;
}> {
  const url = process.env.SYNC_PUSH_URL;
  if (!url) return { pushed: 0, acknowledged: 0, skipped: true };

  const pending = await getPendingSyncEvents(batchSize);
  if (pending.length === 0) return { pushed: 0, acknowledged: 0, skipped: false };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.SYNC_PUSH_SECRET ? { 'X-Sync-Secret': process.env.SYNC_PUSH_SECRET } : {}),
      },
      body: JSON.stringify({ events: pending }),
    });
    if (!res.ok) {
      return { pushed: pending.length, acknowledged: 0, skipped: false, error: `HTTP ${res.status}` };
    }
    const body = await res.json().catch(() => ({ acceptedIds: [] }));
    const ids: string[] = Array.isArray(body.acceptedIds) ? body.acceptedIds : [];
    if (ids.length) await markEventsSynced(ids);
    return { pushed: pending.length, acknowledged: ids.length, skipped: false };
  } catch (err) {
    return { pushed: pending.length, acknowledged: 0, skipped: false, error: (err as Error).message };
  }
}

/**
 * Query pending sync events (for a push job or admin view).
 */
export async function getPendingSyncEvents(limit = 500): Promise<SyncEventDoc[]> {
  const db = syncEventsDB();
  // Indexed query on (type, syncStatus). The previous implementation applied
  // `limit` to allDocs BEFORE filtering, so it only ever looked at the first
  // 500 documents in _id order and returned the pending ones among them. Once
  // the database held more than 500 events — which it does almost immediately,
  // since every create/update emits one — a backlog of pending events sitting
  // past that boundary was invisible and never pushed. Filtering in the
  // selector means the limit now bounds the RESULT, which is what the caller
  // asked for.
  return findByType<SyncEventDoc>(
    db,
    'sync_event',
    { syncStatus: 'pending' },
    { limit, indexFields: ['type', 'syncStatus'] },
  );
}

/**
 * Aggregate stats for sync-health UI.
 */
export async function getSyncEventStats(scope?: DataScope): Promise<{
  total: number;
  pending: number;
  syncing: number;
  synced: number;
  failed: number;
  oldestPending?: string;
  newestEvent?: string;
}> {
  const db = syncEventsDB();
  const all = await findByType<SyncEventDoc>(db, 'sync_event');
  // Scope the roll-up to the caller's tenant. filterByScope lets super_admin
  // and government see every org; org_admin / medical_superintendent / hrio are
  // restricted to their own. Without this, /api/admin/sync-health returned a
  // cross-tenant per-facility stat to an org-level admin.
  const docs = scope ? filterByScope(all, scope) : all;

  const stats = {
    total: docs.length,
    pending: 0,
    syncing: 0,
    synced: 0,
    failed: 0,
    oldestPending: undefined as string | undefined,
    newestEvent: undefined as string | undefined,
  };

  for (const d of docs) {
    stats[d.syncStatus] = (stats[d.syncStatus] || 0) + 1;
    if (d.syncStatus === 'pending') {
      if (!stats.oldestPending || d.occurredAt < stats.oldestPending) {
        stats.oldestPending = d.occurredAt;
      }
    }
    if (!stats.newestEvent || d.occurredAt > stats.newestEvent) {
      stats.newestEvent = d.occurredAt;
    }
  }

  return stats;
}
