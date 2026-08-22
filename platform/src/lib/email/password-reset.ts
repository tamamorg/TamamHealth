/**
 * The email someone receives when they ask to set a new password.
 *
 * Same token, same expiry and same single-use page as the welcome invitation
 * (see `lib/user-invite.ts`) — setting a password you have never had and
 * replacing one you have forgotten are the same operation on the same
 * document. Only the words differ, and they matter: a "welcome, an account has
 * been created for you" message sent to someone who has used the system for a
 * year reads as a mistake or a phish, and they ring the administrator instead.
 *
 * Carries no password, states plainly what to do if the request was not
 * theirs, and — like every message in this platform — is plain text, because a
 * good share of the mail clients in use here render nothing else.
 */

import { sendEmail } from './index';
import type { EmailSendResult } from './provider';

export interface PasswordResetEmailInput {
  to: string;
  /** The person's display name, for the greeting. */
  name: string;
  username: string;
  resetUrl: string;
  expiresInHours: number;
}

export function renderPasswordResetEmail(input: PasswordResetEmailInput): { subject: string; body: string } {
  const lines = [
    `Hello ${input.name},`,
    '',
    'Someone asked to set a new password for your TamamHealth account',
    `(${input.username}).`,
    '',
    'Choose a new password here. The link works once and expires in',
    `${input.expiresInHours} hours:`,
    '',
    input.resetUrl,
    '',
    'If the link has expired, ask for a new one from the sign-in page.',
    '',
    'If this was not you, you can ignore this message — your current password',
    'still works and nothing has changed. Tell your administrator if you keep',
    'receiving these.',
    '',
    'Do not reply to this message.',
  ];
  return { subject: 'Set a new TamamHealth password', body: lines.join('\n') };
}

/**
 * Send the reset link. Never throws — `sendEmail` already turns transport
 * failures into a result, and the caller answers the same way either way so
 * the response cannot be used to discover whether an account exists.
 */
export async function sendPasswordResetEmail(input: PasswordResetEmailInput): Promise<EmailSendResult> {
  const { subject, body } = renderPasswordResetEmail(input);
  return sendEmail({ to: input.to, subject, body });
}
