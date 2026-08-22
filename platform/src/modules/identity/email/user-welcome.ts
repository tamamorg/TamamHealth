/**
 * The email a new staff member receives when their account is created.
 *
 * Deliberately carries NO password. It names the account and links to a
 * single-use page where the person chooses their own credential, so nothing
 * reusable is ever sitting in a mailbox. See `lib/user-invite.ts` for why.
 *
 * Plain text, not HTML. `EmailSendInput` is text-only by design and providers
 * wrap it, but the deployment reality argues for it independently: a good
 * share of the mail clients in use here render text only, and a styled
 * invitation that arrives blank is an account nobody can activate. A bare URL
 * is clickable in every client worth supporting.
 */

import { sendEmail } from '@/lib/email/index';
import type { EmailSendResult } from '@/lib/email/provider';

export interface WelcomeEmailInput {
  to: string;
  /** The person's display name, for the greeting. */
  name: string;
  username: string;
  roleLabel: string;
  facilityName?: string;
  organisationName?: string;
  inviteUrl: string;
  expiresInHours: number;
}

export function renderWelcomeEmail(input: WelcomeEmailInput): { subject: string; body: string } {
  const where = input.facilityName || input.organisationName || 'TamamHealth';
  const lines = [
    `Hello ${input.name},`,
    '',
    `An account has been created for you on TamamHealth${input.facilityName ? ` at ${input.facilityName}` : ''}.`,
    '',
    `  Username: ${input.username}`,
    `  Role:     ${input.roleLabel}`,
    ...(input.facilityName ? [`  Facility: ${input.facilityName}`] : []),
    '',
    'Choose your password here. The link works once and expires in',
    `${input.expiresInHours} hours:`,
    '',
    input.inviteUrl,
    '',
    'If the link has expired, ask your administrator to send a new invitation.',
    '',
    'If you were not expecting this you can ignore this message — the account',
    'cannot be used until someone sets a password.',
    '',
    'Do not reply to this message.',
  ];
  return { subject: `Set up your ${where} account`, body: lines.join('\n') };
}

/**
 * Send the invitation. Never throws — `sendEmail` already turns transport
 * failures into a result, and the account must exist whether or not the mail
 * gateway was reachable. The caller reports delivery back to the administrator
 * so they know whether to hand the details over another way.
 */
export async function sendWelcomeEmail(input: WelcomeEmailInput): Promise<EmailSendResult> {
  const { subject, body } = renderWelcomeEmail(input);
  return sendEmail({ to: input.to, subject, body });
}
