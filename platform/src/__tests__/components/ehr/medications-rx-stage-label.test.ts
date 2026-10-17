/**
 * The chart's medication status said "Prescribed" until dispensing, so a
 * prescriber never saw the pharmacist clear (or hold) an order.
 */
jest.mock('@/lib/hooks/usePrescriptions', () => ({}));
import { rxStatusLabel } from '@/components/ehr/chart/sections/MedicationsSection';
import en from '@/lib/i18n/locales/en';
import type { PrescriptionDoc } from '@/lib/db-types';

const t = (key: string) => (en as Record<string, string>)[key] ?? key;
const rx = (over: Partial<PrescriptionDoc>) => ({ status: 'pending', ...over }) as PrescriptionDoc;

it.each([
  [{}, 'Prescribed'],
  [{ orderStatus: 'received_in_pharmacy_queue' }, 'Prescribed'],
  [{ orderStatus: 'cleared_for_dispensing' }, 'Cleared for dispensing'],
  [{ orderStatus: 'held_awaiting_clarification' }, 'Held for clarification'],
  [{ status: 'dispensed', orderStatus: 'counseled' }, 'Dispensed'],
  [{ status: 'discontinued', orderStatus: 'cleared_for_dispensing' }, 'Stopped'],
  [{ fulfilment: 'external', orderStatus: 'cleared_for_dispensing' }, 'Script not yet given'],
] as const)('%j → %s', (over, label) => {
  expect(rxStatusLabel(rx(over as Partial<PrescriptionDoc>), t)).toBe(label);
});
