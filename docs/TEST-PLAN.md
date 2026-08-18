# TamamHealth Health Information System - Comprehensive Test Plan

**Version:** 1.1
**Date:** 2026-02-21 (revised 2026-08-18)
**Application:** TamamHealth
**URL:** https://app.tamamhealth.org (production, DigitalOcean-hosted)
**Repository:** github.com/tamamorg/TamamHealth

---

## 1. Executive Summary

This test plan covers end-to-end testing of the TamamHealth Health Information System, an offline-first Electronic Health Record (EHR) for South Sudan. Testing covers all clinical workflows, data integrity, security controls, and performance across all 25 user roles.

### 1.1 What's actually automated today

This plan is a manual/exploratory test matrix; there is no 1:1 automated
equivalent. What does exist, in `platform/`:

- **Jest** (`npm test`, config in `jest.config.ts`, jsdom environment) — the only
  automated test runner. ~59 test files under `src/__tests__/`, organized by
  concern: `clinical/`, `services/`, `sync/`, `security/`, `rbac/`,
  `integration/`, `api/`, `clinical-notes/`, plus module-specific suites
  (`pharmacy/`, `telehealth/`, `tour/`, `components/`). These are unit/
  integration tests against services and logic — there is **no
  `@testing-library/react`** and no rendered-component assertions in the
  React sense.
- **No browser E2E automation** — no Playwright or Cypress config anywhere in
  the repo. Every functional test case below (`F-*`) is manual until someone
  adds an E2E harness (see Recommendations, §9).
- `npx tsc --noEmit` (type-check) and `npm run build` are the other two gates
  CI (`.github/workflows/ci.yml`) runs on every PR, alongside `npm test`.

---

## 2. Test Accounts

There is no seeded roster of demo credentials anymore. Login (`/login`) is a real
username/password form (with an optional role picker, usable only by super admins
signing into another role's workspace) — accounts are issued by an administrator
(Org Admin → Users, or Super Admin → Users), which also issues a temporary
password that forces a change at next login. To build a test matrix, provision one
account per role you need to cover from an admin account; there is no default
password to document here.

Roles as of this writing (`UserRole` in `platform/src/lib/db-types.ts`, 25 total):
`super_admin`, `org_admin`, `doctor`, `clinical_officer`, `nurse`, `midwife`,
`lab_tech`, `pharmacist`, `front_desk`, `cashier`, `government`,
`county_health_director`, `data_entry_clerk`, `medical_superintendent`, `hrio`,
`nutritionist`, `radiologist`, `hospital_manager`, `medical_biller`, plus six
clinical-flow station roles (`central_registration_clerk`, `clinic_clerk`,
`triage_nurse`, `rooming_nurse`, `clinician`, `records_hmis_officer`). There is no
"Boma Health Worker" or "Payam Supervisor" role — the standalone community-health
(boma/payam/BHW) tier was removed from the platform; drop any test cases that
assume it.

---

## 3. Functional Testing

### 3.1 Authentication & Authorization

| # | Test Case | Steps | Expected Result | Priority |
|---|-----------|-------|-----------------|----------|
| F-AUTH-01 | Login with valid credentials | Enter a provisioned doctor account's username/password | Redirects to that role's landing dashboard (`/dashboard`) | Critical |
| F-AUTH-02 | Login with invalid password | Enter a valid username with the wrong password | Shows error, no redirect | Critical |
| F-AUTH-03 | Login with non-existent user | Enter an unprovisioned username | Shows error | Critical |
| F-AUTH-04 | Session persistence | Login, close tab, reopen | Still logged in | High |
| F-AUTH-05 | Logout | Click logout button | Returns to login page, cookie cleared | High |
| F-AUTH-06 | Role-based routing | Login as each role | Each redirects to correct dashboard | Critical |
| F-AUTH-07 | Route protection | Access /consultation without login | Redirects to /login | Critical |
| F-AUTH-08 | Role guard | Access /consultation as pharmacist | Shows "Access Restricted" | High |
| F-AUTH-09 | Disabled account | Attempt login with disabled user | Shows error, login blocked | High |
| F-AUTH-10 | Token expiry | Wait past session TTL with a stale token (default 30 days, `SESSION_TTL_HOURS` env-configurable) | Redirects to login on next navigation | Medium |

### 3.2 Patient Registration (Front Desk)

| # | Test Case | Steps | Expected Result | Priority |
|---|-----------|-------|-----------------|----------|
| F-REG-01 | Register new patient | Fill all required fields, save | Patient created with hospital number | Critical |
| F-REG-02 | Hospital number format | Register a patient at a facility | Number starts with that facility's configured `hospitalNumberPrefix` | High |
| F-REG-03 | Duplicate prevention | Register two patients with same name | Both created with unique IDs | Medium |
| F-REG-04 | Required field validation | Submit with empty first name | Shows validation error | High |
| F-REG-05 | Patient search | Search by name or hospital number | Correct results returned | Critical |
| F-REG-06 | Patient details view | Click patient in list | Full details displayed | High |
| F-REG-07 | Edit patient info | Update patient phone number | Change persists after reload | High |
| F-REG-08 | Gender validation | Register with Male/Female/Unknown | All accepted | Medium |

### 3.3 Doctor Consultation

| # | Test Case | Steps | Expected Result | Priority |
|---|-----------|-------|-----------------|----------|
| F-CON-01 | Create consultation | Select patient, fill complaint, save | Medical record created | Critical |
| F-CON-02 | Patient search in consultation | Type patient name in search | Dropdown shows matching patients | High |
| F-CON-03 | Vital signs entry | Enter all vital signs | BMI auto-calculated, values saved | High |
| F-CON-04 | ICD-11 diagnosis search | Search "malaria" | Shows matching ICD-11 codes | High |
| F-CON-05 | Add multiple diagnoses | Add primary + secondary | Both saved with correct type | High |
| F-CON-06 | Diagnosis severity | Set severity to mild/moderate/severe | Severity saved correctly per diagnosis | High |
| F-CON-07 | Prescription entry | Add medication with dose/route/frequency | Prescription created in DB | Critical |
| F-CON-08 | Prescription instructions | Enter "Take with food" | Instructions saved with prescription | Medium |
| F-CON-09 | Lab order creation | Check "Malaria RDT" and "FBC" | Lab orders appear in Lab module | Critical |
| F-CON-10 | Prescription to pharmacy | Add Coartem prescription, save | Appears in Pharmacy prescription queue | Critical |
| F-CON-11 | Drug-interaction check | Prescribe two interacting drugs | Interaction warning shown before save | High |
| F-CON-12 | Allergy check | Prescribe a drug matching a recorded allergy | Allergy warning shown before save | High |
| F-CON-13 | Clinical Scribe | Open AI Scribe, dictate or paste notes | Vitals/complaint/meds/diagnoses/SOAP fields auto-populated on approval | Low |
| F-CON-15 | File attachments | Upload scan/X-ray image | Attachment saved with consultation | Medium |
| F-CON-16 | Follow-up scheduling | Set follow-up date + reason | Follow-up saved in record | Medium |
| F-CON-17 | Referral from consultation | Check referral, select hospital | Referral data saved | High |
| F-CON-18 | Post-save navigation | Save consultation | Redirects to /patients | Medium |

### 3.4 Laboratory

| # | Test Case | Steps | Expected Result | Priority |
|---|-----------|-------|-----------------|----------|
| F-LAB-01 | View pending orders | Login as lab tech | See all pending lab orders | Critical |
| F-LAB-02 | Accept lab order | Click "Accept" on pending order | Status changes to "In Progress" | High |
| F-LAB-03 | Enter lab result | Click "Enter Result", type value | Result saved, status = completed | Critical |
| F-LAB-04 | Consultation-generated orders | Doctor orders Malaria RDT | Appears in lab tech queue | Critical |
| F-LAB-05 | Filter by status | Click "Pending" filter | Only pending orders shown | Medium |
| F-LAB-06 | Search lab orders | Search by patient name | Correct orders filtered | Medium |
| F-LAB-07 | Stats accuracy | Check stat counts | Match actual data in table | Medium |

### 3.5 Pharmacy

| # | Test Case | Steps | Expected Result | Priority |
|---|-----------|-------|-----------------|----------|
| F-PH-01 | View prescription queue | Login as pharmacist | See all prescriptions from DB | Critical |
| F-PH-02 | Dispense medication | Click "Dispense" on pending Rx | Status changes to "dispensed", timestamp set | Critical |
| F-PH-03 | Consultation prescriptions appear | Doctor saves consultation with Rx | New Rx appears in pharmacy queue | Critical |
| F-PH-04 | Non-pharmacist access | Login as nurse, view pharmacy | "Pharmacist only" shown on actions | High |
| F-PH-05 | Search prescriptions | Search by patient or medication | Correct results | Medium |
| F-PH-06 | Inventory view | Switch to Inventory tab | Medication stock levels shown | Medium |
| F-PH-07 | Dispensed count | Dispense 2 prescriptions | "Dispensed Today" stat updates | Medium |

### 3.6 Referrals & Transfers

| # | Test Case | Steps | Expected Result | Priority |
|---|-----------|-------|-----------------|----------|
| F-REF-01 | Create referral | Fill referral form, submit | Referral created with status "pending" | High |
| F-REF-02 | Accept referral | Click "Accept" on incoming referral | Status = "seen", patient transferred | Critical |
| F-REF-03 | Patient transfer on accept | Accept referral to Hospital B | Patient's registrationHospital updated to B | Critical |
| F-REF-04 | Reject referral | Click "Decline" | Status = "rejected" | Medium |
| F-REF-05 | Emergency referral | Create emergency referral | Emergency badge + warning shown | Medium |

### 3.7 Government Dashboard

| # | Test Case | Steps | Expected Result | Priority |
|---|-----------|-------|-----------------|----------|
| F-GOV-01 | National statistics | Login as a government-role account | Total patients from actual DB count | High |
| F-GOV-02 | Hospital performance | View hospital table | Correct counts per hospital | Medium |
| F-GOV-03 | Disease surveillance | View epidemic intelligence | Disease alerts and trends shown | Medium |

### 3.8 Navigation & UI Completeness

| # | Test Case | Steps | Expected Result | Priority |
|---|-----------|-------|-----------------|----------|
| F-NAV-01 | All sidebar links work | Click each sidebar item | Page loads without error | High |
| F-NAV-02 | Sidebar collapse | Click collapse button | Sidebar collapses, content expands | Medium |
| F-NAV-03 | Mobile sidebar | Open on mobile device | Hamburger menu works | Medium |
| F-NAV-04 | Global search | Type in top bar search | Relevant results in current page | Medium |
| F-NAV-05 | Theme toggle | Click dark/light toggle | Theme switches, persists on reload | Medium |
| F-NAV-06 | Breadcrumb navigation | Navigate deep, click back | Returns to correct page | Low |

---

## 4. Non-Functional Testing

### 4.1 Performance

| # | Test Case | Expected Result | Priority |
|---|-----------|-----------------|----------|
| NF-PERF-01 | Initial page load | Login page loads in < 3s on 3G | High |
| NF-PERF-02 | Dashboard render | Dashboard renders in < 2s with 50+ patients | High |
| NF-PERF-03 | Patient search latency | Results appear in < 500ms for 500 patients | Medium |
| NF-PERF-04 | Consultation save time | Full consultation saves in < 2s | High |
| NF-PERF-05 | Offline mode | App continues to work without network | Critical |
| NF-PERF-06 | Service worker caching | Pages load from cache when offline | High |

### 4.2 Security & Compliance

| # | Test Case | Expected Result | Priority |
|---|-----------|-----------------|----------|
| NF-SEC-01 | JWT token validation | Malformed/expired tokens rejected in the Edge proxy (`src/proxy.ts`); revocation (logout) is checked separately, server-side, in `getAuthPayload`/`/api/auth/me` on every API call — a revoked token still passes the proxy but is rejected there | Critical |
| NF-SEC-02 | Route protection | Unauthenticated access blocked | Critical |
| NF-SEC-03 | Role-based access control | Users can only access role-permitted pages | Critical |
| NF-SEC-04 | Password storage | Passwords hashed with bcrypt | Critical |
| NF-SEC-05 | Audit logging | Login, logout, CRUD actions logged | High |
| NF-SEC-06 | Session / idle timeout | Screen auto-locks on tab-hidden and after 10 min idle (`useAutoLock`, facility/org-configurable); unlock via 4-digit PIN | Medium |
| NF-SEC-07 | Data scoping (org) | Users only see their organization's data | High |
| NF-SEC-08 | Data scoping (hospital) | Hospital staff only see their hospital data | High |
| NF-SEC-09 | HTTPS enforcement | Production (app.tamamhealth.org, DigitalOcean) uses HTTPS | Critical |
| NF-SEC-10 | XSS prevention | User input is sanitized/escaped in React | High |

### 4.3 Access-control & audit checklist

Framed loosely against HIPAA-style controls as a familiar checklist shape —
HIPAA itself isn't the operative compliance framework for a South-Sudan-based
deployment (see `docs/VENTURES.md`), so treat "Implemented" below as "this
control exists," not as a compliance certification.

| # | Control | Status | Notes |
|---|---------|--------|-------|
| AC-01 | Access controls | Implemented | 25-role RBAC, enforced in the Edge proxy (`src/proxy.ts`) + server + client (`role-routes.ts`) |
| AC-02 | Audit trail | Implemented | All actions logged in `tamamhealth_audit_log` (push-only, append-only) |
| AC-03 | Unique user identification | Implemented | Per-user accounts, admin-issued, JWT session |
| AC-04 | Automatic session/idle timeout | Implemented | Auto-lock on tab-hidden + 10 min idle, PIN unlock (see NF-SEC-06) |
| AC-05 | Encryption in transit | Implemented | HTTPS in production |
| AC-06 | Encryption at rest | Not implemented for the primary write path | PouchDB/IndexedDB data is unencrypted in the browser — this is by design; the platform's real at-rest control is full-disk/volume encryption on the server (`PHI_AT_REST_STRATEGY=disk-encryption`, see `docs/GO-LIVE-STEP-BY-STEP.md`), not application-layer PouchDB encryption. A server-only field-encryption layer (`field-encryption.ts`) exists but is a no-op in the browser and does not cover patient demographics |
| AC-07 | Data integrity | Implemented | PouchDB revision tracking + CouchDB `validate_doc_update` guard |
| AC-08 | Minimum necessary access | Implemented | Role-based data scoping (`filterByScope()`) |

---

## 5. Usability Testing

| # | Test Case | Expected Result | Priority |
|---|-----------|-----------------|----------|
| U-01 | First-time user onboarding | First-visit "Get Started" onboarding card appears on the home dashboard after login | High |
| U-02 | Mobile responsiveness | All pages usable on 375px width | High |
| U-03 | Error messages clarity | Errors describe what went wrong | Medium |
| U-04 | Form field labels | All inputs have clear labels | Medium |
| U-05 | Loading states | Spinners shown during async operations | Medium |
| U-06 | Empty states | Meaningful messages when no data | Medium |
| U-07 | Color contrast | Text readable in dark and light mode | Medium |
| U-08 | Touch targets | Buttons at least 44x44px on mobile | Low |

---

## 6. Regression Testing

After each fix, verify these critical paths still work:

| # | Regression Test | Covers |
|---|----------------|--------|
| R-01 | Login → Dashboard → Logout | Auth flow |
| R-02 | Register patient → View in list | Patient CRUD |
| R-03 | Consultation → Lab order appears | Data flow |
| R-04 | Consultation → Prescription appears in pharmacy | Data flow |
| R-05 | Create referral → Accept → Patient transferred | Referral flow |
| R-06 | Theme toggle persists | Settings |
| R-07 | Offline functionality | PWA/Service Worker |

---

## 7. Test Results Summary

### Data Flow Fixes Applied (2026-02-21)

| Issue | Before | After | Status |
|-------|--------|-------|--------|
| Consultation -> Lab orders | `labResults: []` always empty | Lab orders created in `tamamhealth_lab_results` DB | FIXED |
| Consultation -> Pharmacy | Prescriptions only in MedicalRecord | Prescriptions created in `tamamhealth_prescriptions` DB | FIXED |
| Pharmacy mock data | Hardcoded 6 prescriptions | Reads from PouchDB `tamamhealth_prescriptions` | FIXED |
| Diagnosis severity | Hardcoded `'moderate'` | Per-diagnosis severity selector (mild/moderate/severe) | FIXED |
| Prescription instructions | Always empty `''` | Instructions input field added | FIXED |
| Pharmacy dispense | Only updated local state | Persists to DB via `dispensePrescription()` | FIXED |
| Government patient count | Used `h.patientCount` (static) | Uses actual PouchDB patient count | FIXED (prior) |
| Referral patient transfer | Only status changed | Patient `registrationHospital` updated | FIXED (prior) |
| Boma visit patient creation | No patient record created | PatientDoc created for new patients | FIXED (prior) |

### Known Limitations (as of 2026-02-21 — re-verify before relying on #1-2; #3 and #5 below are since resolved)

1. **Inventory management** - Was mock data at the time of this note; re-check against the current `pharmacy`/`equipment` modules rather than assuming it's still true.
2. **Lab result → Medical record linking** - Was not back-linked at the time of this note; re-verify against the current clinical-flow implementation.
3. ~~No idle session timeout~~ - **Resolved**: the shell now auto-locks on tab-hidden and after 10 min idle (`useAutoLock`), unlocked by a 4-digit PIN.
4. **PouchDB data not encrypted at rest** - Still true, and by design: patient demographics in the browser IndexedDB are in the clear. The platform's real at-rest control is server-side full-disk encryption, not application-layer PouchDB encryption (see §9).
5. ~~Demo credentials visible~~ - **Resolved**: `/login` no longer shows a seeded account roster; accounts are admin-issued.

---

## 8. Risk-Based Test Priority

**Critical Path (Must Pass):**
1. Login works across all roles
2. Patient registration creates valid records
3. Doctor consultation saves to all 3 DBs (medical records, lab, prescriptions)
4. Lab tech can view and process orders from consultations
5. Pharmacist can view and dispense prescriptions from consultations
6. Referral acceptance transfers patient ownership

**High Priority:**
7. All sidebar navigation links work
8. Role-based access control blocks unauthorized pages
9. Dark/light theme toggle works
10. Data scoping filters by organization and hospital

**Medium Priority:**
11. Drug-interaction and allergy checks fire correctly at prescribing
12. Clinical Scribe dictation fills the consultation form correctly
13. Government dashboard statistics accuracy
14. Search and filter functionality across all modules

---

## 9. Recommendations

1. ~~Add idle session timeout~~ — done (`useAutoLock`: tab-hidden + 10 min idle, PIN unlock).
2. ~~Remove demo credentials from the login page~~ — done; `/login` is a real
   admin-issued-account form now, no seeded roster.
3. ~~Add CSRF tokens~~ — done (`lib/csrf.ts`, enforced in `src/proxy.ts`).
4. **Encrypt PouchDB at rest**, or confirm the disk-encryption-only strategy
   (`PHI_AT_REST_STRATEGY=disk-encryption`) is acceptable for every deployment
   target — patient demographics in the browser IndexedDB remain in the clear
   either way.
5. **Verify lab result → medical record linking** end-to-end — confirm whether
   this MVP-era gap has been closed as part of the clinical-flow work.
6. **Build out inventory management** further if any module still relies on
   placeholder/mock stock data — re-check against the current `pharmacy` and
   `equipment` modules rather than assuming this is still true.
7. **Grow Jest coverage** where it's thin — ~59 test files exist today across
   `clinical/`, `services/`, `sync/`, `security/`, `rbac/`, `integration/`,
   but several placeholder directories (`audit/`, `clinical-flow/`, `db/`,
   `observability/`, `usage/`) are still empty.
8. **Add E2E tests** with Playwright or Cypress — still true; no browser
   automation exists anywhere in the repo today.
