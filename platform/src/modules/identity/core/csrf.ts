/**
 * CSRF token mint/verify — runs in the Next.js Edge runtime (middleware) and
 * in Node API routes. Implemented with Web Crypto so both work with the same
 * code path.
 *
 * Token shape:  base64url(nonce_16) + '.' + base64url(HMAC-SHA-256(secret, sub || nonce))
 *
 *   - The nonce is 16 random bytes per session — different from any other
 *     session, but stable across requests within the session.
 *   - The HMAC binds the token to the session subject (`sub`, the JWT user id).
 *     A token issued to user A can't be replayed against user B even if the
 *     attacker can read it; a network-injecting attacker can't forge a token
 *     that verifies against a target session because they don't have the
 *     server secret.
 *
 * The cookie holding this token is *non-httpOnly* so the browser can read it
 * and echo it in the X-CSRF-Token header. SameSite=strict means the cookie
 * doesn't ride along on cross-site navigations to begin with — the HMAC layer
 * is defence-in-depth on top of that, in case a future change weakens the
 * SameSite stance or a misbehaving browser ignores it.
 */

const ENCODER = new TextEncoder();

export const CSRF_COOKIE_NAME = 'tamamhealth-csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

const HARDCODED_FALLBACK = 'tamamhealth-south-sudan-health-2026-secret-key';

function getSecret(): string {
  const s = process.env.JWT_SECRET || HARDCODED_FALLBACK;
  if (process.env.NODE_ENV === 'production' && s === HARDCODED_FALLBACK) {
    throw new Error('[CSRF] JWT_SECRET must be set in production.');
  }
  return s;
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesFromBase64Url(s: string): Uint8Array {
  const pad = (4 - (s.length % 4)) % 4;
  const b64 = (s + '='.repeat(pad)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function hmac(message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    ENCODER.encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, ENCODER.encode(message));
  return new Uint8Array(sig);
}

/** Constant-time compare for two same-length byte arrays. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Mint a fresh CSRF token bound to the given session subject (JWT `sub`).
 * The same `sub` produces a *different* token on each call — clients should
 * keep using the cookie value the server set, not re-mint per request.
 */
export async function mintCsrfToken(sub: string): Promise<string> {
  const nonce = new Uint8Array(16);
  crypto.getRandomValues(nonce);
  const noncePart = base64UrlFromBytes(nonce);
  const sig = await hmac(`${sub}|${noncePart}`);
  return `${noncePart}.${base64UrlFromBytes(sig)}`;
}

/**
 * Verify a token presented by the client (cookie + header — caller must
 * confirm they match before calling this). Returns true iff the HMAC is
 * valid for the supplied session subject.
 */
export async function verifyCsrfToken(token: string, sub: string): Promise<boolean> {
  if (!token || !sub) return false;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return false;
  const noncePart = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);

  let providedSig: Uint8Array;
  try {
    providedSig = bytesFromBase64Url(sigPart);
  } catch {
    return false;
  }
  if (providedSig.length !== 32) return false;

  let expectedSig: Uint8Array;
  try {
    expectedSig = await hmac(`${sub}|${noncePart}`);
  } catch {
    return false;
  }
  return timingSafeEqual(providedSig, expectedSig);
}
