import type { EmailProvider, EmailSendInput, EmailSendResult } from './provider';
import { logProvider } from './log-provider';

/**
 * Outbound email, addressed to whoever the caller names — in practice the
 * PATIENT (a booking confirmation, a receipt), not the platform team.
 *
 * Provider is chosen by `EMAIL_PROVIDER`, the same contract
 * `/api/receipts/email` documents:
 *
 *   EMAIL_PROVIDER=sendgrid → SENDGRID_API_KEY
 *   EMAIL_PROVIDER=resend   → RESEND_API_KEY
 *   EMAIL_PROVIDER=smtp     → SMTP_URL (smtps://user:pass@host:port)
 *   EMAIL_PROVIDER=log      → no network call, structured stdout (default)
 *
 * The remote senders are imported lazily and only when selected. That is not
 * just tidiness: this module is reachable from client code, `process.env` is
 * empty there so the choice is always `log`, and a static import would drag
 * the provider SDK paths (including nodemailer) into the browser bundle.
 */

const DEFAULT_FROM = process.env.FROM_EMAIL || 'support.tamam@gmail.com';

let cached: EmailProvider | null = null;

async function resolveProvider(): Promise<EmailProvider> {
  if (cached) return cached;
  const choice = (process.env.EMAIL_PROVIDER || 'log').toLowerCase();
  if (choice === 'log') {
    cached = logProvider;
    return cached;
  }
  try {
    const { remoteProvider } = await import('./remote-provider');
    cached = remoteProvider(choice);
  } catch {
    // A misconfigured or unavailable provider must not swallow the message
    // silently — fall back to logging it so it can be retried out-of-band.
    cached = logProvider;
  }
  return cached;
}

/** Test hook: clear the memoised provider so a new env value takes effect. */
export function resetEmailProviderForTest(): void {
  cached = null;
}

/**
 * Send one email. Never throws — the result carries `ok`, so callers can record
 * delivery status without a try/catch around every send. Nothing in this
 * platform should lose a saved record because a mail gateway was down.
 */
export async function sendEmail(input: EmailSendInput): Promise<EmailSendResult> {
  const to = input.to.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return { ok: false, providerId: 'invalid', error: 'invalid_recipient' };
  }
  try {
    const provider = await resolveProvider();
    return await provider.send({ ...input, to, from: input.from || DEFAULT_FROM });
  } catch (err) {
    return {
      ok: false,
      providerId: 'error',
      error: err instanceof Error ? err.message : 'unknown_error',
    };
  }
}

/**
 * Whether a send actually left the building.
 *
 * The `log` provider reports `ok: true` on purpose — it keeps delivery status,
 * toasts and audit working on deployments with no mail credentials. That is
 * right for a receipt nobody is waiting on, and wrong for anything a caller
 * would otherwise stop doing: an administrator told "we emailed the invitation"
 * will not read the temporary password out loud, and the new user is stranded.
 *
 * Callers whose next action depends on real delivery must use this rather than
 * `result.ok`.
 */
export function wasDelivered(result: EmailSendResult): boolean {
  return result.ok && result.providerId !== 'log';
}

export type { EmailProvider, EmailSendInput, EmailSendResult };
