/**
 * Executes the `validate_doc_update` source that ships into every org-scoped
 * CouchDB database.
 *
 * The generated string is the last line of defence between a compromised or
 * mis-provisioned browser session and another tenant's records, and it runs
 * inside CouchDB rather than here — so nothing else in the test suite proves it
 * behaves. A syntax error blocks every write to every tenant database; a logic
 * error silently lets one organisation write into another's data.
 */
import { ORG_SCOPED_VALIDATE_FN, buildValidateDocUpdateFn } from '@/lib/sync/validate-doc-update';

type UserCtx = { name?: string; roles: string[] };
type ValidateFn = (
  newDoc: Record<string, unknown>,
  oldDoc: Record<string, unknown> | null,
  userCtx: UserCtx,
  secObj?: unknown,
) => void;

/** Compile the source the same way CouchDB does — as a standalone function. */
function compile(source: string): ValidateFn {
  return new Function(`return (${source});`)() as ValidateFn;
}

const validate = compile(ORG_SCOPED_VALIDATE_FN);

const clinicUser: UserCtx = { name: 'doc-1', roles: ['org:org-a', 'role:doctor'] };
const nurseUser: UserCtx = { name: 'nurse-1', roles: ['org:org-a', 'role:nurse'] };

function reasonFor(
  newDoc: Record<string, unknown>,
  oldDoc: Record<string, unknown> | null,
  userCtx: UserCtx,
): string | null {
  try {
    validate(newDoc, oldDoc, userCtx, {});
    return null;
  } catch (error) {
    return (error as { forbidden?: string }).forbidden ?? 'thrown-without-forbidden';
  }
}

describe('org-scoped validate_doc_update', () => {
  it('compiles as a function and uses no syntax CouchDB rejects', () => {
    expect(typeof validate).toBe('function');
    // The generated body must stay ES5 — CouchDB's SpiderMonkey build is the
    // runtime, and `const`/`let`/arrows there fail at design-doc install time.
    const body = ORG_SCOPED_VALIDATE_FN.replace(/var WRITE_ROLES = .*/, '');
    expect(body).not.toMatch(/\bconst\b|\blet\b|=>/);
  });

  describe('tenant boundary', () => {
    it('rejects a document with no orgId', () => {
      expect(reasonFor({ _id: 'p-1', type: 'patient' }, null, clinicUser))
        .toMatch(/orgId is required/);
    });

    it('rejects a write aimed at another organisation', () => {
      expect(reasonFor({ _id: 'p-1', type: 'patient', orgId: 'org-b' }, null, clinicUser))
        .toMatch(/orgId mismatch/);
    });

    it('accepts a write inside the caller’s own organisation', () => {
      expect(reasonFor({ _id: 'p-1', type: 'patient', orgId: 'org-a' }, null, clinicUser))
        .toBeNull();
    });
  });

  describe('immutable fields', () => {
    it('refuses to move an existing document between tenants', () => {
      const existing = { _id: 'p-1', type: 'patient', orgId: 'org-a', hospitalId: 'h-1' };
      expect(reasonFor({ ...existing, orgId: 'org-b' }, existing, clinicUser))
        .toMatch(/orgId mismatch|orgId is immutable/);
    });

    it('refuses to move a document between facilities', () => {
      const existing = { _id: 'p-1', type: 'patient', orgId: 'org-a', hospitalId: 'h-1' };
      expect(reasonFor({ ...existing, hospitalId: 'h-2' }, existing, clinicUser))
        .toMatch(/hospitalId is immutable/);
    });

    it('refuses to retype a document into a wider permission row', () => {
      const existing = { _id: 'r-1', type: 'medical_record', orgId: 'org-a' };
      expect(reasonFor({ ...existing, type: 'patient' }, existing, clinicUser))
        .toMatch(/type is immutable/);
    });
  });

  describe('role permissions', () => {
    it('lets a permitted role write its own document type', () => {
      expect(reasonFor({ _id: 'r-1', type: 'medical_record', orgId: 'org-a' }, null, clinicUser))
        .toBeNull();
    });

    it('stops a role that is absent from the type’s row', () => {
      expect(reasonFor({ _id: 'r-1', type: 'medical_record', orgId: 'org-a' }, null, nurseUser))
        .toMatch(/role nurse may not write documents of type medical_record/);
    });

    it('rejects a user provisioned without a role claim', () => {
      const legacyUser: UserCtx = { name: 'old-1', roles: ['org:org-a'] };
      expect(reasonFor({ _id: 'p-1', type: 'patient', orgId: 'org-a' }, null, legacyUser))
        .toMatch(/no role claim/);
    });

    it('never reads the acting role from the document body', () => {
      const spoofed = { _id: 'r-1', type: 'medical_record', orgId: 'org-a', role: 'doctor' };
      expect(reasonFor(spoofed, null, nurseUser)).toMatch(/role nurse may not write/);
    });

    it('fails closed on a document type with no permission row', () => {
      expect(reasonFor({ _id: 'x-1', type: 'invented_type', orgId: 'org-a' }, null, clinicUser))
        .toMatch(/unknown document type/);
    });

    it('fails closed on a document with no type at all', () => {
      expect(reasonFor({ _id: 'x-1', orgId: 'org-a' }, null, clinicUser))
        .toMatch(/unknown document type/);
    });
  });

  describe('replication and administration paths', () => {
    it('lets deletion tombstones replicate', () => {
      expect(reasonFor({ _id: 'p-1', _deleted: true }, null, clinicUser)).toBeNull();
    });

    it('lets design documents through to the security object', () => {
      expect(reasonFor({ _id: '_design/anything' }, null, clinicUser)).toBeNull();
    });

    it('exempts server-side _admin writes so migrations and the worker run', () => {
      const admin: UserCtx = { name: 'couch-admin', roles: ['_admin'] };
      expect(reasonFor({ _id: 'x-1', type: 'invented_type' }, null, admin)).toBeNull();
    });
  });

  it('regenerates from the matrix it is given', () => {
    const narrow = compile(buildValidateDocUpdateFn({ patient: ['midwife'] }));
    const asMidwife = { name: 'm-1', roles: ['org:org-a', 'role:midwife'] };
    expect(() => narrow({ _id: 'p-1', type: 'patient', orgId: 'org-a' }, null, asMidwife, {}))
      .not.toThrow();
    expect(() => narrow({ _id: 'p-1', type: 'patient', orgId: 'org-a' }, null, clinicUser, {}))
      .toThrow();
  });
});
