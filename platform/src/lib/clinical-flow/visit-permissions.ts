import type { UserRole } from '../db-types';

/**
 * Who may void a visit opened in error: the roles that can open one (front
 * desk, nursing, clinicians) plus the administrators above them. Kept in its
 * own light module so the chart can ask without loading the encounter service.
 * Every role here holds a full `clinical_encounter` write in DOC_WRITE_ROLES
 * (the void is an ordinary status write), which a test asserts.
 */
export const VISIT_VOID_ROLES: readonly UserRole[] = [
  'super_admin', 'org_admin', 'hospital_manager', 'medical_superintendent',
  'doctor', 'clinical_officer', 'clinician',
  'nurse', 'midwife', 'triage_nurse', 'rooming_nurse',
  'front_desk', 'central_registration_clerk', 'clinic_clerk',
];
