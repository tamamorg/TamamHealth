/**
 * The seeded demo-user roster, defined ONCE.
 *
 * Two consumers must agree on it exactly:
 *   - `lib/db-seed.ts` writes the browser-side user/staff documents from it.
 *   - `modules/identity/core/seed-credentials.ts` (server-only) mints a
 *     password per username and `server-users.ts` verifies logins against it.
 *
 * If they drift, an account shows in the picker but cannot sign in, or signs
 * in with no seeded staff record. Browser-safe on purpose: no passwords, no
 * `node:fs`, no `node:crypto`. Passwords stay in the server-only module.
 */

import { PUBLIC_ORG_ID } from './seed-organizations';

export type SeedUserRole =
  | 'super_admin' | 'government' | 'county_health_director' | 'doctor'
  | 'clinical_officer' | 'nurse' | 'midwife'
  | 'lab_tech' | 'pharmacist' | 'front_desk' | 'cashier'
  | 'data_entry_clerk' | 'medical_superintendent'
  | 'hrio' | 'nutritionist' | 'radiologist'
  | 'org_admin' | 'hospital_manager' | 'medical_biller'
  | 'central_registration_clerk' | 'clinic_clerk' | 'triage_nurse' | 'rooming_nurse'
  | 'clinician' | 'records_hmis_officer';

export interface SeedUserProfile {
  username: string;
  name: string;
  role: SeedUserRole;
  hospitalId?: string;
  hospitalName?: string;
  orgId?: string;
}

export const JUBA = { hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: PUBLIC_ORG_ID } as const;
export const WAU = { hospitalId: 'hosp-002', hospitalName: 'Wau State Hospital', orgId: PUBLIC_ORG_ID } as const;
export const DEMO_HOSPITALS = [JUBA, WAU] as const;

/**
 * Two hospitals in one organization, so a patient can be transferred between
 * them: a transfer's document and the patient's sealed fields stay inside one
 * tenant. One account per job at each hospital. Juba keeps a second doctor so a
 * hand-over inside a hospital has someone to go to.
 */
export const DEMO_USER_PROFILES: readonly SeedUserProfile[] = [
  // Platform and organization
  { username: 'superadmin', name: 'TamamHealth Platform Admin', role: 'super_admin' },
  { username: 'admin', name: 'Ministry of Health', role: 'government', orgId: PUBLIC_ORG_ID },
  { username: 'county.lopez', name: 'Dr. Lopez Lokai Modi', role: 'county_health_director', orgId: PUBLIC_ORG_ID },
  { username: 'org.admin', name: 'Organization Administrator', role: 'org_admin', orgId: PUBLIC_ORG_ID },
  // Juba Teaching Hospital
  { username: 'dr.wani', name: 'Dr. James Wani Igga', role: 'doctor', ...JUBA },
  { username: 'dr.achol', name: 'Dr. Achol Mayen Deng', role: 'doctor', ...JUBA },
  { username: 'triage.mary', name: 'Mary Nyaruai Gai', role: 'nurse', ...JUBA },
  // `lab_tech` is the only role that may enter a result, so each hospital needs one.
  { username: 'lab.gatluak', name: 'Lab Tech Gatluak Puok', role: 'lab_tech', ...JUBA },
  { username: 'pharma.rose', name: 'Pharmacist Rose Gbudue', role: 'pharmacist', ...JUBA },
  { username: 'desk.amira', name: 'Amira Juma Hassan', role: 'front_desk', ...JUBA },
  { username: 'cashier.deng', name: 'Deng Akec Ring', role: 'cashier', ...JUBA },
  { username: 'data.ayen', name: 'Ayen Dut Malual', role: 'data_entry_clerk', ...JUBA },
  { username: 'supt.lado', name: 'Dr. Lado Tombe Kenyi', role: 'medical_superintendent', ...JUBA },
  { username: 'manager.aluel', name: 'Aluel Bol Maker', role: 'hospital_manager', ...JUBA },
  { username: 'biller.nyandeng', name: 'Nyandeng Chol Atem', role: 'medical_biller', ...JUBA },
  { username: 'hrio.dut', name: 'Dut Machar Kuol', role: 'hrio', ...JUBA },
  { username: 'nutr.nyabol', name: 'Nyabol Koang Jal', role: 'nutritionist', ...JUBA },
  { username: 'rad.tamamhealth', name: 'TamamHealth Ladu Soro', role: 'radiologist', ...JUBA },
  // Wau State Hospital
  { username: 'dr.wau', name: 'Dr. Mary Akuol Deng', role: 'doctor', ...WAU },
  { username: 'co.deng', name: 'CO Deng Mabior Kuol', role: 'clinical_officer', ...WAU },
  { username: 'nurse.wau', name: 'Nurse Grace Achai Lual', role: 'nurse', ...WAU },
  { username: 'lab.wau', name: 'Lab Tech Simon Machar Dhieu', role: 'lab_tech', ...WAU },
  { username: 'pharma.wau', name: 'Pharmacist John Bol Garang', role: 'pharmacist', ...WAU },
  { username: 'desk.wau', name: 'Tabitha Nyandeng Kuol', role: 'front_desk', ...WAU },
];
