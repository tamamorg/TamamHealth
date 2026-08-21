/**
 * Account invitations — the token behind the "set your password" link a new
 * user receives by email.
 *
 * Why a link and not the password itself: a temporary password mailed in
 * plaintext lives in an inbox that is often shared at a facility, survives in
 * sent-mail and in mailbox backups, and is readable by anyone with access to
 * either. For a system holding patient records that is a credential leak with
 * a long tail. A single-use link that expires means the password only ever
 * exists in the head of the person who chose it.
 *
 * The raw token is returned to the caller exactly once, at issue time, and
 * never stored: the document keeps only a SHA-256 hash, so a database dump
 * cannot be replayed into an account takeover.
 *
 * SHA-256 rather than bcrypt is deliberate and is NOT the mistake it resembles.
 * bcrypt's cost exists to make guessing a low-entropy human password expensive.
 * This token is 32 random bytes; brute force is already impossible, and the
 * lookup happens on an unauthenticated endpoint where a deliberately slow hash
 * would hand anyone a denial-of-service lever.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * How long an invitation stays usable.
 *
 * Three days rather than a few hours: this platform is used where staff may
 * not reach a connection every day, and an invite that expires before it can
 * be opened means a second round-trip to an administrator who may be at
 * another facility. Long enough to be practical, short enough that a forgotten
 * mailbox is not an open door.
 */
export const INVITE_TTL_HOURS = 72;

/** A fresh invitation. `token` is shown once — only `tokenHash` is persisted. */
export interface IssuedInvite {
  token: string;
  tokenHash: string;
  expiresAt: string;
}

/** Mint an invitation. `now` is injectable so expiry is testable. */
export function issueInvite(now: Date = new Date()): IssuedInvite {
  // base64url of 32 bytes — 256 bits, URL-safe, no padding to mangle in a mail
  // client that decides to wrap or linkify the address.
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: hashInviteToken(token),
    expiresAt: new Date(now.getTime() + INVITE_TTL_HOURS * 3_600_000).toISOString(),
  };
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Constant-time hash comparison.
 *
 * The lookup is by hash, so a plain `===` would leak nothing an attacker could
 * not already measure — but this is the one comparison standing between a
 * guessed token and a staff account, and it costs nothing to do properly.
 */
export function inviteHashMatches(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function isInviteExpired(expiresAt: string | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return true;
  const at = Date.parse(expiresAt);
  // An unparseable expiry is treated as expired: the safe direction is to make
  // someone ask for a new invitation, never to honour a date we cannot read.
  return !Number.isFinite(at) || at <= now.getTime();
}

/**
 * The link that goes in the email.
 *
 * `NEXT_PUBLIC_APP_URL` is the deployment's own address; without it the link
 * would be relative and useless in a mail client, so callers that have no base
 * URL get `null` and must not send an invitation at all.
 */
export function buildInviteUrl(token: string, baseUrl?: string): string | null {
  const base = (baseUrl || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
  if (!base) return null;
  return `${base}/accept-invite?token=${encodeURIComponent(token)}`;
}

/**
 * What the create-user response tells the administrator about the invitation.
 *
 * Reported honestly rather than optimistically: if the mail gateway is
 * unconfigured or refused the message, the administrator has to know so they
 * hand the temporary password over another way instead of assuming an email
 * arrived that never will.
 */
export type InvitationOutcome =
  | { sent: true; to: string; expiresAt: string }
  | { sent: false; reason: 'no_email' | 'no_app_url' | 'not_configured' | 'send_failed' };
