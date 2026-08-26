'use client';

/**
 * Facility Sync (DHIS2) — the runner, and the one owner of the sync log.
 *
 * This is the only place in the app that actually *pushes* this facility's
 * data to the national HMIS: it generates the export for the current period,
 * pushes it, and records the result (including failures, so a later banner
 * cannot go on claiming a stale success).
 *
 * It used to render a full card of its own — a heading that repeated the
 * status grid above it, a "not configured" warning the DHIS2 status cell
 * already carried, a banner echoing the last push message, and a second card
 * whose only content when nothing had run was a sentence saying so. Meanwhile
 * the Settings screen loaded the same sync log a second time for its status
 * grid, so after a push one of the two readings went stale.
 *
 * So: `useFacilitySync` is the single owner of that state, the action is a
 * button the host puts in its own header, and the detail renders nothing at
 * all until there is something to show.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/context';
import { RefreshCw, Check } from '@/components/icons/lucide';
import {
  getDhis2SyncLog, recordDhis2SyncResult, recordDhis2SyncFailure, isDhis2Configured,
  groupDhis2DataValues, type Dhis2SyncLogDoc,
} from '@/lib/services/dhis2-sync-log-service';
import type { DHIS2ExportScope } from '@/lib/services/dhis2-export-service';

export type FacilitySyncStatus = 'synced' | 'error' | 'pending';

export interface FacilitySync {
  running: boolean;
  loaded: boolean;
  configured: boolean;
  log: Dhis2SyncLogDoc | null;
  lastPush: Dhis2SyncLogDoc['lastPush'] | undefined;
  status: FacilitySyncStatus;
  lastSyncedLabel: string;
  elementGroups: ReturnType<typeof groupDhis2DataValues>;
  run: () => Promise<void>;
}

/**
 * Own the DHIS2 sync log once. Any host that shows sync status AND offers the
 * push must share one of these, or the button updates a copy of the state the
 * status read-out is not looking at.
 */
export function useFacilitySync(): FacilitySync {
  const { currentUser } = useAuth();
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<Dhis2SyncLogDoc | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDhis2SyncLog().then(next => { if (!cancelled) { setLog(next); setLoaded(true); } });
    return () => { cancelled = true; };
  }, []);

  const lastPush = log?.lastPush;
  const status: FacilitySyncStatus =
    !lastPush ? 'pending'
    : lastPush.status === 'pushed' ? 'synced'
    : lastPush.status === 'failed' ? 'error'
    : 'pending';

  const elementGroups = useMemo(
    () => (log?.lastDataset ? groupDhis2DataValues(log.lastDataset.dataValues) : []),
    [log],
  );

  const run = useCallback(async () => {
    if (!currentUser) return;
    setRunning(true);
    try {
      const { generateDHIS2Export, pushDataSetToDHIS2 } = await import('@/lib/services/dhis2-export-service');
      const period = new Date().toISOString().slice(0, 7);
      const scope: DHIS2ExportScope = { role: currentUser.role, orgId: currentUser.orgId, hospitalId: currentUser.hospitalId };
      const dataset = await generateDHIS2Export(period, scope);
      const push = await pushDataSetToDHIS2(dataset);
      setLog(await recordDhis2SyncResult({ dataset, push }));
    } catch (err) {
      // Mark the attempt failed (not just a log line) so the status shows
      // "error" instead of a stale "synced" from a prior success.
      setLog(await recordDhis2SyncFailure((err as Error).message || 'Sync failed'));
    } finally {
      setRunning(false);
    }
  }, [currentUser]);

  return {
    running, loaded, configured: isDhis2Configured(), log, lastPush,
    status, elementGroups, run,
    lastSyncedLabel: log?.lastSyncedAt ? new Date(log.lastSyncedAt).toLocaleString() : 'Never synced',
  };
}

/** The action, sized to sit in a section header rather than own a card. */
export function FacilitySyncButton({ sync }: { sync: FacilitySync }) {
  return (
    <button
      type="button"
      onClick={sync.run}
      disabled={sync.running}
      className="ehr-set-head-action"
      data-action="run-facility-sync"
      /* The header has no room to explain itself, so the reason the push may
         not reach a server lives in the tooltip rather than as a warning
         paragraph duplicating the DHIS2 status cell. */
      title={sync.configured
        ? `Push this facility's data to DHIS2. Last synced: ${sync.lastSyncedLabel}.`
        : 'DHIS2 is not configured — this prepares the export locally but will not reach a server.'}
    >
      <RefreshCw className={sync.running ? 'animate-spin' : undefined} />
      {sync.running ? 'Syncing…' : 'Sync now'}
    </button>
  );
}

/**
 * What the last push actually contained. Renders NOTHING until a sync has run
 * — an empty card explaining that a list is empty is the thing this page had
 * too much of.
 */
export function FacilitySyncDetail({ sync }: { sync: FacilitySync }) {
  if (!sync.loaded || sync.elementGroups.length === 0) return null;
  const { status, elementGroups, log, lastPush } = sync;

  return (
    <section className="ehr-set-section">
      <div className="ehr-set-section-head">
        <span><Check /></span>
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <h3>Last push to DHIS2</h3>
          <small>
            {elementGroups.length} data group{elementGroups.length > 1 ? 's' : ''}
            {log?.lastDataset?.period ? ` · ${log.lastDataset.period}` : ''}
            {' · '}
            {status === 'synced' ? 'All pushed' : status === 'error' ? 'Push failed' : 'Prepared, not pushed'}
          </small>
        </div>
      </div>
      <div className="ehr-set-rows">
        {elementGroups.map(g => (
          <div key={g.label} className="ehr-set-row">
            <div className="ehr-set-row-label">
              <b>{g.label}</b>
              <small>
                {g.elements.length} indicator{g.elements.length > 1 ? 's' : ''}
                {status === 'error' && lastPush?.message ? ` · ${lastPush.message}` : ''}
              </small>
            </div>
            <i className="ehr-set-int-pill" data-tone={status === 'synced' ? 'green' : status === 'error' ? 'red' : 'yellow'}>
              {status === 'synced' ? 'Synced' : status === 'error' ? 'Error' : 'Pending'}
            </i>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Standalone host (the /settings/manage Sync tab), which has no header of its
 * own to hang the action on.
 */
export default function FacilitySyncPanel() {
  const sync = useFacilitySync();
  return (
    <div data-tour="settings-sync-panel">
      <section className="ehr-set-section">
        <div className="ehr-set-section-head">
          <span><RefreshCw /></span>
          <div style={{ minWidth: 0, flex: '1 1 auto' }}>
            <h3>Facility sync</h3>
            <small>Push this facility&rsquo;s data to the national HMIS · {sync.lastSyncedLabel}</small>
          </div>
          <FacilitySyncButton sync={sync} />
        </div>
        {!sync.loaded ? (
          <p className="ehr-set-note">Loading sync status…</p>
        ) : sync.elementGroups.length === 0 ? (
          <p className="ehr-set-note">
            Nothing has been pushed from this device yet. Sync now prepares this facility&rsquo;s
            current period and sends it.
          </p>
        ) : null}
      </section>
      <FacilitySyncDetail sync={sync} />
    </div>
  );
}
