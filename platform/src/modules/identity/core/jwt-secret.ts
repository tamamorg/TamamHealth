/**
 * Single source of truth for JWT/HMAC signing-secret resolution and the
 * production refusal rules. Edge-safe: no node:crypto / fs, only process.env.
 *
 * Every signer (session tokens, patient-portal tokens, CSRF HMAC) uses the
 * same rules. CSRF used to refuse only the public fallback, so a short
 * production secret was rejected for tokens but accepted for CSRF; it now
 * clears the same 32-character floor.
 */

export const JWT_SECRET_FALLBACK = 'tamamhealth-south-sudan-health-2026-secret-key';

export function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET || JWT_SECRET_FALLBACK;
  const isProduction = process.env.NODE_ENV === 'production';
  const isServer = typeof window === 'undefined';
  if (isServer && isProduction && secret === JWT_SECRET_FALLBACK) {
    // Fail loudly instead of silently running with a public default. Any
    // production deploy MUST set JWT_SECRET (at least 32 bytes of entropy).
    throw new Error(
      '[SECURITY] JWT_SECRET environment variable must be set in production. ' +
      'Refusing to start with the default fallback secret.'
    );
  }
  if (isServer && isProduction && secret.length < 32) {
    throw new Error(
      '[SECURITY] JWT_SECRET must be at least 32 characters in production ' +
      `(got ${secret.length}). Generate one with: openssl rand -hex 32`
    );
  }
  return secret;
}
