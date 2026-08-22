/**
 * API: /api/patient-transfers/sweep
 * POST — Apply transfers whose clock has run out:
 *          • accepted + `effectiveAt` reached  → complete (ownership moves)
 *          • temporary/shared-care past `expiresAt` → lapse (ownership returns)
 *
 * ## Why this endpoint has to exist
 *
 * `effectiveAt` and `expiresAt` are promises the app makes to clinicians: "this
 * transfer takes effect on Monday", "this cover ends on the 14th". Nothing in an
 * offline-first client can keep those promises — the browser that raised the
 * transfer may be closed, offline, or belong to someone on leave. Without a
 * server-side caller a scheduled transfer silently never lands and a temporary
 * grant never lapses, which means the wrong clinician keeps both the patient and
 * the chart access. This is that caller.
 *
 * Intended callers: the hourly job in .github/workflows/transfers-sweep-cron.yml,
 * or an administrator triggering it by hand.
 *
 * Runs across EVERY organisation. Server-side `getDB` talks to CouchDB with
 * admin credentials, so this is deliberately unscoped — a per-tenant sweep would
 * need a caller per tenant, and a tenant with no active admin would quietly stop
 * honouring its own scheduled transfers. The response carries document ids and
 * counts only, never patient data, so an operator reading the cron log learns
 * nothing about who was moved.
 */
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { forbidden, getAuthPayload, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import { hasTransferCapability } from '@/lib/services/patient-transfer-permissions';

/**
 * Machine caller. A scheduled job has no user session, so it authenticates with
 * a shared secret — the same shape as the reminder-dispatch job. Compared in
 * constant time so the secret cannot be recovered byte-by-byte from response
 * timing. Unset secret = no machine access at all, rather than open access.
 */
function isAuthorizedScheduler(request: NextRequest): boolean {
  const expected = process.env.TRANSFER_SWEEP_SECRET;
  if (!expected) return false;
  const provided = request.headers.get('x-transfer-sweep-secret');
  if (!provided) return false;
  const a = new Uint8Array(Buffer.from(provided, 'utf8'));
  const b = new Uint8Array(Buffer.from(expected, 'utf8'));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function postHandler(request: NextRequest) {
  try {
    // Either the scheduled job holding the shared secret, or an admin with the
    // force capability — sweeping applies transfers without a fresh human
    // decision, which is the same authority `patient.transfer.force` grants.
    const isScheduler = isAuthorizedScheduler(request);
    if (!isScheduler) {
      const auth = await getAuthPayload(request);
      if (!auth) return unauthorized();
      if (!hasTransferCapability(auth.role, 'patient.transfer.force')) {
        return forbidden('Only administrators can run the transfer sweep.');
      }
    }

    const { applyDueTransfers } = await import('@/lib/services/patient-transfer-service');

    // `asOf` lets an operator replay the sweep at a specific instant when
    // reconciling a missed run. Rejected if unparseable rather than silently
    // falling back to now — a typo'd timestamp that quietly means "right now"
    // would apply transfers the operator did not intend to apply yet.
    const asOfParam = new URL(request.url).searchParams.get('asOf');
    let asOf = new Date();
    if (asOfParam) {
      const parsed = new Date(asOfParam);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json(
          { error: `Invalid asOf timestamp: ${asOfParam}` },
          { status: 400 },
        );
      }
      asOf = parsed;
    }

    const actor = isScheduler
      ? { id: 'system', name: 'Scheduled transfer sweep' }
      : undefined;
    const result = await applyDueTransfers(asOf, actor);

    return NextResponse.json({
      ok: true,
      sweptAt: asOf.toISOString(),
      completed: result.completed,
      expired: result.expired,
      completedCount: result.completed.length,
      expiredCount: result.expired.length,
      failedCount: result.failed.length,
      failed: result.failed,
    });
  } catch (err) {
    logApiError('[API /patient-transfers/sweep POST]', err);
    return serverError();
  }
}

export const POST = withAuditLog(postHandler, { action: 'patient_transfer.sweep' });
