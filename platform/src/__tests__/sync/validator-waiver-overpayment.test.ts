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
