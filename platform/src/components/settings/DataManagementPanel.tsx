'use client';

/**
 * Data management — where this deployment's data actually is, and what is at
 * risk of being lost.
 *
 * The facts it reports were all computable already and none of them were on a
 * screen. A ward tablet that has been offline for a week is holding the only
 * copy of that week's work; whether the browser considers that storage durable
 * or evictable decides whether it survives storage pressure; and the backup
 * that would make the question moot was reported nowhere outside the Risk
 * Center. Those three answers belong next to each other, because they are one
 * question — "if this device died right now, what would be gone?"
 *
 * Everything here reads real state:
 *   - unsynced work   `getDirtyDatabases()`, the same test the security wipe
 *                     uses before it destroys anything ("unknown means dirty")
 *   - local footprint `navigator.storage.estimate()` and per-database
 *                     `info().doc_count`
 *   - durability      `navigator.storage.persisted()`
 *   - last backup     the server, via useBackupStatus
 *
 * Nothing is simulated, and anything that cannot be measured renders as "—"
 * rather than as a zero that reads like a measurement.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Database, HardDrive, Archive, RefreshCw, ShieldCheck, AlertTriangle, Loader2, ChevronRight,
} from '@/components/icons/lucide';
import { useApp } from '@/lib/context';
import { useToast } from '@/components/Toast';
import { useRouter } from 'next/navigation';
import { useBackupStatus } from '@/lib/hooks/useBackupStatus';
import { isPathAllowed } from '@/lib/role-routes';
import { LOCAL_AUDIT_RETENTION_DAYS } from '@/lib/services/audit-retention';

/** What this device is holding, once it has been measured. */
interface DeviceData {
  /** Databases with writes not proven to have reached the server. */
  unsynced: string[];
  /** Documents across every local database, or null when none could be read. */
  documents: number | null;
  /** Bytes used and granted, when the browser will say. */
  usageBytes: number | null;
  quotaBytes: number | null;
  /** Whether the browser has promised not to evict this data. */
  durable: 'persisted' | 'evictable' | 'unknown';
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** "tamamhealth_lab_results--org-moh-ss" → "Lab results". */
function readableDatabase(name: string): string {
  const base = name.replace(/^tamamhealth_/, '').split('--')[0].replace(/_/g, ' ');
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export default function DataManagementPanel() {
  const { currentUser } = useApp();
  const { showToast } = useToast();
  const router = useRouter();
  const backup = useBackupStatus();

  const [device, setDevice] = useState<DeviceData | null>(null);
  const [pruning, setPruning] = useState(false);

  const measure = useCallback(async () => {
    const [{ getDirtyDatabases, listLocalDatabases }, { getDB }] = await Promise.all([
      import('@/lib/security/local-wipe'),
      import('@/lib/db'),
    ]);

    const unsynced = await getDirtyDatabases().catch(() => [] as string[]);

    // Document count across every local database. A database that will not
    // open contributes nothing rather than failing the whole measurement —
    // but if none of them opened, the answer is "unknown", not zero.
    let documents = 0;
    let readAny = false;
    for (const name of await listLocalDatabases().catch(() => [] as string[])) {
      try {
        const info = await getDB(name).info();
        documents += info.doc_count;
        readAny = true;
      } catch {
        // Unreadable here means unmeasured, not empty.
      }
    }

    let usageBytes: number | null = null;
    let quotaBytes: number | null = null;
    let durable: DeviceData['durable'] = 'unknown';
    if (typeof navigator !== 'undefined' && navigator.storage) {
      try {
        const estimate = await navigator.storage.estimate?.();
        usageBytes = estimate?.usage ?? null;
        quotaBytes = estimate?.quota ?? null;
      } catch { /* Private mode throws; leave both unknown. */ }
      try {
        const persisted = await navigator.storage.persisted?.();
        if (persisted !== undefined) durable = persisted ? 'persisted' : 'evictable';
      } catch { /* Same. */ }
    }

    setDevice({ unsynced, documents: readAny ? documents : null, usageBytes, quotaBytes, durable });
  }, []);

  useEffect(() => { measure(); }, [measure]);

  const handlePrune = async () => {
    setPruning(true);
    try {
      const { pruneLocalAuditTrails } = await import('@/lib/services/audit-retention');
      const result = await pruneLocalAuditTrails();
      const removed = Object.values(result.removed).reduce((sum, n) => sum + n, 0);
      // Skipped is not a failure — it is the guarantee working. A trail with
      // unsynced entries is the only copy of them, so it is never trimmed.
      if (result.skipped.length > 0) {
        showToast(
          `Removed ${removed} entries. ${result.skipped.length} trail(s) still hold unsynced entries and were kept.`,
          'success',
        );
      } else {
        showToast(`Removed ${removed} entries older than ${LOCAL_AUDIT_RETENTION_DAYS} days.`, 'success');
      }
      await measure();
    } catch {
      showToast('Could not prune the local trails.', 'error');
    } finally {
      setPruning(false);
    }
  };

  const role = currentUser?.role;
  const destinations = [
    { path: '/data-quality', label: 'Data quality', hint: 'Completeness and validity of what this facility has recorded.' },
    { path: '/dhis2-export', label: 'DHIS2 export', hint: 'Aggregate reporting to the national HMIS.' },
    { path: '/reports', label: 'Reports', hint: 'Scheduled and ad-hoc extracts.' },
  ].filter(d => role && isPathAllowed(role, d.path));

  const unsyncedCount = device?.unsynced.length ?? 0;

  return (
    <section className="ehr-set-section">
      <div className="ehr-set-section-head">
        <span><Database /></span>
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <h3>Data management</h3>
          <small>Where this deployment&apos;s data is, and what has not been backed up yet</small>
        </div>
        <button
          type="button"
          className="ehr-set-head-action"
          onClick={measure}
          aria-label="Re-measure this device"
        >
          <RefreshCw /> Refresh
        </button>
      </div>

      {/* ── Unsynced work: the only thing here that can be permanently lost ── */}
      <div className="ehr-set-row dm-row">
        <div className="ehr-set-row-label">
          <b>Work not yet on the server</b>
          <span>
            {device === null
              ? 'Checking every local database…'
              : unsyncedCount === 0
                ? 'Every local database matches the last completed sync.'
                : `${unsyncedCount} database(s) hold writes that have not been proven to reach the server. `
                  + 'Unknown counts as unsynced — a database that cannot be read is treated as holding work.'}
          </span>
          {unsyncedCount > 0 && (
            <div className="dm-chips">
              {device!.unsynced.slice(0, 8).map(name => (
                <em key={name} className="dm-chip dm-chip--warn">{readableDatabase(name)}</em>
              ))}
              {unsyncedCount > 8 && <em className="dm-chip">+{unsyncedCount - 8} more</em>}
            </div>
          )}
        </div>
        <span className={`dm-state ${unsyncedCount > 0 ? 'is-warn' : 'is-ok'}`}>
          {device === null ? <Loader2 className="animate-spin" /> : unsyncedCount > 0 ? <AlertTriangle /> : <ShieldCheck />}
          {device === null ? 'Checking' : unsyncedCount > 0 ? `${unsyncedCount} pending` : 'All synced'}
        </span>
      </div>

      {/* ── Durability: whether the browser may drop the above ── */}
      <div className="ehr-set-row dm-row">
        <div className="ehr-set-row-label">
          <b>Local storage durability</b>
          <span>
            {device?.durable === 'persisted'
              ? 'The browser has granted durable storage — records are not dropped under storage pressure.'
              : device?.durable === 'evictable'
                ? 'Storage is evictable. Under pressure the browser may drop unsynced records, so sync this device regularly.'
                : 'This browser does not report whether storage is durable.'}
          </span>
        </div>
        <span className={`dm-state ${device?.durable === 'persisted' ? 'is-ok' : device?.durable === 'evictable' ? 'is-warn' : ''}`}>
          {device?.durable === 'persisted' ? <ShieldCheck /> : <HardDrive />}
          {device?.durable === 'persisted' ? 'Durable' : device?.durable === 'evictable' ? 'Evictable' : 'Unknown'}
        </span>
      </div>

      {/* ── Footprint ── */}
      <div className="ehr-set-row dm-row">
        <div className="ehr-set-row-label">
          <b>On this device</b>
          <span>
            {device === null
              ? 'Measuring…'
              : `${device.documents === null ? '—' : device.documents.toLocaleString()} documents`
                + `${device.quotaBytes ? ` · ${formatBytes(device.usageBytes)} of ${formatBytes(device.quotaBytes)} granted` : ''}`}
          </span>
        </div>
        <span className="dm-state">
          <Database />
          {formatBytes(device?.usageBytes ?? null)}
        </span>
      </div>

      {/* ── Backup: the answer that makes the rest survivable ── */}
      <div className="ehr-set-row dm-row">
        <div className="ehr-set-row-label">
          <b>Server backup</b>
          <span>
            {backup === null
              ? 'Reading backup status…'
              : backup.detail}
          </span>
        </div>
        <span className={`dm-state ${backup?.state === 'ok' ? 'is-ok' : backup?.state === 'unknown' ? '' : 'is-warn'}`}>
          {backup === null ? <Loader2 className="animate-spin" /> : backup.state === 'ok' ? <ShieldCheck /> : <AlertTriangle />}
          {backup === null
            ? 'Reading'
            : backup.lastBackupAt
              ? `RPO ${backup.rpoHours}h`
              : 'No backup on record'}
        </span>
      </div>

      {/* ── Retention: the one action on this panel ── */}
      <div className="ehr-set-row dm-row">
        <div className="ehr-set-row-label">
          <b>Local trail retention</b>
          <span>
            The audit and controlled-substance trails replicate one way and are kept on the server in
            full. This device keeps the last {LOCAL_AUDIT_RETENTION_DAYS} days. Pruning skips any trail
            still holding unsynced entries — those are the only copy in existence.
          </span>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={handlePrune}
          disabled={pruning}
        >
          <Archive className="w-4 h-4" /> {pruning ? 'Pruning…' : 'Prune now'}
        </button>
      </div>

      {/* ── Where the data goes next ── */}
      {destinations.map(dest => (
        <div key={dest.path} className="ehr-set-row dm-row">
          <div className="ehr-set-row-label">
            <b>{dest.label}</b>
            <span>{dest.hint}</span>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => router.push(dest.path)}
          >
            Open <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      ))}
    </section>
  );
}
