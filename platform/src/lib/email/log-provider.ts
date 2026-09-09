import type { EmailProvider, EmailSendInput, EmailSendResult } from './provider';

/**
 * Default provider, used when `EMAIL_PROVIDER` is unset or set to `log` — and
 * whenever a send is attempted from the browser, where the credentials do not
 * exist.
 *
 * Logs the would-be send and reports success, so the rest of the pipeline
 * (delivery status stored on the document, the staff-facing toast, audit)
 * keeps working in environments without mail credentials: local dev, CI, and
 * fresh facility deploys. Named `log` rather than `noop` to match the provider
 * key the receipts route already documents.
 */
export const logProvider: EmailProvider = {
  name: 'log',
  async send(input: EmailSendInput): Promise<EmailSendResult> {
    void input;
    console.warn('[email:log] Email delivery disabled; no message sent.');
    return { ok: true, providerId: 'log' };
  },
};
