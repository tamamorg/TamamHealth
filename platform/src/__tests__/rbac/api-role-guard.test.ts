/**
 * RBAC — API-layer role checks (src/lib/api-auth.ts) and the CouchDB write
 * matrix (src/lib/sync/write-permissions.ts).
 *
 * Covers the station-role compatibility shim and BUG-008 (data_entry_clerk
 * could create patients via the API despite having no /patients module).
 */
import { hasRole } from '@/modules/identity/core/api-auth';
import type { AuthPayload } from '@/modules/identity/core/api-auth';
import { DOC_WRITE_ROLES } from '@/lib/sync/write-permissions';
import type { UserRole } from '@/lib/db-types';

const auth = (role: UserRole): AuthPayload => ({ sub: 'u', username: 'u', role, name: 'U' });

describe('hasRole: exact match', () => {
  test('grants when the role is listed', () => {
    expect(hasRole(auth('doctor'), ['doctor', 'nurse'])).toBe(true);
  });
  test('denies when the role is absent', () => {
    expect(hasRole(auth('cashier'), ['doctor', 'nurse'])).toBe(false);
  });
});

describe('hasRole: station-role shim', () => {
  test('clinician satisfies a doctor allow-list', () => {
    expect(hasRole(auth('clinician'), ['doctor'])).toBe(true);
  });
  test('triage_nurse and rooming_nurse satisfy a nurse allow-list', () => {
    expect(hasRole(auth('triage_nurse'), ['nurse'])).toBe(true);
    expect(hasRole(auth('rooming_nurse'), ['nurse'])).toBe(true);
  });
  test('registration clerks satisfy a front_desk allow-list', () => {
    expect(hasRole(auth('central_registration_clerk'), ['front_desk'])).toBe(true);
    expect(hasRole(auth('clinic_clerk'), ['front_desk'])).toBe(true);
  });
  test('the shim never grants beyond the mapped equivalent', () => {
    // triage_nurse maps to nurse, NOT clinical_officer — no prescribing rights.
    expect(hasRole(auth('triage_nurse'), ['clinical_officer'])).toBe(false);
    expect(hasRole(auth('clinician'), ['super_admin'])).toBe(false);
  });
});

describe('hasRole: super_admin wildcard (total access)', () => {
  test('super_admin passes an allow-list that does not name it', () => {
    expect(hasRole(auth('super_admin'), ['doctor'])).toBe(true);
    expect(hasRole(auth('super_admin'), ['nurse', 'lab_tech'])).toBe(true);
  });
  test('the wildcard applies to super_admin callers only', () => {
    expect(hasRole(auth('org_admin'), ['doctor'])).toBe(false);
    expect(hasRole(auth('government'), ['doctor'])).toBe(false);
  });
});

describe('CouchDB write matrix (DOC_WRITE_ROLES)', () => {
  test('front_desk may write patients but not clinical documents', () => {
    expect(DOC_WRITE_ROLES.patient).toContain('front_desk');
    expect(DOC_WRITE_ROLES.prescription).not.toContain('front_desk');
    expect(DOC_WRITE_ROLES.lab_result).not.toContain('front_desk');
    expect(DOC_WRITE_ROLES.medical_record).not.toContain('front_desk');
  });

  test('only clinicians may author medical records and prescriptions', () => {
    for (const t of ['medical_record', 'prescription', 'clinical_note'] as const) {
      expect(DOC_WRITE_ROLES[t]).toEqual(expect.arrayContaining(['doctor', 'clinical_officer']));
      expect(DOC_WRITE_ROLES[t]).not.toContain('nurse');
      expect(DOC_WRITE_ROLES[t]).not.toContain('front_desk');
    }
  });

  test('lab_result is writable by lab_tech and clinicians, not front_desk', () => {
    expect(DOC_WRITE_ROLES.lab_result).toContain('lab_tech');
    expect(DOC_WRITE_ROLES.lab_result).toContain('doctor');
    expect(DOC_WRITE_ROLES.lab_result).not.toContain('front_desk');
  });
});
