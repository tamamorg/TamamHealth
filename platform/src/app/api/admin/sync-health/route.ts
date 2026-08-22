/**
 * API: /api/admin/sync-health
 * GET — Operational health view for the platform sync pipeline.
 *
 * Returns outbox backlog, per-status counts, oldest pending event timestamp,
 * and per-facility tallies so ops can see "facility X hasn't synced in Y hours"
 * at a glance.
 *
 * Admin / super-admin / medical-superintendent only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import type { UserRole, SyncEventDoc } from '@/lib/db-types';

const ALLOWED_ROLES: UserRole[] = ['super_admin', 'org_admin', 'medical_superintendent', 'hrio', 'government'];

interface ReplicationHealth {
  /** 'ok' | 'degraded' | 'unknown' — unknown means CouchDB could not be asked. */
  status: 'ok' | 'degraded' | 'unknown';
  running: number;
  /** Jobs in any state other than running, with the state and the last error. */
  unhealthy: { id: string; state: string; error?: string }[];
  note?: string;
}

/**
 * Health of the continuous tenant <-> aggregate replication jobs.
 *
 * In tenant mode, browsers write to `tamamhealth_*--org-x` and server-side
 * `_replicator` jobs mirror those into the shared aggregates. The sync-worker
 * only ever polls the aggregates, so if an inbound job stalls the worker keeps
 * reporting success against a database that has stopped receiving writes, and
 * one organisation's national analytics silently goes stale. Nothing watched
 * those jobs; this is the probe that makes the failure visible.
 */
async function replicationHealth(): Promise<ReplicationHealth> {
  const base = (process.env.COUCHDB_URL || process.env.NEXT_PUBLIC_COUCHDB_URL || '').replace(/\/+$/, '');
  const user = process.env.COUCHDB_ADMIN_USER || process.env.COUCHDB_USER;
  const pass = process.env.COUCHDB_ADMIN_PASSWORD || process.env.COUCHDB_PASSWORD;
  if (!base || !user || !pass) {
    return { status: 'unknown', running: 0, unhealthy: [], note: 'CouchDB admin credentials not configured' };
  }
  try {
    const res = await fetch(`${base}/_scheduler/docs`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      return { status: 'unknown', running: 0, unhealthy: [], note: `_scheduler/docs returned ${res.status}` };
    }
    const body = await res.json() as { docs?: { doc_id?: string; state?: string; info?: { error?: string } }[] };
    const docs = body.docs ?? [];
    const running = docs.filter(d => d.state === 'running').length;
    const unhealthy = docs
      .filter(d => d.state !== 'running')
      .map(d => ({
        id: d.doc_id ?? 'unknown',
        state: d.state ?? 'unknown',
        error: d.info?.error,
      }));
    return { status: unhealthy.length ? 'degraded' : 'ok', running, unhealthy };
  } catch (err) {
    // A probe failure must not take down the whole health view — the outbox
    // numbers above are still worth returning.
    return {
      status: 'unknown',
      running: 0,
      unhealthy: [],
      note: err instanceof Error ? err.message : 'CouchDB unreachable',
    };
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, ALLOWED_ROLES)) return forbidden();

    const { getSyncEventStats } = await import('@/lib/services/sync-event-service');
    const { syncEventsDB } = await import('@/lib/db');

    const stats = await getSyncEventStats();

    // Per-facility rollup (last 24h)
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const db = syncEventsDB();
    const all = await db.allDocs({ include_docs: true });
    const recent = all.rows
      .map((r) => r.doc as SyncEventDoc)
      .filter((d) => d && d.type === 'sync_event' && d.occurredAt >= since);

    const perFacility: Record<string, { total: number; pending: number; failed: number; lastSeen?: string }> = {};
    for (const ev of recent) {
      const key = ev.hospitalId || 'unknown';
      if (!perFacility[key]) {
        perFacility[key] = { total: 0, pending: 0, failed: 0 };
      }
      perFacility[key].total += 1;
      if (ev.syncStatus === 'pending') perFacility[key].pending += 1;
      if (ev.syncStatus === 'failed') perFacility[key].failed += 1;
      if (!perFacility[key].lastSeen || ev.occurredAt > perFacility[key].lastSeen!) {
        perFacility[key].lastSeen = ev.occurredAt;
      }
    }

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      outbox: stats,
      perFacilityLast24h: perFacility,
      windowHours: 24,
      replication: await replicationHealth(),
    });
  } catch (err) {
    logApiError('[API /admin/sync-health GET]', err);
    return serverError();
  }
}
