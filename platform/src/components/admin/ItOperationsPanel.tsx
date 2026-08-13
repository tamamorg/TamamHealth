'use client';

import { useBackupStatus } from '@/lib/hooks/useBackupStatus';

/**
 * IT operations console — health tiles, runnable jobs, console links, data
 * stores, integrations, and workflow controls. Shared by the standalone
 * /it page and the "IT Operations" section inside /system-admin so both
 * surfaces stay identical. Console links are gated per-role against the
 * real route table so nothing navigates somewhere the user would bounce.
 */

import { useEffect, useMemo, useState } from 'react';
import { SettingsLink } from '@/components/settings/SettingsHost';
import { useApp } from '@/lib/context';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { apiFetch } from '@/lib/api-fetch';
import { isPathAllowed } from '@/lib/role-routes';
import {
  Activity, AlertTriangle, CheckCircle2, Database, HardDrive, RefreshCw,
  Server, ShieldCheck, Smartphone, Upload,
} from '@/components/icons/lucide';

interface DbStat {
  key: string;
  label: string;
  count: number;
}

const DB_NAMES = [
  ['tamamhealth_patients', 'Patients'],
  ['tamamhealth_appointments', 'Appointments'],
  ['tamamhealth_medical_records', 'Medical Records'],
  ['tamamhealth_lab_results', 'Lab & Imaging'],
  ['tamamhealth_prescriptions', 'Prescriptions'],
  ['tamamhealth_payments', 'Payments'],
  ['tamamhealth_referrals', 'Referrals'],
  ['tamamhealth_audit_log', 'Audit Log'],
] as const;

const CONSOLE_LINKS = [
  { href: '/data-quality', title: 'Data quality monitor', desc: 'Completeness and validation issues by facility.' },
  { href: '/admin/conflicts', title: 'Conflict queue', desc: 'Reconcile document conflicts from offline edits.' },
  { href: '/facility-settings', title: 'Workflow settings', desc: 'Facility workflow and reporting configuration.' },
  { href: '/settings?panel=sysadmin-apps', title: 'System administration', desc: 'Apps, privileges, metadata, and global properties.' },
];

/** Route the console link's role gate should test — `href` may carry a query. */
const linkPath = (href: string) => href.split('?')[0];

/** Runnable jobs this panel offers — exported so the Settings rail can badge
 *  its "IT Operations" entry without hard-coding a number that drifts. */
export const IT_OPERATIONS_JOB_COUNT = 3;

export default function ItOperationsPanel({ embedded = false }: {
  /** True when hosted inside Settings — hides the self-referential console link. */
  embedded?: boolean;
}) {
  const { currentUser, isOnline, syncPaused, lastSync, syncNow } = useApp();
  const settings = useSettings();
  const [dbStats, setDbStats] = useState<DbStat[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [pushing, setPushing] = useState<'sync' | 'dhis2' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoadingStats(true);
      const { getDB } = await import('@/lib/db');
      const stats = await Promise.all(DB_NAMES.map(async ([key, label]) => {
        try {
          const info = await getDB(key).info();
          return { key, label, count: info.doc_count };
        } catch {
          return { key, label, count: 0 };
        }
      }));
      if (!cancelled) {
        setDbStats(stats);
        setLoadingStats(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  // Single source (KAN-117) — was a localStorage key nothing ever wrote. This
  // panel already handled absence honestly as 'unknown'; it now gets that
  // answer from the same service as every other admin surface, so the four of
  // them can no longer disagree about identical data.
  const backupInfo = useBackupStatus();
  const backupIso = backupInfo?.lastBackupAt ?? null;
  const backupAgeHours = backupInfo?.ageHours == null ? null : Math.floor(backupInfo.ageHours);
  const backupStatus = backupAgeHours === null
    ? 'unknown'
    : backupAgeHours <= settings.itOperations.backupFrequencyHours
      ? 'healthy'
      : backupAgeHours <= settings.itOperations.backupFrequencyHours * 2
        ? 'warning'
        : 'critical';

  const lastSyncAgeMinutes = useMemo(() => {
    if (!lastSync) return null;
    const at = new Date(lastSync).getTime();
    if (Number.isNaN(at)) return null;
    return Math.floor((Date.now() - at) / 60000);
  }, [lastSync]);
  const syncStatus = syncPaused || !isOnline
    ? 'warning'
    : lastSyncAgeMinutes === null
      ? 'unknown'
      : lastSyncAgeMinutes <= settings.itOperations.syncFailureAlertMinutes
        ? 'healthy'
        : 'warning';

  const runLocalSync = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      await syncNow();
      setMessage('Local sync started.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not start sync.');
    } finally {
      setSyncing(false);
    }
  };

  const runServerPush = async (kind: 'sync' | 'dhis2') => {
    setPushing(kind);
    setMessage(null);
    try {
      const res = await apiFetch(kind === 'sync' ? '/api/admin/sync-push' : '/api/admin/dhis2-push', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(body?.error || `Push failed with status ${res.status}.`);
        return;
      }
      setMessage(kind === 'sync' ? `Sync push complete: ${body.pushed ?? 0} pushed.` : `DHIS2 push complete: ${body.dataValues ?? 0} values.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Push failed.');
    } finally {
      setPushing(null);
    }
  };

  const totalDocs = dbStats.reduce((sum, stat) => sum + stat.count, 0);
  const canRunPlatformPush = currentUser?.role === 'super_admin';

  // Only offer consoles this role can actually enter (proxy would bounce
  // anything else); embedded in Settings, the System-administration tile is
  // self-referential — its sections are already in the same rail — so drop it.
  const consoles = CONSOLE_LINKS.filter(c =>
    currentUser && isPathAllowed(currentUser.role, linkPath(c.href))
    && !(embedded && linkPath(c.href) === '/settings'));

  return (
    <div className="it-ops-panel">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-4">
        <HealthCard icon={Activity} title="Sync" status={syncStatus} value={syncPaused ? 'Paused' : isOnline ? 'Online' : 'Offline'} detail={lastSync ? `Last sync ${new Date(lastSync).toLocaleString()}` : 'No sync recorded'} />
        <HealthCard icon={HardDrive} title="Backup" status={backupStatus} value={backupAgeHours === null ? 'None recorded' : `${backupAgeHours}h old`} detail={backupAgeHours === null ? `No backup on this device yet · expected every ${settings.itOperations.backupFrequencyHours}h` : `Expected every ${settings.itOperations.backupFrequencyHours}h`} />
        <HealthCard icon={Smartphone} title="Devices" status={settings.itOperations.requireDeviceRegistration ? 'healthy' : 'warning'} value={settings.itOperations.requireDeviceRegistration ? 'Registration on' : 'Open'} detail={`Review every ${settings.itOperations.deviceReviewDays} days`} />
        <HealthCard icon={ShieldCheck} title="Audit" status="healthy" value={`${settings.itOperations.auditRetentionDays} days`} detail="Retention policy" />
      </div>

      {/* 50/50 split so the seam lines up with the health-card row above
          and the integrations/controls row below. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
        <section className="dash-card overflow-hidden flex flex-col">
          <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Operations Console</h2>
            </div>
            <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{currentUser?.hospitalName || currentUser?.organization?.name || 'Platform'}</span>
          </div>

          {/* Jobs: one full-width row per runnable job, action on the right. */}
          <div className="px-4 pt-3 pb-1">
            <p className="it-group-label">Jobs</p>
          </div>
          <div className="px-4 flex flex-col">
            <JobRow
              icon={RefreshCw}
              label="Start local sync"
              desc="Replicate this device's records with the facility server now."
              busy={syncing}
              onClick={runLocalSync}
            />
            <JobRow
              icon={Upload}
              label="Push sync events"
              desc="Send pending replication events to the country node."
              busy={pushing === 'sync'}
              disabled={!canRunPlatformPush}
              onClick={() => runServerPush('sync')}
            />
            <JobRow
              icon={Upload}
              label="Push DHIS2 export"
              desc="Generate the aggregate dataset and push it to DHIS2."
              busy={pushing === 'dhis2'}
              disabled={!canRunPlatformPush}
              onClick={() => runServerPush('dhis2')}
            />
          </div>
          {message && (
            <div className="mx-4 mt-3 p-3 rounded-lg text-sm font-semibold" style={{ background: 'var(--overlay-subtle)', color: 'var(--text-primary)' }}>
              {message}
            </div>
          )}

          {/* Consoles: descriptive tiles, role-gated. */}
          {consoles.length > 0 && (
            <>
              <div className="px-4 pt-4 pb-1">
                <p className="it-group-label">Consoles</p>
              </div>
              <div className="p-4 pt-1 grid grid-cols-1 md:grid-cols-2 gap-3 mt-auto">
                {/* SettingsLink, not Link: hosted inside Settings these open
                    as another Settings panel; on the standalone /it page the
                    context is absent and they navigate normally. */}
                {consoles.map(c => (
                  <SettingsLink key={c.href} className="it-tile" href={c.href}>
                    <strong>{c.title}</strong>
                    <span>{c.desc}</span>
                  </SettingsLink>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="dash-card overflow-hidden flex flex-col">
          <div className="flex items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Data Stores</h2>
            </div>
            <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{loadingStats ? '…' : `${totalDocs.toLocaleString()} documents`}</span>
          </div>
          <div className="px-4 py-2 flex-1 flex flex-col justify-center">
            {dbStats.map(stat => {
              const maxCount = Math.max(1, ...dbStats.map(s => s.count));
              return (
                <div key={stat.key} className="it-store-row">
                  <span className="it-store-label">{stat.label}</span>
                  <span className="it-store-bar" aria-hidden="true">
                    {/* Zero stays empty — a minimum sliver reads as "some data". */}
                    <i style={{ width: stat.count === 0 ? 0 : `${Math.max(2, Math.round((stat.count / maxCount) * 100))}%` }} />
                  </span>
                  <strong className="it-store-count">{stat.count.toLocaleString()}</strong>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <section className="dash-card overflow-hidden">
          <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Configured Integrations</h2>
          </div>
          <div className="px-4 py-2">
            {settings.itOperations.integrations.map(integration => (
              <div key={integration} className="it-kv-row">
                <span className="flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                  <i className="it-dot" style={{ background: 'var(--color-success)' }} />
                  {integration.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                </span>
                <span className="it-pill">Configured</span>
              </div>
            ))}
          </div>
        </section>
        <section className="dash-card overflow-hidden">
          <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Workflow Controls</h2>
          </div>
          <div className="px-4 py-2">
            {[
              { label: 'Offline mode', value: settings.itOperations.allowOfflineMode ? 'Allowed' : 'Disabled', ok: settings.itOperations.allowOfflineMode },
              { label: 'Device registration', value: settings.itOperations.requireDeviceRegistration ? 'Required' : 'Optional', ok: settings.itOperations.requireDeviceRegistration },
              { label: 'Completeness signoff', value: settings.reporting.requireCompletenessSignoff ? 'Required' : 'Optional', ok: settings.reporting.requireCompletenessSignoff },
              { label: 'Reporting deadline', value: `Day ${settings.reporting.monthlyDeadlineDay}`, ok: true },
            ].map(row => (
              <div key={row.label} className="it-kv-row">
                <span style={{ color: 'var(--text-secondary)' }}>{row.label}</span>
                <strong className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <i className="it-dot" style={{ background: row.ok ? 'var(--color-success)' : 'var(--color-warning)' }} />
                  {row.value}
                </strong>
              </div>
            ))}
          </div>
        </section>
      </div>

      <style>{`
        .it-group-label {
          margin: 0;
          color: var(--text-muted);
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .it-job-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 11px 2px;
          border-bottom: 1px solid var(--border-light);
        }
        .it-job-row:last-child { border-bottom: 0; }
        .it-job-text { min-width: 0; flex: 1; }
        .it-job-text strong {
          display: block;
          color: var(--text-primary);
          font-size: 13px;
          font-weight: 700;
        }
        .it-job-text span {
          display: block;
          margin-top: 1px;
          color: var(--text-muted);
          font-size: 11.5px;
        }
        .it-tile {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 11px 13px;
          border: 1px solid var(--border-light);
          border-radius: 10px;
          background: #fff;
          text-decoration: none;
        }
        .it-tile:hover { border-color: var(--accent-primary); }
        .it-tile strong { color: var(--accent-hover); font-size: 12.5px; font-weight: 800; }
        .it-tile span { color: var(--text-muted); font-size: 11px; }
        .it-store-row {
          display: grid;
          grid-template-columns: minmax(110px, auto) 1fr auto;
          align-items: center;
          gap: 12px;
          padding: 9px 0;
          border-bottom: 1px solid var(--border-light);
        }
        .it-store-row:last-child { border-bottom: 0; }
        .it-store-label { color: var(--text-secondary); font-size: 13px; font-weight: 600; }
        .it-store-bar {
          height: 6px;
          border-radius: 999px;
          background: var(--overlay-subtle);
          overflow: hidden;
        }
        .it-store-bar i { display: block; height: 100%; border-radius: 999px; background: var(--accent-primary); opacity: 0.75; }
        .it-store-count { color: var(--text-primary); font-size: 13px; font-variant-numeric: tabular-nums; text-align: right; }
        .it-kv-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          min-height: 42px;
          border-bottom: 1px solid var(--border-light);
          font-size: 13px;
        }
        .it-kv-row:last-child { border-bottom: 0; }
        .it-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .it-pill {
          display: inline-flex;
          align-items: center;
          min-height: 26px;
          padding: 4px 10px;
          border-radius: 999px;
          background: var(--accent-light);
          color: var(--accent-primary);
          font-size: 11px;
          font-weight: 800;
        }
      `}</style>
    </div>
  );
}

function HealthCard({ icon: Icon, title, status, value, detail }: {
  icon: typeof Activity;
  title: string;
  status: 'healthy' | 'warning' | 'critical' | 'unknown';
  value: string;
  detail: string;
}) {
  const color = status === 'healthy'
    ? 'var(--color-success)'
    : status === 'critical'
      ? 'var(--color-danger)'
      : status === 'warning'
        ? 'var(--color-warning)'
        : 'var(--text-muted)';
  const StatusIcon = status === 'healthy' ? CheckCircle2 : AlertTriangle;
  return (
    <section className="dash-card p-4">
      <div className="flex items-center justify-between mb-3">
        <Icon className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
        <StatusIcon className="w-4 h-4" style={{ color }} />
      </div>
      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{title}</p>
      <p className="text-xl font-bold mt-1" style={{ color: 'var(--text-primary)' }}>{value}</p>
      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{detail}</p>
    </section>
  );
}

function JobRow({ icon: Icon, label, desc, busy, disabled, onClick }: {
  icon: typeof RefreshCw;
  label: string;
  desc: string;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="it-job-row">
      <Icon className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />
      <span className="it-job-text">
        <strong>{label}</strong>
        <span>{disabled ? 'Requires platform administrator access' : desc}</span>
      </span>
      <button
        type="button"
        onClick={onClick}
        disabled={busy || disabled}
        className="btn btn-secondary btn-sm flex-shrink-0"
        title={disabled ? 'Requires platform administrator access' : undefined}
      >
        {busy ? 'Working…' : 'Run'}
      </button>
    </div>
  );
}
