import type { UserRole } from './db-types';

/**
 * Single source of truth for the clinical-document authorship roles used by both
 * the service layer (authorization) and the UI (action gating). Keeping these
 * here avoids the drift the audit flagged between record signing and
 * PhoneNotes.
 */

/**
 * Roles that may sign a clinical note as final and co-sign a trainee's note.
 *
 * `clinical_officer` sits here as of 2026-07-27 (KAN-19). It was previously in
 * TRAINEE_AUTHOR_ROLES, so `isProviderRole('clinical_officer')` was false and CO
 * notes routed for co-signature — while every API guard, `permissions.ts` and
 * `role-display.ts` PHYSICIAN_ROLES already treated a CO as an autonomous
 * prescriber equal to a doctor. Signing was the only place that disagreed.
 *
 * The asymmetry was untenable in both directions: a clinician trusted to
 * prescribe unsupervised but not to sign their own note either has the wrong
 * prescribing rights or the wrong signing rights. Confirmed as independent —
 * which also reflects South Sudan staffing, where a CO is frequently the most
 * senior clinician at a PHCU or PHCC and no doctor is posted to co-sign.
 */
export const PROVIDER_ROLES: UserRole[] = ['doctor', 'medical_superintendent', 'clinician', 'clinical_officer'];

/** Clinical authors who sign but route to a supervising provider for co-signature. */
export const TRAINEE_AUTHOR_ROLES: UserRole[] = ['nurse', 'midwife', 'nutritionist'];

/**
 * The "nurse family": nursing roles that share a dashboard, a second-staff slot
 * on a booking, and the nursing worklists. This exact set was duplicated inline
 * in ~8 places (modularization 2026-11, Phase 1 dedup). NOT the same as sets
 * that add clinical_officer, or that mean only {nurse, midwife} — those stay
 * their own lists on purpose.
 */
export const NURSE_FAMILY_ROLES: readonly UserRole[] = ['nurse', 'midwife', 'triage_nurse', 'rooming_nurse'];

export function isNurseFamilyRole(role?: string | null): boolean {
  return !!role && (NURSE_FAMILY_ROLES as readonly string[]).includes(role);
}

/** What a role may do to a consultation record: sign, route it, co-sign it. */
export function recordSignRights(role: UserRole | undefined) {
  const isProvider = !!role && PROVIDER_ROLES.includes(role);
  const isTrainee = !!role && TRAINEE_AUTHOR_ROLES.includes(role);
  return { isProvider, isTrainee, canAuthor: isProvider || isTrainee };
}

/** Can sign as final / co-sign / respond to a routed clinical communication. */
export function isProviderRole(role?: UserRole | string): boolean {
  return !!role && (PROVIDER_ROLES as string[]).includes(role);
}

/** May author (sign) a clinical document — provider or supervised trainee. */
export function isClinicalAuthorRole(role?: UserRole | string): boolean {
  return !!role && ((PROVIDER_ROLES as string[]).includes(role) || (TRAINEE_AUTHOR_ROLES as string[]).includes(role));
}

/** Shared "no known allergy" sentinels — centralized so every check agrees. */
export const NO_ALLERGY_SENTINELS = ['none', 'none known', 'nkda', 'no known', 'nil', 'n/a', 'na', 'unknown'];

/** True when an allergy substance string is really a "no known allergies" marker. */
export function isNoAllergySentinel(substance?: string): boolean {
  const n = (substance || '').trim().toLowerCase().replace(/[.\s]+$/, '');
  // Whole values, plus phrases that can only mean none ("no known allergies").
  // A prefix test on the list read Naproxen ("na") and Nilotinib ("nil") as "no
  // allergies" and dropped them.
  return n.length === 0 || NO_ALLERGY_SENTINELS.includes(n) || /^(no known|none known|nkda)\b/.test(n);
}
