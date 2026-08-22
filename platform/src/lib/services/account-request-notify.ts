/**
 * Telling the two people an account request concerns: the person who made it,
 * and whoever is allowed to grant it.
 *
 * WHY EMAIL AND NOT THE NOTIFICATION BELL. The in-app notification list is
 * derived client-side from replicated databases (`hooks/useNotifications.ts`),
 * and `tamamhealth_account_requests` deliberately does NOT replicate — a
 * requester's name, email and phone must not land on every device in the
 * facility. So the bell structurally cannot see this queue, and the choice is
 * between mail and nothing. It was nothing.
 *
 * Every send is best-effort. A request must be recorded whether or not a mail
 * gateway answered, and a verification link that failed to send is recoverable
 * (submit the form again) in a way a lost request is not.
 */

import type { AccountRequestDoc, UserDoc } from '../db-types';
import { buildAppUrl } from '../user-invite';
import { INVITE_TTL_HOURS } from '../user-invite';
import { ROLE_LABEL } from '../role-display';

/** Where an approver lands to act on the queue, by tier. */
function queuePathFor(tier: AccountRequestDoc['approverTier']): string {
  return tier === 'super_admin' ? '/admin/users?tab=requests' : '/org-admin/users?tab=requests';
}

function roleLabelFor(doc: AccountRequestDoc): string {
  return ROLE_LABEL[doc.requestedRole] || doc.requestedRole.replace(/_/g, ' ');
}

/**
 * Step one: ask the address to prove itself.
 *
 * Nothing reaches an approver until this token comes back, so this message is
 * the request's only route forward. It is still best-effort — if the gateway
 * is down the person submits again and gets a fresh token, which is a far
 * better failure than an approver acting on an address nobody checked.
 */
export async function notifyRequestSubmitted(
  doc: AccountRequestDoc,
  verificationToken: string,
): Promise<void> {
  try {
    const verifyUrl = buildAppUrl(`/request-account?verify=${encodeURIComponent(verificationToken)}`);
    if (!verifyUrl) return;
    const { sendAccountRequestVerifyEmail } = await import('../email/account-request-verify');
    await sendAccountRequestVerifyEmail({
      to: doc.email,
      name: doc.fullName,
      roleLabel: roleLabelFor(doc),
      organisationName: doc.orgName,
      verifyUrl,
      expiresInHours: INVITE_TTL_HOURS,
    });
  } catch {
    /* a request that was recorded but not acknowledged is still a request */
  }
}

/**
 * Step two: tell the approvers, once the address is confirmed.
 *
 * Resolved from the SAME rule that decides who may act on the request
 * (`approverTier` + `orgId`), rather than a second list that could drift out
 * of step with it — mailing somebody a request they will then be refused
 * permission to open is worse than mailing nobody.
 */
export async function notifyApproversOfRequest(doc: AccountRequestDoc): Promise<number> {
  try {
    const queueUrl = buildAppUrl(queuePathFor(doc.approverTier));
    if (!queueUrl) return 0;

    const { getAllUsers } = await import('./user-service');
    const users = await getAllUsers();
    const approvers = users.filter((user: UserDoc) => {
      if (user.isActive === false || !user.email) return false;
      if (doc.approverTier === 'super_admin') return user.role === 'super_admin';
      return user.role === 'org_admin' && !!doc.orgId && user.orgId === doc.orgId;
    });
    if (approvers.length === 0) return 0;

    const { sendAccountRequestAlertEmail } = await import('../email/account-request-alert');
    const results = await Promise.all(approvers.map(approver =>
      sendAccountRequestAlertEmail({
        to: approver.email!,
        approverName: approver.name,
        requesterName: doc.fullName,
        roleLabel: roleLabelFor(doc),
        organisationName: doc.orgName,
        facilityName: doc.hospitalName,
        queueUrl,
      }).catch(() => ({ ok: false as const, providerId: 'error', error: 'send_failed' }))));
    return results.filter(result => result.ok).length;
  } catch {
    return 0;
  }
}
