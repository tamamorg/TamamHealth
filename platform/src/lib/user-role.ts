import type { UserRole } from './db-types';

/**
 * Retired staff-account roles retained only so old documents and JWTs can be
 * read during the migration. Triage, rooming and maternity are assignments or
 * departments; the account role for all three is `nurse`.
 */
export const LEGACY_NURSING_ROLES = [
  'midwife',
  'triage_nurse',
  'rooming_nurse',
] as const satisfies readonly UserRole[];

const LEGACY_NURSING_ROLE_SET = new Set<UserRole>(LEGACY_NURSING_ROLES);

export function isLegacyNursingRole(role: UserRole | string): role is typeof LEGACY_NURSING_ROLES[number] {
  return LEGACY_NURSING_ROLE_SET.has(role as UserRole);
}

/** Normalize a stored/session role without changing historical clinical data. */
export function canonicalizeUserRole(role: UserRole): UserRole {
  return isLegacyNursingRole(role) ? 'nurse' : role;
}

