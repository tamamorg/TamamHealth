/**
 * Patient-portal one-time passcodes (KAN-76 / LOW-02).
 *
 * ## Why this exists
 *
 * The original ticket described a second login path — first name + surname +
 * date of birth + phone — and asked for it to be gated. **That path no longer
 * exists**: `/api/patient-portal/login` now authenticates on portal username +
 * bcrypt password only. The demographic-knowledge vulnerability is gone.
 *
 * What remains true is the reasoning behind the ticket. A patient portal in
 * South Sudan is protected by a single shared secret, on shared devices, for
 * users who often cannot reset it themselves. SMS possession is a meaningfully
 * independent factor, and the platform already has a provider abstraction
 * (`lib/sms`) with Africa's Talking and Twilio behind it. So this adds OTP as a
 * genuine second factor rather than closing the ticket on a technicality.
 *
 * ## Design
 *
 * - **Off unless `PATIENT_PORTAL_OTP_ENABLED=true`.** A deployment with no SMS
 *   credentials would otherwise lock every patient out of their own records,
 *   which is worse than the risk being mitigated.
 * - **Codes are hashed at rest**, never stored raw. The store is the same
 *   Upstash instance used for rate limiting and token revocation, so the
 *   challenge survives a replica switch mid-login; without Upstash it falls
 *   back to an in-process map (single-replica only, same caveat as elsewhere).
 * - **Attempts are capped.** A 6-digit code is only 10^6 wide — without a cap
 *   it is brute-forceable in minutes. Five wrong answers burn the challenge.
 * - **Verification is constant-time** over the hash, so response timing does
 *   not leak how much of the code was right.
 * - **Delivery failure fails closed.** If the SMS cannot be sent we do not
 *   issue a token; a "second factor" nobody receives is not a factor.
 */

import { captureException } from '@/lib/observability';
import { createHash, timingSafeEqual, randomInt } from 'node:crypto';
import { getUpstashConfig, upstashPipeline, withRetry, hashKey } from './upstash';
import { sendSms } from './sms';

/** How long a code stays valid. Long enough for slow SMS, short enough to matter. */
export const OTP_TTL_SECONDS = 5 * 60;

/** Wrong answers permitted before the challenge is destroyed. */
export const OTP_MAX_ATTEMPTS = 5;

const OTP_PREFIX = 'otp:';

export function otpEnabled(): boolean {
  return process.env.PATIENT_PORTAL_OTP_ENABLED === 'true';
}

interface Challenge {
  codeHash: string;
  attempts: number;
  expiresAt: number;
}

/** Fallback store for deployments without Upstash. Single-replica only. */
const memStore = new Map<string, Challenge>();

function hashCode(patientId: string, code: string): string {
  // Salted by patientId so the same code for two patients hashes differently,
  // and a stolen store cannot be reversed with one rainbow table of 10^6 codes.
  return createHash('sha256').update(`${patientId}:${code}`).digest('hex');
}

function constantTimeEquals(a: string, b: string): boolean {
  // Both operands are sha256 hex digests, so they are always equal length in
  // practice; the guard is here because timingSafeEqual throws otherwise.
  const ab = new Uint8Array(Buffer.from(a, 'utf8'));
  const bb = new Uint8Array(Buffer.from(b, 'utf8'));
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** `randomInt` is CSPRNG-backed — `Math.random()` would be predictable. */
function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

async function storeKey(patientId: string): Promise<string> {
  return OTP_PREFIX + (await hashKey(patientId, 'tamam-otp'));
}

async function putChallenge(patientId: string, challenge: Challenge): Promise<void> {
  const cfg = getUpstashConfig();
  if (cfg) {
    const key = await storeKey(patientId);
    const ttl = Math.max(1, Math.ceil((challenge.expiresAt - Date.now()) / 1000));
    await withRetry(
      () => upstashPipeline(cfg, [['SET', key, JSON.stringify(challenge), 'EX', ttl]]),
      'portal-otp',
    );
    return;
  }
  memStore.set(patientId, challenge);
}

async function readChallenge(patientId: string): Promise<Challenge | null> {
  const cfg = getUpstashConfig();
  if (cfg) {
    const key = await storeKey(patientId);
    const res = await withRetry(() => upstashPipeline(cfg, [['GET', key]]), 'portal-otp');
    const raw = res[0]?.result;
    if (typeof raw !== 'string') return null;
    try {
      return JSON.parse(raw) as Challenge;
    } catch {
      return null;
    }
  }
  const entry = memStore.get(patientId) ?? null;
  if (entry && entry.expiresAt <= Date.now()) {
    memStore.delete(patientId);
    return null;
  }
  return entry;
}

async function dropChallenge(patientId: string): Promise<void> {
  const cfg = getUpstashConfig();
  if (cfg) {
    const key = await storeKey(patientId);
    await withRetry(() => upstashPipeline(cfg, [['DEL', key]]), 'portal-otp').catch(() => undefined);
    return;
  }
  memStore.delete(patientId);
}

/** Mask a phone for display: +211912345678 → +211*****5678. */
export function maskPhone(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.length <= 8) return '****';
  return `${trimmed.slice(0, 4)}*****${trimmed.slice(-4)}`;
}

export interface IssueOtpResult {
  ok: boolean;
  /** Safe to show the user — reveals only the tail of a number they own. */
  maskedPhone?: string;
  error?: string;
}

/**
 * Generate, store and SMS a one-time code.
 *
 * Fails closed: a delivery error returns `ok: false` and the caller must NOT
 * issue a session token.
 */
export async function issueOtp(patientId: string, phone: string): Promise<IssueOtpResult> {
  if (!phone || !phone.trim()) {
    // No number on file — there is nothing to prove possession of. The caller
    // decides whether that blocks login or falls back to password-only.
    return { ok: false, error: 'no-phone' };
  }

  const code = generateCode();
  await putChallenge(patientId, {
    codeHash: hashCode(patientId, code),
    attempts: 0,
    expiresAt: Date.now() + OTP_TTL_SECONDS * 1000,
  });

  const result = await sendSms({
    to: phone,
    body: `Your TamamHealth patient portal code is ${code}. It expires in ${OTP_TTL_SECONDS / 60} minutes. Do not share it with anyone.`,
  });

  if (!result.ok) {
    // Destroy the challenge — leaving a live code for an SMS that never
    // arrived only widens the guessing window.
    await dropChallenge(patientId);
    console.error('[portal-otp] delivery failed:', result.error);
    captureException(result.error, { tag: '[portal-otp] delivery failed:' });
    return { ok: false, error: 'delivery-failed' };
  }

  return { ok: true, maskedPhone: maskPhone(phone) };
}

export type OtpVerdict =
  | { ok: true }
  | { ok: false; reason: 'expired' | 'no-challenge' | 'too-many-attempts' | 'mismatch' };

/**
 * Check a submitted code. A correct answer consumes the challenge, so a code
 * can never be replayed.
 */
export async function verifyOtp(patientId: string, submitted: string): Promise<OtpVerdict> {
  const challenge = await readChallenge(patientId);
  if (!challenge) return { ok: false, reason: 'no-challenge' };

  if (challenge.expiresAt <= Date.now()) {
    await dropChallenge(patientId);
    return { ok: false, reason: 'expired' };
  }

  if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
    await dropChallenge(patientId);
    return { ok: false, reason: 'too-many-attempts' };
  }

  const submittedHash = hashCode(patientId, (submitted || '').trim());
  if (!constantTimeEquals(submittedHash, challenge.codeHash)) {
    const attempts = challenge.attempts + 1;
    if (attempts >= OTP_MAX_ATTEMPTS) {
      await dropChallenge(patientId);
      return { ok: false, reason: 'too-many-attempts' };
    }
    await putChallenge(patientId, { ...challenge, attempts });
    return { ok: false, reason: 'mismatch' };
  }

  // Single-use.
  await dropChallenge(patientId);
  return { ok: true };
}

/** Test hook — clears the in-process fallback store. */
export function _resetOtpStoreForTest(): void {
  memStore.clear();
}
