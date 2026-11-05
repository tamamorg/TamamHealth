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
  SadbPage, SadbCard, SadbStatusCard, SadbKvRow, TONE_CHIP,
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
import { describeApiError, describeError } from '@/lib/user-facing-error';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { humanizeStatus } from '@/lib/format-utils';

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
  const { t } = useTranslation();
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
        showToast(t('msg.retryNotSentNationalSync'), 'error');
      } else if (result.error) {
        showToast(t('msg.retryNotSent', { value: describeApiError({ error: result.error }, t('adminMgmt.nationalServerRejected')) }), 'error');
      } else {
        showToast(t('msg.retryCompleteSentConfirmedBy', { pushed: result.pushed, acknowledged: result.acknowledged }), 'success');
      }
      await loadAll();
    } catch (err) {
      showToast(describeError(err, t('msg.retryNotSentCheckThe')), 'error');
    } finally {
      setRetrying(false);
    }
  };

  const dhisConfigured = isDhis2Configured();
  const dhisHost = getDhis2BaseUrlHost();
  const dhisSynced = dhisLog ? isFullySynced(dhisLog) : false;
  const dhisTone = !dhisConfigured ? 'muted' : dhisSynced ? 'ok' : 'warn';
  const dhisLabel = !dhisConfigured ? t('dhis2.statNotConfigured') : dhisSynced ? t('admin.healthSynced') : t('adminMgmt.configuredAwaitingSync');
  const dhisLastActivity = dhisLog ? formatWhen(dhisLog.lastSyncedAt || dhisLog.lastAttemptAt) : '—';

  const queueTone = !queue || queue.total === 0 ? 'muted' : queue.failed > 0 ? 'danger' : queue.pending > 0 ? 'warn' : 'ok';
  const queueLabel = !queue || queue.total === 0
    ? t('adminMgmt.noEventsYet')
    : queue.failed > 0
      ? t('adminMgmt.nFailed', { count: queue.failed })
      : queue.pending > 0
        ? t('adminMgmt.nPending', { count: queue.pending })
        : t('adminMgmt.drained');

  const apiKeysEnabled = !!config?.superAdminPolicies?.apiKeysEnabled;

  const entries = dhisLog?.entries ?? [];

  return (
    <SadbPage>
      <SadbCard title={t('routeContext.interoperability')} meta={loading || configLoading ? t('admin.loading') : t('adminMgmt.integrationEndpoints')}>
        <div className="sadb-status-grid">
          <SadbStatusCard
            name={t('product.roadmap.done4')}
            status={dhisLabel}
            tone={TONE_CHIP[dhisTone]}
            detail={t('adminMgmt.dhisDetail', { host: dhisHost || t('dhis2.statNotConfigured'), when: dhisLastActivity })}
            actionLabel={t('ui.openDhis2Export')}
            onAction={() => router.push('/dhis2-export')}
          />
          <SadbStatusCard
            name={t('adminMgmt.countryNodeReplication')}
            status={queueLabel}
            tone={TONE_CHIP[queueTone]}
            detail={t('adminMgmt.countryNodeDetail', { when: queue ? formatWhen(queue.newestEvent) : '—' })}
          />
          <SadbStatusCard
            name={t('adminMgmt.apiKeys')}
            status={apiKeysEnabled ? t('adminMgmt.enabledByPolicy') : t('adminMgmt.disabledByPolicy')}
            tone={apiKeysEnabled ? 'green' : 'neutral'}
            detail={t('adminMgmt.apiKeysDetail')}
          />
          <SadbStatusCard
            name={t('adminMgmt.fhirEndpoints')}
            status={t('dhis2.statNotConfigured')}
            tone="neutral"
            detail={t('adminMgmt.fhirDetail')}
          />
          <SadbStatusCard
            name={t('adminMgmt.webhooks')}
            status={t('dhis2.statNotConfigured')}
            tone="neutral"
            detail={t('adminMgmt.webhooksDetail')}
          />
        </div>
      </SadbCard>

      <SadbCard title={t('ui.dhis2PushLog')} meta={loading ? t('admin.loading') : t('adminMgmt.nEntries', { count: entries.length })}>
        <SaTable
          columns={[
            { label: t('transfers.when'), w: 0.9 }, { label: t('adminMgmt.dataset'), w: 1.4 }, { label: t('chart.periodLabel'), w: 0.8 },
            { label: t('lab.result'), w: 0.9 }, { label: t('adminUsers.activityDetail'), w: 2 },
          ]}
          empty={loading ? t('admin.loading') : t('adminMgmt.noDhisPushes')}
          minWidth={680}
        >
          {entries.map((e, i) => (
            <tr key={`${e.time}-${i}`}>
              <td>{formatWhen(e.time)}</td>
              <td>{t('product.roadmap.done4')}</td>
              <td>{i === 0 && dhisLog?.lastDataset ? dhisLog.lastDataset.period : '—'}</td>
              <td><SaPill tone={RESULT_TONE[e.status] || 'muted'}>{humanizeStatus(e.status)}</SaPill></td>
              <td>{e.message}</td>
            </tr>
          ))}
        </SaTable>
      </SadbCard>

      <SadbCard
        title={t('ui.failedPushesRetry')}
        meta={loading ? t('admin.loading') : t(failedEvents.length === 50 ? 'adminMgmt.nShownCapped' : 'adminMgmt.nShown', { count: failedEvents.length })}
        action={
          <button type="button" className="btn btn-secondary btn-sm" disabled={retrying} onClick={handleRetryBatch}>
            <RefreshCw className="w-3.5 h-3.5" />
            {retrying ? t('connectivity.retrying') : t('adminMgmt.retryFailedPushes')}
          </button>
        }
      >
        <SaTable
          columns={[
            { label: t('transfers.when'), w: 0.9 }, { label: t('syncConflicts.colResource'), w: 1.5 },
            { label: t('history.col.operation'), w: 1 }, { label: t('toast.error'), w: 2.2 },
          ]}
          empty={loading ? t('admin.loading') : t('adminMgmt.noFailedPushes')}
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

      <SadbCard title={t('ui.terminologyCodeMappings')}>
        <SadbKvRow label={t('ui.icd11ReferenceSet')} value={t('adminMgmt.icd11BuiltIn')} />
        <SadbKvRow
          label={t('ui.dhis2DataElementMappings')}
          value={t('adminMgmt.dhis2MappingsValue')}
        />
      </SadbCard>
    </SadbPage>
  );
}
