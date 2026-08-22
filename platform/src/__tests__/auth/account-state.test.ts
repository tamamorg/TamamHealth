/**
 * @jest-environment node
 *
 * What a roster row says about an account.
 *
 * Both staff rosters showed one line — "Password reset required" or
 * "Credentials current" — which could not tell apart the three states an
 * administrator has to act on differently: an invitation nobody opened, an
 * account nobody has ever used, and an account that was used and abandoned.
 * `lastLoginAt` did not exist at all, so none of them was answerable.
 */
import { describeAccountState, canResendInvite, DORMANT_AFTER_DAYS } from '@/modules/identity/provisioning/account-state';
import type { UserDoc } from '@/lib/db-types';

const NOW = Date.parse('2026-08-22T09:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

const user = (over: Partial<UserDoc> = {}): UserDoc => ({
  _id: 'user-mary', type: 'user', username: 'mary.nyaboth', name: 'Mary Nyaboth',
  passwordHash: 'x', role: 'nurse', isActive: true,
  createdAt: daysAgo(200), updatedAt: daysAgo(200),
  ...over,
} as UserDoc);

describe('an outstanding invitation', () => {
  it('reads as waiting on the person, not on the administrator', () => {
    const state = describeAccountState(
      user({ inviteTokenHash: 'h', inviteExpiresAt: new Date(NOW + 3_600_000).toISOString() }),
      NOW,
    );
    expect(state.kind).toBe('invited');
    expect(state.needsAttention).toBe(false);
  });

  it('reads as an action for the administrator once it lapses', () => {
    // This is the state that was invisible: the mail may never have arrived,
    // and nothing on either roster said so.
    const state = describeAccountState(
      user({ inviteTokenHash: 'h', inviteExpiresAt: daysAgo(1) }),
      NOW,
    );
    expect(state.kind).toBe('invite_expired');
    expect(state.needsAttention).toBe(true);
    expect(state.label).toMatch(/send a new one/);
  });
});

describe('never used', () => {
  it('separates "never signed in" from "still on a temporary password"', () => {
    expect(describeAccountState(user(), NOW).kind).toBe('never_signed_in');
    expect(describeAccountState(user(), NOW).needsAttention).toBe(false);

    const temporary = describeAccountState(user({ mustChangePassword: true }), NOW);
    expect(temporary.kind).toBe('never_signed_in');
    expect(temporary.needsAttention).toBe(true);
  });
});

describe('in use', () => {
  it('flags an account still on an admin-issued credential', () => {
    const state = describeAccountState(
      user({ lastLoginAt: daysAgo(1), mustChangePassword: true }), NOW,
    );
    expect(state.kind).toBe('temporary_password');
    expect(state.needsAttention).toBe(true);
  });

  it('says when someone last signed in', () => {
    expect(describeAccountState(user({ lastLoginAt: daysAgo(0) }), NOW).label).toBe('Signed in today');
    expect(describeAccountState(user({ lastLoginAt: daysAgo(1) }), NOW).label).toBe('Signed in yesterday');
    expect(describeAccountState(user({ lastLoginAt: daysAgo(10) }), NOW).label).toBe('Signed in 10 days ago');
  });

  it('flags an abandoned account, which is what an access review looks for', () => {
    const state = describeAccountState(user({ lastLoginAt: daysAgo(DORMANT_AFTER_DAYS + 1) }), NOW);
    expect(state.kind).toBe('dormant');
    expect(state.needsAttention).toBe(true);
  });

  it('does not flag one just inside the window', () => {
    expect(describeAccountState(user({ lastLoginAt: daysAgo(DORMANT_AFTER_DAYS - 1) }), NOW).kind)
      .toBe('current');
  });
});

describe('offering to resend', () => {
  it('needs an address to send to', () => {
    expect(canResendInvite(user({ email: 'mary@example.org' }))).toBe(true);
    expect(canResendInvite(user())).toBe(false);
    expect(canResendInvite(user({ email: '   ' }))).toBe(false);
  });

  it('is not offered for a closed account', () => {
    // Re-inviting somebody who has left is the opposite of what the button
    // is for, and the route refuses it too.
    expect(canResendInvite(user({ email: 'mary@example.org', isActive: false }))).toBe(false);
  });
});
