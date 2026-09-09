import type { EmailProvider, EmailSendInput, EmailSendResult } from './provider';

/**
 * The real gateways. Server-only in practice — this file is never imported
 * unless `EMAIL_PROVIDER` names one of them, which cannot happen in the
 * browser (see the lazy import in `./index`).
 *
 * Credentials are read at send time, not module load, so a missing key surfaces
 * as a failed send with a readable reason rather than a crash at import.
 */

async function sendgrid(input: Required<Pick<EmailSendInput, 'to' | 'from' | 'subject' | 'body'>>): Promise<EmailSendResult> {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) return { ok: false, providerId: 'sendgrid', error: 'SENDGRID_API_KEY not configured' };
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    signal: AbortSignal.timeout(15000),
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: input.to }] }],
      from: { email: input.from },
      subject: input.subject,
      content: [{ type: 'text/plain', value: input.body }],
    }),
  });
  if (!res.ok) {
    return { ok: false, providerId: 'sendgrid', error: `SendGrid ${res.status}` };
  }
  // SendGrid returns the id in a header, not a body.
  return { ok: true, providerId: 'sendgrid', providerMessageId: res.headers.get('x-message-id') || undefined };
}

async function resend(input: Required<Pick<EmailSendInput, 'to' | 'from' | 'subject' | 'body'>>): Promise<EmailSendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, providerId: 'resend', error: 'RESEND_API_KEY not configured' };
  const res = await fetch('https://api.resend.com/emails', {
    signal: AbortSignal.timeout(15000),
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ from: input.from, to: input.to, subject: input.subject, text: input.body }),
  });
  if (!res.ok) return { ok: false, providerId: 'resend', error: `Resend ${res.status}` };
  const json = await res.json().catch(() => null) as { id?: string } | null;
  return { ok: true, providerId: 'resend', providerMessageId: json?.id };
}

async function smtp(input: Required<Pick<EmailSendInput, 'to' | 'from' | 'subject' | 'body'>>): Promise<EmailSendResult> {
  if (!process.env.SMTP_URL) return { ok: false, providerId: 'smtp', error: 'SMTP_URL not configured' };
  // A literal import lets Next trace the dependency into the deployed image.
  const { default: nodemailer } = await import('nodemailer');
  const transport = nodemailer.createTransport(process.env.SMTP_URL);
  Object.assign(transport.options, { connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000 });
  const result = await transport.sendMail({
    from: input.from, to: input.to, subject: input.subject, text: input.body,
  });
  if (!result.accepted?.length || result.rejected?.length) {
    return { ok: false, providerId: 'smtp', error: 'smtp_recipient_rejected' };
  }
  return { ok: true, providerId: 'smtp', providerMessageId: result.messageId };
}

/** Build a provider for one of the remote gateway keys. */
export function remoteProvider(choice: string): EmailProvider {
  const send = choice === 'sendgrid' ? sendgrid
    : choice === 'resend' ? resend
      : choice === 'smtp' ? smtp
        : null;
  if (!send) return { name: 'invalid', send: async () => ({ ok: false, providerId: 'invalid', error: 'EMAIL_PROVIDER not configured correctly' }) };
  return {
    name: choice,
    send: (input: EmailSendInput) => !input.from?.trim()
      ? Promise.resolve({ ok: false, providerId: choice, error: 'FROM_EMAIL not configured' })
      : send({
      to: input.to,
      from: input.from || '',
      subject: input.subject,
      body: input.body,
    }),
  };
}
