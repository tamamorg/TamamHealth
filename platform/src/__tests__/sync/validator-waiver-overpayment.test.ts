/**
 * The server's validator holds the same two lines as the app: a waiver or
 * adjustment is approved by a manager other than who entered it, and a payment
 * is never above the balance it was taken against (cash over it is change).
 */
import { ORG_SCOPED_VALIDATE_FN } from '@/lib/sync/validate-doc-update';

const SEALED = 'oenc:v1:b3JnLWE:aXY:Y2lwaGVy';

type Ctx = { name?: string; roles: string[] };
type Fn = (n: Record<string, unknown>, o: Record<string, unknown> | null, u: Ctx, s?: unknown) => void;
const validate = new Function(`return (${ORG_SCOPED_VALIDATE_FN});`)() as Fn;
const reason = (n: Record<string, unknown>, o: Record<string, unknown> | null, u: Ctx): string | null => {
  try { validate(n, o, u, {}); return null; } catch (e) { return (e as { forbidden?: string }).forbidden ?? 'thrown'; }
};

const cashier: Ctx = { name: 'cashier', roles: ['org:org-a', 'role:cashier', 'user:u-cashier', 'facility:h-1'] };

const adjustment = (over: Record<string, unknown> = {}) => ({
  _id: 'adj-1', type: 'adjustment', orgId: 'org-a', facilityId: 'h-1', patientId: 'p-1',
  adjustmentType: 'charity', amount: 30, reason: 'cannot pay',
  createdBy: 'u-cashier', approvedBy: 'u-mgr', approvedByName: 'Mary', approvedByRole: 'hospital_manager',
  approvedDate: '2026-11-08T08:00:00.000Z', createdAt: '2026-11-08T08:00:00.000Z', updatedAt: '2026-11-08T08:00:00.000Z',
  ...over,
});

const payment = (over: Record<string, unknown> = {}) => ({
  _id: 'pmt-1', type: 'payment', orgId: 'org-a', facilityId: 'h-1', patientId: 'p-1', patientName: SEALED,
  method: 'cash', amount: 70, currency: 'SSP', status: 'posted', processedAt: '2026-11-08T08:00:00.000Z',
  processedBy: 'u-cashier', processedByName: 'Cashier', createdBy: 'u-cashier', balanceBefore: 70,
  createdAt: '2026-11-08T08:00:00.000Z', updatedAt: '2026-11-08T08:00:00.000Z', ...over,
});

describe('adjustment approval', () => {
  test('accepts one approved by a manager other than the cashier', () => {
    expect(reason(adjustment(), null, cashier)).toBeNull();
  });
  test('refuses no approver, self approval and a non-approver role', () => {
    expect(reason(adjustment({ approvedBy: undefined }), null, cashier)).toMatch(/name the manager/);
    expect(reason(adjustment({ approvedBy: 'u-cashier' }), null, cashier)).toMatch(/cannot be approved by the person who entered it/);
    // Typed under another id but created by this user: still refused.
    expect(reason(adjustment({ createdBy: 'u-other', approvedBy: 'u-cashier' }), null, cashier)).toMatch(/cannot be approved by the person who entered it/);
    expect(reason(adjustment({ approvedByRole: 'cashier' }), null, cashier)).toMatch(/manager or administrator/);
  });
});

describe('payment', () => {
  test('accepts a payment within the balance and cash with change', () => {
    expect(reason(payment(), null, cashier)).toBeNull();
    expect(reason(payment({ tendered: 100, changeGiven: 30 }), null, cashier)).toBeNull();
  });
  test('refuses an amount above the balance it was taken against', () => {
    expect(reason(payment({ amount: 70.01 }), null, cashier)).toMatch(/more than the balance/);
    expect(reason(payment({ balanceBefore: 0 }), null, cashier)).toMatch(/more than the balance/);
  });
  test('refuses change that does not add up, or on a non-cash method', () => {
    expect(reason(payment({ tendered: 100, changeGiven: 20 }), null, cashier)).toMatch(/Cash tendered/);
    expect(reason(payment({ method: 'mpesa', tendered: 100, changeGiven: 30 }), null, cashier)).toMatch(/Cash tendered/);
  });
  test('a waiver payment carries the same approval rule', () => {
    const waiver = payment({ method: 'waiver' });
    expect(reason(waiver, null, cashier)).toMatch(/name the manager/);
    expect(reason({ ...waiver, approvedBy: 'u-cashier', approvedByRole: 'hospital_manager' }, null, cashier)).toMatch(/cannot be approved/);
    expect(reason({ ...waiver, approvedBy: 'u-mgr', approvedByRole: 'hospital_manager' }, null, cashier)).toBeNull();
  });
  test('a payment without the balance field (gateway webhook) is not refused for it', () => {
    expect(reason(payment({ balanceBefore: undefined, amount: 500 }), null, cashier)).toBeNull();
  });
});

describe('waived bill', () => {
  const bill = (over: Record<string, unknown> = {}) => ({
    _id: 'bill-1', type: 'billing', orgId: 'org-a', facilityId: 'h-1', patientId: 'p-1', status: 'waived',
    ...over,
  });
  test('needs an approver who is not the actor', () => {
    const before = { ...bill({ status: 'pending' }), _rev: '1-a' };
    expect(reason(bill({ _rev: '2-a' }), before, cashier)).toMatch(/waived bill must be approved/);
    expect(reason(bill({ _rev: '2-a', waiverApprovedBy: 'u-cashier', waiverApprovedByRole: 'hospital_manager' }), before, cashier)).toMatch(/waived bill must be approved/);
    expect(reason(bill({ _rev: '2-a', waiverApprovedBy: 'u-mgr', waiverApprovedByRole: 'hospital_manager' }), before, cashier)).toBeNull();
  });
});

describe('a bill created already waived (an exempt visit)', () => {
  const nurse: Ctx = { name: 'nurse', roles: ['org:org-a', 'role:nurse', 'user:u-nurse', 'facility:h-1'] };
  const clinician: Ctx = { name: 'dr', roles: ['org:org-a', 'role:doctor', 'user:u-dr', 'facility:h-1'] };
  const manager: Ctx = { name: 'mgr', roles: ['org:org-a', 'role:hospital_manager', 'user:u-mgr', 'facility:h-1'] };
  // Exactly the shape createBill({ exemptReason }) writes: status waived, no
  // approver, balance zero, the reason on the bill, no money on it.
  const exemptBill = (over: Record<string, unknown> = {}) => ({
    _id: 'bill-ex', type: 'billing', orgId: 'org-a', facilityId: 'h-1', patientId: 'p-1', patientName: SEALED,
    encounterId: 'enc-1', items: [], subtotal: 100, discount: 0, taxRate: 0, taxAmount: 0, totalAmount: 100,
    amountPaid: 0, balanceDue: 0, currency: 'SSP', payments: [], insuranceClaimStatus: 'none',
    status: 'waived', discountReason: 'Exempt visit: Child under five', exemptReason: 'Exempt visit: Child under five',
    generatedBy: 'u-dr', generatedByName: 'Dr', invoiceNumber: 'INV-1', state: 'CES',
    createdAt: '2026-11-08T08:00:00.000Z', updatedAt: '2026-11-08T08:00:00.000Z',
    ...over,
  });

  test('is accepted without an approver from the clinical roles that raise the charge', () => {
    expect(reason(exemptBill(), null, clinician)).toBeNull();
    expect(reason(exemptBill(), null, nurse)).toBeNull();
  });
  test('the cashier cannot write a fresh waived bill to waive a normal charge', () => {
    expect(reason(exemptBill(), null, cashier)).toMatch(/waived bill must be approved/);
    expect(reason(exemptBill({ exemptReason: undefined }), null, clinician)).toMatch(/waived bill must be approved/);
    expect(reason(exemptBill({ exemptReason: '  ' }), null, clinician)).toMatch(/waived bill must be approved/);
    expect(reason(exemptBill({ amountPaid: 10 }), null, clinician)).toMatch(/waived bill must be approved/);
  });
  test('a manager may still create one with their own approval fields', () => {
    expect(reason(exemptBill({ exemptReason: undefined, waiverApprovedBy: 'u-x', waiverApprovedByRole: 'hospital_manager' }), null, manager)).toBeNull();
  });
  test('an existing paying bill still cannot be flipped to waived without an approver', () => {
    const before = { ...exemptBill({ status: 'pending', balanceDue: 100, exemptReason: undefined, discountReason: undefined }), _rev: '1-a' };
    // Even carrying an exemptReason, a transition of a held bill is a human waiver.
    expect(reason({ ...exemptBill({ _rev: '2-a' }) }, before, cashier)).toMatch(/waived bill must be approved/);
    expect(reason({ ...exemptBill({ _rev: '2-a' }) }, before, clinician)).toMatch(/waived bill must be approved/);
    expect(reason({ ...exemptBill({ _rev: '2-a', waiverApprovedBy: 'u-mgr', waiverApprovedByRole: 'hospital_manager' }) }, before, cashier)).toBeNull();
  });
});

describe('the signed approval token rides on the document', () => {
  test('a waiver payment and an adjustment carrying approvalToken are accepted by the validator', () => {
    expect(reason(payment({ method: 'waiver', approvedBy: 'u-mgr', approvedByRole: 'hospital_manager', approvedAt: '2026-11-08T08:00:00.000Z', approvalToken: 'a.b' }), null, cashier)).toBeNull();
    expect(reason(adjustment({ approvalToken: 'a.b' }), null, cashier)).toBeNull();
  });
  test('a human bill waiver carrying waiverApprovalToken is accepted', () => {
    const before = { _id: 'bill-1', type: 'billing', orgId: 'org-a', facilityId: 'h-1', patientId: 'p-1', status: 'pending', _rev: '1-a' };
    expect(reason({ ...before, _rev: '2-a', status: 'waived', waiverApprovedBy: 'u-mgr', waiverApprovedByRole: 'hospital_manager', waiverApprovalToken: 'a.b', waivedBy: 'u-cashier' }, before, cashier)).toBeNull();
  });
});
