import type { UserRole } from '../db-types';
import { ADMIN, CLINICIANS, NURSING_AND_CLINICIANS } from '../sync/write-permissions';

/** Clinical decision + placement at the start of an inpatient stay. */
export const WARD_ADMIT_ROLES: readonly UserRole[] = NURSING_AND_CLINICIANS;

/** Ending an admission requires a diagnosing/prescribing clinician. */
export const WARD_DISCHARGE_ROLES: readonly UserRole[] = CLINICIANS;

/** Bed placement and turnover are operational bedside responsibilities. */
export const WARD_BED_ROLES: readonly UserRole[] = [
  ...NURSING_AND_CLINICIANS,
  'hospital_manager',
];

/** Physical ward configuration, not patient care. */
export const WARD_CONFIG_ROLES: readonly UserRole[] = [
  ...ADMIN,
  'hospital_manager',
  'medical_superintendent',
];

export function roleCan(role: string | undefined, roles: readonly UserRole[]): boolean {
  return Boolean(role && roles.includes(role as UserRole));
}
