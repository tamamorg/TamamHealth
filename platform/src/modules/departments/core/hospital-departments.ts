/**
 * The departments a hospital has, for choosing where a person or a thing
 * belongs: a staff member's department at registration, an asset's location,
 * a clinic's availability, a shift. It is a vocabulary, not provisioning:
 * nothing here creates department records or queues (TAMAM_DEPARTMENT_CATALOG
 * and the Departments page do that).
 *
 * Names are the platform's stored values, so they match what the seed and
 * the catalog already write (Outpatient, Nursing, Laboratory, Records & HMIS,
 * Paediatrics, …). Aliases let an older or differently spelled value
 * ("Pediatrics", "OPD", "Records") land on its entry instead of showing as an
 * extra, unlisted choice.
 *
 * Covers a South Sudan county or state hospital: outpatient and emergency,
 * the clinical specialties, maternal and child health, the vertical programmes
 * (HIV, TB, immunization, nutrition), diagnostics, and the support and
 * administrative units staff are rostered to.
 */

export type HospitalDepartmentGroup = 'clinical' | 'maternal_child' | 'diagnostics' | 'support' | 'administration';

export interface HospitalDepartment {
  name: string;
  group: HospitalDepartmentGroup;
  aliases?: readonly string[];
}

export const HOSPITAL_DEPARTMENT_GROUPS: readonly HospitalDepartmentGroup[] = [
  'clinical', 'maternal_child', 'diagnostics', 'support', 'administration',
];

export const HOSPITAL_DEPARTMENTS: readonly HospitalDepartment[] = [
  // Clinical services
  { name: 'Outpatient', group: 'clinical', aliases: ['OPD', 'Outpatient Department', 'Out-patient'] },
  { name: 'Emergency', group: 'clinical', aliases: ['Casualty', 'A&E', 'Accident and Emergency', 'Emergency Department', 'ER'] },
  { name: 'General Medicine', group: 'clinical', aliases: ['Medical Ward', 'Medicine'] },
  { name: 'Internal Medicine', group: 'clinical', aliases: ['Specialist Internal Medicine'] },
  { name: 'General Surgery', group: 'clinical', aliases: ['Surgery', 'Surgical Ward'] },
  { name: 'Orthopaedic Surgery', group: 'clinical', aliases: ['Orthopaedics', 'Orthopedics', 'Orthopedic Surgery'] },
  { name: 'Operation Theatre', group: 'clinical', aliases: ['Theatre', 'Operating Room', 'Advanced Operation Theatre'] },
  { name: 'Anaesthesia', group: 'clinical', aliases: ['Anesthesia', 'Anaesthesiology'] },
  { name: 'Intensive Care Unit', group: 'clinical', aliases: ['ICU', 'Intensive Care', 'Critical Care'] },
  { name: 'In-patient Services', group: 'clinical', aliases: ['Inpatient', 'IPD', 'Wards'] },
  { name: 'Nursing', group: 'clinical', aliases: ['Nursing Services'] },
  { name: 'Cardiology', group: 'clinical', aliases: ['Cardiac Clinic'] },
  { name: 'Neurology', group: 'clinical' },
  { name: 'Nephrology', group: 'clinical', aliases: ['Renal Medicine', 'Kidney Clinic'] },
  { name: 'Haemodialysis', group: 'clinical', aliases: ['Hemodialysis', 'Dialysis', 'Renal Unit'] },
  { name: 'Oncology', group: 'clinical', aliases: ['Cancer Clinic'] },
  { name: 'Urology', group: 'clinical' },
  { name: 'Ear, Nose and Throat', group: 'clinical', aliases: ['ENT'] },
  { name: 'Ophthalmology', group: 'clinical', aliases: ['Eye Clinic', 'Opthalmology'] },
  { name: 'Dental', group: 'clinical', aliases: ['Dental Clinic', 'Dentistry'] },
  { name: 'Dermatology', group: 'clinical', aliases: ['Skin Clinic'] },
  { name: 'Psychiatry', group: 'clinical', aliases: ['Mental Health'] },
  { name: 'Physiotherapy', group: 'clinical', aliases: ['Physical Therapy', 'Rehabilitation'] },
  { name: 'HIV Care and Treatment', group: 'clinical', aliases: ['ART Clinic', 'HIV Clinic', 'ART'] },
  { name: 'TB Clinic', group: 'clinical', aliases: ['Tuberculosis', 'TB/Leprosy'] },

  // Maternal and child health
  { name: 'Maternity', group: 'maternal_child', aliases: ['Labour Ward', 'Labor Ward', 'Delivery'] },
  { name: 'Obstetrics & Gynaecology', group: 'maternal_child', aliases: ['Obstetrics and Gynaecology', 'Obstetrics & Gynecology', 'OB/GYN', 'OBGYN', 'Gynaecology'] },
  { name: 'Antenatal Care', group: 'maternal_child', aliases: ['ANC', 'Antenatal Clinic'] },
  { name: 'Family Planning', group: 'maternal_child', aliases: ['Reproductive Health'] },
  { name: 'Paediatrics', group: 'maternal_child', aliases: ['Pediatrics', 'Child Health', 'Children’s Ward'] },
  { name: 'Neonatal Unit', group: 'maternal_child', aliases: ['NICU', 'Newborn Unit', 'Neonatology'] },
  { name: 'Immunization', group: 'maternal_child', aliases: ['EPI', 'Vaccination', 'Immunisation'] },
  { name: 'Nutrition', group: 'maternal_child', aliases: ['Nutrition Unit', 'OTP', 'Stabilization Centre'] },

  // Diagnostics
  { name: 'Laboratory', group: 'diagnostics', aliases: ['Lab', 'Medical Laboratory'] },
  { name: 'Blood Bank', group: 'diagnostics', aliases: ['Blood Transfusion'] },
  { name: 'Pathology', group: 'diagnostics', aliases: ['Histopathology'] },
  { name: 'Radiology', group: 'diagnostics', aliases: ['Imaging', 'X-ray', 'Ultrasound'] },
  { name: 'CT Scan', group: 'diagnostics', aliases: ['Computed Tomography', 'CT'] },

  // Pharmacy and support services
  { name: 'Pharmacy', group: 'support', aliases: ['Dispensary'] },
  { name: 'Medical Stores', group: 'support', aliases: ['Stores', 'Supply Chain'] },
  { name: 'Central Sterile Services', group: 'support', aliases: ['CSSD', 'Sterilization'] },
  { name: 'Infection Prevention and Control', group: 'support', aliases: ['IPC'] },
  { name: 'Social Work', group: 'support', aliases: ['Social Services', 'Psychosocial Support'] },
  { name: 'Ambulance Services', group: 'support', aliases: ['Ambulance', 'Transport'] },
  { name: 'Mortuary', group: 'support' },
  { name: 'Kitchen and Catering', group: 'support', aliases: ['Kitchen', 'Catering'] },
  { name: 'Laundry', group: 'support' },
  { name: 'Housekeeping', group: 'support', aliases: ['Cleaning'] },
  { name: 'Maintenance', group: 'support', aliases: ['Biomedical Engineering', 'Works'] },
  { name: 'Security', group: 'support' },

  // Records and administration
  { name: 'Reception', group: 'administration', aliases: ['Front Desk'] },
  { name: 'Registration', group: 'administration', aliases: ['Central Registration'] },
  { name: 'Records & HMIS', group: 'administration', aliases: ['Records', 'Medical Records', 'HMIS', 'Health Information'] },
  { name: 'Billing', group: 'administration', aliases: ['Cashier', 'Billing and Cashier'] },
  { name: 'Finance', group: 'administration', aliases: ['Accounts'] },
  { name: 'Human Resources', group: 'administration', aliases: ['HR'] },
  { name: 'Administration', group: 'administration', aliases: ['Hospital Administration', 'Management'] },
  { name: 'Procurement', group: 'administration' },
  { name: 'ICT', group: 'administration', aliases: ['IT', 'Information Technology'] },
  { name: 'Quality Improvement', group: 'administration', aliases: ['Quality Assurance', 'QI'] },
  { name: 'Public Health', group: 'administration', aliases: ['Surveillance', 'Disease Surveillance'] },
  { name: 'County Health Office', group: 'administration', aliases: ['CHD Office'] },
] as const;

/** Lowercase letters and digits only, so "Ear, nose & throat" and "ENT" compare by content. */
export function departmentKey(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** The standard entry a stored value means (its name or any alias), if any. */
export function hospitalDepartmentFor(value: string | undefined | null): HospitalDepartment | undefined {
  if (!value) return undefined;
  const needle = departmentKey(value);
  if (!needle) return undefined;
  return HOSPITAL_DEPARTMENTS.find(item =>
    departmentKey(item.name) === needle || (item.aliases ?? []).some(alias => departmentKey(alias) === needle));
}

/** Whether two department names mean the same department. */
export function sameDepartment(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  if (departmentKey(a) === departmentKey(b)) return true;
  const left = hospitalDepartmentFor(a);
  return !!left && left === hospitalDepartmentFor(b);
}
