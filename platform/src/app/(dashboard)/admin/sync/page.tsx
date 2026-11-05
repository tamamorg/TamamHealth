'use client';

/**
 * Super-admin → Sync & Jobs.
 * Operational view of the local sync-event outbox: what's queued for the
 * country node, manual job runners for draining it, and a pointer into the
 * conflict reconciliation queue. All data is read live from PouchDB via
 * sync-event-service — nothing here is fabricated.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  SadbPage, SadbCard, SadbChip, SadbKvRow, SadbHeadLink,
  SadbSettingGroup, SadbSettingRow, SadbActionButton, type ChipTone,
} from '@/components/admin/sadb-ui';
import { SaTable, formatWhen } from '@/components/admin/sa-ui';
import { useToast } from '@/components/Toast';
import { apiFetch } from '@/lib/api-fetch';
import { useHospitals } from '@/lib/hooks/useHospitals';
import {
  getSyncEventStats,
  getPendingSyncEvents,
  pushPendingToCountryNode,
} from '@/lib/services/sync-event-service';
import type { SyncEventDoc } from '@/lib/db-types';
import { describeApiError, describeError } from '@/lib/user-facing-error';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface SyncStats {
  total: number;
  pending: number;
  syncing: number;
  synced: number;
  failed: number;
  oldestPending?: string;
  newestEvent?: string;
}

const STATUS_CHIP: Record<SyncEventDoc['syncStatus'], ChipTone> = {
  pending: 'yellow',
  syncing: 'blue',
  synced: 'green',
  failed: 'red',
};

const STATUS_KEY: Record<SyncEventDoc['syncStatus'], string> = {
  pending: 'billing.ovPending',
  syncing: 'status.syncing',
  synced: 'admin.healthSynced',
  failed: 'admin.statusFailed',
};

export default function AdminSyncPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { showToast } = useToast();
  const { hospitals } = useHospitals();

  const [stats, setStats] = useState<SyncStats | null>(null);
  const [events, setEvents] = useState<SyncEventDoc[]>([]);
  const [loading, setLoading] = useState(true);

  const [pendingConflicts, setPendingConflicts] = useState<number | null>(null);
  const [conflictsError, setConflictsError] = useState(false);

  const [pushingCountryNode, setPushingCountryNode] = useState(false);
  const [syncPushing, setSyncPushing] = useState(false);
  const [dhis2Pushing, setDhis2Pushing] = useState(false);

  const hospitalNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of hospitals) map.set(h._id, h.name);
    return map;
  }, [hospitals]);

  const loadQueue = useCallback(async () => {
    try {
      const [s, ev] = await Promise.all([getSyncEventStats(), getPendingSyncEvents(100)]);
      setStats(s);
      setEvents(ev);
    } catch (err) {
      console.error('Failed to load sync queue', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadConflicts = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/conflicts?status=pending');
      if (!res.ok) { setConflictsError(true); return; }
      const body = await res.json();
      setPendingConflicts(Array.isArray(body.conflicts) ? body.conflicts.length : 0);
      setConflictsError(false);
    } catch {
      setConflictsError(true);
    }
  }, []);

  useEffect(() => { loadQueue(); }, [loadQueue]);
  useEffect(() => { loadConflicts(); }, [loadConflicts]);

  const handlePushCountryNode = async () => {
    setPushingCountryNode(true);
    try {
      const result = await pushPendingToCountryNode(50);
      if (result.skipped) {
        showToast(t('msg.nothingSentNationalSyncIs'), 'error');
      } else if (result.error) {
        showToast(t('msg.syncStoppedAfterRecords', { pushed: result.pushed, value: describeApiError({ error: result.error }, t('adminMgmt.nationalServerRejectedRest')) }), 'error');
      } else {
        showToast(t('msg.syncCompleteSentConfirmedBy', { pushed: result.pushed, acknowledged: result.acknowledged }), 'success');
      }
      await loadQueue();
    } catch (err) {
      showToast(describeError(err, t('msg.notSentToTheNational')), 'error');
    } finally {
      setPushingCountryNode(false);
    }
  };

  const handleSyncPush = async () => {
    setSyncPushing(true);
    try {
      const res = await apiFetch('/api/admin/sync-push', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(describeApiError(body, t('msg.syncNotSentTheServer', { status: res.status })), 'error');
      } else {
        const pushed = typeof body.pushed === 'number' ? body.pushed : 0;
        const acked = typeof body.acknowledged === 'number' ? body.acknowledged : 0;
        showToast(t('msg.syncCompleteSentConfirmedBy2', { pushed, acked }), 'success');
      }
      await loadQueue();
    } catch (err) {
      showToast(describeError(err, t('msg.syncNotSentCheckThe')), 'error');
    } finally {
      setSyncPushing(false);
    }
  };

  const handleDhis2Push = async () => {
    setDhis2Pushing(true);
    try {
      const res = await apiFetch('/api/admin/dhis2-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = body?.result?.message || body?.error || t('adminMgmt.dhisNotSent');
        showToast(msg, 'error');
      } else {
        const ok = body.result?.ok !== false;
        const values = typeof body.dataValues === 'number' ? body.dataValues : 0;
        showToast(
          ok ? t('msg.dhis2ReportSentDataValues', { values, period: body.period }) : (body.result?.message || t('msg.dhis2ReportNotSentCheck')),
          ok ? 'success' : 'error',
        );
      }
    } catch (err) {
      showToast(describeError(err, t('msg.dhis2ReportNotSentCheck')), 'error');
    } finally {
      setDhis2Pushing(false);
    }
  };

  const anyRunning = pushingCountryNode || syncPushing || dhis2Pushing;

  return (
    <SadbPage>
      {/* Actions first: the conflict count and the three runners are what an
          operator comes here to DO; the queue below is the evidence. */}
      <div className="sadb-row-3">
        <SadbCard
          title={t('routeContext.conflicts')}
          action={<SadbHeadLink onClick={() => router.push('/admin/conflicts')}>{t('dashboard.open')}</SadbHeadLink>}
        >
          <SadbKvRow label={t('ui.pendingReconciliation')} value={conflictsError ? '—' : pendingConflicts ?? '…'} />
        </SadbCard>

        <SadbSettingGroup title={t('adminMgmt.runNow')}>
          <SadbSettingRow label={t('ui.pushPendingToCountryNode')} sub={t('adminMgmt.syncCountryNodeSub')}>
            <SadbActionButton onClick={handlePushCountryNode} disabled={anyRunning}>
              {pushingCountryNode ? t('adminMgmt.running') : t('adminMgmt.runNow')}
            </SadbActionButton>
          </SadbSettingRow>
          <SadbSettingRow label={t('ui.serverSyncPush')} sub={t('adminMgmt.syncServerPushSub')}>
            <SadbActionButton onClick={handleSyncPush} disabled={anyRunning}>
              {syncPushing ? t('adminMgmt.running') : t('adminMgmt.runNow')}
            </SadbActionButton>
          </SadbSettingRow>
          <SadbSettingRow label={t('ui.dhis2ExportPush')} sub={t('adminMgmt.syncDhisSub')}>
            <SadbActionButton onClick={handleDhis2Push} disabled={anyRunning}>
              {dhis2Pushing ? t('adminMgmt.running') : t('adminMgmt.runNow')}
            </SadbActionButton>
          </SadbSettingRow>
        </SadbSettingGroup>
      </div>

      <SadbCard
        title={t('adminMgmt.syncQueue')}
        meta={(
          <div className="sadb-legend">
            <span><i style={{ background: 'var(--color-warning-600)' }} />{t('ui.pending2')}{loading ? '—' : stats?.pending ?? 0})</span>
            <span><i style={{ background: 'var(--accent-primary)' }} />{t('ui.syncing')}{loading ? '—' : stats?.syncing ?? 0})</span>
            <span><i style={{ background: 'var(--color-success-800)' }} />{t('ui.synced')}{loading ? '—' : stats?.synced ?? 0})</span>
            <span><i style={{ background: 'var(--color-danger-500)' }} />{t('ui.failed2')}{loading ? '—' : stats?.failed ?? 0})</span>
          </div>
        )}
      >
        <p className="sadb-card-meta" style={{ padding: '2px 16px 10px' }}>
          {loading
            ? t('admin.loading')
            : t(events.length === 100 ? 'adminMgmt.syncShownCapped' : 'adminMgmt.syncShown', { count: events.length, when: formatWhen(stats?.oldestPending) })}
        </p>
        <SaTable
          columns={[
            { label: t('transfers.when'), w: 0.9 }, { label: t('syncConflicts.colResource'), w: 1.5 }, { label: t('history.col.operation'), w: 1 },
            { label: t('births.colFacility'), w: 1.2 }, { label: t('admin.colStatus'), w: 0.8 }, { label: t('toast.error'), w: 1.8 },
          ]}
          empty={loading ? t('admin.loading') : t('adminMgmt.syncNothingWaiting')}
          minWidth={760}
        >
          {events.map(ev => (
            <tr key={ev._id}>
              <td>{formatWhen(ev.occurredAt)}</td>
              <td><strong>{ev.resourceType}</strong> <span style={{ color: 'var(--text-muted)' }}>{ev.resourceId.slice(0, 12)}</span></td>
              <td>{ev.operation}</td>
              <td>{(ev.hospitalId && hospitalNames.get(ev.hospitalId)) || ev.hospitalId || '—'}</td>
              <td><SadbChip tone={STATUS_CHIP[ev.syncStatus]}>{t(STATUS_KEY[ev.syncStatus])}</SadbChip></td>
              <td>{ev.syncError || '—'}</td>
            </tr>
          ))}
        </SaTable>
      </SadbCard>
    </SadbPage>
  );
}
