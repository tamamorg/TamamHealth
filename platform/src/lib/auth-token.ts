import { SignJWT, jwtVerify } from 'jose';

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
    exp: Math.floor(Date.now() / 1000) + 28800, // 8h
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

export async function createToken(user: { _id: string; username: string; role: string; actualRole?: string; name: string; hospitalId?: string; hospitalName?: string; orgId?: string; countryId?: string; payam?: string; county?: string; state?: string; mustChangePassword?: boolean }): Promise<string> {
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
    orgId: user.orgId,
    countryId: user.countryId,
    payam: user.payam,
    county: user.county,
    state: user.state,
    mustChangePassword: user.mustChangePassword,
  };

  // Use jose when crypto.subtle is available (HTTPS / localhost / server-side)
  if (hasCryptoSubtle()) {
    return new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setExpirationTime('8h')
      .sign(JWT_SECRET);
  }

  // Fallback for non-secure contexts (HTTP on LAN — dev only)
  console.warn('[Auth] crypto.subtle unavailable (non-HTTPS). Using dev fallback token.');
  return createFallbackToken(payload);
}

export async function verifyToken(token: string): Promise<{
  sub: string;
  username: string;
  role: string;
  actualRole?: string;
  name: string;
  hospitalId?: string;
  hospitalName?: string;
  orgId?: string;
  countryId?: string;
  payam?: string;
  county?: string;
  state?: string;
  mustChangePassword?: boolean;
} | null> {
  // Try jose first (works server-side and on HTTPS)
  if (hasCryptoSubtle()) {
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET, {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
      return payload as {
        sub: string;
        username: string;
        role: string;
        actualRole?: string;
        name: string;
        hospitalId?: string;
        hospitalName?: string;
        orgId?: string;
        countryId?: string;
        payam?: string;
        county?: string;
        state?: string;
        mustChangePassword?: boolean;
      };
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
    };
  }

  return null;
}
