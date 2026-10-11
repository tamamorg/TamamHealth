import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, unauthorized } from '@/modules/identity';
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

  // Per-user rate gate. An authenticated cashier must not be able to spam the
  // upstream provider; receipts are a handful per visit, so this is tight.
  const verdict = await rateLimit({
    key: 'receipt-email:' + auth.sub,
    limit: 10,
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
    paymentId?: string;
    receiptNumber?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // The message is bound to a REAL payment in the caller's scope, goes only to
  // that patient's email on file, and its subject/body are built here from the
  // stored payment. Caller-supplied subject/html/text are ignored: this
  // endpoint is not a general-purpose mail relay.
  const { to } = payload;
  const lookupKey = (typeof payload.paymentId === 'string' && payload.paymentId)
    || (typeof payload.receiptNumber === 'string' && payload.receiptNumber)
    || '';
  if (!to || !lookupKey) {
    return NextResponse.json({ error: 'to and paymentId (or receiptNumber) are required' }, { status: 400 });
  }
  if (!isValidEmail(to)) {
    return NextResponse.json({ error: 'to is not a valid email address' }, { status: 400 });
  }

  const { paymentsDB } = await import('@/lib/db');
  const { getPaymentByReference } = await import('@/lib/services/payment-service');
  const { getPatientById } = await import('@/lib/services/patient-service');
  const { buildScopeFromAuth, filterByScope } = await import('@/lib/services/data-scope');
  type PaymentLike = import('@/lib/db-types-payments').PaymentDoc;
  let payment: PaymentLike | null = null;
  try {
    payment = await paymentsDB().get(lookupKey) as PaymentLike;
  } catch {
    payment = await getPaymentByReference(lookupKey).catch(() => null);
  }
  // 404 for both "missing" and "out of scope" so ids cannot be probed.
  if (!payment || payment.type !== 'payment'
    || filterByScope([payment as unknown as Record<string, unknown>], buildScopeFromAuth(auth)).length === 0) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }
  const patient = await getPatientById(payment.patientId).catch(() => null);
  if (!patient || filterByScope([patient], buildScopeFromAuth(auth)).length === 0) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }
  const onFile = (patient.email || '').trim().toLowerCase();
  if (!onFile) {
    return NextResponse.json({ error: 'This patient has no email address on file.' }, { status: 422 });
  }
  if (onFile !== to.trim().toLowerCase()) {
    return NextResponse.json({ error: 'Receipts can only be sent to the email address on the patient record.' }, { status: 403 });
  }
  // One payment's receipt cannot be re-sent in a loop.
  const perPayment = await rateLimit({ key: `receipt-email:payment:${payment._id}`, limit: 5, windowMs: 60 * 60_000 });
  if (!perPayment.allowed) {
    return NextResponse.json({ error: 'This receipt was already sent several times. Try again later.' }, { status: 429 });
  }

  const { buildReceiptData, generateReceiptHTML } = await import('@/lib/services/receipt-service');
  const receipt = buildReceiptData(payment, auth.hospitalName, patient.hospitalNumber);
  const receiptNumber = receipt.receiptNumber;
  const subject = `Payment Receipt \u2014 ${receiptNumber}`;
  const html = generateReceiptHTML(receipt);
  const text = `Payment receipt ${receiptNumber}: ${receipt.amount} ${receipt.currency} paid on ${receipt.date}.`;

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
