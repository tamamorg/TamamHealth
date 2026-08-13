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
