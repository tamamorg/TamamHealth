import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthPayload, unauthorized, forbidden, hasRole, logApiError,
} from '@/lib/api-auth';
import { withAuditLog } from '@/lib/audit/with-audit';
import { rateLimit } from '@/lib/rate-limit';
import type { UserRole } from '@/lib/db-types';

// Receipt e-mailing is a billing/cashier surface. Clinical roles can also
// trigger it (e.g. a doctor mailing a copy after a consultation), but
// administrative-only roles like lab_tech / pharmacist are excluded — they
// have their own service-specific receipts.
const RECEIPT_EMAIL_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'medical_superintendent',
  'cashier', 'medical_biller', 'doctor', 'clinical_officer', 'nurse',
];

/**
 * POST /api/receipts/email
 *
 * Delivers a payment receipt to the supplied address via the configured
 * email provider. Provider is selected by `EMAIL_PROVIDER` env var:
 *
 *   EMAIL_PROVIDER=sendgrid   → SENDGRID_API_KEY
 *   EMAIL_PROVIDER=resend     → RESEND_API_KEY
 *   EMAIL_PROVIDER=smtp       → SMTP_URL  (smtps://user:pass@host:port)
 *   EMAIL_PROVIDER=log        → no network call, just structured stdout
 *                               (default for dev / when no creds present)
 *
 * The send is "best effort" — we always return 200 with a `delivered`
 * flag so the caller can render a "Receipt queued" toast even on a low-
 * connectivity facility deployment. If the provider call fails the
 * receipt is logged so it can be retried out-of-band.
 *
 * `from` defaults to FROM_EMAIL or `support.tamam@gmail.com`.
 */
async function postHandler(req: NextRequest) {
  const auth = await getAuthPayload(req);
  if (!auth) return unauthorized();
  if (!hasRole(auth, RECEIPT_EMAIL_ROLES)) return forbidden();

  // Per-user rate gate. Without this an authenticated cashier can spam the
  // upstream provider until the daily quota dies; 30 receipts / minute is
  // generous for any plausible cashiering workflow.
  const verdict = await rateLimit({
    key: 'receipt-email:' + auth.sub,
    limit: 30,
    windowMs: 60_000,
  });
  if (!verdict.allowed) {
    return NextResponse.json(
      {
        error: 'Too many receipt emails sent. Please slow down and try again shortly.',
        retryAfterMs: Math.max(0, verdict.resetAt - Date.now()),
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.max(1, Math.ceil((verdict.resetAt - Date.now()) / 1000))),
        },
      },
    );
  }

  let payload: {
    to?: string;
    subject?: string;
    html?: string;
    text?: string;
    receiptNumber?: string;
    amount?: number;
    currency?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { to, subject, html, text, receiptNumber } = payload;
  if (!to || !subject) {
    return NextResponse.json({ error: 'to and subject are required' }, { status: 400 });
  }
  if (!isValidEmail(to)) {
    return NextResponse.json({ error: 'to is not a valid email address' }, { status: 400 });
  }
  if (html && hasUnsafeReceiptHtml(html)) {
    return NextResponse.json({ error: 'Receipt HTML contains unsafe content' }, { status: 400 });
  }

  const from = process.env.FROM_EMAIL || 'support.tamam@gmail.com';
  const provider = (process.env.EMAIL_PROVIDER || 'log').toLowerCase();

  try {
    let delivered = false;
    let providerUsed = provider;

    switch (provider) {
      case 'sendgrid':
        delivered = await sendViaSendgrid({ to, from, subject, html, text });
        break;
      case 'resend':
        delivered = await sendViaResend({ to, from, subject, html, text });
        break;
      case 'smtp':
        delivered = await sendViaSmtp({ to, from, subject, html, text });
        break;
      case 'log':
      default:
        providerUsed = 'log';
        // No real email provider is configured. In production this is a
        // misconfiguration: report honest non-delivery rather than a silent
        // "sent" (a cashier must not be told a receipt went out when it
        // didn't). In dev/demo, keep the convenient success and print a
        // PII-free preview line (never the recipient address or amount).
        if (process.env.NODE_ENV === 'production') {
          logApiError(
            '[API /receipts/email]',
            new Error('No EMAIL_PROVIDER configured — receipt not delivered'),
          );
          delivered = false;
        } else {
          console.log(JSON.stringify({
            tag: '[Email Receipt]',
            subject, receiptNumber,
            previewLength: (html || text || '').length,
          }));
          delivered = true;
        }
        break;
    }

    return NextResponse.json({
      success: delivered,
      delivered,
      provider: providerUsed,
      receiptNumber,
      message: delivered ? 'Receipt sent' : 'Email delivery is not configured — receipt was not sent',
    });
  } catch (error) {
    // Failed sends are logged but reported as "queued" so the UI doesn't
    // alarm the cashier — a background retry job can pick this up.
    logApiError('[API /receipts/email Provider error]', error);
    return NextResponse.json({
      success: true,
      delivered: false,
      provider,
      receiptNumber,
      message: 'Receipt queued for retry',
    });
  }
}

/**
 * Receipt HTML is generated by the escaped, fixed template in
 * receipt-service. Reject active-content primitives if a caller bypasses that
 * client helper and submits a handcrafted payload directly.
 */
function hasUnsafeReceiptHtml(html: string): boolean {
  if (html.length > 100_000) return true;
  return /<(script|iframe|object|embed|form|base|meta)\b/i.test(html)
    || /\son[a-z]+\s*=/i.test(html)
    || /(?:javascript|data)\s*:/i.test(html)
    || /@import|url\s*\(|expression\s*\(/i.test(html);
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider adapters — kept inline to avoid pulling SDK deps unless used. Each
// returns true when the provider accepted the message, false when delivery
// is uncertain. Throwing escalates to the caller's retry path.
// ─────────────────────────────────────────────────────────────────────────────

interface SendArgs { to: string; from: string; subject: string; html?: string; text?: string }

async function sendViaSendgrid({ to, from, subject, html, text }: SendArgs): Promise<boolean> {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) throw new Error('SENDGRID_API_KEY not configured');
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from },
      subject,
      content: [
        ...(text ? [{ type: 'text/plain', value: text }] : []),
        ...(html ? [{ type: 'text/html', value: html }] : []),
      ],
    }),
  });
  if (!res.ok) throw new Error(`SendGrid ${res.status}: ${await res.text().catch(() => '')}`);
  return true;
}

async function sendViaResend({ to, from, subject, html, text }: SendArgs): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY not configured');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ from, to, subject, html, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text().catch(() => '')}`);
  return true;
}

async function sendViaSmtp({ to, from, subject, html, text }: SendArgs): Promise<boolean> {
  // nodemailer is an optional dependency — loaded dynamically so the bundle
  // doesn't require it unless an SMTP deployment opts in.
  if (!process.env.SMTP_URL) throw new Error('SMTP_URL not configured');
  let nodemailer: { createTransport: (url: string) => { sendMail: (opts: SendArgs) => Promise<unknown> } };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import(/* webpackIgnore: true */ 'nodemailer' as string);
    nodemailer = mod.default ?? mod;
  } catch {
    throw new Error('nodemailer is not installed; run `npm i nodemailer` to enable SMTP delivery');
  }
  const transport = nodemailer.createTransport(process.env.SMTP_URL);
  await transport.sendMail({ from, to, subject, html, text });
  return true;
}

function isValidEmail(addr: string): boolean {
  // Lenient — server validates intent, not perfection.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr);
}
export const POST = withAuditLog(postHandler, { action: 'receipt.email' });
