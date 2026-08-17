'use client';

/**
 * Super-admin → Interoperability.
 * Honest inventory of the integrations that actually exist in this codebase
 * — DHIS2 aggregate export, country-node document replication, and the
 * platform REST API gate. No FHIR/webhook endpoints are wired up yet, so
 * those are shown as explicit "none registered" status cards rather than
 * omitted or invented.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  SadbPage, SadbCard, SadbStatusCard, SadbHeadLink, SadbKvRow, TONE_CHIP,
} from '@/components/admin/sadb-ui';
import { SaPill, SaTable, formatWhen } from '@/components/admin/sa-ui';
import { useToast } from '@/components/Toast';
import { usePlatformConfig } from '@/lib/hooks/usePlatformConfig';
import {
  getDhis2SyncLog, isDhis2Configured, getDhis2BaseUrlHost, isFullySynced,
  type Dhis2SyncLogDoc,
} from '@/lib/services/dhis2-sync-log-service';
import { getSyncEventStats, pushPendingToCountryNode } from '@/lib/services/sync-event-service';
import { syncEventsDB } from '@/lib/db';
import { findByType } from '@/lib/services/db-query';
import type { SyncEventDoc } from '@/lib/db-types';
import { RefreshCw } from '@/components/icons/lucide';

interface QueueHealth {
  total: number;
  pending: number;
  failed: number;
  newestEvent?: string;
}

const RESULT_TONE: Record<string, 'ok' | 'danger' | 'info'> = {
  success: 'ok',
  error: 'danger',
  info: 'info',
};

export default function AdminInteropPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { config, loading: configLoading } = usePlatformConfig();

  const [dhisLog, setDhisLog] = useState<Dhis2SyncLogDoc | null>(null);
  const [queue, setQueue] = useState<QueueHealth | null>(null);
  const [failedEvents, setFailedEvents] = useState<SyncEventDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [log, stats, allEvents] = await Promise.all([
        getDhis2SyncLog(),
        getSyncEventStats(),
        findByType<SyncEventDoc>(syncEventsDB(), 'sync_event'),
      ]);
      setDhisLog(log);
      setQueue({ total: stats.total, pending: stats.pending, failed: stats.failed, newestEvent: stats.newestEvent });
      setFailedEvents(
        allEvents
          .filter(e => e.syncStatus === 'failed')
          .sort((a, b) => (b.occurredAt || '').localeCompare(a.occurredAt || ''))
          .slice(0, 50)
      );
    } catch (err) {
      console.error('Failed to load interop data', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleRetryBatch = async () => {
    setRetrying(true);
    try {
      const result = await pushPendingToCountryNode(50);
      if (result.skipped) {
        showToast('Country-node sync is not configured on this facility (SYNC_PUSH_URL unset) — no retry attempted.', 'error');
      } else if (result.error) {
        showToast(`Retry push failed: ${result.error}`, 'error');
      } else {
        showToast(`Retry batch: pushed ${result.pushed}, acknowledged ${result.acknowledged}.`, 'success');
      }
      await loadAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Retry failed.', 'error');
    } finally {
      setRetrying(false);
    }
  };

  const dhisConfigured = isDhis2Configured();
  const dhisHost = getDhis2BaseUrlHost();
  const dhisSynced = dhisLog ? isFullySynced(dhisLog) : false;
  const dhisTone = !dhisConfigured ? 'muted' : dhisSynced ? 'ok' : 'warn';
  const dhisLabel = !dhisConfigured ? 'Not configured' : dhisSynced ? 'Synced' : 'Configured, awaiting sync';
  const dhisLastActivity = dhisLog ? formatWhen(dhisLog.lastSyncedAt || dhisLog.lastAttemptAt) : '—';

  const queueTone = !queue || queue.total === 0 ? 'muted' : queue.failed > 0 ? 'danger' : queue.pending > 0 ? 'warn' : 'ok';
  const queueLabel = !queue || queue.total === 0
    ? 'No events yet'
    : queue.failed > 0
      ? `${queue.failed} failed`
      : queue.pending > 0
        ? `${queue.pending} pending`
        : 'Drained';

  const apiKeysEnabled = !!config?.superAdminPolicies?.apiKeysEnabled;

  const entries = dhisLog?.entries ?? [];

  return (
    <SadbPage>
      <SadbCard title="Interoperability" meta={loading || configLoading ? 'Loading…' : 'Integration endpoints'}>
        <div className="sadb-status-grid">
          <SadbStatusCard
            name="DHIS2 export"
            status={dhisLabel}
            tone={TONE_CHIP[dhisTone]}
            detail={`Aggregate export · ${dhisHost || 'Not configured'} · Last activity ${dhisLastActivity}`}
            actionLabel="Open DHIS2 export"
            onAction={() => router.push('/dhis2-export')}
          />
          <SadbStatusCard
            name="Country-node replication"
            status={queueLabel}
            tone={TONE_CHIP[queueTone]}
            detail={`Document sync · Local outbox → country node · Last activity ${queue ? formatWhen(queue.newestEvent) : '—'}`}
          />
          <SadbStatusCard
            name="API keys"
            status={apiKeysEnabled ? 'Enabled by policy' : 'Disabled by policy'}
            tone={apiKeysEnabled ? 'green' : 'neutral'}
            detail="Platform REST endpoints, gated by super-admin policy."
          />
          <SadbStatusCard
            name="FHIR endpoints"
            status="Not configured"
            tone="neutral"
            detail="No FHIR endpoints are registered on this deployment."
          />
          <SadbStatusCard
            name="Webhooks"
            status="Not configured"
            tone="neutral"
            detail="No webhook subscriptions are registered on this deployment."
          />
        </div>
      </SadbCard>

      <SadbCard title="DHIS2 push log" meta={loading ? 'Loading…' : `${entries.length} entries`}>
        <SaTable
          columns={['When', 'Dataset', 'Period', 'Result', 'Detail']}
          empty={loading ? 'Loading…' : 'No DHIS2 push attempts recorded yet.'}
          minWidth={680}
        >
          {entries.map((e, i) => (
            <tr key={`${e.time}-${i}`}>
              <td>{formatWhen(e.time)}</td>
              <td>DHIS2 export</td>
              <td>{i === 0 && dhisLog?.lastDataset ? dhisLog.lastDataset.period : '—'}</td>
              <td><SaPill tone={RESULT_TONE[e.status] || 'muted'}>{e.status}</SaPill></td>
              <td>{e.message}</td>
            </tr>
          ))}
        </SaTable>
      </SadbCard>

      <SadbCard
        title="Failed pushes & retry"
        meta={loading ? 'Loading…' : `${failedEvents.length} shown${failedEvents.length === 50 ? ' (capped)' : ''}`}
        action={
          <button type="button" className="btn btn-secondary btn-sm" disabled={retrying} onClick={handleRetryBatch}>
            <RefreshCw className="w-3.5 h-3.5" />
            {retrying ? 'Retrying…' : 'Retry batch'}
          </button>
        }
      >
        <SaTable
          columns={['When', 'Resource', 'Operation', 'Error']}
          empty={loading ? 'Loading…' : 'No failed pushes.'}
          minWidth={620}
        >
          {failedEvents.map(ev => (
            <tr key={ev._id}>
              <td>{formatWhen(ev.occurredAt)}</td>
              <td><strong>{ev.resourceType}</strong> <span style={{ color: 'var(--text-muted)' }}>{ev.resourceId.slice(0, 12)}</span></td>
              <td>{ev.operation}</td>
              <td>{ev.syncError || '—'}</td>
            </tr>
          ))}
        </SaTable>
      </SadbCard>

      <SadbCard
        title="Terminology & code mappings"
        action={<SadbHeadLink onClick={() => router.push('/dhis2-export')}>Open DHIS2 export</SadbHeadLink>}
      >
        <SadbKvRow label="ICD-11 reference set" value="Bundled client-side (icd11-codes.ts) for diagnosis coding" />
        <SadbKvRow
          label="DHIS2 data-element mappings"
          value="Facility & workforce, births/deaths (CRVS), laboratory, pharmacy, immunizations, ANC, disease surveillance, data quality"
        />
      </SadbCard>
    </SadbPage>
  );
}
