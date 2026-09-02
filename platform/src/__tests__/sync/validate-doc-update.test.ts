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
const frontDeskUser: UserCtx = { name: 'desk-1', roles: ['org:org-a', 'role:front_desk'] };

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

    it('lets nursing roles create only the dedicated vitals observation subtype', () => {
      expect(reasonFor({
        _id: 'r-vitals', type: 'medical_record', orgId: 'org-a',
        recordKind: 'nursing_vitals',
      }, null, nurseUser)).toBeNull();

      expect(reasonFor({ _id: 'r-1', type: 'medical_record', orgId: 'org-a' }, null, nurseUser))
        .toMatch(/may create medical_record only when recordKind/);

      expect(reasonFor({
        _id: 'r-consult', type: 'medical_record', orgId: 'org-a',
        recordKind: 'consultation',
      }, null, nurseUser)).toMatch(/may create medical_record only when recordKind/);
    });

    it('keeps appointment scheduling and care-team fields at the front desk boundary', () => {
      const appointment = {
        _id: 'apt-1', type: 'appointment', orgId: 'org-a',
        providerId: 'doctor-1', providerName: 'Dr One',
        staffId: 'nurse-1', staffName: 'Nurse One', status: 'scheduled',
      };
      // Booking is open to clinical staff — a doctor may CREATE one.
      expect(reasonFor(appointment, null, frontDeskUser)).toBeNull();
      expect(reasonFor(appointment, null, clinicUser)).toBeNull();
      expect(reasonFor(appointment, null, nurseUser)).toBeNull();
      // What stays at the desk is re-routing an EXISTING one.
      expect(reasonFor({ ...appointment, providerId: 'doctor-2' }, appointment, clinicUser))
        .toMatch(/may not amend providerId on appointment/);
      expect(reasonFor({ ...appointment, staffId: 'nurse-2' }, appointment, nurseUser))
        .toMatch(/may not amend staffId on appointment/);
      expect(reasonFor({ ...appointment, appointmentDate: '2026-09-02' }, appointment, clinicUser))
        .toMatch(/may not amend appointmentDate on appointment/);
      expect(reasonFor({ ...appointment, appointmentTime: '11:30' }, appointment, nurseUser))
        .toMatch(/may not amend appointmentTime on appointment/);
      expect(reasonFor({ ...appointment, status: 'in_progress' }, appointment, clinicUser)).toBeNull();
    });

    it('keeps patient care-team fields at the front desk boundary', () => {
      const patient = {
        _id: 'patient-1', type: 'patient', orgId: 'org-a',
        firstName: 'Nyakuma', surname: 'Deng',
      };
      expect(reasonFor({ ...patient, assignedDoctor: 'doctor-2' }, patient, clinicUser))
        .toMatch(/may not change patient care-team assignment fields/);
      expect(reasonFor({ ...patient, assignedNurse: 'nurse-2' }, patient, nurseUser))
        .toMatch(/may not change patient care-team assignment fields/);
      expect(reasonFor({ ...patient, assignedDoctor: 'doctor-2' }, patient, frontDeskUser))
        .toBeNull();
      // Clinical chart fields remain writable; this is a protected subset, not
      // a blanket removal of the clinician's patient-update permission.
      expect(reasonFor({ ...patient, noKnownMedications: true }, patient, clinicUser)).toBeNull();
    });

    it('allows attributable provider transfers but not transfer-stamped nurse rerouting', () => {
      const patient = {
        _id: 'patient-1', type: 'patient', orgId: 'org-a',
        assignedDoctor: 'doctor-1', assignedNurse: 'nurse-1',
      };
      expect(reasonFor({
        ...patient,
        assignedDoctor: 'doctor-2',
        assignmentSource: 'transfer',
        assignmentTransferId: 'transfer-1',
      }, patient, clinicUser)).toBeNull();
      expect(reasonFor({
        ...patient,
        assignedNurse: 'nurse-2',
        assignmentSource: 'transfer',
        assignmentTransferId: 'transfer-1',
      }, patient, nurseUser)).toMatch(/may not change patient care-team assignment fields/);
    });

    it('allows terminal assignment cleanup but cannot disguise a new owner as completion', () => {
      const patient = {
        _id: 'patient-1', type: 'patient', orgId: 'org-a',
        assignedDoctor: 'doctor-1', assignedNurse: 'nurse-1',
      };
      expect(reasonFor({
        ...patient,
        assignedDoctor: undefined,
        assignedNurse: undefined,
        assignmentStatus: 'completed',
      }, patient, clinicUser)).toBeNull();
      expect(reasonFor({
        ...patient,
        assignedDoctor: 'doctor-2',
        assignedNurse: undefined,
        assignmentStatus: 'completed',
      }, patient, clinicUser)).toMatch(/may not change patient care-team assignment fields/);
    });

    it('rejects a user provisioned without a role claim', () => {
      const legacyUser: UserCtx = { name: 'old-1', roles: ['org:org-a'] };
      expect(reasonFor({ _id: 'p-1', type: 'patient', orgId: 'org-a' }, null, legacyUser))
        .toMatch(/no role claim/);
    });

    it('never reads the acting role from the document body', () => {
      const spoofed = { _id: 'r-1', type: 'medical_record', orgId: 'org-a', role: 'doctor' };
      expect(reasonFor(spoofed, null, nurseUser)).toMatch(/role nurse may create medical_record only when recordKind/);
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

  describe('deletes are judged as writes', () => {
    // A tombstone carries no body, so every one of these is decided on oldDoc.
    const record = { _id: 'r-1', type: 'medical_record', orgId: 'org-a' };
    const tombstone = { _id: 'r-1', _rev: '2-x', _deleted: true };

    it('stops a role that could not have written the document from deleting it', () => {
      expect(reasonFor(tombstone, record, nurseUser))
        .toMatch(/role nurse may not delete documents of type medical_record/);
    });

    it('lets a role that may write the type delete it', () => {
      expect(reasonFor(tombstone, record, clinicUser)).toBeNull();
    });

    it('refuses a tombstone aimed at another organisation’s document', () => {
      const otherOrg = { ...record, orgId: 'org-b' };
      expect(reasonFor(tombstone, otherOrg, clinicUser)).toMatch(/orgId mismatch/);
    });

    it('rejects a delete from a user with no role claim', () => {
      const legacyUser: UserCtx = { name: 'old-1', roles: ['org:org-a'] };
      expect(reasonFor(tombstone, record, legacyUser)).toMatch(/no role claim/);
    });

    it('does not let the tombstone body relabel what is being deleted', () => {
      // Claiming a broadly-writable type on the way out must not widen the row
      // the delete is checked against — oldDoc decides.
      const spoofed = { _id: 'r-1', _rev: '2-x', _deleted: true, type: 'patient', orgId: 'org-a' };
      expect(reasonFor(spoofed, record, nurseUser))
        .toMatch(/role nurse may not delete documents of type medical_record/);
    });
  });

  describe('facility boundary', () => {
    const jubaNurse: UserCtx = {
      name: 'n-1', roles: ['org:org-a', 'facility:hosp-juba', 'role:nurse'],
    };
    const roving: UserCtx = {
      name: 'n-2', roles: ['org:org-a', 'facility:hosp-juba', 'facility:hosp-wau', 'role:nurse'],
    };
    const at = (hospitalId: string) => ({
      _id: 't-1', type: 'triage', orgId: 'org-a', hospitalId,
    });

    it('accepts a write stamped with the user’s own facility', () => {
      expect(reasonFor(at('hosp-juba'), null, jubaNurse)).toBeNull();
    });

    it('refuses a write stamped with another facility in the same org', () => {
      expect(reasonFor(at('hosp-wau'), null, jubaNurse)).toMatch(/facility mismatch/);
    });

    it('honours every facility claim a user holds', () => {
      expect(reasonFor(at('hosp-juba'), null, roving)).toBeNull();
      expect(reasonFor(at('hosp-wau'), null, roving)).toBeNull();
      expect(reasonFor(at('hosp-malakal'), null, roving)).toMatch(/facility mismatch/);
    });

    it('refuses to delete another facility’s record', () => {
      const theirs = at('hosp-wau');
      expect(reasonFor({ _id: 't-1', _rev: '2-x', _deleted: true }, theirs, jubaNurse))
        .toMatch(/facility mismatch/);
    });

    it('leaves org-wide roles unscoped', () => {
      // medical_superintendent and hospital_manager are in MULTI_FACILITY_ROLES,
      // so their oversight spans every facility in the tenant.
      const supt: UserCtx = {
        name: 's-1', roles: ['org:org-a', 'facility:hosp-juba', 'role:medical_superintendent'],
      };
      expect(reasonFor(at('hosp-wau'), null, supt)).toBeNull();
    });

    it('does not apply to an account with no facility claim', () => {
      const national: UserCtx = { name: 'g-1', roles: ['org:org-a', 'role:government'] };
      expect(reasonFor(
        { _id: 'a-1', type: 'facility_assessment', orgId: 'org-a', hospitalId: 'hosp-wau' },
        null, national,
      )).toBeNull();
    });

    it('does not apply to org-wide document types', () => {
      const alert = { _id: 'al-1', type: 'disease_alert', orgId: 'org-a', hospitalId: 'hosp-wau' };
      expect(reasonFor(alert, null, jubaNurse)).toBeNull();
    });

    it('ignores fields that name a counterparty rather than the owner', () => {
      // A referral names the destination facility; sending one is the point.
      // Neither PatientDoc nor ReferralDoc carries `hospitalId`, so the rule
      // never reaches them.
      const referral = {
        _id: 'ref-1', type: 'referral', orgId: 'org-a',
        fromHospitalId: 'hosp-juba', toHospitalId: 'hosp-wau',
      };
      expect(reasonFor(referral, null, jubaNurse)).toBeNull();

      const patient = {
        _id: 'p-9', type: 'patient', orgId: 'org-a',
        registrationHospital: 'hosp-wau', lastVisitHospital: 'hosp-juba',
      };
      expect(reasonFor(patient, null, jubaNurse)).toBeNull();
    });
  });

  describe('amend-only roles', () => {
    // Pharmacy changes a constrained lifecycle subset of the order. Bedside
    // medication events are independent append-only documents instead.
    const pharmacist: UserCtx = { name: 'rx-1', roles: ['org:org-a', 'role:pharmacist'] };
    const order = { _id: 'rx-1', type: 'prescription', orgId: 'org-a', orderStatus: 'verified' };

    it('lets a pharmacist advance an existing order', () => {
      expect(reasonFor({ ...order, orderStatus: 'dispensed' }, order, pharmacist)).toBeNull();
    });

    it('refuses to let a nurse rewrite the order and accepts a new dose event', () => {
      expect(reasonFor({ ...order, administrations: [{ id: 'madm-1' }] }, order, nurseUser))
        .toMatch(/role nurse may not write documents of type prescription/);
      const event = {
        _id: 'madm-1', type: 'medication_administration', orgId: 'org-a',
        prescriptionId: 'rx-1', patientId: 'p-1', eventKind: 'administration',
      };
      expect(reasonFor(event, null, nurseUser)).toBeNull();
      expect(reasonFor({ ...event, status: 'held' }, event, nurseUser)).toMatch(/append-only/);
    });

    it('refuses to let either of them author an order', () => {
      expect(reasonFor(order, null, pharmacist))
        .toMatch(/role pharmacist may not write documents of type prescription/);
      expect(reasonFor(order, null, nurseUser))
        .toMatch(/role nurse may not write documents of type prescription/);
    });

    it('refuses to let an amend-only role delete the order', () => {
      const tombstone = { _id: 'rx-1', _rev: '2-x', _deleted: true };
      expect(reasonFor(tombstone, order, pharmacist))
        .toMatch(/role pharmacist may not delete documents of type prescription/);
      expect(reasonFor(tombstone, order, nurseUser))
        .toMatch(/role nurse may not delete documents of type prescription/);
    });

    it('leaves the prescriber able to do all three', () => {
      expect(reasonFor(order, null, clinicUser)).toBeNull();
      expect(reasonFor({ ...order, dose: '10mg' }, order, clinicUser)).toBeNull();
      expect(reasonFor({ _id: 'rx-1', _rev: '2-x', _deleted: true }, order, clinicUser)).toBeNull();
    });

    it('grants nothing on a type with no amend-only row', () => {
      const record = { _id: 'r-1', type: 'medical_record', orgId: 'org-a' };
      expect(reasonFor({ ...record, note: 'x' }, record, nurseUser))
        .toMatch(/role nurse may not write documents of type medical_record/);
    });
  });

  describe('append-only trails', () => {
    const entry = { _id: 'aud-1', type: 'audit_log', orgId: 'org-a' };

    it('accepts a new entry from any staff role', () => {
      expect(reasonFor(entry, null, nurseUser)).toBeNull();
    });

    it('refuses to amend an entry that already exists', () => {
      expect(reasonFor({ ...entry, action: 'rewritten' }, entry, nurseUser))
        .toMatch(/audit_log is append-only/);
    });

    it('refuses to delete an entry', () => {
      expect(reasonFor({ _id: 'aud-1', _rev: '2-x', _deleted: true }, entry, clinicUser))
        .toMatch(/audit_log is append-only/);
    });

    it('protects the narcotics register and the patient ledger the same way', () => {
      for (const type of ['controlled_substance_log', 'ledger_entry']) {
        const existing = { _id: `${type}-1`, type, orgId: 'org-a' };
        expect(reasonFor({ ...existing, amount: 999 }, existing, clinicUser))
          .toMatch(new RegExp(`${type} is append-only`));
      }
    });

    it('leaves sync_event amendable — it is updated in place when it lands', () => {
      const event = { _id: 'sync-1', type: 'sync_event', orgId: 'org-a' };
      expect(reasonFor({ ...event, syncStatus: 'synced' }, event, nurseUser)).toBeNull();
    });
  });

  describe('replication and administration paths', () => {
    it('accepts a tombstone for a document this database never held', () => {
      // Replication routinely delivers one; there is nothing to destroy, and
      // rejecting it would stall the feed.
      expect(reasonFor({ _id: 'p-1', _deleted: true }, null, clinicUser)).toBeNull();
    });

    it('accepts a tombstone for an already-deleted document', () => {
      const alreadyGone = { _id: 'p-1', _rev: '3-y', _deleted: true };
      expect(reasonFor({ _id: 'p-1', _rev: '4-z', _deleted: true }, alreadyGone, nurseUser))
        .toBeNull();
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
