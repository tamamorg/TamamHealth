/**
 * priceFromFees must resolve a line to its OWN service by code or name. Callers
 * pass the service name (e.g. `serviceCode: test.name`); matching only the code
 * sent every lab test to the first lab fee, so a Malaria RDT was billed at the
 * Full Blood Count price (audit 2026-11-05).
 */
import { priceFromFees } from '@/lib/services/fee-schedule-service';
import type { FeeScheduleDoc } from '@/lib/db-types-billing';

const fee = (over: Partial<FeeScheduleDoc>): FeeScheduleDoc => ({
  _id: over.serviceCode || 'f', type: 'fee_schedule', facilityId: 'h1', facilityName: 'H1',
  category: 'laboratory', serviceCode: 'LAB-X', serviceName: 'X', unitPrice: 0, currency: 'SSP',
  isActive: true, effectiveFrom: '2026-01-01', createdAt: '2026-01-01', updatedAt: '2026-01-01',
  ...over,
} as FeeScheduleDoc);

const fees = [
  fee({ serviceCode: 'LAB-FBC', serviceName: 'Full Blood Count', unitPrice: 3500 }), // first in category
  fee({ serviceCode: 'LAB-MRDT', serviceName: 'Malaria RDT', unitPrice: 2000 }),
];

describe('priceFromFees', () => {
  it('matches a lab test by NAME, not the first fee in the category', () => {
    expect(priceFromFees(fees, 'laboratory', 'Malaria RDT')?.unitPrice).toBe(2000);
  });

  it('matches by service code too', () => {
    expect(priceFromFees(fees, 'laboratory', 'LAB-MRDT')?.unitPrice).toBe(2000);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(priceFromFees(fees, 'laboratory', '  malaria rdt ')?.unitPrice).toBe(2000);
  });

  it('falls back to a category fee only when the service is not catalogued at all', () => {
    expect(priceFromFees(fees, 'laboratory', 'Not a catalogued test')?.serviceCode).toBe('LAB-FBC');
    expect(priceFromFees(fees, 'laboratory', undefined)?.serviceCode).toBe('LAB-FBC');
  });
});
