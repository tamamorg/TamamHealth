/**
 * Sync — the PUSH replication filter (src/lib/sync/sync-service.ts).
 *
 * Regression for BUG-005: a document the CouchDB validator permanently rejects
 * (a `_design/*` index, or a clinical type the role may not write) wedged the
 * push checkpoint — PouchDB will not advance past a batch containing a write
 * failure, so every document created afterwards, including new patients,
 * silently stopped syncing. The push filter must drop exactly those documents
 * so they never enter the stream, while letting everything the role CAN write
 * through unchanged.
 *
 * Exercise the production predicate directly so role and tenant/facility
 * scoping cannot drift between the test and the replication stream.
 */
import {
  DOC_CREATE_ONLY_REQUIRED_VALUES,
  DOC_CREATE_ONLY_ROLES,
  DOC_UPDATE_ONLY_ROLES,
  DOC_WRITE_ROLES,
} from '@/lib/sync/write-permissions';
import { buildPushFilter } from '@/lib/sync/sync-service';

function pushFilter(role: string | undefined) {
  const filter = buildPushFilter(role, {
    orgId: 'org-a',
    facilityIds: ['fac-a'],
    allFacilities: false,
  });
  return (doc: { _id?: string; _rev?: string; _deleted?: boolean; type?: string; orgId?: string; hospitalId?: string; recordKind?: string }) =>
    filter({ orgId: 'org-a', ...doc });
}

describe('push filter: design documents', () => {
  const f = pushFilter('front_desk');
  test('drops pouchdb-find Mango index design docs (the universal wedge)', () => {
    expect(f({ _id: '_design/idx-abc', type: undefined })).toBe(false);
    expect(f({ _id: '_design/tamamhealth-org-scope' })).toBe(false);
  });
  test('keeps ordinary documents', () => {
    expect(f({ _id: 'pat-123', type: 'patient' })).toBe(true);
  });
});

describe('push filter: role-based clinical exclusions (BUG-005)', () => {
  test('front_desk pushes patients but NOT prescriptions/labs/records', () => {
    const f = pushFilter('front_desk');
    expect(f({ _id: 'pat-1', type: 'patient' })).toBe(true);
    expect(f({ _id: 'rx-1', type: 'prescription' })).toBe(false);
    expect(f({ _id: 'lab-1', type: 'lab_result' })).toBe(false);
    expect(f({ _id: 'mr-1', type: 'medical_record' })).toBe(false);
    expect(f({ _id: 'b-1', type: 'birth' })).toBe(false);
    expect(f({ _id: 'd-1', type: 'death' })).toBe(false);
  });

  test('a doctor pushes clinical documents the front_desk cannot', () => {
    const f = pushFilter('doctor');
    expect(f({ _id: 'rx-1', type: 'prescription' })).toBe(true);
    expect(f({ _id: 'mr-1', type: 'medical_record' })).toBe(true);
    expect(f({ _id: 'lab-1', type: 'lab_result' })).toBe(true);
    expect(f({ _id: 'pat-1', type: 'patient' })).toBe(true);
  });

  test('lab_tech pushes lab results but not prescriptions', () => {
    const f = pushFilter('lab_tech');
    expect(f({ _id: 'lab-1', type: 'lab_result' })).toBe(true);
    expect(f({ _id: 'rx-1', type: 'prescription' })).toBe(false);
  });
});

describe('push filter: fail-closed for unknown/untyped docs', () => {
  const f = pushFilter('front_desk');
  test('untyped documents are quarantined but tombstones still replicate', () => {
    expect(f({ _id: 'cfg-1' })).toBe(false);
    expect(f({ _id: 'pat-1', _deleted: true })).toBe(true);
  });
  test('known operational types use their explicit role row', () => {
    expect(f({ _id: 'appt-1', type: 'appointment' })).toBe(true);
    expect(f({ _id: 'x-1', type: 'staff_schedule' })).toBe(false);
    expect(f({ _id: 'x-2', type: 'invented_type' })).toBe(false);
  });
});

describe('push filter: no role fails closed except for tombstones', () => {
  const f = pushFilter(undefined);
  test('drops typed docs and design docs while allowing deletes', () => {
    expect(f({ _id: 'rx-1', type: 'prescription' })).toBe(false);
    expect(f({ _id: '_design/idx-1' })).toBe(false);
    expect(f({ _id: 'old-1', _deleted: true })).toBe(true);
  });
});

describe('push filter: tenant and facility entitlement', () => {
  const f = pushFilter('front_desk');

  test('pushes the signed-in facility and organization-wide records', () => {
    expect(f({ _id: 'pat-a', type: 'patient', orgId: 'org-a', hospitalId: 'fac-a' })).toBe(true);
    expect(f({ _id: 'org-config', type: 'patient', orgId: 'org-a' })).toBe(true);
  });

  test('drops records belonging to another organization or facility', () => {
    expect(f({ _id: 'pat-b', type: 'patient', orgId: 'org-b', hospitalId: 'fac-a' })).toBe(false);
    expect(f({ _id: 'pat-c', type: 'patient', orgId: 'org-a', hospitalId: 'fac-b' })).toBe(false);
  });
});

/**
 * The wedge itself, expressed as an invariant: for any role and revision, the
 * filter agrees with the validator's decision order (create-only on a first
 * revision, full-write matrix, update-only on a later revision). Nothing the
 * validator rejects reaches the stream, and nothing it accepts is withheld.
 */
describe('push filter: invariant — agrees with the validator', () => {
  const roles = ['front_desk', 'doctor', 'nurse', 'lab_tech', 'pharmacist', 'cashier', 'hrio'];
  const typed = Object.keys(DOC_WRITE_ROLES);
  test('every role/type/revision decision matches the validator tables', () => {
    for (const role of roles) {
      const f = pushFilter(role);
      for (const type of typed) {
        const full = (DOC_WRITE_ROLES[type] as readonly string[]).includes(role);
        const creator = (DOC_CREATE_ONLY_ROLES[type] as readonly string[] | undefined)?.includes(role) ?? false;
        const amender = (DOC_UPDATE_ONLY_ROLES[type] as readonly string[] | undefined)?.includes(role) ?? false;
        const required = DOC_CREATE_ONLY_REQUIRED_VALUES[type];
        const body: Record<string, string> = {};
        for (const k of Object.keys(required ?? {})) body[k] = required![k][0];
        const first = f({ _id: `${type}-1`, _rev: '1-a', type, ...body });
        const later = f({ _id: `${type}-1`, _rev: '3-b', type, ...body });
        expect(first).toBe(full || creator);
        // A creator is offered at any local revision: an unsent document that
        // was edited before its first push is still a create on the server.
        expect(later).toBe(full || amender || creator);
      }
      expect(f({ _id: '_design/idx-z' })).toBe(false);
    }
  });
});

describe('push filter: update-only and create-only roles', () => {
  test('pharmacist updates a prescription but cannot create one', () => {
    const f = pushFilter('pharmacist');
    expect(f({ _id: 'rx-1', _rev: '2-x', type: 'prescription' })).toBe(true);
    expect(f({ _id: 'rx-1', _rev: '1-x', type: 'prescription' })).toBe(false);
  });
  test('nurse updates an admission and an appointment', () => {
    const f = pushFilter('nurse');
    expect(f({ _id: 'adm-1', _rev: '2-x', type: 'admission' })).toBe(true);
    expect(f({ _id: 'appt-1', _rev: '4-x', type: 'appointment' })).toBe(true);
    // create-only too
    expect(f({ _id: 'adm-2', _rev: '1-x', type: 'admission' })).toBe(true);
    expect(f({ _id: 'appt-2', _rev: '1-x', type: 'appointment' })).toBe(true);
  });
  test('cashier updates an admission but cannot create one', () => {
    const f = pushFilter('cashier');
    expect(f({ _id: 'adm-1', _rev: '2-x', type: 'admission' })).toBe(true);
    expect(f({ _id: 'adm-1', _rev: '1-x', type: 'admission' })).toBe(false);
  });
  test('nurse creates only the nursing-vitals shape of a medical record', () => {
    const f = pushFilter('nurse');
    expect(f({ _id: 'mr-1', _rev: '1-x', type: 'medical_record', recordKind: 'nursing_vitals' })).toBe(true);
    expect(f({ _id: 'mr-2', _rev: '1-x', type: 'medical_record', recordKind: 'consultation' })).toBe(false);
    // Edited locally before the first push: still unsent, so still offered.
    expect(f({ _id: 'mr-1', _rev: '2-x', type: 'medical_record', recordKind: 'nursing_vitals' })).toBe(true);
    expect(f({ _id: 'mr-2', _rev: '2-x', type: 'medical_record', recordKind: 'consultation' })).toBe(false);
  });
  test('pharmacist cannot push types outside its grants', () => {
    const f = pushFilter('pharmacist');
    expect(f({ _id: 'adm-1', _rev: '2-x', type: 'admission' })).toBe(false);
  });
});
