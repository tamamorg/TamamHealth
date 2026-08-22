/**
 * "Somebody is waiting" — sent to the approvers when a verified request lands.
 *
 * The request queue was a tab on a page. An org_admin who did not happen to
 * open it never learned that anyone had asked, and a request that rots is not
 * a tidy no: it is a clinician who gives up and borrows a colleague's login,
 * which is the exact outcome the whole request flow exists to prevent.
 *
 * Carries no personal detail beyond a name and a role. The message travels to
 * whatever mailbox an administrator uses, which is not always one the
 * organisation controls, and the request itself is one click away behind a
 * session.
 */

import { sendEmail } from './index';
import type { EmailSendResult } from './provider';

export interface AccountRequestAlertInput {
  to: string;
  approverName: string;
  requesterName: string;
  roleLabel: string;
  organisationName?: string;
  facilityName?: string;
  queueUrl: string;
}

export function renderAccountRequestAlertEmail(
  input: AccountRequestAlertInput,
): { subject: string; body: string } {
  const where = [input.facilityName, input.organisationName].filter(Boolean).join(', ');
  const lines = [
    `Hello ${input.approverName},`,
    '',
    `${input.requesterName} has asked for a TamamHealth account.`,
    '',
    `  Role requested: ${input.roleLabel}`,
    ...(where ? [`  Where: ${where}`] : []),
    '',
    'They have confirmed their email address. Review the request here:',
    '',
    input.queueUrl,
    '',
    'Nobody has been granted anything yet — an account is only created when',
    'you approve it.',
    '',
    'Do not reply to this message.',
  ];
  return { subject: `Account request from ${input.requesterName}`, body: lines.join('\n') };
}

export async function sendAccountRequestAlertEmail(
  input: AccountRequestAlertInput,
): Promise<EmailSendResult> {
  const { subject, body } = renderAccountRequestAlertEmail(input);
  return sendEmail({ to: input.to, subject, body });
}
