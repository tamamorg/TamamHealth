/**
 * Liveness probe.
 *
 * GET /api/health/live
 *
 * Answers one question only: is this Node process still serving HTTP? It
 * deliberately touches no dependency, so it can never be the reason an
 * orchestrator restarts the container.
 *
 * `/api/health` is the *readiness* probe and returns 503 when CouchDB or the
 * analytics database is unreachable — correct for deciding whether to send an
 * instance traffic, wrong for deciding whether to kill it. Pointing a liveness
 * probe at that endpoint turns a CouchDB blip into a restart loop across every
 * instance, and the instances cannot recover until the dependency does. Keep
 * the two probes on separate paths.
 *
 * Unauthenticated and side-effect free, like the readiness probe.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      service: 'tamamhealth-platform',
      time: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
