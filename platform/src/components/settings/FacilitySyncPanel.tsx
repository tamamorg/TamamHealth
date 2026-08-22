'use client';

/**
 * Facility Sync (DHIS2) — the runner, not a status read-out.
 *
 * This is the one place in the app that actually *pushes* this facility's data
 * to the national HMIS: it generates the export for the current period, pushes
 * it, and records the result (including failures, so a later banner cannot go
 * on claiming a stale success).
 *
 * It lived inside /settings/manage's Sync tab, which is reachable only from a
 * footer link in FacilitySettingsView — so the Settings rail could show DHIS2
 * status and offer no way to run it. Lifting it out lets both hosts render the
 * same panel instead of one of them re-implementing the push.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/lib/context';
import { RefreshCw, Check } from '@/components/icons/lucide';
import {
  getDhis2SyncLog, recordDhis2SyncResult, recordDhis2SyncFailure, isDhis2Configured,
  groupDhis2DataValues, type Dhis2SyncLogDoc,
} from '@/lib/services/dhis2-sync-log-service';
import type { DHIS2ExportScope } from '@/lib/services/dhis2-export-service';

export default function FacilitySyncPanel() {
  const { currentUser } = useApp();
  const [syncRunning, setSyncRunning] = useState(false);
  const [dhis2Log, setDhis2Log] = useState<Dhis2SyncLogDoc | null>(null);
  const [dhis2LogLoaded, setDhis2LogLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDhis2SyncLog().then(log => { if (!cancelled) { setDhis2Log(log); setDhis2LogLoaded(true); } });
    return () => { cancelled = true; };
  }, []);

  const dhis2Configured = isDhis2Configured();
  const lastPush = dhis2Log?.lastPush;
  const overallStatus: 'synced' | 'error' | 'pending' =
    !lastPush ? 'pending'
    : lastPush.status === 'pushed' ? 'synced'
    : lastPush.status === 'failed' ? 'error'
    : 'pending';
  const elementGroups = useMemo(
    () => dhis2Log?.lastDataset ? groupDhis2DataValues(dhis2Log.lastDataset.dataValues) : [],
    [dhis2Log],
  );
  const lastSyncedLabel = dhis2Log?.lastSyncedAt
    ? new Date(dhis2Log.lastSyncedAt).toLocaleString()
    : 'Never synced';

  const handleRunSync = useCallback(async () => {
    if (!currentUser) return;
    setSyncRunning(true);
    try {
      const { generateDHIS2Export, pushDataSetToDHIS2 } = await import('@/lib/services/dhis2-export-service');
      const period = new Date().toISOString().slice(0, 7);
      const scope: DHIS2ExportScope = { role: currentUser.role, orgId: currentUser.orgId, hospitalId: currentUser.hospitalId };
      const dataset = await generateDHIS2Export(period, scope);
      const push = await pushDataSetToDHIS2(dataset);
      const log = await recordDhis2SyncResult({ dataset, push });
      setDhis2Log(log);
    } catch (err) {
      // Mark the attempt failed (not just a log line) so the banner shows
      // "error" instead of a stale "synced" from a prior success.
      const log = await recordDhis2SyncFailure((err as Error).message || 'Sync failed');
      setDhis2Log(log);
    } finally {
      setSyncRunning(false);
    }
  }, [currentUser]);

  return (
    <div className="max-w-2xl space-y-5" data-tour="settings-sync-panel">
      {/* Header card */}
      <div className="card-elevated p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>Facility Sync</h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
              Push facility data to the national HMIS (DHIS2). Last synced: {lastSyncedLabel}.
            </p>
            {!dhis2Configured && (
              <p style={{ fontSize: 12, color: 'var(--color-warning-text)', marginTop: 4 }}>
                DHIS2 not configured — Sync Now prepares the export locally but won&apos;t reach a server until NEXT_PUBLIC_DHIS2_BASE_URL is set.
              </p>
            )}
          </div>
          <button
            onClick={handleRunSync}
            disabled={syncRunning}
            className="flex items-center gap-2 btn btn-primary flex-shrink-0"
            style={{ opacity: syncRunning ? 0.7 : 1 }}
          >
            <RefreshCw className={`w-4 h-4 ${syncRunning ? 'animate-spin' : ''}`} />
            {syncRunning ? 'Syncing…' : 'Sync Now'}
          </button>
        </div>

        {/* Status message */}
        {syncRunning ? (
          <div className="mt-4 flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: 'rgba(33,145,208,0.07)', border: '1px solid rgba(33,145,208,0.2)' }}>
            <RefreshCw className="w-4 h-4 animate-spin flex-shrink-0" style={{ color: 'var(--tamamhealth-blue)' }} />
            <span style={{ fontSize: 13, color: 'var(--tamamhealth-blue)', fontWeight: 500 }}>Syncing data to DHIS2…</span>
          </div>
        ) : lastPush && (
          <div
            className="mt-4 flex items-center gap-2 px-4 py-3 rounded-xl"
            style={
              overallStatus === 'synced' ? { background: 'rgba(14, 148, 99,0.08)', border: '1px solid rgba(14, 148, 99,0.2)' }
              : overallStatus === 'error' ? { background: 'rgba(224, 49, 39,0.08)', border: '1px solid rgba(224, 49, 39,0.2)' }
              : { background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }
            }
          >
            {overallStatus === 'synced'
              ? <Check className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-success-text)' }} />
              : <RefreshCw className="w-4 h-4 flex-shrink-0" style={{ color: overallStatus === 'error' ? 'var(--color-danger)' : 'var(--text-muted)' }} />}
            <span style={{ fontSize: 13, fontWeight: 500, color: overallStatus === 'synced' ? 'var(--color-success-text)' : overallStatus === 'error' ? 'var(--color-danger-text)' : 'var(--text-secondary)' }}>
              {lastPush.message}
            </span>
          </div>
        )}
      </div>

      {/* Progress overview */}
      <div className="card-elevated p-5 space-y-1">
        {!dhis2LogLoaded ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading sync status…</p>
        ) : elementGroups.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            No sync has been run yet on this device. Click Sync Now to push this facility&apos;s data to DHIS2.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                {elementGroups.length} data groups from last sync ({dhis2Log?.lastDataset?.period})
              </span>
              <span style={{ fontSize: 12, color: overallStatus === 'error' ? 'var(--color-danger-text)' : 'var(--text-muted)' }}>
                {overallStatus === 'synced' ? 'All pushed' : overallStatus === 'error' ? 'Push failed' : 'Prepared, not pushed'}
              </span>
            </div>
            {/* Progress bar — one atomic push covers every group, so it's all-or-nothing */}
            <div style={{ height: 6, borderRadius: 3, background: 'var(--border-light)', overflow: 'hidden', marginBottom: 16 }}>
              <div style={{ height: '100%', width: overallStatus === 'synced' ? '100%' : '0%', background: overallStatus === 'error' ? 'var(--color-danger)' : 'var(--color-success)', borderRadius: 3, transition: 'width 0.6s ease' }} />
            </div>

            {elementGroups.map(g => {
              const s =
                overallStatus === 'synced' ? { bg: 'rgba(14, 148, 99,0.1)', fg: 'var(--color-success-text)', label: 'Synced' }
                : overallStatus === 'error' ? { bg: 'rgba(224, 49, 39,0.1)', fg: 'var(--color-danger-text)', label: 'Error' }
                : { bg: 'rgba(255, 127, 0,0.1)', fg: 'var(--color-warning-text)', label: 'Pending' };
              return (
                <div key={g.label} className="flex items-start justify-between py-2.5" style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <div className="min-w-0">
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{g.label}</span>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{g.elements.length} indicator{g.elements.length > 1 ? 's' : ''}</p>
                    {overallStatus === 'error' && lastPush && (
                      <p style={{ fontSize: 11, color: 'var(--color-danger-text)', marginTop: 2 }}>{lastPush.message}</p>
                    )}
                  </div>
                  <span className="flex-shrink-0 ms-3 text-[11px] font-semibold px-2.5 py-0.5 rounded-full" style={{ background: s.bg, color: s.fg }}>
                    {s.label}
                  </span>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
