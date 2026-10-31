import type { UserRole } from './db-types';

/**
 * Retired staff-account roles and the role each one became, retained only so
 * old documents and JWTs can be read during the migration. Triage, rooming and
 * maternity are assignments or departments, so all three are `nurse`; the
 * clerk, clinician and HMIS logins were the same jobs under a second name.
 *
 * A Map, not an object: a role string comes off a token or a document, and
 * `constructor` must not resolve to anything.
 */
export const LEGACY_ROLE_MAP: ReadonlyMap<UserRole, UserRole> = new Map<UserRole, UserRole>([
  ['midwife', 'nurse'],
  ['triage_nurse', 'nurse'],
  ['rooming_nurse', 'nurse'],
  ['clinician', 'doctor'],
  ['records_hmis_officer', 'hrio'],
  ['clinic_clerk', 'front_desk'],
  ['central_registration_clerk', 'front_desk'],
]);

export function isLegacyRole(role: UserRole | string): boolean {
  return LEGACY_ROLE_MAP.has(role as UserRole);
}

/** Normalize a stored/session role without changing historical clinical data. */
export function canonicalizeUserRole(role: UserRole): UserRole {
  return LEGACY_ROLE_MAP.get(role) ?? role;
}
