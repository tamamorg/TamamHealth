jest.mock('uuid', () => ({ v4: () => 'plan-test-id' }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.mock('@/lib/services/audit-service', () => ({ logAuditSafe: jest.fn() }));
jest.mock('@/lib/services/sync-event-service', () => ({ emitSyncEvent: jest.fn() }));

import { createPaymentPlan } from '@/lib/services/payment-service';
import { teardownTestDBs } from '../helpers/test-db';

const input = { patientId: 'synthetic', patientName: 'Synthetic patient', totalBalance: 100, termMonths: 3,
  currency: 'USD', encounterIds: [], createdByStaff: 'biller', createdByStaffName: 'Biller', facilityId: 'facility', orgId: 'org' };

afterEach(async () => { jest.useRealTimers(); await teardownTestDBs(); });

it('persists currency, schedules consecutive first-of-month dates and ends on the final installment', async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout'] });
  jest.setSystemTime(new Date(2026, 0, 31, 12));
  const result = await createPaymentPlan(input);
  expect(result.currency).toBe('USD');
  expect(result.installments.map(item => item.dueDate)).toEqual(['2026-02-01', '2026-03-01', '2026-04-01']);
  expect(result.endDate).toBe('2026-04-01');
  expect(result.installments.reduce((sum, item) => sum + Math.round(item.amount * 100), 0)).toBe(10000);
});

it('does not create a negative final installment for small balances', async () => {
  const result = await createPaymentPlan({ ...input, totalBalance: .13, termMonths: 12 });
  expect(result.installments.every(item => item.amount >= 0)).toBe(true);
  expect(result.installments.reduce((sum, item) => sum + Math.round(item.amount * 100), 0)).toBe(13);
});

it.each([{ totalBalance: 0 }, { totalBalance: Infinity }, { termMonths: 0 }, { termMonths: 1.5 }, { apr: 5 }, { currency: 'invalid' }])('rejects an invalid plan before writing: %o', async patch => {
  await expect(createPaymentPlan({ ...input, ...patch })).rejects.toThrow('INVALID_PAYMENT_PLAN');
});
