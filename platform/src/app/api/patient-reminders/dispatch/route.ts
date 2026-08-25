/**
 * API: /api/patient-reminders/dispatch
 * POST — Dispatch due patient reminders (status 'queued', sendDate reached)
 *        through the configured SMS gateway (lib/sms). Opt-in per deployment
 *        via PATIENT_REMINDER_SMS_ENABLED='true'; without it the endpoint
 *        reports gatewayEnabled:false and sends nothing, preserving the
 *        staff-worked reminder queue.
 *
 * Intended callers: a scheduled job (cron hitting this route once daily) or
 * an admin/records officer triggering a manual dispatch from the UI.
 */
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';

const DISPATCH_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'hrio', 'front_desk', 'nurse',
];

/**
 * Machine caller (KAN-104). A scheduled job has no user session, so it
 * authenticates with a shared secret instead — the same shape as the CouchDB
 * sync webhook. Compared in constant time so the secret can't be recovered
 * byte-by-byte from response timing.
 *
 * Unset secret = no machine access at all, rather than open access.
 */
function hasSharedDispatchSecret(request: NextRequest): boolean {
  const expected = process.env.REMINDER_DISPATCH_SECRET;
  if (!expected) return false;
  const provided = request.headers.get('x-reminder-dispatch-secret');
  if (!provided) return false;
  const a = new Uint8Array(Buffer.from(provided, 'utf8'));
  const b = new Uint8Array(Buffer.from(expected, 'utf8'));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * The daily cron, or an operator's own scheduler.
 *
 * The first-party job now presents a short-lived GitHub OIDC token bound to
 * this repository, this workflow and main — the same scheme the transfer sweep
 * uses. That matters beyond tidiness: `REMINDER_DISPATCH_SECRET` was never set,
 * so this route refused every run and no patient was reminded for weeks. A
 * token GitHub mints per run needs nothing configured by hand.
 *
 * The shared secret stays for operators running their own scheduler; unset, it
 * grants nothing.
 */
async function isAuthorizedScheduler(request: NextRequest): Promise<boolean> {
  if (hasSharedDispatchSecret(request)) return true;
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return false;
  const { verifyReminderDispatchOidcToken } = await import('@/lib/github-actions-oidc');
  return verifyReminderDispatchOidcToken(authorization.slice('Bearer '.length).trim());
}

async function postHandler(request: NextRequest) {
  try {
    // Either a scheduled job holding the shared secret, or a staff user with
    // an appropriate role triggering a manual dispatch.
    if (!await isAuthorizedScheduler(request)) {
      const auth = await getAuthPayload(request);
      if (!auth) return unauthorized();
      if (!hasRole(auth, DISPATCH_ROLES)) return forbidden();
    }

    const { dispatchDueReminders } = await import('@/lib/services/patient-reminder-service');
    const url = new URL(request.url);
    const asOf = url.searchParams.get('asOf') || undefined;
    const outcome = await dispatchDueReminders(asOf);

    return NextResponse.json(outcome, { status: outcome.gatewayEnabled ? 200 : 202 });
  } catch (err) {
    logApiError('[API /patient-reminders/dispatch POST]', err);
    return serverError();
  }
}

export const POST = withAuditLog(postHandler, { action: 'patient.reminder.dispatch' });
