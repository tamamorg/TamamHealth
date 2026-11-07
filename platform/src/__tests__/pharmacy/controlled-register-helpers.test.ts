/**
 * The controlled-substance register tied every movement to a synthetic
 * `csub-<slug>` id, so its balances never reconciled against real stock
 * (security audit 2026-11-05, §2.1 #7). A movement now carries the real
 * inventory id when the drug matches the facility's controlled stock.
 */
import { matchControlledInventoryItem, registerInventoryId } from '@/components/pharmacy/controlled-register-helpers';
import type { PharmacyInventoryDoc } from '@/lib/db-types';

const items = [
  { _id: 'inv-morphine', medicationName: 'Morphine sulfate 10mg', controlledSchedule: 'II', unit: 'mg' },
  { _id: 'inv-diazepam', medicationName: 'Diazepam 5mg', controlledSchedule: 'IV', unit: 'mg' },
] as unknown as PharmacyInventoryDoc[];

describe('matchControlledInventoryItem', () => {
  it('matches a stock item by name, case-insensitively', () => {
    expect(matchControlledInventoryItem('morphine sulfate 10mg', items)?._id).toBe('inv-morphine');
    expect(matchControlledInventoryItem('  Diazepam 5mg ', items)?._id).toBe('inv-diazepam');
  });
  it('returns undefined for an off-catalogue or empty name', () => {
    expect(matchControlledInventoryItem('Pethidine 50mg', items)).toBeUndefined();
    expect(matchControlledInventoryItem('', items)).toBeUndefined();
  });
});

describe('registerInventoryId', () => {
  it('uses the real inventory id when one was matched', () => {
    expect(registerInventoryId('inv-morphine', 'Morphine sulfate 10mg')).toBe('inv-morphine');
  });
  it('falls back to a synthetic per-name id for an off-catalogue drug', () => {
    expect(registerInventoryId('', 'Pethidine 50mg')).toBe('csub-pethidine-50mg');
    expect(registerInventoryId('', '')).toBe('csub-item');
  });
});
