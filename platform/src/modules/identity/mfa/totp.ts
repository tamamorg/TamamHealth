/**
 * Time-based one-time passwords (RFC 6238), for staff second-factor sign-in.
 *
 * WHY THIS EXISTS: `/admin/security` has displayed "Require MFA: On" since the
 * screen shipped, and nothing anywhere read the flag. Patients got a real
 * second factor — an SMS code, in `patient-portal-otp.ts` — while the people
 * holding write access to every chart in the facility got a password. That is
 * the wrong way round.
 *
 * WHY TOTP AND NOT SMS: the patient OTP path exists because a patient's phone
 * number is the only channel a hospital reliably has for them. Staff are
 * different. SMS in this deployment's setting fails closed often enough that a
 * ward would be locked out of its own records by a network outage, and the
 * patient code already says as much in its own comments. TOTP needs no
 * network at the moment of use — which, on an offline-first platform, is the
 * whole argument.
 *
 * WHY NO DEPENDENCY: TOTP is an HMAC, a counter and a modulo. The
 * implementation below is ~60 lines against `node:crypto`, and a credential
 * primitive is a poor place to inherit a supply chain.
 *
 * SHA-1 is deliberate. It is what every authenticator app defaults to, and the
 * construction here is HMAC — its security does not rest on collision
 * resistance. Choosing SHA-256 would be marginally stronger in theory and
 * silently incompatible with the apps people actually have installed.
 *
 * Server-only: uses `node:crypto`.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Seconds per code. 30 is the universal default; changing it breaks every app. */
export const TOTP_STEP_SECONDS = 30;

/** Digits per code. Six, for the same reason. */
export const TOTP_DIGITS = 6;

/**
 * How many steps either side of "now" are accepted.
 *
 * One step (±30s) tolerates the clock drift of a cheap phone and the seconds
 * between reading a code and pressing the button. Widening it to two would
 * triple the guess surface for no practical gain; narrowing it to zero would
 * reject people whose phone is fifteen seconds fast, which is most of them.
 */
export const TOTP_WINDOW_STEPS = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32, unpadded — the encoding every authenticator app expects. */
export function base32Encode(buffer: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

/** Inverse of `base32Encode`. Ignores spaces and case, as apps do on paste. */
export function base32Decode(input: string): Uint8Array {
  const clean = input.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 character in secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/**
 * A fresh shared secret, base32-encoded.
 *
 * 20 bytes (160 bits) is the size RFC 4226 specifies for HMAC-SHA1 and what
 * every authenticator expects; longer secrets are accepted by some apps and
 * silently mangled by others.
 */
export function generateTotpSecret(): string {
  return base32Encode(new Uint8Array(randomBytes(20)));
}

/** The counter value for a moment in time. */
export function totpStep(now: number = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_STEP_SECONDS);
}

/** The code for one counter value, zero-padded to `TOTP_DIGITS`. */
export function totpCodeForStep(secret: string, step: number): string {
  const key = base32Decode(secret);
  const counter = new Uint8Array(8);
  // Two 32-bit halves: `setBigUint64` would work, but step fits in 32 bits
  // until the year 6053 and this avoids a BigInt on a hot path.
  const counterView = new DataView(counter.buffer);
  counterView.setUint32(0, Math.floor(step / 0x100000000));
  counterView.setUint32(4, step >>> 0);

  const digest = createHmac('sha1', key).update(counter).digest();
  // Dynamic truncation, RFC 4226 §5.4.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/** The code for right now — used by tests and by the enrolment confirmation. */
export function totpCode(secret: string, now: number = Date.now()): string {
  return totpCodeForStep(secret, totpStep(now));
}

/**
 * Verify a submitted code.
 *
 * Returns the counter step that matched, or null. The STEP is returned rather
 * than a boolean because the caller must persist it: a TOTP code stays valid
 * for its whole window, so without recording which step was spent, a code
 * read over someone's shoulder — or captured from a shared screen — can be
 * replayed for the next thirty seconds. `lastUsedStep` closes that.
 */
export function verifyTotpCode(
  secret: string,
  code: string,
  options: { now?: number; lastUsedStep?: number } = {},
): number | null {
  const submitted = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(submitted)) return null;

  const current = totpStep(options.now ?? Date.now());
  for (let drift = -TOTP_WINDOW_STEPS; drift <= TOTP_WINDOW_STEPS; drift++) {
    const step = current + drift;
    // Already spent: a replay, not a fresh proof of possession.
    if (options.lastUsedStep !== undefined && step <= options.lastUsedStep) continue;
    let expected: string;
    try {
      expected = totpCodeForStep(secret, step);
    } catch {
      return null;
    }
    if (constantTimeEquals(expected, submitted)) return step;
  }
  return null;
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * The `otpauth://` URI an authenticator app imports.
 *
 * Rendered as text for the user to type, not as a QR code: drawing a QR needs
 * either a dependency or a few hundred lines of error-correction maths, and
 * every authenticator worth using accepts a manually entered key. The secret
 * is grouped in fours by the caller so it can be typed without losing place.
 */
export function buildOtpauthUri(secret: string, account: string, issuer = 'TamamHealth'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Group a secret in fours — `JBSW Y3DP EHPK 3PXP` — so it can be read aloud. */
export function formatSecretForDisplay(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? []).join(' ');
}

// ─── Recovery codes ─────────────────────────────────────────────────────────

/** How many single-use recovery codes are issued at enrolment. */
export const RECOVERY_CODE_COUNT = 10;

/**
 * Single-use codes for the phone that is lost, broken, or wiped.
 *
 * Without these, enabling MFA in a rural facility means one dropped handset
 * costs a clinician their access until a platform operator can be reached —
 * which, for a deployment whose whole premise is intermittent connectivity, is
 * a worse failure than the one MFA prevents.
 *
 * The alphabet excludes look-alike characters for the same reason
 * `temp-password.ts` does: these get written on paper and read back later.
 */
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = randomBytes(10);
    let code = '';
    for (const byte of bytes) code += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
    codes.push(`${code.slice(0, 5)}-${code.slice(5)}`);
  }
  return codes;
}

/**
 * SHA-256, not bcrypt — the same reasoning as the invitation token in
 * `user-invite.ts`. These are 50 bits of CSPRNG output, not a human-chosen
 * secret, so brute force is already impossible and a deliberately slow hash on
 * an unauthenticated-adjacent path is a denial-of-service lever.
 */
export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code.replace(/[\s-]/g, '').toUpperCase(), 'utf8').digest('hex');
}

/**
 * Spend a recovery code. Returns the remaining hashes, or null if no match —
 * the caller persists the remainder, which is what makes each code single-use.
 */
export function consumeRecoveryCode(code: string, hashes: readonly string[]): string[] | null {
  const candidate = hashRecoveryCode(code);
  const index = hashes.findIndex(stored => constantTimeEquals(stored, candidate));
  if (index === -1) return null;
  return hashes.filter((_, i) => i !== index);
}
