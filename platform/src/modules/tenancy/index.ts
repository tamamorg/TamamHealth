import type { UserDoc, UserRole } from '@/lib/db-types';

/** The roles that may open the shared organization, facility and people workspace. */
export const TENANCY_WORKSPACE_ROLES: readonly UserRole[] = [
  'super_admin', 'org_admin', 'medical_superintendent', 'hospital_manager',
  'government', 'county_health_director', 'hrio', 'records_hmis_officer',
];

/**
 * A person belongs on a facility roster when it is their home site or one of
 * the additional sites they cover. Keep this rule here so every count and list
 * answers the same question.
 */
export function userWorksAtFacility(
  user: Pick<UserDoc, 'hospitalId' | 'facilityIds'>,
  facilityId: string,
): boolean {
  return user.hospitalId === facilityId || (user.facilityIds ?? []).includes(facilityId);
}

export type ManagementView = 'organizations' | 'facilities' | 'people';

/** A record the tenant tree can create from a dialog, wherever it is hosted. */
export type TenancyCreateKind = 'organization' | 'facility' | 'staff';

/** Keep organization ownership platform-wide; tenant operators manage their own facilities and people. */
export function managementViewsForRole(role: UserRole): readonly ManagementView[] {
  if (role === 'super_admin') return ['people', 'facilities', 'organizations'];
  if (role === 'org_admin' || role === 'medical_superintendent' || role === 'hospital_manager') {
    return ['people', 'facilities'];
  }
  return ['facilities', 'organizations'];
}

export type TenancyAction =
  | 'organization:view' | 'organization:create' | 'organization:edit'
  | 'facility:view' | 'facility:create' | 'facility:edit'
  | 'person:view' | 'person:create' | 'person:edit'
  | 'access:reset' | 'access:disable';

const ALL_ACTIONS: readonly TenancyAction[] = [
  'organization:view', 'organization:create', 'organization:edit',
  'facility:view', 'facility:create', 'facility:edit',
  'person:view', 'person:create', 'person:edit', 'access:reset', 'access:disable',
];
const ORG_ACTIONS: readonly TenancyAction[] = ALL_ACTIONS.filter(action => action !== 'organization:create');
const FACILITY_OVERSIGHT: readonly TenancyAction[] = ['organization:view', 'facility:view', 'person:view'];
const NETWORK_OVERSIGHT: readonly TenancyAction[] = ['organization:view', 'facility:view'];
const NO_TENANCY_ACTIONS: readonly TenancyAction[] = [];

/** Explicit least-privilege matrix for every platform role. */
export const TENANCY_ACTIONS_BY_ROLE: Readonly<Record<UserRole, readonly TenancyAction[]>> = {
  super_admin: ALL_ACTIONS,
  org_admin: ORG_ACTIONS,
  medical_superintendent: FACILITY_OVERSIGHT,
  hospital_manager: FACILITY_OVERSIGHT,
  doctor: NO_TENANCY_ACTIONS,
  clinical_officer: NO_TENANCY_ACTIONS,
  nurse: NO_TENANCY_ACTIONS,
  midwife: NO_TENANCY_ACTIONS,
  lab_tech: NO_TENANCY_ACTIONS,
  pharmacist: NO_TENANCY_ACTIONS,
  radiologist: NO_TENANCY_ACTIONS,
  nutritionist: NO_TENANCY_ACTIONS,
  front_desk: NO_TENANCY_ACTIONS,
  cashier: NO_TENANCY_ACTIONS,
  medical_biller: NO_TENANCY_ACTIONS,
  data_entry_clerk: NO_TENANCY_ACTIONS,
  hrio: NETWORK_OVERSIGHT,
  records_hmis_officer: NETWORK_OVERSIGHT,
  government: NETWORK_OVERSIGHT,
  county_health_director: NETWORK_OVERSIGHT,
  central_registration_clerk: NO_TENANCY_ACTIONS,
  clinic_clerk: NO_TENANCY_ACTIONS,
  triage_nurse: NO_TENANCY_ACTIONS,
  rooming_nurse: NO_TENANCY_ACTIONS,
  clinician: NO_TENANCY_ACTIONS,
};

export function canPerformTenancyAction(role: UserRole, action: TenancyAction): boolean {
  return TENANCY_ACTIONS_BY_ROLE[role].includes(action);
}
