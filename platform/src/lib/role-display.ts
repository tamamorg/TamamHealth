import type { UserRole } from './db-types';

// Role-display helpers used by the contacts picker and message UI.
// Centralised here so titles/labels stay consistent across the app.

export const ROLE_TITLE: Record<UserRole, string> = {
  super_admin: 'Admin',
  org_admin: 'Org Admin',
  doctor: 'Dr.',
  clinical_officer: 'CO.',
  medical_superintendent: 'Dr.',
  nurse: 'Nurse',
  midwife: 'Nurse',
  pharmacist: 'Pharm.',
  lab_tech: 'Lab',
  radiologist: 'Dr.',
  nutritionist: 'RD',
  front_desk: '',
  cashier: '',
  government: '',
  county_health_director: '',
  data_entry_clerk: '',
  hrio: 'HRIO',
  hospital_manager: 'Mgr.',
  medical_biller: 'Biller',
  central_registration_clerk: '',
  clinic_clerk: '',
  triage_nurse: 'Nurse',
  rooming_nurse: 'Nurse',
  clinician: 'Dr.',
  records_hmis_officer: 'HMIS',
};

export const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  org_admin: 'Org Admin',
  doctor: 'Doctor',
  clinical_officer: 'Clinical Officer',
  medical_superintendent: 'Medical Superintendent',
  nurse: 'Nurse',
  midwife: 'Nurse',
  pharmacist: 'Pharmacist',
  lab_tech: 'Lab Tech',
  radiologist: 'Radiologist',
  nutritionist: 'Nutritionist',
  front_desk: 'Medical Receptionist',
  cashier: 'Cashier',
  government: 'Government',
  county_health_director: 'County Health Director',
  data_entry_clerk: 'Data Entry Clerk',
  hrio: 'Health Records (HRIO)',
  hospital_manager: 'Hospital Manager',
  medical_biller: 'Medical Biller',
  central_registration_clerk: 'Registration Clerk',
  clinic_clerk: 'Clinic Clerk',
  triage_nurse: 'Nurse',
  rooming_nurse: 'Nurse',
  clinician: 'Doctor',
  records_hmis_officer: 'Records / HMIS Officer',
};

/** Roles that count as "physician" for filtering. */
export const PHYSICIAN_ROLES: UserRole[] = [
  'doctor',
  'clinical_officer',
  'medical_superintendent',
  'radiologist',
  'clinician',
];

/** Roles that count as messageable clinical staff (doctors + everyone who treats patients). */
export const CLINICAL_ROLES: UserRole[] = [
  ...PHYSICIAN_ROLES,
  'nurse',
  'midwife',
  'triage_nurse',
  'rooming_nurse',
  'pharmacist',
  'lab_tech',
  'nutritionist',
];

/** Format a user's display name with their role title prefix. */
export function formatStaffName(role: UserRole, name: string): string {
  const title = ROLE_TITLE[role];
  if (!title) return name;
  return name.startsWith(title) ? name : `${title} ${name}`;
}

export function isPhysician(role: UserRole): boolean {
  return PHYSICIAN_ROLES.includes(role);
}

export function isClinical(role: UserRole): boolean {
  return CLINICAL_ROLES.includes(role);
}
