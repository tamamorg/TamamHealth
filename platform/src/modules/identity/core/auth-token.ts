import { SignJWT, jwtVerify } from 'jose';
import { SESSION_TTL_SEC, SESSION_ABSOLUTE_MAX_SEC } from '@/modules/identity/core/session';
import { resolveJwtSecret } from '@/modules/identity/core/jwt-secret';

// Server-side secret (never leaves Node). All authoritative token creation and
// verification runs server-side, so the client never needs the signing key.
// The browser-side development fallback is intentionally separate from the
// server secret. Never read a NEXT_PUBLIC_* signing key here: this module is
// imported by client code and any such value would be bundled for every user.
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const JWT_SECRET = new TextEncoder().encode(resolveJwtSecret());

const JWT_ISSUER = 'tamamhealth';
const JWT_AUDIENCE_BASE = 'tamamhealth-web';
// Optional per-deployment audience (JWT_DEPLOYMENT_ID, server-side only). New
// tokens are minted for `tamamhealth-web:<id>`; verification accepts that AND
// the bare legacy audience, so turning the variable on does not sign anybody
// out. NOTE: the bare audience is accepted INDEFINITELY (nothing drops it), so
// JWT_DEPLOYMENT_ID does not yet isolate deployments: a token for the bare
// audience still verifies everywhere that shares the signing secret. It only
// isolates once the bare audience is removed from ACCEPTED_AUDIENCES, which
// signs out every session still carrying it, so that is a deliberate later
// step. Until then the per-deployment signing secret is the real isolation.
const DEPLOYMENT_ID = (process.env.JWT_DEPLOYMENT_ID || '').trim();
const JWT_AUDIENCE = DEPLOYMENT_ID ? `${JWT_AUDIENCE_BASE}:${DEPLOYMENT_ID}` : JWT_AUDIENCE_BASE;
const ACCEPTED_AUDIENCES = DEPLOYMENT_ID ? [JWT_AUDIENCE, JWT_AUDIENCE_BASE] : [JWT_AUDIENCE_BASE];

function newSessionId(): string {
  return globalThis.crypto.randomUUID();
}

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
  // Non-production servers may be reachable from the network (`next dev` binds
  // every interface), and an unsigned token is a login for any role. So it is
  // an explicit opt-in for a developer on loopback, not a default.
  if (process.env.ALLOW_INSECURE_DEV_TOKENS !== 'true') return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[2] !== 'dev-fallback') return null;
    const payload = JSON.parse(atob(parts[1]));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (payload.iss !== JWT_ISSUER || !ACCEPTED_AUDIENCES.includes(payload.aud)) return null;
    if (typeof payload.sat === 'number' && payload.sat + SESSION_ABSOLUTE_MAX_SEC < Math.floor(Date.now() / 1000)) return null;
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

export async function createToken(user: { _id: string; username: string; role: string; actualRole?: string; name: string; hospitalId?: string; hospitalName?: string; facilityIds?: string[]; orgId?: string; countryId?: string; payam?: string; county?: string; state?: string; mustChangePassword?: boolean; passwordUpdatedAt?: string; pwdAt?: number; ttlSeconds?: number; persist?: boolean; sid?: string; sessionStart?: number }): Promise<string> {
  const payload = {
    // Session id + original sign-in time. `sid` is minted at sign-in and
    // copied across every renewal, so revoking it kills the whole renewal
    // family (a stolen copy of an older token included). `sat` anchors the
    // absolute session ceiling. See session.ts / token-blacklist.ts.
    sid: user.sid ?? newSessionId(),
    sat: user.sessionStart ?? Math.floor(Date.now() / 1000),
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
    // Password epoch: tokens minted before the account's latest password
    // change are rejected by getAuthPayload / /api/auth/me, so a password
    // change or admin reset revokes every other session immediately.
    pwdAt: user.pwdAt ?? pwdAtClaim(user.passwordUpdatedAt),
    // "Keep me signed in" (login/page.tsx). Carried on the token — not just
    // decided once at cookie-issue time — so /api/auth/me's sliding renewal
    // (which re-mints the token and re-applies the cookies) knows whether the
    // ORIGINAL choice was a persistent cookie or a browser-session one, and
    // preserves it rather than defaulting every renewal back to persistent.
    // Undefined (every caller that predates this, and every non-staff-login
    // token, e.g. patient portal) means "persistent", matching the behaviour
    // before this claim existed.
    persist: user.persist === false ? false : true,
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
  /** Password epoch (unix seconds) — see createToken. */
  pwdAt?: number;
  /** Session id shared by every token in one sign-in's renewal chain. Absent
   *  on tokens minted before it existed. */
  sid?: string;
  /** When the original sign-in happened (unix seconds). Absent on old tokens. */
  sat?: number;
  /** Expiry (unix seconds). */
  exp?: number;
  /** Issued-at (unix seconds) — drives sliding session renewal. */
  iat?: number;
  /** "Keep me signed in" — see createToken. Absent on tokens minted before
   *  this claim existed; treat as persistent (`!== false`), not as false. */
  persist?: boolean;
}

export async function verifyToken(token: string): Promise<VerifiedTokenPayload | null> {
  // Try jose first (works server-side and on HTTPS)
  if (hasCryptoSubtle()) {
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET, {
        issuer: JWT_ISSUER,
        audience: ACCEPTED_AUDIENCES,
        // Pin the algorithm (never trust the header) and refuse tokens that
        // omit the claims every check downstream relies on.
        algorithms: ['HS256'],
        requiredClaims: ['exp', 'iat', 'sub'],
      });
      const claims = payload as unknown as VerifiedTokenPayload;
      // Absolute session ceiling. Tokens without `sat` (minted before this
      // existed) are accepted until their own exp; /api/auth/me anchors them
      // on first renewal.
      if (typeof claims.sat === 'number'
          && claims.sat + SESSION_ABSOLUTE_MAX_SEC < Math.floor(Date.now() / 1000)) {
        return null;
      }
      return claims;
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
      sid: fallback.sid as string | undefined,
      sat: fallback.sat as number | undefined,
      persist: fallback.persist as boolean | undefined,
    };
  }

  return null;
}

// ─── Second-factor hand-off token ───────────────────────────────────────────

