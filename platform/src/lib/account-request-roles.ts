/**
 * The role rules for account requests, with no database imports.
 *
 * Kept apart from `account-request-service` on purpose: the public request
 * form is a client component, and importing the service there would pull
 * PouchDB and the whole data layer into the browser bundle for the sake of a
 * list of role names.
 */
import type { UserRole } from './db-types';

/**
 * Roles that bypass org scoping in `filterByScope`, so only a platform
 * operator may grant them. Identical to `PRIVILEGED_ASSIGNABLE_ROLES` in
 * `/api/users` — a role that is privileged to assign is privileged to approve.
 */
export const PLATFORM_APPROVAL_ROLES: UserRole[] = [
  'super_admin', 'government', 'county_health_director',
];

/**
 * Roles the public form may ask for.
 *
 * `super_admin` is deliberately absent: the platform operator account comes
 * from the deployment bootstrap, not from a public form. Allowing it would put
 * "make me the platform owner" in front of an approver as a routine-looking row.
 */
export const REQUESTABLE_ROLES: UserRole[] = [
  'org_admin', 'doctor', 'clinical_officer', 'nurse', 'midwife', 'lab_tech',
  'pharmacist', 'front_desk', 'cashier', 'data_entry_clerk',
  'medical_superintendent', 'hrio', 'nutritionist', 'radiologist',
  'hospital_manager', 'medical_biller', 'government', 'county_health_director',
];

export function isRequestableRole(role: string): role is UserRole {
  return (REQUESTABLE_ROLES as string[]).includes(role);
}

/**
 * Who must decide a request. Derived on the server from the requested role and
 * organisation — never accepted from the client, which would let a requester
 * choose their own approver.
 */
export function approverTierFor(role: UserRole, orgId?: string): 'super_admin' | 'org_admin' {
  if (PLATFORM_APPROVAL_ROLES.includes(role)) return 'super_admin';
  // No organisation means no tenant to route to. Without this the request
  // would be visible to nobody and simply rot.
  if (!orgId) return 'super_admin';
  return 'org_admin';
}
