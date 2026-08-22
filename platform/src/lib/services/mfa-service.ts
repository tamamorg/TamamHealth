/**
 * Second-factor enrolment and verification for staff accounts.
 *
 * The mechanics are in `lib/totp.ts`; this is the part that touches the user
 * document and decides who has to have one.
 *
 * ENROLMENT IS TWO STEPS ON PURPOSE. `begin` writes a secret; `confirm` writes
 * `totpEnabledAt` only after the user has produced a working code from it. The
 * gap matters: an account whose factor went live the moment a secret was
 * generated would be locked out by any mistake between the two — a mistyped
 * secret, an app that failed to save, a browser closed halfway. The secret
 * alone is inert, and `mfaEnabled` reads `totpEnabledAt`, never `totpSecret`.
 *
 * Server-only: `lib/totp.ts` uses `node:crypto`.
 */

import { usersDB } from '../db';
import type { UserDoc, UserRole } from '../db-types';
import {
  buildOtpauthUri, consumeRecoveryCode, formatSecretForDisplay, generateRecoveryCodes,
  generateTotpSecret, hashRecoveryCode, verifyTotpCode,
} from '../totp';

/**
 * Roles that must hold a second factor when the platform policy requires MFA.
 *
 * Not "everyone", and the reason is operational rather than a compromise. A
 * ward nurse on a shared facility tablet, on a night shift, with no phone of
 * her own on the ward, cannot be the person a TOTP prompt is tested on first.
 * Start where the blast radius is largest and the person reliably has a
 * device: the accounts that can create other accounts, move data across
 * tenants, or run a whole facility.
 *
 * Widening this list is a policy decision, not a code change waiting to
 * happen — but it is deliberately a list, so widening it is one edit.
 */
export const MFA_REQUIRED_ROLES: readonly UserRole[] = [
  'super_admin', 'org_admin', 'medical_superintendent', 'hospital_manager',
] as const;

/** Whether MFA is switched on for this deployment at all. */
export async function isMfaPolicyEnabled(): Promise<boolean> {
  try {
    const { getPlatformConfig } = await import('./platform-config-service');
    return (await getPlatformConfig()).superAdminPolicies?.mfaRequired !== false;
  } catch {
    // A policy that cannot be read must not silently switch a security control
    // off. Requiring it is the direction that fails safe — and every account it
    // applies to can still reach the enrolment screen, so nobody is stranded.
    return true;
  }
}

/** Whether THIS user is obliged to enrol before using the app. */
export async function isMfaRequiredFor(user: { role: UserRole; totpEnabledAt?: string }): Promise<boolean> {
  if (user.totpEnabledAt) return false;
  if (!MFA_REQUIRED_ROLES.includes(user.role)) return false;
  return isMfaPolicyEnabled();
}

async function loadUser(id: string): Promise<UserDoc> {
  return await usersDB().get(id) as UserDoc;
}

export interface TotpEnrolmentStart {
  /** Base32 secret, for an app that reads a URI. */
  secret: string;
  /** The same secret in groups of four, for someone typing it by hand. */
  secretForDisplay: string;
  /** `otpauth://` URI — pasted, or turned into a QR by the client if it can. */
  otpauthUri: string;
}

/**
 * Start enrolment: mint a secret and store it UNCONFIRMED.
 *
 * Calling this again replaces an unconfirmed secret, which is what "start
 * over" means when someone loses the setup screen halfway. It refuses to
 * replace a CONFIRMED one — re-enrolling an active factor has to go through
 * `disableTotp`, which requires the current password, or a stolen session
 * could quietly swap the second factor for one the attacker holds.
 */
export async function beginTotpEnrolment(userId: string): Promise<TotpEnrolmentStart> {
  const db = usersDB();
  const existing = await loadUser(userId);
  if (existing.totpEnabledAt) {
    throw new Error('Two-factor authentication is already enabled on this account.');
  }
  const secret = generateTotpSecret();
  await db.put({ ...existing, totpSecret: secret, updatedAt: new Date().toISOString() });
  return {
    secret,
    secretForDisplay: formatSecretForDisplay(secret),
    otpauthUri: buildOtpauthUri(secret, existing.username),
  };
}

export type TotpConfirmResult =
  | { ok: true; recoveryCodes: string[] }
  | { ok: false; reason: 'no_enrolment' | 'invalid_code' | 'already_enabled' };

/**
 * Finish enrolment: check a code against the stored secret, then switch the
 * factor on and issue recovery codes.
 *
 * The recovery codes are returned ONCE and only their hashes are kept — same
 * construction as the invitation token. Without them, enabling MFA in a rural
 * facility would mean a dropped handset costs a clinician their access until a
 * platform operator can be reached, which is a worse failure than the one MFA
 * prevents.
 */
export async function confirmTotpEnrolment(userId: string, code: string): Promise<TotpConfirmResult> {
  const db = usersDB();
  const existing = await loadUser(userId);
  if (existing.totpEnabledAt) return { ok: false, reason: 'already_enabled' };
  if (!existing.totpSecret) return { ok: false, reason: 'no_enrolment' };

  const step = verifyTotpCode(existing.totpSecret, code);
  if (step === null) return { ok: false, reason: 'invalid_code' };

  const recoveryCodes = generateRecoveryCodes();
  const now = new Date().toISOString();
  await db.put({
    ...existing,
    totpEnabledAt: now,
    totpLastUsedStep: step,
    totpRecoveryCodeHashes: recoveryCodes.map(hashRecoveryCode),
    updatedAt: now,
  });
  const { logAudit } = await import('./audit-service');
  await logAudit('mfa_enabled', existing._id, existing.username,
    `${existing.username} enabled two-factor authentication`, true);
  return { ok: true, recoveryCodes };
}

/**
 * Turn the factor off and erase every trace of it.
 *
 * The caller MUST have re-verified the user's password first (the route does).
 * Removing a second factor is the single most useful thing an attacker can do
 * with a borrowed session, so it is the one account change that costs a
 * password even though the user is already signed in.
 */
export async function disableTotp(userId: string, actorUsername?: string): Promise<void> {
  const db = usersDB();
  const existing = await loadUser(userId);
  await db.put({
    ...existing,
    totpSecret: undefined,
    totpEnabledAt: undefined,
    totpLastUsedStep: undefined,
    totpRecoveryCodeHashes: undefined,
    updatedAt: new Date().toISOString(),
  });
  const { logAudit } = await import('./audit-service');
  await logAudit('mfa_disabled', existing._id, actorUsername ?? existing.username,
    `Two-factor authentication removed from "${existing.username}"`, true);
}

/** Issue a fresh set of recovery codes, invalidating any that remain. */
export async function regenerateRecoveryCodes(userId: string): Promise<string[] | null> {
  const db = usersDB();
  const existing = await loadUser(userId);
  if (!existing.totpEnabledAt) return null;
  const codes = generateRecoveryCodes();
  await db.put({
    ...existing,
    totpRecoveryCodeHashes: codes.map(hashRecoveryCode),
    updatedAt: new Date().toISOString(),
  });
  const { logAudit } = await import('./audit-service');
  await logAudit('mfa_recovery_regenerated', existing._id, existing.username,
    `${existing.username} regenerated two-factor recovery codes`, true);
  return codes;
}

export type SecondFactorResult =
  | { ok: true; usedRecoveryCode: boolean; recoveryCodesRemaining: number }
  | { ok: false };

/**
 * Verify a submitted second factor at sign-in. Accepts a TOTP code or one of
 * the account's unused recovery codes.
 *
 * Both outcomes persist state, and both must: a spent TOTP step stops the same
 * code being replayed inside its 30-second window, and a spent recovery code
 * has to be struck off or it is not single-use. A write failure therefore
 * fails the verification rather than waving it through — the alternative is a
 * factor that silently degrades into a reusable one.
 */
export async function verifySecondFactor(userId: string, code: string): Promise<SecondFactorResult> {
  const db = usersDB();
  let existing: UserDoc;
  try {
    existing = await loadUser(userId);
  } catch {
    return { ok: false };
  }
  if (!existing.totpEnabledAt || !existing.totpSecret) return { ok: false };

  const submitted = (code || '').trim();
  const step = verifyTotpCode(existing.totpSecret, submitted, {
    lastUsedStep: existing.totpLastUsedStep,
  });

  if (step !== null) {
    try {
      await db.put({ ...existing, totpLastUsedStep: step, updatedAt: new Date().toISOString() });
    } catch {
      return { ok: false };
    }
    return {
      ok: true,
      usedRecoveryCode: false,
      recoveryCodesRemaining: existing.totpRecoveryCodeHashes?.length ?? 0,
    };
  }

  const remaining = consumeRecoveryCode(submitted, existing.totpRecoveryCodeHashes ?? []);
  if (remaining) {
    try {
      await db.put({ ...existing, totpRecoveryCodeHashes: remaining, updatedAt: new Date().toISOString() });
    } catch {
      return { ok: false };
    }
    const { logAudit } = await import('./audit-service');
    await logAudit('mfa_recovery_used', existing._id, existing.username,
      `${existing.username} signed in with a recovery code — ${remaining.length} left`, true);
    return { ok: true, usedRecoveryCode: true, recoveryCodesRemaining: remaining.length };
  }

  return { ok: false };
}
