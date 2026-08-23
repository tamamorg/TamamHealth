/**
 * API: /api/admin/backup
 * GET  — what the server knows about the last backup (admin surfaces).
 * POST — the backup job reports that a backup finished.
 *
 * This is the endpoint `recordBackupCompleted` was written against and which
 * never existed. Without it nothing could ever report a backup, so
 * `getBackupStatus` could only ever answer `unknown`, and the Risk Center
 * carried a HIGH "No backup on record" that no amount of successful backing up
 * could clear — on a platform whose backup container was running the whole
 * time. The loop was open at exactly one link: the job had no way to say it
 * had finished.
 *
 * Authenticated as a MACHINE, not a user: the caller is a cron container with
 * no session. It reuses `verifySyncMachineRequest` — the same HMAC signature,
 * freshness window and replay-protecting nonce the CouchDB webhook uses — so
 * there is one machine-auth scheme on this platform rather than two.
 *
 * Body: { "completedAt": "2026-08-23T02:00:00.000Z" }
 * `completedAt` is the backup's own completion time, not now: the job reports
 * after the fact, and the meaningful timestamp is when the data was captured.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySyncMachineRequest } from '@/lib/sync-auth';
import { forbidden, getAuthPayload, hasRole, logApiError, unauthorized } from '@/modules/identity';

export const dynamic = 'force-dynamic';

/**
 * Read the status the POST above records.
 *
 * The admin surfaces used to read this straight from the local replica, which
 * made a server-side fact depend on one global config document completing a
 * round trip through 76-database replication. When that pull had not run —
 * a fresh device, a stalled gateway, a browser that had just been wiped — the
 * Risk Center reported "No backup on record" for a backup the server knew
 * about, which is the same false alarm this endpoint exists to end. Asking the
 * server is the direct answer; the local read stays as the offline fallback.
 *
 * Platform-operator surface, so `super_admin` only.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, ['super_admin'])) return forbidden();

    const rpoParam = Number(request.nextUrl.searchParams.get('rpoHours'));
    const rpoHours = Number.isFinite(rpoParam) && rpoParam > 0 ? rpoParam : undefined;

    const { getBackupStatus } = await import('@/lib/services/backup-status-service');
    return NextResponse.json({ status: await getBackupStatus(rpoHours) });
  } catch (err) {
    logApiError('[API /admin/backup GET]', err);
    return NextResponse.json({ error: 'Failed to read backup status' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const verification = await verifySyncMachineRequest(request, rawBody);
    if (!verification.ok) {
      return NextResponse.json(
        { error: verification.status === 503 ? 'Authentication unavailable' : 'Unauthorized' },
        { status: verification.status },
      );
    }

    let body: { completedAt?: unknown };
    try {
      body = JSON.parse(rawBody) as { completedAt?: unknown };
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const completedAt = typeof body.completedAt === 'string' && body.completedAt
      ? body.completedAt
      : new Date().toISOString();

    const { recordBackupCompleted } = await import('@/lib/services/backup-status-service');
    try {
      await recordBackupCompleted(completedAt);
    } catch (err) {
      // The service rejects an unparseable timestamp. That is the caller's
      // mistake, not a server fault, so it answers 400 rather than 500.
      if (err instanceof Error && /Invalid backup completion timestamp/.test(err.message)) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }

    return NextResponse.json({ recorded: true, completedAt });
  } catch (err) {
    logApiError('[API /admin/backup POST]', err);
    return NextResponse.json({ error: 'Failed to record backup' }, { status: 500 });
  }
}
