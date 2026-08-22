/**
 * Temporary-password generator for admin-provisioned accounts.
 *
 * Every place an administrator creates a user or resets a password uses this
 * one generator, so credentials handed to staff always have the same shape:
 * strong (CSPRNG), readable (no look-alike characters — 0/O, 1/l/I are
 * excluded), and safe to relay verbally or on paper in a clinic with no
 * email. The account is always written with `mustChangePassword: true`, so
 * whatever is generated here lives exactly one login.
 *
 * Client-safe: uses Web Crypto when available, falls back to Math.random only
 * in non-secure dev contexts where crypto.getRandomValues is missing.
 */

export const TEMP_PASSWORD_LENGTH = 14;

/**
 * A length that satisfies this deployment's policy.
 *
 * The generator's own default is 14, which clears the shipped minimum of 12 —
 * but an operator can raise `passwordMinLength` on /admin/security, and a
 * generated credential the server then rejects would make the create-user
 * dialog look broken. Never shorter than the default: a policy of 8 does not
 * mean the temporary password should get weaker.
 */
export function tempPasswordLengthFor(minLength: number): number {
  return Math.max(TEMP_PASSWORD_LENGTH, Math.trunc(minLength) || 0);
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

export function generateTempPassword(length = TEMP_PASSWORD_LENGTH): string {
  const out: string[] = [];
  const rand = (n: number) =>
    typeof crypto !== 'undefined' && crypto.getRandomValues
      ? crypto.getRandomValues(new Uint32Array(1))[0] % n
      : Math.floor(Math.random() * n);
  for (let i = 0; i < length; i++) out.push(ALPHABET[rand(ALPHABET.length)]);
  return out.join('');
}
