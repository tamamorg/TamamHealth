/**
 * What a staff roster row should SAY about an account, in one place.
 *
 * The two rosters (`/admin/users`, `/org-admin/users`) each showed one line —
 * "Password reset required" or "Credentials current" — and that line could not
 * distinguish the three states an administrator actually needs to tell apart:
 *
 *   - an invitation that was sent and never opened (the mail gateway may be
 *     broken, or the address may be wrong, and nobody would ever know);
 *   - an account nobody has ever signed in to;
 *   - an account that was used and then abandoned, which is what a periodic
 *     access review exists to find.
 *
 * `lastLoginAt` did not exist at all until this shipped, so none of the three
 * was answerable. The wording lives here rather than in either page so the two
 * cannot drift into describing the same account differently.
 *
 * No database or React imports — read by both client pages and by tests.
 */

import type { UserDoc } from '@/lib/db-types';
import { isInviteExpired } from '@/modules/identity/provisioning/invite-window';

export type AccountStateKind =
  | 'invited'
  | 'invite_expired'
  | 'never_signed_in'
  | 'temporary_password'
  | 'dormant'
  | 'current';

export interface AccountState {
  kind: AccountStateKind;
  /** One short line for the roster row. */
  label: string;
  /** Whether this row is asking the administrator to do something. */
  needsAttention: boolean;
}

/** No sign-in for this long counts as dormant. Matches the access-review default. */
export const DORMANT_AFTER_DAYS = 90;

function daysSince(iso: string | undefined, now: number): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return Math.floor((now - at) / 86_400_000);
}

/**
 * Describe an account, most actionable state first.
 *
 * Order matters and is deliberate: an outstanding invitation outranks
 * "never signed in" because they are the same fact with different next steps —
 * one is waiting on the person, the other is waiting on the administrator.
 */
export function describeAccountState(user: UserDoc, now: number = Date.now()): AccountState {
  if (user.inviteTokenHash) {
    if (isInviteExpired(user.inviteExpiresAt, new Date(now))) {
      return {
        kind: 'invite_expired',
        label: 'Invitation expired — send a new one',
        needsAttention: true,
      };
    }
    return { kind: 'invited', label: 'Invited — waiting for them to set a password', needsAttention: false };
  }

  if (!user.lastLoginAt) {
    // An account created before `lastLoginAt` existed also has none, so this
    // is stated as a fact about the record rather than an accusation.
    return {
      kind: 'never_signed_in',
      label: user.mustChangePassword ? 'Never signed in — still on a temporary password' : 'No sign-in recorded',
      needsAttention: Boolean(user.mustChangePassword),
    };
  }

  if (user.mustChangePassword) {
    return { kind: 'temporary_password', label: 'On a temporary password', needsAttention: true };
  }

  const idle = daysSince(user.lastLoginAt, now);
  if (idle !== null && idle >= DORMANT_AFTER_DAYS) {
    return { kind: 'dormant', label: `No sign-in for ${idle} days`, needsAttention: true };
  }

  if (idle === 0) return { kind: 'current', label: 'Signed in today', needsAttention: false };
  if (idle === 1) return { kind: 'current', label: 'Signed in yesterday', needsAttention: false };
  return { kind: 'current', label: `Signed in ${idle} days ago`, needsAttention: false };
}

/** Whether a "Send invitation again" action makes sense for this account. */
export function canResendInvite(user: UserDoc): boolean {
  return user.isActive !== false && Boolean(user.email?.trim());
}
