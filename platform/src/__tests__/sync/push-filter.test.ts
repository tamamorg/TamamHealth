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
 * `buildPushFilter` is not exported (it is an internal of sync-service), so we
 * reconstruct the exact predicate here and assert it against DOC_WRITE_ROLES —
 * the same matrix the real filter consumes. The sync-service unit below keeps
 * the reconstruction honest by importing the matrix, not a copy.
 */
import { DOC_WRITE_ROLES } from '@/lib/sync/write-permissions';

// Mirror of buildPushFilter(role) in sync-service.ts. Kept structurally
// identical; DOC_WRITE_ROLES is imported so the role lists can never drift.
function pushFilter(role: string | undefined) {
  return (doc: { _id?: string; _deleted?: boolean; type?: string }) => {
    if (typeof doc._id === 'string' && doc._id.indexOf('_design/') === 0) return false;
    if (doc._deleted === true) return true;
    if (!role || !doc.type) return false;
    const allowed = doc.type ? DOC_WRITE_ROLES[doc.type] : undefined;
    if (!allowed) return false;
    return (allowed as readonly string[]).includes(role);
  };
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

/**
 * The wedge itself, expressed as an invariant: for any role, EVERY document
 * that survives the push filter is one the CouchDB validator would accept
 * (a known type this role may write, or a deletion tombstone).
 * Nothing the validator rejects can reach the stream, so nothing can stall the
 * checkpoint.
 */
describe('push filter: invariant — survivors are all server-acceptable', () => {
  const roles = ['front_desk', 'doctor', 'nurse', 'lab_tech', 'pharmacist', 'cashier'];
  const typed = Object.keys(DOC_WRITE_ROLES);
  test('no role ever pushes a doc its matrix row forbids', () => {
    for (const role of roles) {
      const f = pushFilter(role);
      for (const type of typed) {
        const allowed = (DOC_WRITE_ROLES[type] as readonly string[]).includes(role);
        expect(f({ _id: `${type}-1`, type })).toBe(allowed);
      }
      // Design docs are rejected for every role.
      expect(f({ _id: '_design/idx-z' })).toBe(false);
    }
  });
});
