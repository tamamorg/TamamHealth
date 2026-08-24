/** The fee catalog is loaded once per superbill, not once per line. */

const getActiveFees = jest.fn(async () => [
  { serviceCode: 'CONSULT', serviceName: 'Consultation', category: 'consultation', unitPrice: 50, isActive: true },
  { serviceCode: 'CBC', serviceName: 'CBC', category: 'laboratory', unitPrice: 20, isActive: true },
]);

jest.mock('@/lib/services/fee-schedule-service', () => ({
  getActiveFees: () => getActiveFees(),
  priceFromFees: (
    fees: Array<{ serviceCode: string; category: string }>,
    category: string,
    serviceCode?: string,
  ) => fees.find(fee => serviceCode ? fee.serviceCode === serviceCode : fee.category === category) ?? null,
  chargeForServices: jest.fn(),
}));

jest.mock('@/lib/services/directive-service', () => ({ addDirective: jest.fn() }));
jest.mock('@/lib/services/audit-service', () => ({ logAuditSafe: jest.fn() }));

import { buildSuperbillPreview } from '@/lib/services/superbill-service';

beforeEach(() => getActiveFees.mockClear());

it('prices every catalog-backed line with one database load', async () => {
  const preview = await buildSuperbillPreview([
    { category: 'consultation', serviceCode: 'CONSULT' },
    { category: 'laboratory', serviceCode: 'CBC' },
    { category: 'consultation', serviceCode: 'CONSULT', quantity: 2 },
  ]);

  expect(getActiveFees).toHaveBeenCalledTimes(1);
  expect(preview.lines.map(line => line.unitPrice)).toEqual([50, 20, 50]);
  expect(preview.total).toBe(170);
});

it('does not load the catalog when every line has an explicit price', async () => {
  await buildSuperbillPreview([
    { category: 'consultation', unitPrice: 75 },
    { category: 'laboratory', unitPrice: 25 },
  ]);
  expect(getActiveFees).not.toHaveBeenCalled();
});
