/** @jest-environment node */
import { getAvailableSlots } from '@/lib/services/booking-service';
import { findByType } from '@/lib/services/db-query';
import { computeSlots } from '@/lib/booking/slot-engine';
import type { VisitReasonDoc } from '@/lib/db-types-booking';

jest.mock('@/lib/db', () => ({
  appointmentsDB: () => 'appointments', availabilityDB: () => 'availability', slotHoldsDB: () => 'holds',
}));
jest.mock('@/lib/services/db-query', () => ({ findByType: jest.fn() }));
jest.mock('@/lib/services/booking-policy-service', () => ({ getEffectiveBookingPolicy: jest.fn(async () => ({})) }));
jest.mock('@/lib/booking/slot-engine', () => ({ computeSlots: jest.fn(() => []) }));
jest.mock('uuid', () => ({ v4: () => 'test-id' }));

it('loads same-organization conflicts across facilities and legacy rows without leaking another tenant', async () => {
  const rows = [
    { _id: 'local', orgId: 'org-a', facilityId: 'fac-a', appointmentDate: '2026-09-10' },
    { _id: 'away', orgId: 'org-a', facilityId: 'fac-b', appointmentDate: '2026-09-10' },
    { _id: 'legacy', orgId: 'org-a', appointmentDate: '2026-09-10' },
    { _id: 'other-tenant', orgId: 'org-b', facilityId: 'fac-a', appointmentDate: '2026-09-10' },
    { _id: 'unowned', facilityId: 'fac-a', appointmentDate: '2026-09-10' },
    { _id: 'outside-range', orgId: 'org-a', appointmentDate: '2026-09-12' },
  ];
  jest.mocked(findByType).mockImplementation(async db => (db as unknown) === 'appointments' ? rows as never : []);
  await getAvailableSlots({ facilityId: 'fac-a', orgId: 'org-a', from: '2026-09-10', to: '2026-09-10',
    visitReason: { durationMinutes: 30 } as VisitReasonDoc, patientClass: 'returning', channel: 'staff' });
  expect(jest.mocked(computeSlots).mock.calls[0][1]).toEqual(rows.slice(0, 3));
});
