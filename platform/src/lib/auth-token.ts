import { SignJWT, jwtVerify } from 'jose';
import { SESSION_TTL_SEC } from './session';

// Server-side secret (never leaves Node). All authoritative token creation and
// verification runs server-side, so the client never needs the signing key.
// The browser-side development fallback is intentionally separate from the
// server secret. Never read a NEXT_PUBLIC_* signing key here: this module is
// imported by client code and any such value would be bundled for every user.
const HARDCODED_FALLBACK = 'tamamhealth-south-sudan-health-2026-secret-key';
const secret =
  process.env.JWT_SECRET ||
  HARDCODED_FALLBACK;

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const IS_SERVER = typeof window === 'undefined';

if (IS_SERVER && IS_PRODUCTION && secret === HARDCODED_FALLBACK) {
  // Fail loudly instead of silently running with a public default. Any
  // production deploy MUST set JWT_SECRET (at least 32 bytes of entropy).
  throw new Error(
    '[SECURITY] JWT_SECRET environment variable must be set in production. ' +
    'Refusing to start with the default fallback secret.'
  );
}

if (IS_SERVER && IS_PRODUCTION && secret.length < 32) {
  throw new Error(
    '[SECURITY] JWT_SECRET must be at least 32 characters in production ' +
    `(got ${secret.length}). Generate one with: openssl rand -hex 32`
  );
}

const JWT_SECRET = new TextEncoder().encode(secret);

const JWT_ISSUER = 'tamamhealth';
const JWT_AUDIENCE = 'tamamhealth-web';

/**
 * Check if Web Crypto API is available.
 * crypto.subtle is only available in secure contexts (HTTPS or localhost).
 * When accessing via HTTP on a LAN IP (e.g., phone on local network), it's unavailable.
 */
function hasCryptoSubtle(): boolean {
  return typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.subtle !== 'undefined';
}

/**
 * Fallback token for non-secure contexts (DEVELOPMENT ONLY).
 * Uses base64-encoded JSON — NOT cryptographically secure.
 * In production this path is refused: we fail closed rather than accept
 * unsigned tokens on the wire.
 */
function createFallbackToken(payload: Record<string, unknown>): string {
  if (IS_PRODUCTION) {
    throw new Error('[SECURITY] Refusing to issue unsigned fallback token in production');
  }
  const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const body = btoa(JSON.stringify({
    ...payload,
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC,
  }));
  return `${header}.${body}.dev-fallback`;
}

function verifyFallbackToken(token: string): Record<string, unknown> | null {
  // Refuse unsigned tokens in production. The only way a token carrying the
  // literal "dev-fallback" signature could reach a production verifier is
  // token forgery, so reject unconditionally.
  if (IS_PRODUCTION) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[2] !== 'dev-fallback') return null;
    const payload = JSON.parse(atob(parts[1]));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (payload.iss !== JWT_ISSUER || payload.aud !== JWT_AUDIENCE) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Convert a user document's passwordUpdatedAt (ISO string) into the `pwdAt`
 * JWT claim (unix seconds). Returns undefined for absent/invalid input so
 * accounts predating the field keep working.
 */
export function pwdAtClaim(passwordUpdatedAt?: string): number | undefined {
  if (!passwordUpdatedAt) return undefined;
  const ms = Date.parse(passwordUpdatedAt);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

export async function createToken(user: { _id: string; username: string; role: string; actualRole?: string; name: string; hospitalId?: string; hospitalName?: string; facilityIds?: string[]; orgId?: string; countryId?: string; payam?: string; county?: string; state?: string; mustChangePassword?: boolean; mfaPending?: boolean; passwordUpdatedAt?: string; pwdAt?: number; ttlSeconds?: number }): Promise<string> {
  const payload = {
    sub: user._id,
    username: user.username,
    role: user.role,
    // Set only when a super-admin signed in AS another role from the login
    // role picker; carries the real account role for audit + session restore.
    actualRole: user.actualRole,
    name: user.name,
    hospitalId: user.hospitalId,
    hospitalName: user.hospitalName,
    // Extra facilities this user covers — see UserDoc.facilityIds.
    facilityIds: user.facilityIds,
    orgId: user.orgId,
    countryId: user.countryId,
    payam: user.payam,
    county: user.county,
    state: user.state,
    mustChangePassword: user.mustChangePassword,
    // The account's role obliges it to hold a second factor and it has not
    // enrolled one yet. Carried as a CLAIM rather than looked up per request
    // because the Edge proxy is where the gate has to run and it has no
    // database — and because the alternative, a client-side-only gate, is the
    // same mistake `mustChangePassword` made for a year. Re-minted the moment
    // enrolment completes, so it cannot go stale in the direction that locks
    // somebody out.
    mfaPending: user.mfaPending,
    // Password epoch: tokens minted before the account's latest password
    // change are rejected by getAuthPayload / /api/auth/me, so a password
    // change or admin reset revokes every other session immediately.
    pwdAt: user.pwdAt ?? pwdAtClaim(user.passwordUpdatedAt),
  };

  // A shorter life than the session default, where the caller asks for one.
  // The only user today is an impersonated session: `impersonationMaxMinutes`
  // is displayed on the security console, and a maximum duration that nothing
  // shortens is not a maximum.
  const ttl = user.ttlSeconds && user.ttlSeconds > 0
    ? Math.min(user.ttlSeconds, SESSION_TTL_SEC)
    : SESSION_TTL_SEC;

  // Use jose when crypto.subtle is available (HTTPS / localhost / server-side)
  if (hasCryptoSubtle()) {
    return new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setExpirationTime(`${ttl}s`)
      .sign(JWT_SECRET);
  }

  // Fallback for non-secure contexts (HTTP on LAN — dev only)
  console.warn('[Auth] crypto.subtle unavailable (non-HTTPS). Using dev fallback token.');
  return createFallbackToken(payload);
}

export interface VerifiedTokenPayload {
  sub: string;
  username: string;
  role: string;
  actualRole?: string;
  name: string;
  hospitalId?: string;
  hospitalName?: string;
  facilityIds?: string[];
  orgId?: string;
  countryId?: string;
  payam?: string;
  county?: string;
  state?: string;
  mustChangePassword?: boolean;
  /** Second-factor enrolment is required for this role and not yet done. */
  mfaPending?: boolean;
  /** Password epoch (unix seconds) — see createToken. */
  pwdAt?: number;
  /** Issued-at (unix seconds) — drives sliding session renewal. */
  iat?: number;
}

export async function verifyToken(token: string): Promise<VerifiedTokenPayload | null> {
  // Try jose first (works server-side and on HTTPS)
  if (hasCryptoSubtle()) {
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET, {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
      return payload as unknown as VerifiedTokenPayload;
    } catch {
      // Fall through to try fallback
    }
  }

  // Try fallback token (dev mode over HTTP)
  const fallback = verifyFallbackToken(token);
  if (fallback) {
    return {
      sub: fallback.sub as string,
      username: fallback.username as string,
      role: fallback.role as string,
      actualRole: fallback.actualRole as string | undefined,
      name: fallback.name as string,
      hospitalId: fallback.hospitalId as string | undefined,
      orgId: fallback.orgId as string | undefined,
      countryId: fallback.countryId as string | undefined,
      payam: fallback.payam as string | undefined,
      county: fallback.county as string | undefined,
      state: fallback.state as string | undefined,
      mustChangePassword: fallback.mustChangePassword as boolean | undefined,
      pwdAt: fallback.pwdAt as number | undefined,
      iat: fallback.iat as number | undefined,
    };
  }

  return null;
}

// ─── Second-factor hand-off token ───────────────────────────────────────────

/**
 * A DIFFERENT audience from the session token, and that is the whole design.
 *
 * Between "your password is correct" and "you are signed in" there is a state
 * the server has to remember across two requests. The patient portal solves it
 * with a server-side challenge store; staff sign-in cannot, because the
 * platform runs on multiple replicas and a challenge in one instance's memory
 * is a coin-flip on the next request.
 *
 * So the state travels with the client, signed. The audience claim is what
 * keeps it from being a session: `verifyToken` demands `tamamhealth-web` and
 * will not accept this token for any authenticated request, no matter where it
 * is presented. It proves one thing — that a password was verified for this
 * subject, minutes ago — and it is exchanged for a real session only by
 * /api/auth/verify-mfa, after a code is checked.
 */
const MFA_AUDIENCE = 'tamamhealth-mfa-pending';

/**
 * Five minutes. Long enough to open an authenticator app, find the entry and
 * type six digits on a phone with a cracked screen; short enough that a token
 * left in a browser's network log is not a standing half-credential.
 */
export const MFA_PENDING_TTL_SEC = 300;

export interface MfaPendingClaims {
  sub: string;
  /** The role the user asked to sign in AS — the login role picker's choice,
   *  which must survive the second-factor step or a super-admin would be
   *  silently dropped back into their own role after entering a code. */
  requestedRole?: string;
  /** Facility the login form pinned, carried for the same reason. */
  hospitalId?: string;
}

export async function createMfaPendingToken(claims: MfaPendingClaims): Promise<string> {
  if (!hasCryptoSubtle()) {
    // No unsigned fallback here, in production or out of it. An unsigned
    // second-factor hand-off is a token anyone can mint for any subject, which
    // would turn MFA into a formality rather than a factor.
    throw new Error('[SECURITY] Cannot issue a second-factor token without Web Crypto');
  }
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(MFA_AUDIENCE)
    .setExpirationTime(`${MFA_PENDING_TTL_SEC}s`)
    .sign(JWT_SECRET);
}

export async function verifyMfaPendingToken(token: string): Promise<MfaPendingClaims | null> {
  if (!hasCryptoSubtle()) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: MFA_AUDIENCE,
    });
    if (typeof payload.sub !== 'string' || !payload.sub) return null;
    return {
      sub: payload.sub,
      requestedRole: typeof payload.requestedRole === 'string' ? payload.requestedRole : undefined,
      hospitalId: typeof payload.hospitalId === 'string' ? payload.hospitalId : undefined,
    };
  } catch {
    return null;
  }
}
