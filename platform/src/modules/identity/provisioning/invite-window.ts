/**
 * The parts of an invitation that involve no secrets: how long it lasts, and
 * where its link points.
 *
 * Split out of `invite-token.ts` because both are needed in a browser and that
 * one is not. `account-state.ts` asks whether an invitation has lapsed in order
 * to label a roster row, and a staff roster is a client component — so before
 * this split, rendering a list of colleagues pulled `node:crypto` into the
 * client graph to answer a question about a date.
 *
 * Nothing here is a credential, so nothing here needs to be server-only.
 */

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

export function isInviteExpired(expiresAt: string | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return true;
  const at = Date.parse(expiresAt);
  // An unparseable expiry is treated as expired: the safe direction is to make
  // someone ask for a new invitation, never to honour a date we cannot read.
  return !Number.isFinite(at) || at <= now.getTime();
}

/**
 * An absolute URL into this deployment, or null when it has no address
 * configured.
 *
 * `NEXT_PUBLIC_APP_URL` is the deployment's own address. Every emailed link
 * goes through here, because a relative URL in a mail client is not a broken
 * link — it is a link that silently does nothing, which is worse. Callers with
 * no base URL get `null` and must not send the message at all.
 */
export function buildAppUrl(path: string, baseUrl?: string): string | null {
  const base = (baseUrl || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
  if (!base) return null;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/** The set-your-password link that goes in an invitation or a reset email. */
export function buildInviteUrl(token: string, baseUrl?: string, isReset = false): string | null {
  // One page redeems both: setting a password you never had and replacing one
  // you forgot are the same operation on the same document. `reset=1` only
  // changes what the page SAYS — it is not a credential and not trusted for
  // anything, so a user who edits it out of the URL simply sees the other
  // wording and redeems exactly the same token.
  const suffix = isReset ? '&reset=1' : '';
  return buildAppUrl(`/accept-invite?token=${encodeURIComponent(token)}${suffix}`, baseUrl);
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
