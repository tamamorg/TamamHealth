/**
 * @jest-environment node
 *
 * The manager's approval is signed by the server, so a device cannot type one.
 * The gateway refuses a new waiver / adjustment / human bill waiver whose token
 * does not verify; reconciliation lists stored ones that do not.
 */
const SECRET = 'test-secret-test-secret-test-secret-0123456789';

import {
  signApproval, approvalVerifies, approvalClaimFor, moneyApprovalRefusal, approvalState, reconcileMoneyApprovals, APPROVAL_TTL_MS,
} from '@/lib/billing/approval-token';
import type { ManagerApproval } from '@/lib/billing/manager-override-policy';

const NOW = Date.parse('2026-11-08T08:00:00.000Z');
const approval: ManagerApproval = { approvedBy: 'u-mgr', approvedByName: 'Mary', approvedByRole: 'hospital_manager', approvedAt: '2026-11-08T08:00:00.000Z' };
const token = (binding: Parameters<typeof signApproval>[1], now = NOW) => signApproval(approval, binding, SECRET, now);

const adjustment = (over: Record<string, unknown> = {}) => ({
  _id: 'adj-1', type: 'adjustment', patientId: 'p-1', amount: 30, createdBy: 'u-cashier',
  approvedBy: 'u-mgr', approvedByRole: 'hospital_manager', createdAt: '2026-11-08T08:02:00.000Z',
  approvalToken: token({ requesterId: 'u-cashier', subjectId: 'p-1', amount: 30 }), ...over,
});
const waiverPayment = (over: Record<string, unknown> = {}) => ({
  _id: 'pmt-1', type: 'payment', method: 'waiver', patientId: 'p-1', amount: 50, processedBy: 'u-cashier', createdBy: 'u-cashier',
  approvedBy: 'u-mgr', approvedByRole: 'hospital_manager', processedAt: '2026-11-08T08:01:00.000Z',
  approvalToken: token({ requesterId: 'u-cashier', subjectId: 'p-1', amount: 50 }), ...over,
});
const waivedBill = (over: Record<string, unknown> = {}) => ({
  _id: 'bill-1', type: 'billing', status: 'waived', patientId: 'p-1', waivedBy: 'u-cashier', waivedAt: '2026-11-08T08:01:00.000Z',
  waiverApprovedBy: 'u-mgr', waiverApprovedByRole: 'hospital_manager',
  waiverApprovalToken: token({ requesterId: 'u-cashier', subjectId: 'bill-1' }), ...over,
});

describe('signed approval', () => {
  test('a genuine token verifies for the record it was issued for', () => {
    expect(moneyApprovalRefusal(adjustment(), null, SECRET)).toBeNull();
    expect(moneyApprovalRefusal(waiverPayment(), null, SECRET)).toBeNull();
    expect(moneyApprovalRefusal(waivedBill(), { _id: 'bill-1', status: 'pending' }, SECRET)).toBeNull();
  });

  test('a record with no token, or a token typed by the device, is refused', () => {
    expect(moneyApprovalRefusal(adjustment({ approvalToken: undefined }), null, SECRET)).toMatch(/Approval not verified/);
    expect(moneyApprovalRefusal(adjustment({ approvalToken: 'abc.def' }), null, SECRET)).toMatch(/Approval not verified/);
    const forged = Buffer.from(JSON.stringify({ v: 1, by: 'u-mgr', role: 'hospital_manager', at: approval.approvedAt, req: 'u-cashier', sub: 'p-1', amt: 3000, exp: NOW + APPROVAL_TTL_MS })).toString('base64url');
    expect(moneyApprovalRefusal(adjustment({ approvalToken: `${forged}.${'A'.repeat(43)}` }), null, SECRET)).toMatch(/Approval not verified/);
  });

  test('a token signed with another secret is refused', () => {
    const other = signApproval(approval, { requesterId: 'u-cashier', subjectId: 'p-1', amount: 30 }, 'another-secret-another-secret-another!', NOW);
    expect(moneyApprovalRefusal(adjustment({ approvalToken: other }), null, SECRET)).toMatch(/Approval not verified/);
  });

  test('the token is bound to approver, requester, patient, bill and amount', () => {
    expect(approvalVerifies(approvalClaimFor(adjustment({ approvedBy: 'u-other' }))!, SECRET)).toBe(false);
    expect(approvalVerifies(approvalClaimFor(adjustment({ approvedByRole: 'org_admin' }))!, SECRET)).toBe(false);
    expect(approvalVerifies(approvalClaimFor(adjustment({ createdBy: 'u-cashier-2' }))!, SECRET)).toBe(false);
    expect(approvalVerifies(approvalClaimFor(adjustment({ patientId: 'p-2' }))!, SECRET)).toBe(false);
    expect(approvalVerifies(approvalClaimFor(adjustment({ amount: 300 }))!, SECRET)).toBe(false);
    expect(approvalVerifies(approvalClaimFor(waivedBill({ _id: 'bill-2' }))!, SECRET)).toBe(false);
  });

  test('a record written long after the approval lapsed, or before it, is refused', () => {
    expect(moneyApprovalRefusal(adjustment({ createdAt: '2026-11-08T09:00:00.000Z' }), null, SECRET)).toMatch(/Approval not verified/);
    expect(moneyApprovalRefusal(adjustment({ createdAt: '2026-11-08T07:00:00.000Z' }), null, SECRET)).toMatch(/Approval not verified/);
  });

  test('an exempt bill created waived needs no approval, but flipping a held bill does, however it is described', () => {
    const exempt = { _id: 'bill-ex', type: 'billing', status: 'waived', exemptReason: 'Exempt visit: Emergency', amountPaid: 0, payments: [] };
    expect(moneyApprovalRefusal(exempt, null, SECRET)).toBeNull();
    // The server holds this bill un-waived: the incoming "new" document is a human waiver.
    expect(moneyApprovalRefusal(exempt, { _id: 'bill-ex', status: 'pending' }, SECRET)).toMatch(/Approval not verified/);
    // No exempt reason and no token: refused on create too.
    expect(moneyApprovalRefusal({ ...exempt, exemptReason: undefined }, null, SECRET)).toMatch(/Approval not verified/);
  });

  test('records the server already holds, and unrelated documents, are not re-judged', () => {
    expect(moneyApprovalRefusal(adjustment({ approvalToken: undefined }), { _id: 'adj-1' }, SECRET)).toBeNull();
    expect(moneyApprovalRefusal(waivedBill({ waiverApprovalToken: undefined }), { _id: 'bill-1', status: 'waived' }, SECRET)).toBeNull();
    expect(moneyApprovalRefusal({ _id: 'pmt-2', type: 'payment', method: 'cash' }, null, SECRET)).toBeNull();
    expect(moneyApprovalRefusal({ _id: 'bill-3', type: 'billing', status: 'pending' }, null, SECRET)).toBeNull();
  });
});

describe('reconciliation', () => {
  test('lists waivers and adjustments whose approval does not verify', () => {
    const exempt = { _id: 'bill-ex', type: 'billing', status: 'waived', exemptReason: 'Exempt', amountPaid: 0, payments: [] };
    const docs = [adjustment(), adjustment({ _id: 'adj-2', approvalToken: undefined }), waiverPayment({ _id: 'pmt-2', amount: 9 }), waivedBill(), exempt,
      { _id: 'pmt-3', type: 'payment', method: 'cash' }];
    expect(reconcileMoneyApprovals(docs, SECRET).map(r => r.id)).toEqual(['adj-2', 'pmt-2']);
    expect(approvalState(adjustment(), SECRET)).toBe('verified');
    expect(approvalState(exempt, SECRET)).toBe('exempt');
    expect(approvalState({ _id: 'x', type: 'patient' }, SECRET)).toBeNull();
    expect(reconcileMoneyApprovals(docs, SECRET)[0]).toMatchObject({ type: 'adjustment', approvedBy: 'u-mgr' });
  });
});
