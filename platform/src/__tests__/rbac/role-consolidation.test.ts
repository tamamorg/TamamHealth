import { readFileSync } from 'node:fs';
import path from 'node:path';
import { assignableRolesForOrgAdmin, getAvailableRoles, isRouteAllowed } from '@/lib/permissions';
import { COLLECTIONS, DOC_WRITE_ROLES } from '@/lib/sync/write-permissions';
import { canonicalizeUserRole, isLegacyRole, LEGACY_ROLE_MAP } from '@/lib/user-role';
import { resolveRole } from '@/modules/identity/provisioning/bulk-user-import';
import { migrateRoleDocument } from '../../../scripts/migrate-retired-roles.mjs';

const RETIRED = [
  ['clinician', 'doctor'],
  ['records_hmis_officer', 'hrio'],
  ['clinic_clerk', 'front_desk'],
  ['central_registration_clerk', 'front_desk'],
] as const;

describe('retired account roles', () => {
  it.each(RETIRED)('%s signs in as %s', (from, to) => {
    expect(canonicalizeUserRole(from)).toBe(to);
    expect(isLegacyRole(from)).toBe(true);
    expect(isLegacyRole(to)).toBe(false);
  });

  it('never maps to another retired role, so one pass is enough', () => {
    for (const to of LEGACY_ROLE_MAP.values()) expect(isLegacyRole(to)).toBe(false);
  });

  it('leaves a role string from a token alone when it is an object key', () => {
    expect(canonicalizeUserRole('constructor' as never)).toBe('constructor');
  });

  it('offers no retired role for a new account', () => {
    for (const roles of [getAvailableRoles('public', true), getAvailableRoles('private')]) {
      expect(roles.filter(isLegacyRole)).toEqual([]);
    }
  });

  it.each(['src/components/admin/UserForm.tsx', 'src/app/(dashboard)/admin/users/[id]/page.tsx'])(
    '%s lists no retired role', file => {
      const source = readFileSync(path.join(process.cwd(), file), 'utf8');
      const list = source.slice(source.indexOf('const ROLE_OPTIONS'), source.indexOf('];', source.indexOf('const ROLE_OPTIONS')));
      for (const role of LEGACY_ROLE_MAP.keys()) expect(list).not.toContain(`'${role}'`);
    },
  );

  it('keeps an organization roster that named a retired role usable', () => {
    expect(assignableRolesForOrgAdmin('public', ['clinic_clerk', 'nurse'])).toEqual(['nurse', 'front_desk']);
  });

  it.each([
    ['clinician', 'doctor'],
    ['clinic clerk', 'front_desk'],
    ['registration clerk', 'front_desk'],
    ['records officer', 'hrio'],
  ])('imports the old label "%s" as %s', (label, role) => {
    expect(resolveRole(label)).toBe(role);
  });

  it('reads the proxy role through the same conversion', () => {
    const proxy = readFileSync(path.join(process.cwd(), 'src/proxy.ts'), 'utf8');
    expect(proxy).toContain('const role = canonicalizeUserRole(payload.role as UserRole);');
  });
});

describe('write rows the merge depends on', () => {
  it('lets HRIO write everything the HMIS officer could', () => {
    for (const type of ['disease_alert', 'facility_census']) {
      expect(DOC_WRITE_ROLES[type]).toContain('hrio');
    }
  });

  it('keeps health records out of human-resources documents', () => {
    for (const type of ['asset', 'staff_schedule', 'leave_request', 'payroll_entry']) {
      expect(DOC_WRITE_ROLES[type]).not.toContain('hrio');
      expect(DOC_WRITE_ROLES[type]).toContain('hospital_manager');
      expect(DOC_WRITE_ROLES[type]).toContain('medical_superintendent');
    }
    expect(isRouteAllowed('hrio', '/hr')).toBe(false);
  });

  it('keeps reception out of records that move money, and on insurance', () => {
    expect(COLLECTIONS).not.toContain('front_desk');
    for (const type of ['billing', 'charge', 'adjustment', 'payment', 'refund', 'saved_payment_method', 'payment_plan', 'invoice']) {
      expect(DOC_WRITE_ROLES[type]).not.toContain('front_desk');
    }
    for (const type of ['insurance_policy', 'eligibility_check', 'claim', 'ledger_entry']) {
      expect(DOC_WRITE_ROLES[type]).toContain('front_desk');
    }
  });
});

describe('migrate-retired-roles', () => {
  it('converts a user and reports the move', () => {
    const doc = { _id: 'u', role: 'clinic_clerk' };
    expect(migrateRoleDocument(doc, canonicalizeUserRole)).toEqual(['clinic_clerk -> front_desk']);
    expect(doc.role).toBe('front_desk');
  });

  it('collapses an organization roster without duplicates', () => {
    const doc = { _id: 'o', enabledRoles: ['clinic_clerk', 'front_desk', 'clinician'] };
    expect(migrateRoleDocument(doc, canonicalizeUserRole)).toEqual(['enabledRoles']);
    expect(doc.enabledRoles).toEqual(['front_desk', 'doctor']);
  });

  it('leaves a current document untouched, so a re-run writes nothing', () => {
    expect(migrateRoleDocument({ _id: 'u', role: 'doctor', enabledRoles: ['nurse'] }, canonicalizeUserRole)).toEqual([]);
  });
});
