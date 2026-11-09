/**
 * Reception closes visits at checkout, so it may carry a visit's balance as a
 * debt to the account (recordDebtToAccount). The grant is create-only and bound
 * to that one plan shape: reception can't open an ordinary instalment plan, nor
 * edit or settle any plan afterwards.
 */
import { ORG_SCOPED_VALIDATE_FN } from '@/lib/sync/validate-doc-update';
import { buildPushFilter } from '@/lib/sync/sync-service';

type Ctx = { name?: string; roles: string[] };
type Fn = (n: Record<string, unknown>, o: Record<string, unknown> | null, u: Ctx, s?: unknown) => void;
const validate = new Function(`return (${ORG_SCOPED_VALIDATE_FN});`)() as Fn;
const reason = (n: Record<string, unknown>, o: Record<string, unknown> | null, u: Ctx): string | null => {
  try { validate(n, o, u, {}); return null; } catch (e) { return (e as { forbidden?: string }).forbidden ?? 'thrown'; }
};

const desk: Ctx = { name: 'desk', roles: ['org:org-a', 'role:front_desk', 'user:u-desk', 'facility:h-1'] };
const nurse: Ctx = { name: 'nurse', roles: ['org:org-a', 'role:nurse', 'user:u-nurse', 'facility:h-1'] };

const debtPlan = (over: Record<string, unknown> = {}) => ({
  _id: 'plan-1', type: 'payment_plan', orgId: 'org-a', facilityId: 'h-1', patientId: 'p-1',
  totalBalance: 5000, currency: 'SSP', termMonths: 1, monthlyAmount: 5000, apr: 0,
  startDate: '2026-11-09', endDate: '2026-12-01', status: 'active', paidToDate: 0,
  remainingBalance: 5000, missedPayments: 0, autoPayEnabled: false, encounterIds: ['enc-1'],
  reason: 'Family will pay on Friday', planKind: 'debt_at_checkout',
  installments: [{ number: 1, dueDate: '2026-12-01', amount: 5000, status: 'pending' }],
  createdByStaff: 'u-desk', createdAt: '2026-11-09T08:00:00.000Z', updatedAt: '2026-11-09T08:00:00.000Z',
  ...over,
});

describe('reception records a debt at checkout', () => {
  test('the validator accepts the debt-at-checkout plan from the front desk', () => {
    expect(reason(debtPlan(), null, desk)).toBeNull();
  });

  test('an ordinary instalment plan from the front desk is refused', () => {
    const { planKind: _omit, ...plain } = debtPlan();
    expect(reason(plain, null, desk)).not.toBeNull();
    expect(reason(debtPlan({ status: 'completed' }), null, desk)).not.toBeNull();
  });

  test('the front desk cannot edit or settle a plan afterwards', () => {
    const existing = { ...debtPlan(), _rev: '1-a' };
    expect(reason({ ...existing, _rev: '2-b', paidToDate: 5000, remainingBalance: 0, status: 'completed' }, existing, desk)).not.toBeNull();
  });

  test('other clinical roles still cannot create one', () => {
    expect(reason(debtPlan(), null, nurse)).not.toBeNull();
  });

  test('the push filter offers the plan for upload (no silent hold-back)', () => {
    const filter = buildPushFilter('front_desk', { orgId: 'org-a', facilityIds: ['h-1'], allFacilities: false });
    expect(filter(debtPlan())).toBe(true);
  });
});
