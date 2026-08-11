/**
 * Health / readiness probe.
 *
 * GET /api/health
 *
 * Liveness: the route returning at all proves the Next.js server is up.
 * Readiness: we additionally report on the clinical CouchDB and, when
 * configured, the national analytics database.
 *   - DATABASE_URL unset      → db: "not-configured" (analytics is
 *                               optional for a single-facility offline deploy).
 *   - DATABASE_URL set + OK   → db: "ok" (200).
 *   - DATABASE_URL set + down → db: "unavailable" (503, so orchestrators and
 *                               load balancers can pull the instance).
 *
 * Intentionally unauthenticated and side-effect free so it can be polled by
 * Kubernetes liveness/readiness probes, uptime monitors, and the deploy
 * pipeline's post-rollout smoke check.
 */

import { NextResponse } from 'next/server';

// Always evaluate fresh; never cache a health result.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const startedAt = Date.now();
  let db: 'ok' | 'unavailable' | 'not-configured' = 'not-configured';
  let dbLatencyMs: number | null = null;
  let couchdb: 'ok' | 'unavailable' | 'not-configured' = 'not-configured';
  let couchdbLatencyMs: number | null = null;

  const couchUrl = process.env.COUCHDB_URL || process.env.NEXT_PUBLIC_COUCHDB_URL;
  if (couchUrl) {
    const t0 = Date.now();
    try {
      const user = process.env.COUCHDB_ADMIN_USER || process.env.COUCHDB_USER;
      const pass = process.env.COUCHDB_ADMIN_PASSWORD || process.env.COUCHDB_PASSWORD;
      const headers = new Headers();
      if (user && pass) headers.set('Authorization', `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`);
      const response = await fetch(couchUrl.replace(/\/$/, ''), {
        headers,
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
      couchdb = response.ok ? 'ok' : 'unavailable';
      couchdbLatencyMs = Date.now() - t0;
    } catch (err) {
      couchdb = 'unavailable';
      couchdbLatencyMs = Date.now() - t0;
      console.warn('[Health] clinical CouchDB check failed:', (err as { code?: string; message?: string })?.code || (err as Error)?.message);
    }
  }

  if (process.env.DATABASE_URL) {
    const t0 = Date.now();
    try {
      const { query } = await import('@/lib/db/postgres');
      await query('SELECT 1');
      db = 'ok';
      dbLatencyMs = Date.now() - t0;
    } catch (err) {
      db = 'unavailable';
      dbLatencyMs = Date.now() - t0;
      console.warn('[Health] analytics database check failed:', (err as { code?: string; message?: string })?.code || (err as Error)?.message);
    }
  }

  const healthy = db !== 'unavailable' && couchdb !== 'unavailable';
  const body = {
    status: healthy ? 'ok' : 'degraded',
    service: 'tamamhealth-platform',
    version: process.env.NEXT_PUBLIC_APP_VERSION || process.env.npm_package_version || 'unknown',
    time: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    checks: {
      server: 'ok',
      couchdb,
      couchdbLatencyMs,
      database: db,
      databaseLatencyMs: dbLatencyMs,
    },
    responseMs: Date.now() - startedAt,
  };

  return NextResponse.json(body, {
    status: healthy ? 200 : 503,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
