/**
 * The two-tech lab correction (`lab_result.pendingCorrection` /
 * `rejectedCorrections`) and the triage medication review
 * (`triage.medicationReview`) carry PHI: proposed results, reasons and the
 * names of medicines. Both must be sealed on the device the way every other
 * catalogued field is, and the server's validator must accept the sealed
 * writes from the roles that make them (lab_tech, triage_nurse) and refuse
 * plaintext. Ids and staff names stay readable.
 */
import PouchDB from 'pouchdb-browser';
import memoryAdapter from 'pouchdb-adapter-memory';
import { ORG_SCOPED_VALIDATE_FN } from '@/lib/sync/validate-doc-update';
import { wrapEncrypted } from '@/lib/encrypted-db';
import { isOrgEncrypted } from '@/lib/org-data-cipher';

const findPlugin = require('pouchdb-find');
PouchDB.plugin(memoryAdapter);
PouchDB.plugin(findPlugin.default || findPlugin);

type Ctx = { name?: string; roles: string[] };
type Fn = (n: Record<string, unknown>, o: Record<string, unknown> | null, u: Ctx, s?: unknown) => void;
const validate = new Function(`return (${ORG_SCOPED_VALIDATE_FN});`)() as Fn;
const reason = (n: Record<string, unknown>, o: Record<string, unknown> | null, u: Ctx): string | null => {
  try { validate(n, o, u, {}); return null; } catch (e) { return (e as { forbidden?: string }).forbidden ?? 'thrown'; }
};

const SEALED = 'oenc:v1:b3JnLWE:aXY:Y2lwaGVy';
const labTech: Ctx = { name: 'lab', roles: ['org:org-a', 'role:lab_tech', 'user:u-lab-b', 'facility:h-1'] };
/** The lab tech who proposes the corrections below (proposedById u-lab-a). */
const proposer: Ctx = { name: 'lab-a', roles: ['org:org-a', 'role:lab_tech', 'user:u-lab-a', 'facility:h-1'] };
const triageNurse: Ctx = { name: 'nurse', roles: ['org:org-a', 'role:triage_nurse', 'user:u-nurse', 'facility:h-1'] };
const doctor: Ctx = { name: 'doctor', roles: ['org:org-a', 'role:doctor', 'user:u-doctor', 'facility:h-1'] };

const lab = (over: Record<string, unknown> = {}) => ({
  _id: 'lab-1', _rev: '2-a', type: 'lab_result', orgId: 'org-a', hospitalId: 'h-1', patientId: 'p-1',
  patientName: SEALED, testName: SEALED, specimen: SEALED, result: SEALED, unit: '', referenceRange: SEALED,
  status: 'completed', orderStatus: 'resulted', abnormal: true, critical: false,
  orderedBy: 'Dr. Wani', orderedAt: '2026-11-07T08:00:00.000Z', completedAt: '2026-11-07T09:00:00.000Z',
  ...over,
});

const correction = (over: Record<string, unknown> = {}) => ({
  result: SEALED, unit: '', referenceRange: SEALED, abnormal: false, critical: false, reason: SEALED,
  proposedBy: 'Achol Lab', proposedById: 'u-lab-a', proposedAt: '2026-11-07T10:00:00.000Z', ...over,
});

const triage = (over: Record<string, unknown> = {}) => ({
  _id: 'triage-1', type: 'triage', orgId: 'org-a', hospitalId: 'h-1', facilityId: 'h-1', patientId: 'p-1',
  patientName: SEALED, priority: 'GREEN', status: 'seen',
  airway: 'clear', breathing: 'normal', circulation: 'normal', consciousness: 'alert',
  triagedBy: 'u-nurse', triagedByName: 'Nurse Ayen', triagedAt: '2026-11-07T08:00:00.000Z',
  ...over,
});

const review = (over: Record<string, unknown> = {}) => ({
  reviewedAt: '2026-11-07T08:00:00.000Z', reviewedBy: 'u-nurse', reviewedByName: 'Nurse Ayen', activeCount: 2,
  added: [SEALED], edited: [], stopped: [SEALED], removed: [], ...over,
});

describe('validate_doc_update', () => {
  it('accepts a lab tech proposing, approving and rejecting a sealed correction', () => {
    const before = lab();
    const proposed = lab({ _rev: '3-a', pendingCorrection: correction() });
    expect(reason(proposed, before, proposer)).toBeNull();
    expect(reason(lab({
      _rev: '4-a', result: 'oenc:v1:b3JnLWE:aXY:Y29ycmVjdGVk', abnormal: false,
      amended: true, amendedAt: '2026-11-07T11:00:00.000Z',
      amendedBy: 'Achol Lab', amendedFrom: SEALED, amendmentReason: SEALED,
      correctionVerifiedBy: 'Ladu Lab', correctionVerifiedById: 'u-lab-b', correctionVerifiedAt: '2026-11-07T11:00:00.000Z',
    }), lab({ _rev: '3-a', pendingCorrection: correction({ result: 'oenc:v1:b3JnLWE:aXY:Y29ycmVjdGVk' }) }), labTech)).toBeNull();
    expect(reason(lab({
      _rev: '4-a',
      rejectedCorrections: [{ ...correction(), rejectedBy: 'Ladu Lab', rejectedById: 'u-lab-b', rejectedAt: '2026-11-07T11:00:00.000Z', rejectionReason: SEALED }],
    }), proposed, labTech)).toBeNull();
  });

  // The app's two-tech rule, held by the server too: a device cannot approve
  // its own user's correction or put someone else's name on a proposal.
  it('refuses the proposer approving their own correction', () => {
    const proposed = lab({ _rev: '3-a', pendingCorrection: correction() });
    const approval = lab({
      _rev: '4-a', result: 'oenc:v1:b3JnLWE:aXY:Y29ycmVjdGVk', amended: true, amendedAt: '2026-11-07T11:00:00.000Z',
      amendedBy: 'Achol Lab', amendedFrom: SEALED, amendmentReason: SEALED,
      correctionVerifiedBy: 'Achol Lab', correctionVerifiedById: 'u-lab-a', correctionVerifiedAt: '2026-11-07T11:00:00.000Z',
    });
    expect(reason(approval, lab({ _rev: '3-a', pendingCorrection: correction({ result: 'oenc:v1:b3JnLWE:aXY:Y29ycmVjdGVk' }) }), proposer)).toMatch(/second lab tech/);
  });

  it('refuses an approval that names someone other than the approver', () => {
    const proposed = lab({ _rev: '3-a', pendingCorrection: correction() });
    expect(reason(lab({
      _rev: '4-a', amended: true, correctionVerifiedBy: 'Someone', correctionVerifiedById: 'u-other',
      correctionVerifiedAt: '2026-11-07T11:00:00.000Z',
    }), proposed, labTech)).toMatch(/correctionVerifiedById must be the user approving/);
  });

  it('refuses a proposal filed under another user', () => {
    expect(reason(lab({ _rev: '3-a', pendingCorrection: correction() }), lab(), labTech))
      .toMatch(/must name the user proposing it/);
  });

  it('refuses non-lab roles proposing, approving or rejecting corrections', () => {
    const before = lab();
    const proposed = lab({ _rev: '3-a', pendingCorrection: correction() });
    expect(reason(proposed, before, doctor)).toMatch(/Only a lab tech/);
    expect(reason(lab({
      _rev: '4-a', result: 'oenc:v1:b3JnLWE:aXY:Y29ycmVjdGVk', amended: true, amendedAt: '2026-11-07T11:00:00.000Z',
      amendedBy: 'Achol Lab', amendmentReason: SEALED, correctionVerifiedById: 'u-doctor', correctionVerifiedAt: '2026-11-07T11:00:00.000Z',
    }), proposed, doctor)).toMatch(/Only a lab tech/);
    expect(reason(lab({
      _rev: '4-a', rejectedCorrections: [{ ...correction(), rejectedById: 'u-doctor', rejectedAt: 'x', rejectionReason: SEALED }],
    }), proposed, doctor)).toMatch(/Only a lab tech/);
  });

  it('refuses direct changes to a filed value without an approved pending correction', () => {
    expect(reason(lab({ result: 'oenc:v1:b3JnLWE:aXY:Y29ycmVjdGVk' }), lab(), labTech))
      .toMatch(/only through an approved pending correction/);
  });

  it('refuses silently clearing, self-rejecting or rewriting a pending correction', () => {
    const proposed = lab({ _rev: '3-a', pendingCorrection: correction() });
    expect(reason(lab({ _rev: '4-a' }), proposed, labTech)).toMatch(/Rejecting a correction requires/);
    expect(reason(lab({
      _rev: '4-a', rejectedCorrections: [{ ...correction(), rejectedById: 'u-lab-a', rejectedAt: 'x', rejectionReason: SEALED }],
    }), proposed, proposer)).toMatch(/second lab tech/);
    expect(reason(lab({ _rev: '4-a', pendingCorrection: correction({ proposedAt: 'changed' }) }), proposed, proposer))
      .toMatch(/immutable until it is approved or rejected/);
  });

  it('refuses a plaintext proposed value, reason or rejection reason', () => {
    expect(reason(lab({ pendingCorrection: correction({ result: '6.9 mmol/L' }) }), lab(), proposer))
      .toMatch(/lab_result field pendingCorrection\.result must be encrypted/);
    expect(reason(lab({ pendingCorrection: correction({ reason: 'Transcription error' }) }), lab(), proposer))
      .toMatch(/pendingCorrection\.reason must be encrypted/);
    expect(reason(lab({
      rejectedCorrections: [{ ...correction(), rejectedBy: 'Ladu Lab', rejectedById: 'u-lab-b', rejectedAt: 'x', rejectionReason: 'Checked again' }],
    }), lab({ pendingCorrection: correction() }), labTech)).toMatch(/rejectedCorrections\[0\]\.rejectionReason must be encrypted/);
  });

  it('accepts a triage nurse saving a sealed medication review, refuses plaintext medicine names', () => {
    expect(reason(triage({ medicationReview: review() }), null, triageNurse)).toBeNull();
    expect(reason(triage({ medicationReview: review({ added: ['Metformin'] }) }), null, triageNurse))
      .toMatch(/triage field medicationReview\.added\[0\] must be encrypted/);
  });
});

describe('sealed on the device', () => {
  let n = 0;
  let raw: PouchDB.Database;
  let db: PouchDB.Database;
  const savedSwitch = process.env.NEXT_PUBLIC_PHI_ENCRYPTION;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_PHI_ENCRYPTION = 'true';
    raw = new PouchDB(`corr-test-${n++}`, { adapter: 'memory' });
    db = wrapEncrypted(raw, 'tamamhealth_test');
  });
  afterEach(async () => {
    await raw.destroy();
    if (savedSwitch === undefined) delete process.env.NEXT_PUBLIC_PHI_ENCRYPTION;
    else process.env.NEXT_PUBLIC_PHI_ENCRYPTION = savedSwitch;
  });

  it('seals the proposed and rejected values, keeps ids and staff names readable, and reads back plaintext', async () => {
    const plain = (over: Record<string, unknown> = {}) => correction({ result: '6.9', unit: 'mmol/L', referenceRange: '3.5-5.1', reason: 'Re-run on fresh sample', ...over });
    await db.put({
      _id: 'lab-1', type: 'lab_result', orgId: 'org-a', patientId: 'p-1', result: '4.1',
      pendingCorrection: { ...plain(), observations: [{ id: 'k', label: 'Potassium', group: 'Chem', value: '6.9' }] },
      rejectedCorrections: [{ ...plain({ result: '7.5' }), rejectedBy: 'Ladu Lab', rejectedById: 'u-lab-b', rejectedAt: 'x', rejectionReason: 'Haemolysed' }],
    });
    const stored = await raw.get('lab-1') as unknown as Record<string, Record<string, unknown> & Array<Record<string, unknown>>>;
    const pending = stored.pendingCorrection as Record<string, unknown>;
    for (const field of ['result', 'unit', 'referenceRange', 'reason']) expect(isOrgEncrypted(pending[field])).toBe(true);
    expect(isOrgEncrypted((pending.observations as Array<Record<string, unknown>>)[0].value)).toBe(true);
    expect(pending.proposedById).toBe('u-lab-a');
    expect(pending.proposedBy).toBe('Achol Lab');
    const rejected = (stored.rejectedCorrections as unknown as Array<Record<string, unknown>>)[0];
    expect(isOrgEncrypted(rejected.result)).toBe(true);
    expect(isOrgEncrypted(rejected.rejectionReason)).toBe(true);
    expect(rejected.rejectedById).toBe('u-lab-b');
    expect(JSON.stringify(stored)).not.toMatch(/6\.9|7\.5|Re-run|Haemolysed/);

    const read = await db.get('lab-1') as unknown as { pendingCorrection: { result: string; reason: string } };
    expect(read.pendingCorrection).toMatchObject({ result: '6.9', reason: 'Re-run on fresh sample' });
  });

  it('seals the medicine names in a triage medication review', async () => {
    await db.put({ _id: 'triage-1', type: 'triage', orgId: 'org-a', patientId: 'p-1', medicationReview: review({ added: ['Metformin'], stopped: ['Amoxicillin'], edited: ['Losartan'], removed: ['Aspirin'] }) });
    const stored = await raw.get('triage-1') as unknown as { medicationReview: Record<string, unknown> };
    for (const field of ['added', 'stopped', 'edited', 'removed']) {
      expect(isOrgEncrypted((stored.medicationReview[field] as string[])[0])).toBe(true);
    }
    expect(stored.medicationReview.reviewedBy).toBe('u-nurse');
    expect(stored.medicationReview.activeCount).toBe(2);
    expect(JSON.stringify(stored)).not.toMatch(/Metformin|Amoxicillin|Losartan|Aspirin/);
  });
});
