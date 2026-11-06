'use client';
/**
 * Browser-side write path for the DHIS2 sync log.
 *
 * The log is a single platform-global doc in the pull-only
 * tamamhealth_platform_config database, so a browser write to the local copy
 * never replicates up — each officer kept a private log (security/data audit
 * 2026-11-05, §2.1 #11). These wrappers POST to /api/dhis2-sync-log; the server
 * writes the shared canonical doc and replication carries it to every device.
 *
 * Reads (getDhis2SyncLog, isDhis2Configured, …) stay in dhis2-sync-log-service.
 */
import type { DHIS2DataSet, DHIS2PushResult } from './dhis2-export-service';
import type { Dhis2SyncLogDoc, Dhis2LogStatus } from './dhis2-sync-log-service';

async function postLog(payload: Record<string, unknown>): Promise<Dhis2SyncLogDoc> {
  const { apiFetch } = await import('../api-fetch');
  const res = await apiFetch('/api/dhis2-sync-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`DHIS2 sync log not saved (HTTP ${res.status})`);
  const { log } = await res.json() as { log: Dhis2SyncLogDoc };
  return log;
}

export function appendDhis2LogEntry(message: string, status: Dhis2LogStatus = 'info'): Promise<Dhis2SyncLogDoc> {
  return postLog({ action: 'append', message, status });
}

export function recordDhis2SyncFailure(message: string): Promise<Dhis2SyncLogDoc> {
  return postLog({ action: 'failure', message });
}

export function recordDhis2SyncResult(params: {
  dataset: DHIS2DataSet; push: DHIS2PushResult; message?: string;
}): Promise<Dhis2SyncLogDoc> {
  return postLog({ action: 'result', dataset: params.dataset, push: params.push, message: params.message });
}
