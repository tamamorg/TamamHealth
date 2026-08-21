/**
 * Sync Service — manages PouchDB ↔ CouchDB live replication for a single database.
 *
 * Features:
 *  - Live replication with retry
 *  - Connection state tracking
 *  - Conflict resolution (latest-write-wins via updatedAt)
 *  - Org-scoped filter replication
 */

import PouchDB from 'pouchdb-browser';
import type { SyncDirection } from './sync-config';
import { enqueueConflict, HIGH_RISK_RESOURCES } from '../services/conflict-service';
import { addBreadcrumb, captureException } from '../observability';
import { markDocsConflicted, markDocsSynced } from './offline-metadata';
import { apiFetch } from '../api-fetch';

export type SyncState = 'idle' | 'connecting' | 'active' | 'paused' | 'error' | 'denied';

/**
 * For each doc that just replicated in, check whether it has competing
 * revisions (`_conflicts`). If the resource type is on the high-risk list,
 * record the conflict so an admin reconciles it via the conflict queue
 * page. Low/medium-risk types fall through to PouchDB's default
 * most-recent-rev-wins behaviour.
 *
 * Exported so it can be unit-tested independently of replication wiring.
 */
export async function surfaceHighRiskConflicts(
  localDB: PouchDB.Database,
  docs: Array<{ _id?: string; _rev?: string }>
): Promise<void> {
  for (const d of docs) {
    const docId = d?._id;
    if (!docId || docId.startsWith('_design/')) continue;
    try {
      const head = (await localDB.get(docId, { conflicts: true })) as PouchDB.Core.IdMeta &
        PouchDB.Core.GetMeta & {
          type?: string;
          patientId?: string;
          orgId?: string;
          countryId?: string;
          _conflicts?: string[];
        };
      const losingRevs = head._conflicts;
      if (!losingRevs || losingRevs.length === 0) continue;
      const resourceType = head.type;
      if (!resourceType || !HIGH_RISK_RESOURCES.has(resourceType)) {
        // Not a tracked high-risk type — let default win-rev resolution stand.
        continue;
      }
      await enqueueConflict({
        resourceType,
        resourceId: docId,
        winningRev: head._rev,
        losingRevs,
        orgId: head.orgId,
        countryId: head.countryId,
      });
    } catch (err) {
      // A 404 here means the doc was deleted between replication landing and
      // our follow-up `get` — there's nothing to surface, so silently move on.
      const status = (err as { status?: number; name?: string } | null)?.status;
      const name = (err as { name?: string } | null)?.name;
      if (status === 404 || name === 'not_found') {
        continue;
      }
      // Don't break replication on conflict-queue errors, but make them visible.
      addBreadcrumb({ category: 'sync', message: 'conflict-queue enqueue failed', level: 'warning', data: { docId } });
      captureException(err, { tag: 'sync.surfaceHighRiskConflicts', docId });
    }
  }
}

export interface SyncStatus {
  state: SyncState;
  lastSync: string | null;
  docsWritten: number;
  docsRead: number;
  error: string | null;
}

import { replicationSelector, type FacilityEntitlement } from './facility-entitlements';

export interface SyncServiceOptions {
  localDB: PouchDB.Database;
  remoteUrl: string;
  direction: SyncDirection;
  /** If provided, only replicate docs where doc.orgId matches */
  orgId?: string;
  /**
   * What the signed-in user may replicate (KAN-95). When present, this becomes
   * a CouchDB selector evaluated SERVER-SIDE, so non-entitled documents never
   * reach the device — unlike the client-side filter function it replaces,
   * which only decided what to keep after the server had already sent it.
   */
  entitlement?: FacilityEntitlement;
  /**
   * The signed-in user's platform role. Used to filter the PUSH stream so the
   * device never tries to replicate documents the CouchDB validator will
   * reject (design-index docs, or clinical types this role may not write —
   * both of which the demo seed plants in every browser). A permanently
   * rejected doc otherwise wedges the push checkpoint: PouchDB will not
   * advance past a batch containing a write failure, so every document created
   * after the rejected one — including new patients — silently stops syncing.
   */
  writableRole?: string;
  /**
   * How the PULL direction runs.
   *  - 'poll'  (default): periodic one-shot pulls that release their HTTP
   *    connection between cycles. This is the fix for push starvation — a
   *    single client runs ~76 databases, and if every pull holds a live
   *    longpoll open, they saturate the browser's ~6-connections-per-host
   *    limit and push never gets a slot to send new local writes.
   *  - 'live': the previous continuous longpoll behaviour (kept as an escape
   *    hatch; do not use with many databases on one client).
   * PUSH always stays live: an idle live push holds no remote connection and
   * only connects to POST when there is a local change, so write-through stays
   * immediate.
   */
  pullMode?: 'poll' | 'live';
  /** Poll interval for pullMode 'poll', in ms (default 15000). */
  pullIntervalMs?: number;
  /** Callback when status changes */
  onChange?: (status: SyncStatus) => void;
}

import { DOC_WRITE_ROLES, isAppendOnlyDatabase } from './write-permissions';

/**
 * Build a PouchDB push filter that drops documents the server would reject:
 *  - every `_design/*` doc (members can't write design docs to CouchDB), and
 *  - any typed doc whose write matrix excludes this role.
 * Untyped docs and types absent from the matrix are dropped. The same-origin
 * gateway fails closed on unknown document types; filtering them here keeps a
 * malformed legacy record from wedging every later write in the checkpoint.
 */
function buildPushFilter(role: string | undefined, appendOnlyDatabase = false) {
  return (doc: { _id?: string; _deleted?: boolean; type?: string }) => {
    if (typeof doc._id === 'string' && doc._id.indexOf('_design/') === 0) return false;
    if (doc._deleted === true) {
      // A tombstone carries no `type`, so the matrix below cannot judge it —
      // but on an append-only database the answer is known from the database
      // alone: the server refuses every deletion there. Offering one would
      // wedge the push checkpoint on a permanent rejection, which is precisely
      // what this filter exists to prevent. Local retention pruning
      // (`audit-retention.ts`) relies on this: it trims the device's copy
      // without ever proposing to trim the server's.
      return !appendOnlyDatabase;
    }
    if (!role || !doc.type) return false;
    const allowed = doc.type ? DOC_WRITE_ROLES[doc.type] : undefined;
    if (!allowed) return false;
    return (allowed as readonly string[]).includes(role);
  };
}

const RETRY_DELAYS = [1000, 2000, 5000, 10000, 30000]; // escalating backoff

export class SyncService {
  private localDB: PouchDB.Database;
  private remoteDB: PouchDB.Database;
  private direction: SyncDirection;
  private orgId?: string;
  private onChange?: (status: SyncStatus) => void;

  private replication: PouchDB.Replication.Sync<object> | PouchDB.Replication.Replication<object> | null = null;
  // For the bidirectional case we run push and pull as two independent live
  // replications rather than db.sync(), so each direction gets its own
  // top-level live/retry and its own scoping (push filter vs pull selector)
  // with no ambiguity about which nested option wins.
  private pushRep: PouchDB.Replication.Replication<object> | null = null;
  private pullRep: PouchDB.Replication.Replication<object> | null = null;
  private readonly selector: Record<string, unknown> | undefined;
  private readonly pushFilter: (doc: { _id?: string; type?: string }) => boolean;
  private readonly pullMode: 'poll' | 'live';
  private readonly pullIntervalMs: number;
  private pullTimer: ReturnType<typeof setTimeout> | null = null;
  private pullCycleRep: PouchDB.Replication.Replication<object> | null = null;
  private stopped = true;
  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private _status: SyncStatus = {
    state: 'idle',
    lastSync: null,
    docsWritten: 0,
    docsRead: 0,
    error: null,
  };

  constructor(opts: SyncServiceOptions) {
    this.localDB = opts.localDB;
    // Per-user auth: the browser already holds an `AuthSession` cookie set by
    // CouchDB's POST /_session during login (see lib/sync/couch-client-auth).
    // PouchDB's default fetch does not opt into credentialled cross-origin
    // requests, so we install one that does. CORS is configured on CouchDB
    // to allow credentials (see scripts/setup-couchdb.sh).
    //
    // No password is embedded in the URL — that closes the previous
    // single-shared-admin model where one stolen device leaked the cluster.
    this.remoteDB = new PouchDB(opts.remoteUrl, {
      skip_setup: true,
      fetch: (url: RequestInfo | URL, requestOpts?: RequestInit) =>
        apiFetch(url, { ...(requestOpts ?? {}), credentials: 'include' }),
    } as PouchDB.Configuration.RemoteDatabaseConfiguration);
    this.direction = opts.direction;
    this.orgId = opts.orgId;
    this.onChange = opts.onChange;
    // Built once: the entitlement cannot change without a new session, and
    // rebuilding it per replication restart would risk the two directions of a
    // bidirectional sync disagreeing about scope.
    this.selector = replicationSelector(
      opts.entitlement ?? { orgId: opts.orgId, facilityIds: [], allFacilities: true },
    );
    // `localDB.name` is the local PouchDB database name, which is exactly the
    // key `isAppendOnlyDatabase` is stated in — the remote may be a tenant
    // database (`…--org-x`), the local one never is.
    this.pushFilter = buildPushFilter(
      opts.writableRole,
      isAppendOnlyDatabase((opts.localDB as { name?: string }).name ?? ''),
    );
    this.pullMode = opts.pullMode ?? 'poll';
    this.pullIntervalMs = opts.pullIntervalMs ?? 15000;
  }

  get status(): SyncStatus {
    return { ...this._status };
  }

  /** Start replication (live push + live-or-polled pull). */
  startSync(): void {
    this.cancelReplication();
    this.stopped = false;
    this.updateStatus({ state: 'connecting', error: null });

    // `live` and `retry` MUST sit at the top level of the sync options — PouchDB
    // reads them there, not inside the per-direction `push`/`pull` sub-objects.
    // Nesting them made the sync one-shot: it drained the initial backlog and
    // then stopped, so documents created afterwards never pushed. The
    // per-direction sub-objects carry ONLY their scoping (selector / filter).
    const liveBase = {
      live: true,
      retry: true,
      batch_size: 100,
      batches_limit: 5,
    } as const;

    // PUSH scoping is a CLIENT-SIDE filter: it drops docs the server would
    // reject (design indexes, non-writable clinical types) before they enter
    // the stream, so a permanently-rejected doc can never wedge the push
    // checkpoint and stall every later document — new patients included.
    const pushDir: PouchDB.Replication.ReplicateOptions = {
      filter: this.pushFilter as unknown as (doc: object) => boolean,
    };

    const startLivePush = () => {
      // Push always stays live: an idle live push holds no remote connection
      // and only connects to POST when there's a local change, so writes reach
      // the server immediately without contributing to connection pressure.
      this.pushRep = this.localDB.replicate.to(this.remoteDB, { ...liveBase, ...pushDir });
      this.attachListeners(this.pushRep);
    };

    const startPull = () => {
      if (this.pullMode === 'poll') {
        // Periodic one-shot pulls that RELEASE their connection between cycles.
        this.scheduleNextPull(Math.floor(Math.random() * this.pullIntervalMs));
      } else {
        this.pullRep = this.localDB.replicate.from(this.remoteDB, {
          ...liveBase,
          ...(this.selector ? { selector: this.selector } : {}),
        });
        this.attachListeners(this.pullRep);
      }
    };

    if (this.direction === 'both') {
      startLivePush();
      startPull();
    } else if (this.direction === 'push') {
      const rep = this.localDB.replicate.to(this.remoteDB, { ...liveBase, ...pushDir });
      this.attachListeners(rep);
      this.replication = rep;
    } else {
      startPull();
    }
  }

  /** Run one non-live pull, then schedule the next. Connection is released
   * as soon as the cycle completes, so pulls don't starve push. */
  private runPullCycle(): void {
    if (this.stopped) return;
    this.updateStatus({ state: 'active', error: null });
    const rep = this.localDB.replicate.from(this.remoteDB, {
      retry: false,
      batch_size: 100,
      batches_limit: 5,
      ...(this.selector ? { selector: this.selector } : {}),
    });
    this.pullCycleRep = rep;
    // Reuse the change handler for status + conflict surfacing, but NOT the
    // error→scheduleRetry path (a one-shot's error just schedules the next poll).
    (rep as unknown as { on: (ev: string, cb: (info: unknown) => void) => void })
      .on('change', (info: unknown) => this.handleReplicationChange(info));
    const done = () => {
      if (this.pullCycleRep === rep) this.pullCycleRep = null;
      if (!this.stopped) {
        this.updateStatus({ state: 'paused', lastSync: new Date().toISOString() });
        this.scheduleNextPull(this.pullIntervalMs);
      }
    };
    Promise.resolve(rep as unknown as Promise<unknown>).then(done, (err: unknown) => {
      // Network blip or transient CouchDB error: don't surface as fatal, just
      // retry on the next cycle. Persistent auth failures are handled by the
      // session heartbeat / refresh path elsewhere.
      const msg = err instanceof Error ? err.message : 'pull error';
      if (!this.stopped) this.updateStatus({ state: 'error', error: msg });
      done();
    });
  }

  private scheduleNextPull(delayMs: number): void {
    if (this.stopped) return;
    this.clearPullTimer();
    this.pullTimer = setTimeout(() => this.runPullCycle(), delayMs);
  }

  private clearPullTimer(): void {
    if (this.pullTimer) {
      clearTimeout(this.pullTimer);
      this.pullTimer = null;
    }
  }

  /** Stop replication */
  stopSync(): void {
    this.stopped = true;
    this.cancelReplication();
    this.clearRetryTimer();
    this.updateStatus({ state: 'idle' });
  }

  /** Force a one-time sync (non-live) and return when complete */
  async syncNow(): Promise<void> {
    const opts: PouchDB.Replication.ReplicateOptions = {
      batch_size: 200,
      ...(this.orgId ? {
        filter: (doc: Record<string, unknown>) => {
          if ((doc._id as string)?.startsWith('_design/')) return true;
          if (!doc.orgId) return true;
          return doc.orgId === this.orgId;
        },
      } : {}),
    };

    this.updateStatus({ state: 'active', error: null });

    try {
      if (this.direction === 'both') {
        const result = await this.localDB.sync(this.remoteDB, opts);
        this.updateStatus({
          state: 'idle',
          lastSync: new Date().toISOString(),
          docsWritten: this._status.docsWritten + (result.push?.docs_written || 0),
          docsRead: this._status.docsRead + (result.pull?.docs_read || 0),
        });
      } else if (this.direction === 'push') {
        const result = await this.localDB.replicate.to(this.remoteDB, opts);
        this.updateStatus({
          state: 'idle',
          lastSync: new Date().toISOString(),
          docsWritten: this._status.docsWritten + (result.docs_written || 0),
        });
      } else {
        const result = await this.localDB.replicate.from(this.remoteDB, opts);
        this.updateStatus({
          state: 'idle',
          lastSync: new Date().toISOString(),
          docsRead: this._status.docsRead + (result.docs_read || 0),
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sync failed';
      this.updateStatus({ state: 'error', error: msg });
      throw err;
    }
  }

  /** Resolve conflicts using latest-write-wins (updatedAt timestamp) */
  async resolveConflicts(docId: string): Promise<void> {
    try {
      const doc = await this.localDB.get(docId, { conflicts: true }) as PouchDB.Core.IdMeta & PouchDB.Core.GetMeta & { updatedAt?: string; _conflicts?: string[] };
      const conflicts = doc._conflicts;
      if (!conflicts || conflicts.length === 0) return;

      // Fetch all conflicting revisions
      const revDocs = await Promise.all(
        conflicts.map(rev => this.localDB.get(docId, { rev }) as Promise<PouchDB.Core.IdMeta & PouchDB.Core.GetMeta & { updatedAt?: string }>)
      );

      // Find the winner: the one with the latest updatedAt
      let winner = doc;
      for (const revDoc of revDocs) {
        if (revDoc.updatedAt && (!winner.updatedAt || revDoc.updatedAt > winner.updatedAt)) {
          winner = revDoc;
        }
      }

      // Delete losing revisions
      const losers = [doc, ...revDocs].filter(d => d._rev !== winner._rev);
      for (const loser of losers) {
        await this.localDB.remove(loser._id, loser._rev);
      }

      // If the winner wasn't the current doc, put it as the new head
      if (winner._rev !== doc._rev) {
        const winnerObj = winner as unknown as Record<string, unknown>;
        const { _rev: _unusedRev, ...data } = winnerObj;
        void _unusedRev;
        await this.localDB.put({ ...data, _id: docId } as PouchDB.Core.PutDocument<object>);
      }
    } catch {
      // Conflict resolution is best-effort
    }
  }

  destroy(): void {
    this.stopSync();
  }

  // --- Private helpers ---

  // Status + conflict-surfacing for a replication 'change' event. Shared by
  // the live replications and the periodic pull cycle.
  private handleReplicationChange(info: unknown): void {
    this.retryCount = 0;
    const changeInfo = info as {
      docs_written?: number;
      docs_read?: number;
      direction?: 'push' | 'pull';
      docs?: Array<{ _id?: string; _rev?: string }>;
      change?: { docs_read?: number; docs_written?: number; docs?: Array<{ _id?: string; _rev?: string }> };
    };
    const docsWritten = changeInfo.docs_written || changeInfo.change?.docs_written || 0;
    const docsRead = changeInfo.docs_read || changeInfo.change?.docs_read || 0;
    const changedDocs = changeInfo.change?.docs ?? changeInfo.docs ?? [];
    this.updateStatus({
      state: 'active',
      lastSync: new Date().toISOString(),
      docsWritten: this._status.docsWritten + docsWritten,
      docsRead: this._status.docsRead + docsRead,
    });

    if ((changeInfo.direction === 'push' || this.direction === 'push') && changedDocs.length > 0) {
      void markDocsSynced(this.localDB, changedDocs).catch(err =>
        captureException(err, { tag: 'sync.markDocsSynced' })
      );
    }

    // Conflict-queue wiring: when sync replication writes a doc into the
    // local DB, PouchDB may have created sibling revisions (a `_conflicts`
    // array on the live head). For high-risk clinical types — allergies,
    // referrals, discharge status, adverse events — silently letting
    // most-recent-rev wins erases real edits that a clinician needs to see.
    // Surface those to the conflict queue so an admin reconciles them.
    // Pull-direction changes carry the docs; ignore push-direction.
    const docsLanded =
      changeInfo.change?.docs ??
      (changeInfo.direction === 'pull' || changeInfo.direction === undefined
        ? changeInfo.docs
        : undefined);
    if (docsLanded && docsLanded.length > 0) {
      // Fire-and-forget; never block replication on conflict-queue writes.
      // Per-doc errors are reported inside surfaceHighRiskConflicts; this
      // outer catch handles any failure of the call as a whole.
      void surfaceHighRiskConflicts(this.localDB, docsLanded).catch(err =>
        captureException(err, { tag: 'sync.surfaceHighRiskConflicts.outer' })
      );
      void markDocsConflicted(this.localDB, docsLanded).catch(err =>
        captureException(err, { tag: 'sync.markDocsConflicted' })
      );
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private attachListeners(rep: any): void {
    rep.on('change', (info: unknown) => this.handleReplicationChange(info));

    rep.on('paused', () => {
      // Paused means replication is up to date (or went offline)
      this.updateStatus({
        state: 'paused',
        lastSync: this._status.lastSync || new Date().toISOString(),
      });
    });

    rep.on('active', () => {
      this.updateStatus({ state: 'active', error: null });
    });

    rep.on('denied', (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Access denied';
      this.updateStatus({ state: 'denied', error: msg });
    });

    rep.on('error', (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Replication error';
      this.updateStatus({ state: 'error', error: msg });
      this.scheduleRetry();
    });

    rep.on('complete', () => {
      // Only fires when replication is cancelled or non-live ends
      if (this._status.state !== 'idle') {
        this.updateStatus({ state: 'idle' });
      }
    });
  }

  private scheduleRetry(): void {
    this.clearRetryTimer();
    const delay = RETRY_DELAYS[Math.min(this.retryCount, RETRY_DELAYS.length - 1)];
    this.retryCount++;
    this.retryTimer = setTimeout(() => {
      this.startSync();
    }, delay);
  }

  private cancelReplication(): void {
    this.clearPullTimer();
    for (const rep of [this.replication, this.pushRep, this.pullRep, this.pullCycleRep]) {
      (rep as { cancel?: () => void } | null)?.cancel?.();
    }
    this.replication = null;
    this.pushRep = null;
    this.pullRep = null;
    this.pullCycleRep = null;
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private updateStatus(partial: Partial<SyncStatus>): void {
    this._status = { ...this._status, ...partial };
    this.onChange?.(this.status);
  }
}
