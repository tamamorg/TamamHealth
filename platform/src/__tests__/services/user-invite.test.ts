/**
 * @jest-environment node
 *
 * Account invitations — the token behind the "set your password" link.
 *
 * This is a credential that arrives by email and is redeemable without a
 * session, so the rules that matter are the ones that stop it being replayed,
 * outlived, or leaked: single use, expiring, never stored in the clear, and
 * never handed back to a browser.
 */

import {
  issueInvite, hashInviteToken, inviteHashMatches, isInviteExpired,
  buildInviteUrl, INVITE_TTL_HOURS,
} from '@/lib/user-invite';

describe('issuing', () => {
  test('the stored value is a hash, never the token itself', () => {
    // A database dump must not be replayable into an account takeover.
    const invite = issueInvite();
    expect(invite.tokenHash).not.toBe(invite.token);
    expect(invite.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(invite.tokenHash).toBe(hashInviteToken(invite.token));
  });

  test('tokens are unguessable and unique', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => issueInvite().token));
    expect(tokens.size).toBe(200);
    // base64url of 32 bytes — 43 chars, no padding to be mangled by a mail client.
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test('expiry is the documented window from the issuing moment', () => {
    const now = new Date('2026-08-21T10:00:00.000Z');
    const invite = issueInvite(now);
    const expected = new Date(now.getTime() + INVITE_TTL_HOURS * 3_600_000);
    expect(invite.expiresAt).toBe(expected.toISOString());
  });
});

describe('expiry', () => {
  const now = new Date('2026-08-21T10:00:00.000Z');

  test('a live invitation is not expired', () => {
    expect(isInviteExpired(new Date(now.getTime() + 60_000).toISOString(), now)).toBe(false);
  });

  test('the boundary is closed — an invitation expiring now is spent', () => {
    expect(isInviteExpired(now.toISOString(), now)).toBe(true);
  });

  test.each([
    ['missing', undefined],
    ['empty', ''],
    ['unparseable', 'whenever'],
  ])('a %s expiry counts as expired, not as forever', (_label, value) => {
    // The safe direction is to make someone request a new invitation; treating
    // an unreadable date as open-ended would be a permanent credential.
    expect(isInviteExpired(value as string | undefined, now)).toBe(true);
  });
});

describe('hash comparison', () => {
  test('matches an identical hash and rejects anything else', () => {
    const h = hashInviteToken('abc');
    expect(inviteHashMatches(h, h)).toBe(true);
    expect(inviteHashMatches(h, hashInviteToken('abd'))).toBe(false);
  });

  test('a length mismatch is rejected rather than throwing', () => {
    // timingSafeEqual throws on unequal lengths; a truncated value from a
    // malformed document must be a clean "no", not a 500.
    expect(inviteHashMatches(hashInviteToken('abc'), 'short')).toBe(false);
    expect(inviteHashMatches('', '')).toBe(true);
  });

  test.each([null, undefined, 42, {}])('non-string input %p is rejected', value => {
    expect(inviteHashMatches(value as unknown as string, 'x')).toBe(false);
  });
});

describe('the link', () => {
  const OLD = process.env.NEXT_PUBLIC_APP_URL;
  afterEach(() => { process.env.NEXT_PUBLIC_APP_URL = OLD; });

  test('is absolute and carries the token', () => {
    expect(buildInviteUrl('tok-123', 'https://app.tamamhealth.org'))
      .toBe('https://app.tamamhealth.org/accept-invite?token=tok-123');
  });

  test('url-encodes the token', () => {
    expect(buildInviteUrl('a+b/c=', 'https://x.org')).toContain('token=a%2Bb%2Fc%3D');
  });

  test('a trailing slash on the base does not double up', () => {
    expect(buildInviteUrl('t', 'https://x.org/')).toBe('https://x.org/accept-invite?token=t');
  });

  test('with no base URL there is no link at all', () => {
    // A relative link is useless in a mail client, so the caller is told it
    // cannot invite rather than sending a broken one.
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(buildInviteUrl('t')).toBeNull();
  });
});
