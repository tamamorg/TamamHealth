let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-lwuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

const mockAudit = jest.fn(async () => undefined);
jest.mock('@/lib/services/audit-service', () => ({
  logAudit: (...a: unknown[]) => mockAudit(...(a as [])),
  logAuditSafe: (...a: unknown[]) => mockAudit(...(a as [])),
}));
jest.mock('@/lib/services/checkout-gate-service', () => ({
  evaluateCheckoutGate: async () => ({ canDischarge: false, blocking: [{ key: 'unpaid_bill' }] }),
}));

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { labResultsDB, encountersDB, getDB } from '@/lib/db';
import { updateLabResult, getOverdueUnreviewedResults } from '@/lib/services/lab-service';
import { admitPatient } from '@/lib/services/ward-service';
import { assertDischargeAllowed } from '@/modules/post-consult/services/discharge-service';

afterEach(async () => { jest.restoreAllMocks(); mockAudit.mockClear(); await teardownTestDBs(); uuidCounter = 0; });

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

describe('updateLabResult failure modes', () => {
  test('returns null only when the order does not exist', async () => {
    expect(await updateLabResult('lab-missing', { notes: 'x' } as never)).toBeNull();
  });

  test('rethrows a write conflict instead of reporting not found', async () => {
    await putDoc(labResultsDB(), { _id: 'lab-1', type: 'lab_result', status: 'pending', orderedAt: hoursAgo(1) } as never);
    const conflict = Object.assign(new Error('Document update conflict'), { status: 409, name: 'conflict' });
    jest.spyOn(labResultsDB(), 'put').mockRejectedValueOnce(conflict);
    await expect(updateLabResult('lab-1', { notes: 'x' } as never)).rejects.toBe(conflict);
  });
});

describe('getOverdueUnreviewedResults clocks from completedAt', () => {
  test('a later write does not reset the SLA clock', async () => {
    const base = { type: 'lab_result', status: 'completed', orderStatus: 'resulted', critical: true, orgId: 'o' };
    await putDoc(labResultsDB(), { _id: 'lab-old', ...base, completedAt: hoursAgo(72), updatedAt: hoursAgo(1), createdAt: hoursAgo(80) } as never);
    await putDoc(labResultsDB(), { _id: 'lab-new', ...base, completedAt: hoursAgo(2), updatedAt: hoursAgo(1), createdAt: hoursAgo(80) } as never);
    await putDoc(labResultsDB(), { _id: 'lab-legacy', ...base, updatedAt: hoursAgo(72), createdAt: hoursAgo(80) } as never);
    const ids = (await getOverdueUnreviewedResults()).map(r => r._id).sort();
    expect(ids).toEqual(['lab-legacy', 'lab-old']);
  });
});

describe('admitPatient double submit', () => {
  const input = () => ({
    patientId: 'pat-1', patientName: 'Pat One', admittingDiagnosis: 'x', severity: 'moderate' as const,
    admittedBy: 'u1', admittedByName: 'U', wardId: 'ward-1', wardName: 'Ward 1',
    facilityId: 'hosp-1', facilityName: 'H', facilityLevel: 'county' as never,
    attendingPhysician: 'u2', attendingPhysicianName: 'D', state: 'CES', orgId: 'org-1',
  });

  test('two concurrent bedless admits create one active admission', async () => {
    const results = await Promise.allSettled([admitPatient(input()), admitPatient(input())]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect((rejected.reason as { code?: string }).code).toBe('DUPLICATE_ADMISSION');
    const rows = (await getDB('tamamhealth_wards').allDocs({ include_docs: true })).rows
      .filter(r => (r.doc as { type?: string })?.type === 'admission');
    expect(rows).toHaveLength(1);
  });

  test('a slow admit does not delete the claim a later caller took over from it', async () => {
    const wards = getDB('tamamhealth_wards');
    const claimId = '_local/admission_claim_hosp-1_pat-1';
    const realPut = wards.put.bind(wards);
    let takenOver = false;
    jest.spyOn(wards, 'put').mockImplementation((async (doc: { _id: string }, ...rest: unknown[]) => {
      if (!takenOver && !doc._id.startsWith('_local/')) {
        takenOver = true;
        // Simulate: this admit outlived the stale window and B took the claim over.
        const mine = await wards.get(claimId);
        await wards.remove(mine as never);
        await realPut({ _id: claimId, claimedAt: new Date().toISOString(), token: 'B-token' } as never);
      }
      return (realPut as (...a: unknown[]) => unknown)(doc, ...rest);
    }) as never);
    await admitPatient(input());
    expect(takenOver).toBe(true);
    const claim = await wards.get(claimId) as unknown as { token?: string };
    expect(claim.token).toBe('B-token');
  });

  test('the claim is released so a later admission after discharge is not blocked by it', async () => {
    await admitPatient(input());
    const claims = await getDB('tamamhealth_wards').get('_local/admission_claim_hosp-1_pat-1').catch(() => null);
    expect(claims).toBeNull();
  });
});

describe('assertDischargeAllowed override audit', () => {
  test('an exceptional discharge asserted twice audits CHECKOUT_GATE_OVERRIDDEN once', async () => {
    await putDoc(encountersDB(), { _id: 'enc-1', type: 'clinical_encounter', patientId: 'p', status: 'with_clinician', orgId: 'o', hospitalId: 'h' } as never);
    const actor = { actorId: 'doc-1', actorRole: 'doctor' as never, reason: 'Patient left against advice' };
    await assertDischargeAllowed('enc-1', 'dismissed_without_formal_checkout', actor);
    await assertDischargeAllowed('enc-1', 'dismissed_without_formal_checkout', actor);
    const overrides = mockAudit.mock.calls.filter(c => (c as unknown[])[0] === 'CHECKOUT_GATE_OVERRIDDEN');
    expect(overrides).toHaveLength(1);
  });

  test('a failed audit write is not remembered, so the next assert audits again', async () => {
    await putDoc(encountersDB(), { _id: 'enc-2', type: 'clinical_encounter', patientId: 'p', status: 'with_clinician', orgId: 'o', hospitalId: 'h' } as never);
    const actor = { actorId: 'doc-1', actorRole: 'doctor' as never, reason: 'Patient left against advice' };
    mockAudit.mockRejectedValueOnce(new Error('audit db down'));
    await assertDischargeAllowed('enc-2', 'dismissed_without_formal_checkout', actor);
    await assertDischargeAllowed('enc-2', 'dismissed_without_formal_checkout', actor);
    await assertDischargeAllowed('enc-2', 'dismissed_without_formal_checkout', actor);
    const overrides = mockAudit.mock.calls.filter(c => (c as unknown[])[0] === 'CHECKOUT_GATE_OVERRIDDEN');
    expect(overrides).toHaveLength(2); // failed attempt + the retry that succeeded; third is deduped
  });
});
