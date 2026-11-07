/**
 * Audit M3: the server refuses catalogued PHI that arrives as plaintext.
 *
 * Executes the generated validate_doc_update source, built from the real
 * phi-field-catalog.json, the way CouchDB does. Rollout safety is the point of
 * the "legacy" cases: production already holds plaintext, and a clinician must
 * still be able to save such a record without touching the plaintext field.
 */
import { ORG_SCOPED_VALIDATE_FN } from '@/lib/sync/validate-doc-update';
import {
  DOC_WRITE_ROLES,
  SEALED_PHI_FIELDS,
  buildValidateDocUpdateFn,
  compileSealedFieldSpec,
} from '@/lib/sync/write-permissions';
import catalog from '@/lib/phi-field-catalog.json';

type Ctx = { name?: string; roles: string[] };
type Fn = (n: Record<string, unknown>, o: Record<string, unknown> | null, u: Ctx, s?: unknown) => void;
const compile = (src: string) => new Function(`return (${src});`)() as Fn;
const validate = compile(ORG_SCOPED_VALIDATE_FN);

const doctor: Ctx = { name: 'dr', roles: ['org:org-a', 'role:doctor', 'user:u-1', 'facility:h-1'] };
const admin: Ctx = { name: 'root', roles: ['_admin'] };

const SEALED = 'oenc:v1:b3JnLWE:aXY:Y2lwaGVy';

function reason(n: Record<string, unknown>, o: Record<string, unknown> | null, u: Ctx = doctor, fn: Fn = validate): string | null {
  try { fn(n, o, u, {}); return null; } catch (e) { return (e as { forbidden?: string }).forbidden ?? 'thrown'; }
}

const problem = (over: Record<string, unknown> = {}) => ({
  _id: 'problem-1', type: 'problem', orgId: 'org-a', hospitalId: 'h-1', patientId: 'p-1',
  status: 'active', patientName: SEALED, name: SEALED, ...over,
});

describe('catalogued fields must be sealed', () => {
  it('accepts sealed values (single-org, multi-org and the retired server envelope)', () => {
    expect(reason(problem(), null)).toBeNull();
    expect(reason(problem({ name: 'oencm:v1:W10:a:b:c' }), null)).toBeNull();
    expect(reason(problem({ name: 'enc:v1:abc' }), null)).toBeNull();
  });

  it('refuses plaintext on create, naming the field but never the value', () => {
    const msg = reason(problem({ name: 'Tuberculosis of Mr Deng' }), null);
    expect(msg).toMatch(/problem field name must be encrypted/);
    expect(msg).not.toMatch(/Deng/);
  });

  it('refuses a plaintext value that changed on update', () => {
    const old = problem({ name: 'old legacy text' });
    expect(reason(problem({ name: 'edited text' }), old)).toMatch(/field name must be encrypted/);
  });

  it('lets an update through that leaves legacy plaintext untouched', () => {
    const old = problem({ name: 'legacy plaintext', notes: 'legacy note' });
    expect(reason(problem({ name: 'legacy plaintext', notes: 'legacy note', status: 'resolved' }), old)).toBeNull();
  });

  it('lets legacy plaintext be replaced by a sealed value (the migration path)', () => {
    expect(reason(problem(), problem({ name: 'legacy plaintext' }))).toBeNull();
  });

  it('judges a create over a deleted stub as a create', () => {
    expect(reason(problem({ name: 'plain' }), { ...problem({ name: 'plain' }), _deleted: true })).toMatch(/must be encrypted/);
  });

  it('allows empty strings, null and non-strings', () => {
    expect(reason(problem({ name: '', notes: null, icd11Code: undefined }), null)).toBeNull();
    expect(reason(problem({ notes: 42 }), null)).toBeNull();
  });

  it('does not touch fields outside the catalogue', () => {
    expect(reason(problem({ status: 'plain-status', patientId: 'p-plain', onsetDate: '2026-01-01', somethingElse: 'x' }), null)).toBeNull();
  });

  it('does not touch a type with no catalogue entry', () => {
    const orgAdmin: Ctx = { name: 'a', roles: ['org:org-a', 'role:org_admin'] };
    expect(reason({ _id: 'w1', type: 'ward', orgId: 'org-a', hospitalId: 'h-1', name: 'Plain Ward' }, null, orgAdmin)).toBeNull();
  });

  it('does not judge deletes', () => {
    expect(reason({ _id: 'problem-1', _deleted: true }, problem({ name: 'legacy' }))).toBeNull();
  });

  it('leaves server writes (_admin: API routes, the seed script, migrations) alone', () => {
    expect(reason(problem({ name: 'plain' }), null, admin)).toBeNull();
  });
});

describe('nested catalogue paths', () => {
  const bill = (over: Record<string, unknown> = {}) => ({
    _id: 'bill-1', type: 'billing', orgId: 'org-a', hospitalId: 'h-1', patientId: 'p-1', status: 'pending',
    patientName: SEALED, items: [{ description: SEALED, amount: 5 }], ...over,
  });

  it('checks array element paths (items[].description)', () => {
    const msg = reason(bill({ items: [{ description: SEALED }, { description: 'plain line' }] }), null);
    expect(msg).toMatch(/billing field items\[1\]\.description must be encrypted/);
  });

  it('checks every string beneath a ** path', () => {
    const msg = reason({
      _id: 'm-1', type: 'medical_record', orgId: 'org-a', hospitalId: 'h-1', patientId: 'p-1', patientName: SEALED,
      vitalSigns: { note: { deep: 'plain' } },
    }, null);
    expect(msg).toMatch(/medical_record field vitalSigns\.note\.deep must be encrypted/);
  });

  it('is not fooled by a legacy array element changing position', () => {
    const old = bill({ items: [{ description: 'legacy A' }, { description: 'legacy B' }] });
    const next = bill({ items: [{ description: 'legacy B' }] });
    const biller: Ctx = { name: 'b', roles: ['org:org-a', 'role:cashier', 'user:u-9', 'facility:h-1'] };
    expect(reason(next, old, biller)).toBeNull();
  });
});

describe('catalogue wiring', () => {
  it('compiles every catalogued type', () => {
    expect(Object.keys(SEALED_PHI_FIELDS).sort()).toEqual(Object.keys(catalog.types).sort());
  });

  it('honours a custom spec and an empty one', () => {
    const spec = compileSealedFieldSpec({ problem: { fields: ['notes'] } });
    const only = compile(buildValidateDocUpdateFn(undefined, undefined, undefined, undefined, undefined, spec));
    expect(reason(problem({ name: 'plain', notes: 'plain' }), null, doctor, only)).toMatch(/field notes/);
    expect(reason(problem({ name: 'plain' }), null, doctor, only)).toBeNull();
    const none = compile(buildValidateDocUpdateFn(undefined, undefined, undefined, undefined, undefined, {}));
    expect(reason(problem({ name: 'plain' }), null, doctor, none)).toBeNull();
  });

  it('every catalogued type is a known document type', () => {
    for (const type of Object.keys(catalog.types)) expect(DOC_WRITE_ROLES[type]).toBeDefined();
  });
});

// ── Review of #256 (2026-11-07) ─────────────────────────────────────────────
describe('arrays from another JS context (as CouchDB hands them over)', () => {
  // CouchDB evaluates the validator in its own context; a document's arrays are
  // not `instanceof Array` there. vm gives the same situation in Node.
   
  const vm = require('node:vm') as typeof import('node:vm');
  const foreign = <T,>(value: T): T => vm.runInNewContext(`(${JSON.stringify(value)})`) as T;

  it('still finds plaintext inside a catalogued array path', () => {
    const doc = foreign({
      _id: 'msg-1', type: 'message', orgId: 'org-a', body: SEALED,
      editHistory: [{ body: 'plain earlier wording', at: '2026-11-07T10:00:00Z' }],
    });
    expect(Array.isArray(doc.editHistory) && !(doc.editHistory instanceof Array)).toBe(true);
    expect(reason(doc, null)).toMatch(/message field editHistory\[0\]\.body must be encrypted/);
  });

  it('passes the same array when it is sealed', () => {
    const doc = foreign({
      _id: 'msg-1', type: 'message', orgId: 'org-a', body: SEALED,
      editHistory: [{ body: SEALED, at: '2026-11-07T10:00:00Z' }],
    });
    expect(reason(doc, null)).toBeNull();
  });
});

describe('a conflicting branch whose parent the server does not hold', () => {
  it('stores an untouched-legacy branch (oldDoc null, revision past the first) instead of stranding it', () => {
    expect(reason(problem({ _rev: '3-abc', name: 'legacy plaintext' }), null)).toBeNull();
  });

  it('still judges a first revision (a create) with no oldDoc', () => {
    expect(reason(problem({ _rev: '1-abc', name: 'plain text' }), null)).toMatch(/must be encrypted/);
    expect(reason(problem({ name: 'plain text' }), null)).toMatch(/must be encrypted/);
  });
});

describe('robustness', () => {
  it('a document key named hasOwnProperty does not break the walk', () => {
    expect(reason(problem({ name: 'plain', hasOwnProperty: 'x' }), null)).toMatch(/must be encrypted/);
  });

  it('an update with nothing unsealed never needs the old revision', () => {
    const huge = problem({ attachmentsBlob: 'x'.repeat(5_000_000) });
    const started = Date.now();
    expect(reason(problem({ status: 'resolved' }), huge)).toBeNull();
    expect(Date.now() - started).toBeLessThan(500);
  });
});
