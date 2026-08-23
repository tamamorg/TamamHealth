/**
 * What to tell the administrator about the invitation email.
 *
 * `/api/users` attempts an invite on EVERY account it creates and reports the
 * outcome, but only `/org-admin/users` ever read that field — and it phrased
 * the answer inline. `/admin/users` and the create-organization flow threw the
 * outcome away and unconditionally showed a temporary password, so an operator
 * was never told whether a link had already gone out, nor that the account had
 * no email address to send one to.
 *
 * Kept apart from `lib/user-invite.ts` on purpose: that module imports
 * `node:crypto` and cannot be pulled into a client bundle. This is copy.
 */
import type { InvitationOutcome } from '@/modules/identity/provisioning/user-invite';

export interface InvitationCopy {
  /** The sentence under the modal title. */
  message: string;
  /**
   * Whether the temporary password still has to be handed over by other means.
   * False only when a link genuinely reached a mailbox.
   */
  mustSharePassword: boolean;
}

const SHARE = 'Share these credentials securely. The user must change the password at first login.';

export function describeInvitationOutcome(invitation?: InvitationOutcome): InvitationCopy {
  if (!invitation) return { message: SHARE, mustSharePassword: true };
  if (invitation.sent) {
    return {
      message: `An invitation was emailed to ${invitation.to}. They choose their own password from it — `
        + 'you only need to share the one below if the email does not arrive.',
      mustSharePassword: false,
    };
  }
  switch (invitation.reason) {
    case 'no_email':
      return {
        message: 'This account has no email address, so no invitation could be sent. '
          + SHARE,
        mustSharePassword: true,
      };
    case 'not_configured':
      // Name the setting. "Email is not configured" reads as a defect to the
      // administrator in front of it, when it is a deployment setting nobody
      // has filled in yet — and the person who can fix it is often the same
      // person reading this.
      return {
        message: 'Email is not configured on this deployment, so no invitation was sent. '
          + 'To send invitations automatically, set EMAIL_PROVIDER (sendgrid, resend or smtp) '
          + 'and its key in the deployment environment. ' + SHARE,
        mustSharePassword: true,
      };
    case 'no_app_url':
      return {
        message: 'No application URL is configured, so the invitation link could not be built. '
          + 'Set NEXT_PUBLIC_APP_URL in the deployment environment. ' + SHARE,
        mustSharePassword: true,
      };
    case 'send_failed':
    default:
      return {
        message: 'The invitation email could not be sent. ' + SHARE,
        mustSharePassword: true,
      };
  }
}
