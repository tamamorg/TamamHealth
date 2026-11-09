import { buildReorderRows } from '@/lib/pharmacy-reorder';
import type { PharmacyInventoryDoc } from '@/lib/db-types';
import type { InventoryLine } from '@/lib/pharmacy-reorder';

const TODAY = '2026-11-08';
const line = (over: Partial<PharmacyInventoryDoc> & { status?: string }): InventoryLine => ({
  _id: `inv-${Math.random()}`, type: 'pharmacy_inventory', hospitalId: 'h-1', hospitalName: 'H',
  medicationName: 'Amoxicillin', category: 'Antibiotic', stockLevel: 500, unit: 'tablets', reorderLevel: 100,
  batchNumber: 'B1', expiryDate: '2027-06-01', dispensedToday: 0, status: 'adequate',
  ...over,
} as InventoryLine);

describe('buildReorderRows', () => {
  it('lists nothing when stock is adequate and in date', () => {
    expect(buildReorderRows([line({})], { today: TODAY })).toEqual([]);
  });

  it('lists a wholly expired medicine as needing replacement with 0 on hand', () => {
    const rows = buildReorderRows([line({ stockLevel: 80, expiryDate: '2026-10-01', status: 'expired' })], { today: TODAY });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ onHand: 0, expiredQty: 80, status: 'expired' });
  });

  it('lists a medicine that is partly expired even when the in-date batch is adequate', () => {
    const rows = buildReorderRows([
      line({ batchNumber: 'B1', stockLevel: 500 }),
      line({ batchNumber: 'B0', stockLevel: 30, expiryDate: '2026-11-01', status: 'adequate' }),
    ], { today: TODAY });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ onHand: 500, expiredQty: 30 });
  });

  it('names the expired units once on a low medicine', () => {
    const rows = buildReorderRows([
      line({ batchNumber: 'B1', stockLevel: 20, status: 'low' }),
      line({ batchNumber: 'B2', stockLevel: 10, expiryDate: '2026-10-01' }),
    ], { today: TODAY });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ onHand: 20, expiredQty: 10, status: 'low' });
  });

  it('counts a batch as usable on its expiry day, like the stock position does', () => {
    const rows = buildReorderRows([
      line({ batchNumber: 'B1', stockLevel: 20, status: 'low' }),
      line({ batchNumber: 'B2', stockLevel: 10, expiryDate: TODAY }),
    ], { today: TODAY });
    expect(rows[0]).toMatchObject({ expiredQty: 0 });
  });

  it('does not mix facilities or medicines, and ignores empty expired lines', () => {
    const rows = buildReorderRows([
      line({ stockLevel: 40, expiryDate: '2026-10-01' }),
      line({ hospitalId: 'h-2', medicationName: 'Amoxicillin' }),
      line({ medicationName: 'Zinc', stockLevel: 0, expiryDate: '2026-10-01' }),
    ], { today: TODAY });
    expect(rows).toHaveLength(1);
    expect(rows[0].item.hospitalId).toBe('h-1');
  });
});
