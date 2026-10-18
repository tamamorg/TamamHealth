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

import { PUBLIC_ORG_ID, PRIVATE_ORG_ID } from './seed-organizations';

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

export const DEMO_USER_PROFILES: readonly SeedUserProfile[] = [
  // Platform super admin (no org)
  { username: 'superadmin', name: 'TamamHealth Platform Admin', role: 'super_admin' },
  // Public org users (government MoH)
  { username: 'admin', name: 'Ministry of Health', role: 'government', orgId: PUBLIC_ORG_ID },
  { username: 'dr.wani', name: 'Dr. James Wani Igga', role: 'doctor', hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'dr.achol', name: 'Dr. Achol Mayen Deng', role: 'doctor', hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'dr.abuk', name: 'Dr. Abuk Ayen Malual', role: 'doctor', hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'dr.ajang', name: 'Dr. Ajang Kuol Deng', role: 'doctor', hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'dr.alier', name: 'Dr. Alier Chol Wol', role: 'doctor', hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'dr.awut', name: 'Dr. Awut Mayom Jok', role: 'doctor', hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'dr.bol', name: 'Dr. Bol Garang Akech', role: 'doctor', hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'dr.chol', name: 'Dr. Chol Atem Puok', role: 'doctor', hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'dr.nyamal', name: 'Dr. Nyamal Koang Lado', role: 'doctor', hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'clinician.akech', name: 'Dr. Akech Deng Mawien', role: 'clinician', hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'co.deng', name: 'CO Deng Mabior Kuol', role: 'clinical_officer', hospitalId: 'hosp-002', hospitalName: 'Wau State Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'dr.wau', name: 'Dr. Mary Akuol Deng', role: 'doctor', hospitalId: 'hosp-002', hospitalName: 'Wau State Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'nurse.wau', name: 'Nurse Grace Achai Lual', role: 'nurse', hospitalId: 'hosp-002', hospitalName: 'Wau State Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'pharma.wau', name: 'Pharmacist John Bol Garang', role: 'pharmacist', hospitalId: 'hosp-002', hospitalName: 'Wau State Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'desk.wau', name: 'Tabitha Nyandeng Kuol', role: 'front_desk', hospitalId: 'hosp-002', hospitalName: 'Wau State Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'nurse.stella', name: 'Nurse Stella Keji Lemi', role: 'nurse', hospitalId: 'hosp-003', hospitalName: 'Malakal Teaching Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'dr.ochalla', name: 'Dr. Peter Ochalla Diu', role: 'doctor', hospitalId: 'hosp-003', hospitalName: 'Malakal Teaching Hospital', orgId: PUBLIC_ORG_ID },
  // Bentiu's own clinician. Without one, the generated Bentiu visits borrowed
  // the Juba lab tech as their "provider" and triager, so every Bentiu
  // booking sat on the board of someone at another facility, where scoping
  // hides it.
  { username: 'co.bentiu', name: 'CO Gatwech Ruot Kuol', role: 'clinical_officer', hospitalId: 'hosp-004', hospitalName: 'Bentiu State Hospital', orgId: PUBLIC_ORG_ID },
  // Stationed at Juba, not Bentiu. Juba Teaching Hospital is where the seeded
  // doctors, nurses, triage, rooming, pharmacy, billing and records all work,
  // and `lab_tech` is the ONLY role that may enter a result
  // (`canEnterLabResults` in usePermissions). With the platform's one lab
  // technician posted to a different facility, `filterByScope` hid every Juba
  // order from them — so a test ordered in the flagship facility's
  // consultation could be placed and never resulted, and the lab loop the
  // product is built around had no one standing at the end of it.
  { username: 'lab.gatluak', name: 'Lab Tech Gatluak Puok', role: 'lab_tech', hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'pharma.rose', name: 'Pharmacist Rose Gbudue', role: 'pharmacist', hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'desk.amira', name: 'Amira Juma Hassan', role: 'front_desk', hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'data.ayen', name: 'Ayen Dut Malual', role: 'data_entry_clerk', hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'supt.lado', name: 'Dr. Lado Tombe Kenyi', role: 'medical_superintendent', hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'manager.aluel', name: 'Aluel Bol Maker', role: 'hospital_manager', hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'biller.nyandeng', name: 'Nyandeng Chol Atem', role: 'medical_biller', hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'hrio.dut', name: 'Dut Machar Kuol', role: 'hrio', hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'nutr.nyabol', name: 'Nyabol Koang Jal', role: 'nutritionist', hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'rad.tamamhealth', name: 'TamamHealth Ladu Soro', role: 'radiologist', hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'midwife.nyakong', name: 'Midwife Nyakong Gatkuoth', role: 'nurse', hospitalId: 'hosp-003', hospitalName: 'Malakal Teaching Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'cashier.deng', name: 'Deng Akec Ring', role: 'cashier', hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'county.lopez', name: 'Dr. Lopez Lokai Modi', role: 'county_health_director', orgId: PUBLIC_ORG_ID },
  // Community-health work uses the active nurse permission envelope. The
  // seeded follow-ups below already target user-bhw.akol; this corresponding
  // staff record makes that assignment and demo login real end to end.
  { username: 'bhw.akol', name: 'Community Health Worker Akol Deng Mading', role: 'nurse', hospitalId: 'phcu-001', hospitalName: 'Kajo-keji Boma PHCU', orgId: PUBLIC_ORG_ID },
  // Clinical-flow workflow stations (EHR Clinical Flow doc §4)
  { username: 'reg.clerk', name: 'Grace Poni Lukudu', role: 'central_registration_clerk', hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'clinic.clerk', name: 'Joseph Taban Lado', role: 'clinic_clerk', hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'triage.mary', name: 'Mary Nyaruai Gai', role: 'nurse', hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'rooming.sara', name: 'Sara Aluel Bol', role: 'nurse', hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'clinician.peter', name: 'Dr. Peter Garang Deng', role: 'clinician', hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: PUBLIC_ORG_ID },
  { username: 'hmis.john', name: 'John Majok Chol', role: 'records_hmis_officer', hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: PUBLIC_ORG_ID },
  // Private org admin (Mercy Hospital Group)
  { username: 'org.admin', name: 'Mercy Org Administrator', role: 'org_admin', orgId: PRIVATE_ORG_ID },
  { username: 'dr.mercy', name: 'Dr. Grace Lado', role: 'doctor', hospitalId: 'hosp-mercy-001', hospitalName: 'Mercy General Hospital', orgId: PRIVATE_ORG_ID },
  { username: 'nurse.mercy', name: 'Nurse Josephine Poni Wani', role: 'nurse', hospitalId: 'hosp-mercy-001', hospitalName: 'Mercy General Hospital', orgId: PRIVATE_ORG_ID },
  { username: 'desk.mercy', name: 'Martha Yar Kuek', role: 'front_desk', hospitalId: 'hosp-mercy-001', hospitalName: 'Mercy General Hospital', orgId: PRIVATE_ORG_ID },
  { username: 'pharma.mercy', name: 'Emmanuel Loro Wani', role: 'pharmacist', hospitalId: 'hosp-mercy-001', hospitalName: 'Mercy General Hospital', orgId: PRIVATE_ORG_ID },
  { username: 'lab.mercy', name: 'Simon Machar Dhieu', role: 'lab_tech', hospitalId: 'hosp-mercy-001', hospitalName: 'Mercy General Hospital', orgId: PRIVATE_ORG_ID },
];
