/**
 * Who may open each chart workspace form — the one rule the chart shell (which
 * refuses to render a form the viewer may not open) and the Clinical forms
 * list (which greys out a row the viewer may not open) both read. Two copies
 * of this drifted once: the list offered rows the shell then dropped, so the
 * press did nothing.
 *
 * `station` is the page the form came from; whoever may open that page may
 * take the form in the chart. `clinicalMayOpen` also admits every clinical
 * chart viewer. `may` narrows further where the page serves more roles than
 * the record does.
 */

import { isPathAllowed } from '@/lib/role-routes';
import { roleCan, WARD_ADMIT_ROLES } from '@/lib/clinical-flow/ward-permissions';
import type { UserRole } from '@/lib/db-types';

/** Who may record an ANC visit — `canRecordVitalEvents` in usePermissions,
 *  the gate on the ANC register's own Register button. The /anc page also
 *  opens for programme viewers (government, county health director) who may
 *  read the register but not write to it. */
export const ANC_RECORD_ROLES: readonly UserRole[] = [
  'doctor', 'clinical_officer', 'nurse', 'midwife', 'clinician', 'triage_nurse', 'rooming_nurse',
  'records_hmis_officer', 'hrio', 'data_entry_clerk', 'medical_superintendent',
];

export interface RoleFormRule {
  station: string;
  clinicalMayOpen: boolean;
  may?: (role: string) => boolean;
}

export const ROLE_FORM_RULES: Record<string, RoleFormRule> = {
  // A nutrition screening may be taken by the clinical and nursing roles too
  // (the `nutrition_screening` sync grant is NURSING_AND_CLINICIANS + nutritionist).
  'nutrition-screening': { station: '/dashboard/nutrition', clinicalMayOpen: true },
  // An imaging report only by whoever holds the radiology station.
  'imaging-report': { station: '/dashboard/radiology', clinicalMayOpen: false },
  'lab-orders': { station: '/dashboard/lab', clinicalMayOpen: false },
  'dispense': { station: '/dashboard/pharmacy', clinicalMayOpen: false },
  // Clinical forms that used to leave the chart for their module's page.
  'triage-form': { station: '/triage', clinicalMayOpen: false },
  'anc-visit': { station: '/anc', clinicalMayOpen: false, may: role => roleCan(role, ANC_RECORD_ROLES) },
  // Narrower than the Wards page, which bed managers open too.
  'ward-admission': { station: '/wards', clinicalMayOpen: false, may: role => roleCan(role, WARD_ADMIT_ROLES) },
};

/** May `role` open chart form `id`? Unknown ids are refused. */
export function roleFormAllowed(id: string, role: string | undefined, canViewClinical: boolean): boolean {
  const rule = ROLE_FORM_RULES[id];
  if (!rule || !role) return false;
  if (rule.may && !rule.may(role)) return false;
  return isPathAllowed(role, rule.station) || (rule.clinicalMayOpen && canViewClinical);
}
