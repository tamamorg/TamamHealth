/**
 * Giving a patient a way into the patient portal.
 *
 * The portal has authenticated against `portalUsername` / `portalPasswordHash`
 * on the patient document since it shipped. NOTHING IN THE PLATFORM EVER WROTE
 * THOSE FIELDS. The only account that had them was a seeded demo patient, so
 * the portal was a working front door with no way to issue a key — a whole
 * feature reachable by exactly one person, none of them real.
 *
 * This is the missing half. It follows the staff invitation design rather than
 * inventing a second one, for the same reasons set out in `lib/user-invite.ts`:
 *
 *   - Staff enrol a patient; the patient chooses their own password. No
 *     credential is ever spoken aloud at a busy front desk, written on the
 *     back of an appointment card, or left in a shared mailbox.
 *   - The activation token is 32 random bytes, stored only as a SHA-256 hash,
 *     single-use, and expiring — so a database dump cannot be replayed into
 *     access to somebody's medical record.
 *   - The username is chosen by staff at enrolment (it is on the card the
 *     patient is given), and the password only ever exists in the patient's
 *     head.
 *
 * ONE DELIBERATE DIFFERENCE from staff invitations: the activation code can be
 * handed over ON PAPER as well as by email. A large share of patients here
 * have no email address at all, and an enrolment flow that assumed one would
 * exclude exactly the people the portal is meant to reach.
 *
 * Server-only.
 */

import { patientsDB } from '../db';
import type { PatientDoc } from '../db-types';
import { issueInvite, hashInviteToken, inviteHashMatches, isInviteExpired } from '../user-invite';
import { findByType } from './db-query';

/** Minimum length for a patient-chosen portal password. */
export const PORTAL_MIN_PASSWORD_LENGTH = 8;

/**
 * Why the patient floor is lower than the staff one.
 *
 * A staff account can read every chart in the facility; a portal account can
 * read exactly one, its owner's. The portal also runs a real second factor
 * (SMS OTP, `patient-portal-otp.ts`) where staff sign-in historically had
 * none — and NIST SP 800-63B-4 puts the 8-character floor precisely at
 * "password plus a second factor". Raising it to the staff minimum would
 * mostly succeed in excluding the older patients this is hardest to reach.
 */

export interface PortalEnrolment {
  username: string;
  /** Shown to staff ONCE, to hand to the patient. Never stored. */
  activationCode: string;
  expiresAt: string;
}

function normaliseUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
}

/** A username suggestion from the patient's own identifiers. */
export function suggestPortalUsername(patient: { firstName?: string; surname?: string; hospitalNumber?: string }): string {
  const name = [patient.firstName, patient.surname]
    .filter(Boolean)
    .join('.')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9.]/g, '');
  const suffix = (patient.hospitalNumber || '').replace(/[^0-9]/g, '').slice(-4);
  return normaliseUsername(suffix ? `${name}.${suffix}` : name) || 'patient';
}

export type EnrolmentResult =
  | { ok: true; enrolment: PortalEnrolment }
  | { ok: false; reason: 'not_found' | 'username_taken' | 'invalid_username' | 'already_enrolled' };

/**
 * Enrol a patient, or re-issue an activation code for one already enrolled.
 *
 * Re-issuing is the common case in practice — a patient who never activated,
 * or lost the slip — and it deliberately does NOT clear an existing password:
 * until the new code is redeemed the old credential keeps working, so a
 * re-print cannot lock somebody out of their own record.
 */
export async function enrolPatientInPortal(
  patientId: string,
  requestedUsername: string,
  actorUsername?: string,
): Promise<EnrolmentResult> {
  const db = patientsDB();
  let patient: PatientDoc;
  try {
    patient = await db.get(patientId) as PatientDoc;
  } catch {
    return { ok: false, reason: 'not_found' };
  }

  const username = normaliseUsername(requestedUsername);
  if (username.length < 3) return { ok: false, reason: 'invalid_username' };

  // Uniqueness across the register. Scanned rather than indexed: portal
  // usernames are sparse, and an index on a login identifier is one more place
  // it exists.
  const clash = (await findByType<PatientDoc>(db, 'patient'))
    .find(p => p._id !== patientId && p.portalUsername?.trim().toLowerCase() === username);
  if (clash) return { ok: false, reason: 'username_taken' };

  const invite = issueInvite();
  const now = new Date().toISOString();
  const updated: PatientDoc = {
    ...patient,
    portalUsername: username,
    portalEnabledAt: patient.portalEnabledAt ?? now,
    portalEnabledBy: actorUsername ?? patient.portalEnabledBy,
    portalInviteTokenHash: invite.tokenHash,
    portalInviteExpiresAt: invite.expiresAt,
    // Re-enrolling lifts a suspension; a disabled account whose owner is
    // standing at the desk asking for a new code is being re-admitted.
    portalDisabledAt: undefined,
    updatedAt: now,
  };
  await db.put(updated);

  const { logAudit } = await import('./audit-service');
  await logAudit('patient_portal_enrolled', patientId, actorUsername,
    `Portal access issued for patient ${patientId} as "${username}"`, true);

  return {
    ok: true,
    enrolment: { username, activationCode: invite.token, expiresAt: invite.expiresAt },
  };
}

export type ActivationResult =
  | { ok: true; username: string }
  | { ok: false; reason: 'not_found' | 'expired' | 'weak_password' | 'disabled' };

/**
 * Redeem an activation code and set the patient's own password.
 *
 * Runs on an UNAUTHENTICATED endpoint, so every failure must look identical
 * from outside — the distinction exists for the audit log, not the response.
 */
export async function activatePortalAccount(
  code: string,
  newPassword: string,
): Promise<ActivationResult> {
  if (!code) return { ok: false, reason: 'not_found' };
  if (!newPassword || newPassword.length < PORTAL_MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: 'weak_password' };
  }

  const db = patientsDB();
  const candidate = hashInviteToken(code.trim());
  const match = (await findByType<PatientDoc>(db, 'patient'))
    .find(p => p.portalInviteTokenHash && inviteHashMatches(p.portalInviteTokenHash, candidate));
  if (!match) return { ok: false, reason: 'not_found' };
  if (match.portalDisabledAt) return { ok: false, reason: 'disabled' };
  if (isInviteExpired(match.portalInviteExpiresAt)) return { ok: false, reason: 'expired' };

  const { hashPassword } = await import('../auth');
  const now = new Date().toISOString();
  await db.put({
    ...match,
    portalPasswordHash: await hashPassword(newPassword),
    portalInviteTokenHash: undefined,
    portalInviteExpiresAt: undefined,
    updatedAt: now,
  });

  const { logAudit } = await import('./audit-service');
  await logAudit('patient_portal_activated', match._id, match.portalUsername,
    `Patient ${match._id} set their portal password`, true);

  return { ok: true, username: match.portalUsername || '' };
}

/**
 * Suspend portal access without destroying the credential.
 *
 * The credential is kept rather than deleted because the reasons this gets
 * used — a disputed account, a shared handset, a patient asking for it to stop
 * for a while — are usually reversible, and a patient should not have to
 * re-enrol from scratch to undo one.
 */
export async function disablePortalAccount(patientId: string, actorUsername?: string): Promise<boolean> {
  const db = patientsDB();
  try {
    const patient = await db.get(patientId) as PatientDoc;
    await db.put({
      ...patient,
      portalDisabledAt: new Date().toISOString(),
      // An outstanding activation code must die with the account, or a slip
      // handed out last week would reopen it.
      portalInviteTokenHash: undefined,
      portalInviteExpiresAt: undefined,
      updatedAt: new Date().toISOString(),
    });
    const { logAudit } = await import('./audit-service');
    await logAudit('patient_portal_disabled', patientId, actorUsername,
      `Portal access suspended for patient ${patientId}`, true);
    return true;
  } catch {
    return false;
  }
}

/** What the chart shows about a patient's portal access. Never a credential. */
export interface PortalAccessSummary {
  enrolled: boolean;
  username?: string;
  activated: boolean;
  activationPending: boolean;
  activationExpiresAt?: string;
  disabled: boolean;
  lastLoginAt?: string;
}

export function summarisePortalAccess(patient: PatientDoc): PortalAccessSummary {
  return {
    enrolled: Boolean(patient.portalUsername),
    username: patient.portalUsername,
    activated: Boolean(patient.portalPasswordHash),
    activationPending: Boolean(patient.portalInviteTokenHash)
      && !isInviteExpired(patient.portalInviteExpiresAt),
    activationExpiresAt: patient.portalInviteExpiresAt,
    disabled: Boolean(patient.portalDisabledAt),
    lastLoginAt: patient.portalLastLoginAt,
  };
}

/**
 * Stamp a successful portal sign-in.
 *
 * Best-effort and never throws: a patient must not be refused their own
 * records because a bookkeeping write lost a revision race. The value answers
 * "is anyone actually using the portal we enrolled them in?", which is the
 * question that decides whether enrolment is worth the desk's time.
 *
 * Skips a write when the stamp is already within the same minute, so a patient
 * refreshing their appointment list does not write a document revision per
 * page load into a replication log every device then pulls.
 */
export async function recordPortalLogin(
  patientId: string,
  at: string = new Date().toISOString(),
): Promise<void> {
  try {
    const db = patientsDB();
    const patient = await db.get(patientId) as PatientDoc;
    if (patient.portalLastLoginAt && at.slice(0, 16) === patient.portalLastLoginAt.slice(0, 16)) return;
    await db.put({ ...patient, portalLastLoginAt: at });
  } catch {
    /* never block a patient's sign-in over a bookkeeping write */
  }
}

/**
 * Whether this account may sign in at all.
 *
 * A suspended account keeps its credential (see `disablePortalAccount`), so
 * the password check alone would still pass. This is the gate that makes the
 * suspension mean something.
 */
export function portalSignInBlocked(patient: { portalDisabledAt?: string }): boolean {
  return Boolean(patient.portalDisabledAt);
}
