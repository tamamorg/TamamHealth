/**
 * Which password minimum THIS deployment enforces.
 *
 * Split from `password-policy.ts` because answering the question needs the
 * platform config database, and the rules themselves are read by client
 * components that must not pull PouchDB into the browser bundle.
 *
 * `superAdminPolicies.passwordMinLength` is the value shown on
 * /admin/security. It was displayed there from the day the screen shipped and
 * read by nothing, so an operator who raised it to 16 changed a number on a
 * page and no passwords. This module is the other half of that control.
 */

import {
  ABSOLUTE_MIN_PASSWORD_LENGTH, DEFAULT_MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH,
  assertPasswordAcceptable, screenPassword,
} from './password-policy';

/**
 * Short-lived cache.
 *
 * Every set-password path calls this, and the platform config is a single
 * document that changes when an operator edits a form — perhaps twice a year.
 * Thirty seconds keeps a password change from making an extra database round
 * trip while still letting a policy edit take effect during the same sitting.
 */
const CACHE_TTL_MS = 30_000;
let cached: { value: number; at: number } | null = null;

/** Test hook — drops the memoised policy so a new config value takes effect. */
export function _resetPasswordPolicyCache(): void {
  cached = null;
}

/**
 * The enforced minimum length, clamped into a range the platform can honour.
 *
 * Clamping is not defensive tidiness. The policy value comes from a number
 * input on an admin screen: without a floor, a typo of `4` would weaken every
 * account created afterwards, and without a ceiling a typo of `400` would make
 * it impossible to set any password at all — locking out the operator who made
 * the mistake.
 *
 * Fails to the DEFAULT, never to the floor: a platform config that cannot be
 * read is an infrastructure problem, and the safe direction is the stricter
 * of the two answers.
 */
export async function getMinPasswordLength(now: number = Date.now()): Promise<number> {
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;
  let value = DEFAULT_MIN_PASSWORD_LENGTH;
  try {
    const { getPlatformConfig } = await import('./services/platform-config-service');
    const configured = (await getPlatformConfig()).superAdminPolicies?.passwordMinLength;
    if (typeof configured === 'number' && Number.isFinite(configured)) {
      value = Math.trunc(configured);
    }
  } catch {
    value = DEFAULT_MIN_PASSWORD_LENGTH;
  }
  value = Math.min(MAX_PASSWORD_LENGTH, Math.max(ABSOLUTE_MIN_PASSWORD_LENGTH, value));
  cached = { value, at: now };
  return value;
}

/**
 * Screen a password against this deployment's policy. Returns the message to
 * show, or null when it is acceptable.
 */
export async function screenPasswordForDeployment(
  password: string,
  identifiers: readonly string[] = [],
): Promise<string | null> {
  return screenPassword({ password, minLength: await getMinPasswordLength(), identifiers });
}

/** Throwing form — raises `PasswordPolicyError`. */
export async function assertPasswordForDeployment(
  password: string,
  identifiers: readonly string[] = [],
): Promise<void> {
  assertPasswordAcceptable({ password, minLength: await getMinPasswordLength(), identifiers });
}
