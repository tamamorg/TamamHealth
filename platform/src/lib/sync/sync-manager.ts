/**
 * Sync Manager — coordinates PouchDB ↔ CouchDB sync across all databases.
 *
 * Usage:
 *   const manager = new SyncManager({ orgId: 'org-123', onChange: cb });
 *   manager.startAll();    // begin syncing all databases
 *   manager.stopAll();     // tear down on logout
 *   manager.syncNow();     // force one-time sync
 */

import { getDB } from '../db';
import { SyncService, type SyncStatus } from './sync-service';
import {
  DATABASE_SYNC_CONFIGS,
  getRemoteUrl,
  getCouchDBUrl,
  isSyncEnabled,
  tenantDatabasesEnabled,
} from './sync-config';

export type AggregateState =
  | 'disabled'
  | 'idle'
  | 'syncing'
  | 'synced'
  | 'error'
  | 'offline'
  /**
   * This tab tried to become the sync leader but another tab in the same
   * origin already holds the Web Lock. Replication is suspended here until
   * that tab closes/refreshes/loses connectivity, at which point the queued
   * lock resolves and this tab transitions to a normal sync state.
   */
  | 'follower';

export interface AggregateStatus {
  state: AggregateState;
  lastSync: string | null;
  totalDocsWritten: number;
  totalDocsRead: number;
  activeDatabases: number;
  errorDatabases: number;
  /** Per-database status keyed by local DB name */
  databases: Record<string, SyncStatus>;
}

/** Web Lock name: one leader per origin (browser limits scope to origin). */
const SYNC_LOCK_NAME = 'tamamhealth-sync';

/**
 * Minimal subset of the Web Locks API we depend on. Typed locally so we don't
 * pull in lib.dom upgrades or fail to compile on older TS lib versions.
 */
interface WebLockManagerLike {
  request: (
    name: string,
    options: { mode?: 'exclusive' | 'shared'; ifAvailable?: boolean; signal?: AbortSignal },
    callback: (lock: unknown | null) => Promise<void> | void
  ) => Promise<unknown>;
}

function getLockManager(): WebLockManagerLike | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as unknown as { locks?: WebLockManagerLike };
  return nav.locks ?? null;
}

import { entitlementFor } from './facility-entitlements';
import type { UserRole } from '../db-types';

export interface SyncManagerOptions {
  orgId?: string;
  /**
   * The signed-in user, used to derive which facilities may be replicated
   * (KAN-95). Omitted means org-wide, which preserves the previous behaviour
   * for callers that have not been updated — those callers are the remaining
   * exposure, not a safe default.
   */
  user?: { role?: UserRole; orgId?: string; hospitalId?: string; facilityIds?: string[] };
  onChange?: (status: AggregateStatus) => void;
}

export class SyncManager {
  private services: Map<string, SyncService> = new Map();
  private statuses: Map<string, SyncStatus> = new Map();
  private orgId?: string;
  private user?: SyncManagerOptions['user'];
  private onChange?: (status: AggregateStatus) => void;
  private _started = false;
  /**
   * True while we hold (or have started, but not yet acquired) the leader
   * Web Lock. Other tabs in the same origin queue on the lock and stay in
   * the 'follower' state until this tab releases it.
   */
  private _leader = false;
  /** Set to true while this tab is queued waiting for the leader to release. */
  private _pendingLeader = false;
  /** lastSync value of the most recent clean settle, to debounce the mark. */
  private _lastCleanPoint: string | null = null;
  /** Resolved once we want to release the lock (on stopAll or destroy). */
  private _lockReleaser: (() => void) | null = null;

  constructor(opts: SyncManagerOptions = {}) {
    this.orgId = opts.orgId;
    this.user = opts.user;
    this.onChange = opts.onChange;
  }

  /** Whether sync is enabled and the manager is running */
  get isRunning(): boolean {
    return this._started;
  }

  /** Whether this tab is the elected sync leader for this origin */
  get isLeader(): boolean {
    return this._leader;
  }

  /** Start live sync for all configured databases */
  startAll(): void {
    if (!isSyncEnabled()) {
      this.notifyChange();
      return;
    }

    // Idempotent: a caller that re-invokes startAll while we're already
    // running (e.g. the gating effect re-firing because a sibling state
    // changed, or React StrictMode double-mounting in dev) must NOT enqueue
    // a second Web Lock request. Without this guard, every redundant call
    // would queue another waiter that re-promotes after we eventually
    // release — producing duplicate SyncService instances and bandwidth.
    if (this._started) return;
    this._started = true;

    const locks = getLockManager();
    if (!locks) {
      // Web Locks API unavailable (very old browser): every tab syncs.
      // This regresses to the previous double-replication behaviour but
      // keeps the app functional. Surface a console warning so it's
      // visible during development.
       
      console.warn(
        '[sync] navigator.locks unavailable; multi-tab leader election disabled. ' +
        'Multiple open tabs will all replicate (more bandwidth, more conflicts).'
      );
      this.startReplications();
      this.notifyChange();
      return;
    }

    // Try to become leader. If another tab already holds the lock, our
    // callback only runs once they release it; until then this tab is in
    // the 'follower' state and does not replicate.
    this._pendingLeader = true;
    this.notifyChange();
    void locks.request(SYNC_LOCK_NAME, { mode: 'exclusive' }, async () => {
      // Stop-before-acquire race: the consumer called stopAll() while we
      // were queued. Release the lock immediately by returning.
      if (!this._started) return;
      this._leader = true;
      this._pendingLeader = false;
      this.startReplications();
      this.notifyChange();
      // Hold the lock until stopAll() resolves this promise.
      await new Promise<void>((resolve) => {
        this._lockReleaser = resolve;
      });
    }).catch((err) => {
      // request() rejects on AbortSignal abort or if the page is closing.
      // In the page-closing case we don't care; otherwise log and surrender
      // leader state.
      if (this._started) {
         
        console.warn('[sync] leader-lock request failed:', err);
      }
      this._leader = false;
      this._pendingLeader = false;
      this.notifyChange();
    });
  }

  /** Spin up the per-DB SyncService instances. Caller has already (or will) become leader. */
  private startReplications(): void {
    const couchdbUrl = getCouchDBUrl();
    const useTenantDatabases = tenantDatabasesEnabled();

    // A single client runs ~76 databases. Left as continuous longpolls, their
    // pull feeds saturate the browser's per-host connection limit and starve
    // push, so new local writes never reach the server. 'poll' pulls release
    // their connection between cycles; push stays live. Overridable for
    // debugging via NEXT_PUBLIC_SYNC_PULL_MODE / NEXT_PUBLIC_SYNC_PULL_INTERVAL_MS.
    const pullMode = process.env.NEXT_PUBLIC_SYNC_PULL_MODE === 'live' ? 'live' : 'poll';
    const parsedInterval = Number(process.env.NEXT_PUBLIC_SYNC_PULL_INTERVAL_MS);
    const pullIntervalMs = Number.isFinite(parsedInterval) && parsedInterval >= 2000
      ? parsedInterval
      : 15000;

    for (const config of DATABASE_SYNC_CONFIGS) {
      const localDB = getDB(config.localName);
      const remoteUrl = getRemoteUrl(config.localName, couchdbUrl, {
        orgScoped: config.orgScoped,
        orgId: this.orgId,
        tenantDatabasesEnabled: useTenantDatabases,
      });

      const service = new SyncService({
        localDB,
        remoteUrl,
        direction: config.direction,
        orgId: config.orgScoped ? this.orgId : undefined,
        // Facility scoping applies only to org-scoped databases; the shared
        // reference databases carry no facility PHI.
        entitlement: config.orgScoped
          ? entitlementFor({ ...this.user, orgId: this.orgId })
          : undefined,
        // Drives the push filter so this device never tries to replicate docs
        // its role may not write (which would wedge the push checkpoint).
        writableRole: this.user?.role,
        pullMode,
        pullIntervalMs,
        onChange: (status) => {
          this.statuses.set(config.localName, status);
          this.notifyChange();
        },
      });

      this.services.set(config.localName, service);
      service.startSync();
    }
  }

  /** Stop all sync services (call on logout) */
  stopAll(): void {
    for (const service of this.services.values()) {
      service.destroy();
    }
    this.services.clear();
    this.statuses.clear();
    this._started = false;
    this._leader = false;
    this._pendingLeader = false;
    // Release the Web Lock so a follower tab can promote.
    if (this._lockReleaser) {
      this._lockReleaser();
      this._lockReleaser = null;
    }
    this.notifyChange();
  }

  /** Force a one-shot sync on all databases */
  async syncNow(): Promise<void> {
    if (!isSyncEnabled()) return;

    const promises = Array.from(this.services.values()).map(service =>
      service.syncNow().catch(() => {
        // Individual failures are tracked per-DB
      })
    );
    await Promise.allSettled(promises);
  }

  /** Get the current aggregate status */
  getStatus(): AggregateStatus {
    if (!isSyncEnabled()) {
      return {
        state: 'disabled',
        lastSync: null,
        totalDocsWritten: 0,
        totalDocsRead: 0,
        activeDatabases: 0,
        errorDatabases: 0,
        databases: {},
      };
    }

    const databases: Record<string, SyncStatus> = {};
    let latestSync: string | null = null;
    let totalDocsWritten = 0;
    let totalDocsRead = 0;
    let activeDatabases = 0;
    let errorDatabases = 0;

    for (const [name, status] of this.statuses) {
      databases[name] = status;
      totalDocsWritten += status.docsWritten;
      totalDocsRead += status.docsRead;

      if (status.lastSync && (!latestSync || status.lastSync > latestSync)) {
        latestSync = status.lastSync;
      }
      if (status.state === 'active' || status.state === 'connecting') {
        activeDatabases++;
      }
      if (status.state === 'error' || status.state === 'denied') {
        errorDatabases++;
      }
    }

    let state: AggregateState;
    // 'follower' takes priority over 'offline' so the user sees the real
    // reason this tab isn't syncing (another tab is leading) — they can act
    // on it. Network status is reported separately in the badge.
    if (this._pendingLeader && !this._leader) {
      state = 'follower';
    } else if (typeof navigator !== 'undefined' && !navigator.onLine) {
      state = 'offline';
    } else if (errorDatabases > 0 && activeDatabases === 0) {
      state = 'error';
    } else if (activeDatabases > 0) {
      state = 'syncing';
    } else if (latestSync) {
      state = 'synced';
    } else {
      state = 'idle';
    }

    return {
      state,
      lastSync: latestSync,
      totalDocsWritten,
      totalDocsRead,
      activeDatabases,
      errorDatabases,
      databases,
    };
  }

  /** Get status for a specific database */
  getDatabaseStatus(dbName: string): SyncStatus | null {
    return this.statuses.get(dbName) || null;
  }

  private notifyChange(): void {
    const status = this.getStatus();
    this.onChange?.(status);
    this.rememberCleanPoint(status);
  }

  /**
   * When every database has settled with nothing in flight and no errors,
   * record where each one had got to. The security wipe reads that mark to
   * tell "already on the server" from "only on this device", and refuses to
   * delete the latter (see lib/security/local-wipe.ts).
   *
   * Fire-and-forget and debounced: it is bookkeeping for a rare event, and
   * notifyChange() runs on every replication tick.
   */
  private rememberCleanPoint(status: AggregateStatus): void {
    if (status.state !== 'synced') return;
    if (status.activeDatabases > 0 || status.errorDatabases > 0) return;
    if (status.lastSync === this._lastCleanPoint) return;
    this._lastCleanPoint = status.lastSync;
    void import('../security/local-wipe')
      .then(({ recordSyncedSequences }) => recordSyncedSequences())
      .then(() => {
        // A clean point is the only moment retention pruning can run: it is
        // exactly when every local audit entry is known to be upstream. The
        // push-only trails are never pulled back, so without this a tablet
        // that stays signed in grows without bound.
        return import('../services/audit-retention')
          .then(({ pruneLocalAuditTrails }) => pruneLocalAuditTrails());
      })
      .catch(() => {
        // Bookkeeping only. Failing here leaves databases looking dirty,
        // which keeps data rather than losing it.
      });
  }
}

// Singleton instance — created once, shared across the app
let _instance: SyncManager | null = null;

export function getSyncManager(): SyncManager | null {
  return _instance;
}

export function createSyncManager(opts: SyncManagerOptions): SyncManager {
  if (_instance) {
    _instance.stopAll();
  }
  _instance = new SyncManager(opts);
  return _instance;
}

export function destroySyncManager(): void {
  if (_instance) {
    _instance.stopAll();
    _instance = null;
  }
}
