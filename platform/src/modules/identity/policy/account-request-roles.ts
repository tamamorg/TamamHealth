/**
 * The role rules for account requests, with no database imports.
 *
 * Kept apart from `account-request-service` on purpose: the public request
 * form is a client component, and importing the service there would pull
 * PouchDB and the whole data layer into the browser bundle for the sake of a
 * list of role names.
 */
import type { UserRole } from '@/lib/db-types';

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
  // The six clinical-flow station roles. They were omitted when this list was
  // written, which left seven of the platform's twenty-five roles with no
  // self-service path at all — real, seeded, routable roles with their own
  // dashboards, whose holders opened the form and could not find their job on
  // it. Nothing about them is privileged: each is narrower than the legacy
  // role it stands in for (see STATION_ROLE_EQUIVALENT in lib/api-auth.ts).
  'central_registration_clerk', 'clinic_clerk', 'triage_nurse', 'rooming_nurse',
  'clinician', 'records_hmis_officer',
];

/**
 * Roles whose holders must be on a professional register.
 *
 * Collected as free text and checked by a HUMAN against the council's own
 * roll — see `AccountRequestDoc.professionalRegistrationNumber` for why it is
 * not validated by shape. The list is the clinical roles that can author
 * clinical content or hold a licence: it is not a permissions boundary, it is
 * a prompt to the approver about what to verify before granting.
 */
export const ROLES_REQUIRING_REGISTRATION: UserRole[] = [
  'doctor', 'clinical_officer', 'clinician', 'nurse', 'midwife',
  'medical_superintendent', 'pharmacist', 'lab_tech', 'radiologist',
  'nutritionist', 'triage_nurse', 'rooming_nurse',
];

export function roleRequiresRegistrationNumber(role: string): boolean {
  return (ROLES_REQUIRING_REGISTRATION as string[]).includes(role);
}

/**
 * How an approver satisfied themselves that the requester is who they say.
 *
 * Recorded with the decision, and REQUIRED to approve. The public form
 * collects nothing but self-assertion, so before this the approval step had no
 * place to record that anyone had checked — and an approval that looks
 * identical whether it was verified or waved through is not an audit trail,
 * it is a rubber stamp with a timestamp.
 *
 * The options are the checks actually available in this setting. "I know this
 * person" is on the list deliberately: in a district hospital it is often the
 * true and sufficient answer, and leaving it off would mean approvers picking
 * a more official-sounding option they did not actually perform.
 */
export const IDENTITY_ATTESTATION_METHODS: readonly { value: string; label: string }[] = [
  { value: 'known_personally', label: 'I know this person and confirm their identity' },
  { value: 'supervisor_confirmed', label: 'Confirmed with their supervisor or department head' },
  { value: 'register_checked', label: 'Checked their registration number against the council register' },
  { value: 'staff_id_seen', label: 'Saw their staff ID or appointment letter' },
  { value: 'in_person', label: 'Verified in person at the facility' },
];

export function isValidAttestation(value: unknown): value is string {
  return typeof value === 'string'
    && IDENTITY_ATTESTATION_METHODS.some(method => method.value === value);
}

/** Roles whose accounts are organisation-wide rather than facility-bound. */
export const ACCOUNT_REQUEST_ROLES_WITHOUT_FACILITY: UserRole[] = [
  'org_admin', 'government', 'county_health_director',
];

export function accountRequestRoleNeedsFacility(role: string): boolean {
  return isRequestableRole(role)
    && !ACCOUNT_REQUEST_ROLES_WITHOUT_FACILITY.includes(role);
}

/** Fail closed when binding a requested account to a tenant-owned facility. */
export function accountRequestFacilityMatchesOrg(
  facility: { orgId?: string } | null,
  orgId?: string,
): facility is { orgId: string } {
  return Boolean(facility && orgId && facility.orgId === orgId);
}

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
