/**
 * Manager override, server side: check another staff member's password on the
 * cashier's device without signing them in.
 *
 * Why online-only: the device holds one offline credential (the person who
 * signed in) and, in production, no other staff password hash, so an approver
 * cannot be verified without the server. The password is checked by the same
 * routine as sign-in and is never stored, returned or logged.
 */
import type { AuthPayload } from '@/modules/identity';
import { authenticateUser } from '@/modules/identity';
import { logAuditSafe } from './audit-service';
import { overrideRefusal, OVERRIDE_REFUSAL_MESSAGE, type ManagerApproval, type OverrideRefusal } from '../billing/manager-override-policy';

export type ManagerOverrideResult =
  | { ok: true; approval: ManagerApproval }
  | { ok: false; code: 'BAD_CREDENTIALS' | OverrideRefusal; message: string };

export async function verifyManagerOverride(input: {
  username: string;
  password: string;
  requester: Pick<AuthPayload, 'sub' | 'username' | 'name' | 'orgId' | 'hospitalId'> & { role: string };
  /** What is being approved, for the audit row ("waiver of 50 SSP"). */
  purpose: string;
}): Promise<ManagerOverrideResult> {
  const username = input.username.trim().toLowerCase();
  const { requester } = input;
  // Typing your own username is refused before any password check.
  if (username === requester.username.toLowerCase()) {
    return { ok: false, code: 'self', message: OVERRIDE_REFUSAL_MESSAGE.self };
  }
  const user = await authenticateUser(username, input.password);
  if (!user) {
    void logAuditSafe('manager_override_failed', requester.sub, requester.name,
      `Manager override refused: wrong credentials for ${username.slice(0, 64)}`, false);
    return { ok: false, code: 'BAD_CREDENTIALS', message: 'The username or password is incorrect.' };
  }
  const refusal = overrideRefusal(
    { id: user._id, role: user.role, orgId: user.orgId, hospitalId: user.hospitalId, facilityIds: user.facilityIds },
    { id: requester.sub, role: requester.role, orgId: requester.orgId, hospitalId: requester.hospitalId },
  );
  if (refusal) {
    void logAuditSafe('manager_override_failed', requester.sub, requester.name,
      `Manager override refused (${refusal}) for ${user.username}`, false);
    return { ok: false, code: refusal, message: OVERRIDE_REFUSAL_MESSAGE[refusal] };
  }
  const approval: ManagerApproval = {
    approvedBy: user._id, approvedByName: user.name, approvedByRole: user.role, approvedAt: new Date().toISOString(),
  };
  await logAuditSafe('manager_override_granted', user._id, user.name,
    `${user.name} approved ${input.purpose} at the device of ${requester.name} (${requester.sub})`, true);
  return { ok: true, approval };
}
