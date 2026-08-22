/**
 * Getting a set-your-password link to the person who needs it.
 *
 * This lived inside `POST /api/users` as a local function, which meant only
 * ONE of the two ways an account can be created ever sent an invitation. The
 * other — approving an account request — called `createUser` directly and
 * handed the approver a temporary password to relay by phone, even though the
 * requester had typed their email address into the form for exactly this
 * purpose. Two provisioning entry points had already been collapsed onto one
 * write path; this collapses them onto one delivery path too.
 *
 * Three callers now share it:
 *   - `POST /api/users`                    — an administrator creates an account
 *   - `POST /api/account-requests/:id`     — an approver grants a request
 *   - `POST /api/auth/forgot-password`     — a user asks to set a new password
 *
 * It never throws. A mail gateway that is down, unconfigured, or missing a
 * base URL must not fail account creation: the account is the thing that
 * matters, and the caller reports the outcome so an administrator knows
 * whether to hand the temporary password over another way instead of assuming
 * mail arrived.
 */

import type { UserDoc, UserRole } from '../db-types';
import type { InvitationOutcome } from '../user-invite';
import { logApiError } from '../api-auth';

/**
 * Why the link is being sent.
 *
 * The token, the expiry and the redemption endpoint are identical — setting a
 * password you have never had and replacing one you have forgotten are the
 * same operation on the same document. Only the words differ, and sending
 * someone a "welcome, an account has been created for you" message when they
 * asked to reset a password they have used for a year is the kind of small
 * wrongness that makes people distrust the mail and phone the administrator
 * anyway.
 */
export type InvitePurpose = 'invite' | 'reset';

/**
 * Issue an invitation for `user` and mail it.
 *
 * Re-issuing overwrites any outstanding invitation, so a resent invite
 * silently invalidates the first — which is what an administrator means by
 * "send it again", and what makes this safe to call repeatedly.
 */
export async function deliverAccountInvite(
  user: UserDoc,
  purpose: InvitePurpose = 'invite',
): Promise<InvitationOutcome> {
  const to = user.email?.trim();
  if (!to) return { sent: false, reason: 'no_email' };

  try {
    const [
      { issueUserInvite },
      { buildInviteUrl, INVITE_TTL_HOURS },
      { sendWelcomeEmail },
      { sendPasswordResetEmail },
      { ROLE_LABEL },
      { wasDelivered },
    ] = await Promise.all([
      import('./user-service'),
      import('../user-invite'),
      import('../email/user-welcome'),
      import('../email/password-reset'),
      import('../role-display'),
      import('../email'),
    ]);

    const invite = await issueUserInvite(user._id);
    if (!invite) return { sent: false, reason: 'send_failed' };

    const inviteUrl = buildInviteUrl(invite.token, undefined, purpose === 'reset');
    // Without a base URL the link would be relative and useless in a mail
    // client, so say so rather than sending a broken invitation.
    if (!inviteUrl) return { sent: false, reason: 'no_app_url' };

    const result = purpose === 'reset'
      ? await sendPasswordResetEmail({
        to,
        name: user.name,
        username: user.username,
        resetUrl: inviteUrl,
        expiresInHours: INVITE_TTL_HOURS,
      })
      : await sendWelcomeEmail({
        to,
        name: user.name,
        username: user.username,
        roleLabel: ROLE_LABEL[user.role as UserRole] || user.role.replace(/_/g, ' '),
        facilityName: user.hospitalName,
        organisationName: user.orgName,
        inviteUrl,
        expiresInHours: INVITE_TTL_HOURS,
      });

    // `result.ok` is true even from the log provider, which delivers nothing.
    // Reporting that as sent is the one failure mode this whole fallback
    // exists to avoid: the administrator would not hand over the temporary
    // password and the account would be unreachable.
    if (wasDelivered(result)) return { sent: true, to, expiresAt: invite.expiresAt };
    return { sent: false, reason: result.ok ? 'not_configured' : 'send_failed' };
  } catch (err) {
    logApiError('[invite-delivery]', err);
    return { sent: false, reason: 'send_failed' };
  }
}
