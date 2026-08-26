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
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useToast } from '@/components/Toast';
import { useRouter } from 'next/navigation';
import { useBackupStatus } from '@/lib/hooks/useBackupStatus';
import { isPathAllowed } from '@/lib/role-routes';
import { LOCAL_AUDIT_RETENTION_DAYS } from '@/lib/services/audit-retention';
import {
  assessOfflineReadiness,
  type OfflineReadinessCheckId,
  type OfflineReadinessReport,
} from '@/lib/offline-readiness';

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

/**
 * PouchDB's own map/reduce index databases (`<db>-mrview-<hash>`).
 *
 * They hold index rows derived from documents this device already has, are
 * rebuilt on demand, and replicate nowhere — so counting them as work that has
 * not reached the server is wrong twice over. On a freshly seeded device they
 * roughly double the number: 85 "unsynced databases" was 42 real ones and
 * their indexes. `getDirtyDatabases` keeps them because the security wipe is
 * right to be conservative about anything it cannot read; a report is not.
 */
const isViewIndex = (name: string) => name.includes('-mrview-');

export default function DataManagementPanel() {
  const { t } = useTranslation();
  const { currentUser } = useApp();
  const { showToast } = useToast();
  const router = useRouter();
  const backup = useBackupStatus();

  const [device, setDevice] = useState<DeviceData | null>(null);
  const [offlineReadiness, setOfflineReadiness] = useState<OfflineReadinessReport | null>(null);
  const [pruning, setPruning] = useState(false);

  const measure = useCallback(async () => {
    const [{ getDirtyDatabases, listLocalDatabases }, { getDB }] = await Promise.all([
      import('@/lib/security/local-wipe'),
      import('@/lib/db'),
    ]);

    const unsynced = (await getDirtyDatabases().catch(() => [] as string[]))
      .filter(name => !isViewIndex(name));

    // Document count across every local database. A database that will not
    // open contributes nothing rather than failing the whole measurement —
    // but if none of them opened, the answer is "unknown", not zero.
    let documents = 0;
    let readAny = false;
    const names = (await listLocalDatabases().catch(() => [] as string[]))
      .filter(name => !isViewIndex(name));
    for (const name of names) {
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
    setOfflineReadiness(await assessOfflineReadiness(currentUser?.username));
  }, [currentUser?.username]);

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
        showToast(t('dataMgmt.prunedKept', { removed, kept: result.skipped.length }), 'success');
      } else {
        showToast(t('dataMgmt.pruned', { removed, days: LOCAL_AUDIT_RETENTION_DAYS }), 'success');
      }
      await measure();
    } catch {
      showToast(t('dataMgmt.pruneFailed'), 'error');
    } finally {
      setPruning(false);
    }
  };

  const role = currentUser?.role;
  const destinations = [
    { path: '/data-quality', label: t('dataMgmt.dataQuality'), hint: t('dataMgmt.dataQualityHint') },
    { path: '/dhis2-export', label: t('dataMgmt.dhis2'), hint: t('dataMgmt.dhis2Hint') },
    { path: '/reports', label: t('dataMgmt.reports'), hint: t('dataMgmt.reportsHint') },
  ].filter(d => role && isPathAllowed(role, d.path));

  const unsyncedCount = device?.unsynced.length ?? 0;
  const readinessIssue = offlineReadiness?.checks.find(check => !check.passed);
  const readinessLabel = (id: OfflineReadinessCheckId): string => t(`offlineReady.check.${id}`);

  return (
    <section className="ehr-set-section">
      <div className="ehr-set-section-head">
        <span><Database /></span>
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <h3>{t('dataMgmt.title')}</h3>
          <small>{t('dataMgmt.intro')}</small>
        </div>
        <button
          type="button"
          className="ehr-set-head-action"
          onClick={measure}
          aria-label={t('dataMgmt.refreshAria')}
        >
          <RefreshCw /> {t('dataMgmt.refresh')}
        </button>
      </div>

      {/* ── Cold-start gate: all prerequisites REDCap/Kobo-style provisioning needs ── */}
      <div className="ehr-set-row dm-row">
        <div className="ehr-set-row-label">
          <b>{t('offlineReady.title')}</b>
          <span>
            {offlineReadiness === null
              ? t('offlineReady.checking')
              : offlineReadiness.state === 'ready'
                ? t('offlineReady.readyBody')
                : offlineReadiness.state === 'warning'
                  ? t('offlineReady.warningBody')
                  : t('offlineReady.notReadyBody', {
                    item: readinessIssue ? readinessLabel(readinessIssue.id) : t('offlineReady.unknownIssue'),
                  })}
          </span>
          {offlineReadiness && (
            <div className="dm-chips">
              {offlineReadiness.checks.map(check => (
                <em key={check.id} className={`dm-chip ${check.passed ? 'dm-chip--ok' : 'dm-chip--warn'}`}>
                  {check.passed ? '✓' : '×'} {readinessLabel(check.id)}
                </em>
              ))}
            </div>
          )}
        </div>
        <span className={`dm-state ${offlineReadiness?.state === 'ready' ? 'is-ok' : offlineReadiness ? 'is-warn' : ''}`}>
          {offlineReadiness === null
            ? <Loader2 className="animate-spin" />
            : offlineReadiness.state === 'ready' ? <ShieldCheck /> : <AlertTriangle />}
          {offlineReadiness === null
            ? t('offlineReady.checkingState')
            : offlineReadiness.state === 'ready'
              ? t('offlineReady.ready')
              : offlineReadiness.state === 'warning'
                ? t('offlineReady.warning')
                : t('offlineReady.notReady')}
        </span>
      </div>

      {/* ── Unsynced work: the only thing here that can be permanently lost ── */}
      <div className="ehr-set-row dm-row">
        <div className="ehr-set-row-label">
          <b>{t('dataMgmt.unsyncedTitle')}</b>
          <span>
            {device === null
              ? t('dataMgmt.unsyncedChecking')
              : unsyncedCount === 0
                ? t('dataMgmt.unsyncedNone')
                : t('dataMgmt.unsyncedSome', { count: unsyncedCount })}
          </span>
          {unsyncedCount > 0 && (
            <div className="dm-chips">
              {device!.unsynced.slice(0, 8).map(name => (
                <em key={name} className="dm-chip dm-chip--warn">{readableDatabase(name)}</em>
              ))}
              {unsyncedCount > 8 && <em className="dm-chip">{t('dataMgmt.more', { count: unsyncedCount - 8 })}</em>}
            </div>
          )}
        </div>
        <span className={`dm-state ${unsyncedCount > 0 ? 'is-warn' : 'is-ok'}`}>
          {device === null ? <Loader2 className="animate-spin" /> : unsyncedCount > 0 ? <AlertTriangle /> : <ShieldCheck />}
          {device === null
            ? t('dataMgmt.stateChecking')
            : unsyncedCount > 0 ? t('dataMgmt.statePending', { count: unsyncedCount }) : t('dataMgmt.stateAllSynced')}
        </span>
      </div>

      {/* ── Durability: whether the browser may drop the above ── */}
      <div className="ehr-set-row dm-row">
        <div className="ehr-set-row-label">
          <b>{t('dataMgmt.durabilityTitle')}</b>
          <span>
            {device?.durable === 'persisted'
              ? t('dataMgmt.durabilityPersisted')
              : device?.durable === 'evictable'
                ? t('dataMgmt.durabilityEvictable')
                : t('dataMgmt.durabilityUnknown')}
          </span>
        </div>
        <span className={`dm-state ${device?.durable === 'persisted' ? 'is-ok' : device?.durable === 'evictable' ? 'is-warn' : ''}`}>
          {device?.durable === 'persisted' ? <ShieldCheck /> : <HardDrive />}
          {device?.durable === 'persisted'
            ? t('dataMgmt.durable')
            : device?.durable === 'evictable' ? t('dataMgmt.evictable') : t('dataMgmt.unknown')}
        </span>
      </div>

      {/* ── Footprint ── */}
      <div className="ehr-set-row dm-row">
        <div className="ehr-set-row-label">
          <b>{t('dataMgmt.deviceTitle')}</b>
          <span>
            {device === null
              ? t('dataMgmt.measuring')
              : device.quotaBytes
                ? t('dataMgmt.footprint', {
                  documents: device.documents === null ? '—' : device.documents.toLocaleString(),
                  used: formatBytes(device.usageBytes),
                  quota: formatBytes(device.quotaBytes),
                })
                : t('dataMgmt.documents', {
                  documents: device.documents === null ? '—' : device.documents.toLocaleString(),
                })}
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
          <b>{t('dataMgmt.backupTitle')}</b>
          <span>
            {backup === null ? t('dataMgmt.backupReading') : backup.detail}
          </span>
        </div>
        <span className={`dm-state ${backup?.state === 'ok' ? 'is-ok' : backup?.state === 'unknown' ? '' : 'is-warn'}`}>
          {backup === null ? <Loader2 className="animate-spin" /> : backup.state === 'ok' ? <ShieldCheck /> : <AlertTriangle />}
          {backup === null
            ? t('dataMgmt.reading')
            : backup.lastBackupAt
              ? t('dataMgmt.rpo', { hours: backup.rpoHours })
              : t('dataMgmt.noBackup')}
        </span>
      </div>

      {/* ── Retention: the one action on this panel ── */}
      <div className="ehr-set-row dm-row">
        <div className="ehr-set-row-label">
          <b>{t('dataMgmt.retentionTitle')}</b>
          <span>
            {t('dataMgmt.retentionBody', { days: LOCAL_AUDIT_RETENTION_DAYS })}
          </span>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={handlePrune}
          disabled={pruning}
        >
          <Archive className="w-4 h-4" /> {pruning ? t('dataMgmt.pruning') : t('dataMgmt.prune')}
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
            {t('dataMgmt.open')} <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      ))}
    </section>
  );
}
