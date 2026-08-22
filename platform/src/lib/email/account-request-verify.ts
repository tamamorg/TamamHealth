/**
 * "Is this really your address?" — sent the moment someone asks for an account.
 *
 * The request form is the only place a person outside the organisation can
 * start a process that ends in prescribing rights, and every field in it was
 * self-asserted with nothing checked. This message is the cheapest real check
 * available: it proves whoever filled the form can read the mailbox they typed.
 *
 * It is not identity proofing on its own — the approver still has to attest to
 * who the person is — but it stops the two failure modes that cost the most
 * approver attention: a typo that sends an approved account's invitation into
 * the void, and somebody entering a colleague's address.
 */

import { sendEmail } from './index';
import type { EmailSendResult } from './provider';

export interface AccountRequestVerifyInput {
  to: string;
  name: string;
  roleLabel: string;
  organisationName?: string;
  verifyUrl: string;
  expiresInHours: number;
}

export function renderAccountRequestVerifyEmail(
  input: AccountRequestVerifyInput,
): { subject: string; body: string } {
  const lines = [
    `Hello ${input.name},`,
    '',
    'You asked for a TamamHealth account:',
    '',
    `  Role: ${input.roleLabel}`,
    ...(input.organisationName ? [`  Organisation: ${input.organisationName}`] : []),
    '',
    'Confirm this address so an administrator can review your request. The',
    `link works once and expires in ${input.expiresInHours} hours:`,
    '',
    input.verifyUrl,
    '',
    'Until you confirm, nobody sees the request and no account is created.',
    '',
    'If you did not ask for an account, ignore this message — nothing was',
    'created and nothing will be.',
    '',
    'Do not reply to this message.',
  ];
  return { subject: 'Confirm your TamamHealth account request', body: lines.join('\n') };
}

export async function sendAccountRequestVerifyEmail(
  input: AccountRequestVerifyInput,
): Promise<EmailSendResult> {
  const { subject, body } = renderAccountRequestVerifyEmail(input);
  return sendEmail({ to: input.to, subject, body });
}
