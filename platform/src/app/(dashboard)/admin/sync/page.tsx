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

export default function AdminSyncPage() {
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
        showToast('Country-node sync is not configured on this facility (SYNC_PUSH_URL unset) — no events pushed.', 'error');
      } else if (result.error) {
        showToast(`Push failed after ${result.pushed} queued: ${result.error}`, 'error');
      } else {
        showToast(`Pushed ${result.pushed}, acknowledged ${result.acknowledged}.`, 'success');
      }
      await loadQueue();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Push to country node failed.', 'error');
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
        showToast(body?.error || `Sync push failed (HTTP ${res.status}).`, 'error');
      } else {
        const pushed = typeof body.pushed === 'number' ? body.pushed : 0;
        const acked = typeof body.acknowledged === 'number' ? body.acknowledged : 0;
        showToast(`Server sync push: pushed ${pushed}, acknowledged ${acked}.`, 'success');
      }
      await loadQueue();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Sync push failed.', 'error');
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
        const msg = body?.result?.message || body?.error || `DHIS2 push failed (HTTP ${res.status}).`;
        showToast(msg, 'error');
      } else {
        const ok = body.result?.ok !== false;
        const values = typeof body.dataValues === 'number' ? body.dataValues : 0;
        showToast(
          ok ? `DHIS2 export pushed — ${values} data values for period ${body.period}.` : (body.result?.message || 'DHIS2 push failed.'),
          ok ? 'success' : 'error',
        );
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'DHIS2 push failed.', 'error');
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
          title="Conflicts"
          action={<SadbHeadLink onClick={() => router.push('/admin/conflicts')}>Open</SadbHeadLink>}
        >
          <SadbKvRow label="Pending reconciliation" value={conflictsError ? '—' : pendingConflicts ?? '…'} />
        </SadbCard>

        <SadbSettingGroup title="Job runners">
          <SadbSettingRow label="Push pending to country node" sub="Pushes up to 50 queued events from this browser to the configured country node.">
            <SadbActionButton onClick={handlePushCountryNode} disabled={anyRunning}>
              {pushingCountryNode ? 'Running…' : 'Run now'}
            </SadbActionButton>
          </SadbSettingRow>
          <SadbSettingRow label="Server sync push" sub="Server-side push of pending sync events to CouchDB.">
            <SadbActionButton onClick={handleSyncPush} disabled={anyRunning}>
              {syncPushing ? 'Running…' : 'Run now'}
            </SadbActionButton>
          </SadbSettingRow>
          <SadbSettingRow label="DHIS2 export push" sub="Exports this reporting period's aggregate data values to DHIS2.">
            <SadbActionButton onClick={handleDhis2Push} disabled={anyRunning}>
              {dhis2Pushing ? 'Running…' : 'Run now'}
            </SadbActionButton>
          </SadbSettingRow>
        </SadbSettingGroup>
      </div>

      <SadbCard
        title="Sync &amp; Jobs"
        meta={(
          <div className="sadb-legend">
            <span><i style={{ background: 'var(--color-warning-600)' }} />Pending ({loading ? '—' : stats?.pending ?? 0})</span>
            <span><i style={{ background: 'var(--accent-primary)' }} />Syncing ({loading ? '—' : stats?.syncing ?? 0})</span>
            <span><i style={{ background: 'var(--color-success-800)' }} />Synced ({loading ? '—' : stats?.synced ?? 0})</span>
            <span><i style={{ background: 'var(--color-danger-500)' }} />Failed ({loading ? '—' : stats?.failed ?? 0})</span>
          </div>
        )}
      >
        <p className="sadb-card-meta" style={{ padding: '2px 16px 10px' }}>
          {loading
            ? 'Loading…'
            : `${events.length} shown${events.length === 100 ? ' (capped at 100)' : ''} · Oldest pending ${formatWhen(stats?.oldestPending)}`}
        </p>
        <SaTable
          columns={[
            { label: 'When', w: 0.9 }, { label: 'Resource', w: 1.5 }, { label: 'Operation', w: 1 },
            { label: 'Facility', w: 1.2 }, { label: 'Status', w: 0.8 }, { label: 'Error', w: 1.8 },
          ]}
          empty={loading ? 'Loading…' : 'Queue is drained — all events synced.'}
          minWidth={760}
        >
          {events.map(ev => (
            <tr key={ev._id}>
              <td>{formatWhen(ev.occurredAt)}</td>
              <td><strong>{ev.resourceType}</strong> <span style={{ color: 'var(--text-muted)' }}>{ev.resourceId.slice(0, 12)}</span></td>
              <td>{ev.operation}</td>
              <td>{(ev.hospitalId && hospitalNames.get(ev.hospitalId)) || ev.hospitalId || '—'}</td>
              <td><SadbChip tone={STATUS_CHIP[ev.syncStatus]}>{ev.syncStatus}</SadbChip></td>
              <td>{ev.syncError || '—'}</td>
            </tr>
          ))}
        </SaTable>
      </SadbCard>
    </SadbPage>
  );
}
