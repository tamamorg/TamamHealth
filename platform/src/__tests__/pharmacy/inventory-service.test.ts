/**
 * Pharmacy inventory management — issue #85 bullet (1): add/update/remove
 * medications including stock levels, expiry dates and unit pricing, plus the
 * stock-status classification the pharmacy dashboard's low/critical/expired
 * badges read.
 *
 * `pharmacy-inventory-service.ts` had no service-level test at all before
 * this file — every existing pharmacy suite exercises inventory only as a
 * seeded fixture for `dispenseMedication`, never the CRUD/decrement/
 * classification functions themselves.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { pharmacyInventoryDB } from '@/lib/db';
import {
  getAllInventory,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  decrementStock,
  classifyStockStatus,
  dispensedTodayOf,
} from '@/lib/services/pharmacy-inventory-service';
import type { PharmacyInventoryDoc } from '@/lib/db-types';
import { jubaDate } from '@/lib/time-juba';

const HOSP_A = 'hosp-001';
const HOSP_B = 'hosp-002';
const ORG = 'org-moh-ss';

afterEach(async () => {
  await teardownTestDBs();
  uuidCounter = 0;
});

function baseItem(overrides: Partial<PharmacyInventoryDoc> = {}) {
  return {
    hospitalId: HOSP_A,
    hospitalName: 'Juba Teaching Hospital',
    medicationName: 'Amoxicillin 500mg',
    category: 'Antibiotic',
    stockLevel: 200,
    unit: 'tablets',
    reorderLevel: 20,
    batchNumber: 'B-2026-01',
    expiryDate: '2027-01-01',
    orgId: ORG,
    ...overrides,
  };
}

describe('createInventoryItem', () => {
  it('writes stock level, expiry date, batch and unit pricing fields, defaulting dispensedToday to 0', async () => {
    const item = await createInventoryItem(baseItem({ unitPrice: 250 } as never));

    expect(item._id).toMatch(/^inv-/);
    expect(item.type).toBe('pharmacy_inventory');
    expect(item.medicationName).toBe('Amoxicillin 500mg');
    expect(item.stockLevel).toBe(200);
    expect(item.expiryDate).toBe('2027-01-01');
    expect(item.batchNumber).toBe('B-2026-01');
    expect((item as unknown as { unitPrice: number }).unitPrice).toBe(250);
    expect(item.dispensedToday).toBe(0);
    expect(item.createdAt).toBeTruthy();
    expect(item.updatedAt).toBeTruthy();

    const stored = await pharmacyInventoryDB().get(item._id) as PharmacyInventoryDoc;
    expect(stored.stockLevel).toBe(200);
  });
});

describe('getAllInventory', () => {
  it('sorts by medication name and applies tenant scope', async () => {
    await createInventoryItem(baseItem({ medicationName: 'Paracetamol 500mg' }));
    await createInventoryItem(baseItem({ medicationName: 'Amoxicillin 500mg' }));
    await createInventoryItem(baseItem({ medicationName: 'Ibuprofen 400mg', hospitalId: HOSP_B }));

    const all = await getAllInventory();
    expect(all.map(i => i.medicationName)).toEqual([
      'Amoxicillin 500mg', 'Ibuprofen 400mg', 'Paracetamol 500mg',
    ]);

    const scoped = await getAllInventory({ role: 'pharmacist', orgId: ORG, hospitalId: HOSP_A });
    expect(scoped.map(i => i.medicationName)).toEqual(['Amoxicillin 500mg', 'Paracetamol 500mg']);
  });
});

describe('updateInventoryItem', () => {
  it('updates stock/pricing fields but keeps the item pinned to its own org/facility', async () => {
    const item = await createInventoryItem(baseItem({ unitPrice: 100 } as never));

    const updated = await updateInventoryItem(item._id, {
      stockLevel: 150,
      unitPrice: 120,
      hospitalId: HOSP_B, // a caller cannot relocate stock to another facility via update
      orgId: 'org-other',
    } as never);

    expect(updated?.stockLevel).toBe(150);
    expect((updated as unknown as { unitPrice: number })?.unitPrice).toBe(120);
    expect(updated?.hospitalId).toBe(HOSP_A);
    expect(updated?.orgId).toBe(ORG);
  });

  it('returns null for an unknown id and for an item outside the caller scope', async () => {
    expect(await updateInventoryItem('inv-does-not-exist', { stockLevel: 5 })).toBeNull();

    const item = await createInventoryItem(baseItem());
    const result = await updateInventoryItem(
      item._id,
      { stockLevel: 5 },
      { role: 'pharmacist', orgId: ORG, hospitalId: HOSP_B },
    );
    expect(result).toBeNull();
    const stored = await pharmacyInventoryDB().get(item._id) as PharmacyInventoryDoc;
    expect(stored.stockLevel).toBe(200); // untouched
  });
});

describe('deleteInventoryItem', () => {
  it('removes the item and reports the outcome honestly', async () => {
    const item = await createInventoryItem(baseItem());
    expect(await deleteInventoryItem('inv-does-not-exist')).toBe(false);

    const removed = await deleteInventoryItem(item._id);
    expect(removed).toBe(true);
    await expect(pharmacyInventoryDB().get(item._id)).rejects.toThrow();
  });

  it('refuses to remove an item outside the caller scope', async () => {
    const item = await createInventoryItem(baseItem());
    const removed = await deleteInventoryItem(item._id, { role: 'pharmacist', orgId: ORG, hospitalId: HOSP_B });
    expect(removed).toBe(false);
    const stored = await pharmacyInventoryDB().get(item._id) as PharmacyInventoryDoc;
    expect(stored.stockLevel).toBe(200);
  });
});

describe('decrementStock', () => {
  it('decrements the named facility row and stamps today\'s dispensed counter', async () => {
    const item = await createInventoryItem(baseItem({ stockLevel: 40 }));

    await decrementStock('Amoxicillin 500mg', HOSP_A, 5);

    const stored = await pharmacyInventoryDB().get(item._id) as PharmacyInventoryDoc;
    expect(stored.stockLevel).toBe(35);
    expect(stored.dispensedToday).toBe(5);
    expect(stored.dispensedTodayDate).toBe(jubaDate());
    expect(stored.lastDispensed).toBeTruthy();
  });

  it('never falls back to another facility\'s row when a facility is specified', async () => {
    // Facility A holds no record of this drug; facility B does. A dispense at
    // A must not silently decrement B's shelf.
    const itemB = await createInventoryItem(baseItem({ hospitalId: HOSP_B, medicationName: 'Metformin 500mg', stockLevel: 60 }));

    await decrementStock('Metformin 500mg', HOSP_A, 3);

    const stored = await pharmacyInventoryDB().get(itemB._id) as PharmacyInventoryDoc;
    expect(stored.stockLevel).toBe(60); // untouched
  });

  it('is a no-op when the medication has no inventory row at all', async () => {
    await expect(decrementStock('Nonexistent Drug', HOSP_A, 1)).resolves.toBeUndefined();
  });

  it('survives concurrent decrements without losing an update (409 retry)', async () => {
    const item = await createInventoryItem(baseItem({ stockLevel: 10 }));

    await Promise.all([
      decrementStock('Amoxicillin 500mg', HOSP_A, 1),
      decrementStock('Amoxicillin 500mg', HOSP_A, 1),
      decrementStock('Amoxicillin 500mg', HOSP_A, 1),
    ]);

    const stored = await pharmacyInventoryDB().get(item._id) as PharmacyInventoryDoc;
    expect(stored.stockLevel).toBe(7); // all three decrements landed, none lost
    expect(stored.dispensedToday).toBe(3);
  });
});

describe('classifyStockStatus', () => {
  const today = jubaDate();
  const future = '2099-01-01';
  const past = '2000-01-01';

  it('flags an expired batch regardless of how much stock remains', () => {
    const item = { stockLevel: 500, reorderLevel: 20, expiryDate: past } as PharmacyInventoryDoc;
    expect(classifyStockStatus(item)).toBe('expired');
  });

  it('flags zero or negative stock as critical', () => {
    const item = { stockLevel: 0, reorderLevel: 20, expiryDate: future } as PharmacyInventoryDoc;
    expect(classifyStockStatus(item)).toBe('critical');
  });

  it('flags stock under 30% of the reorder level as critical even though it is > 0', () => {
    const item = { stockLevel: 5, reorderLevel: 20, expiryDate: future } as PharmacyInventoryDoc;
    expect(classifyStockStatus(item)).toBe('critical'); // 5 < 20*0.3=6
  });

  it('flags stock under the reorder level (but above the critical band) as low', () => {
    const item = { stockLevel: 15, reorderLevel: 20, expiryDate: future } as PharmacyInventoryDoc;
    expect(classifyStockStatus(item)).toBe('low');
  });

  it('reports adequate stock above the reorder level', () => {
    const item = { stockLevel: 25, reorderLevel: 20, expiryDate: future } as PharmacyInventoryDoc;
    expect(classifyStockStatus(item)).toBe('adequate');
  });

  it('treats an item with no expiry date on the stock-level rules alone', () => {
    const item = { stockLevel: 25, reorderLevel: 20, expiryDate: '' } as unknown as PharmacyInventoryDoc;
    expect(classifyStockStatus(item)).toBe('adequate');
  });

  it('is consistent with jubaDate() for "today" (not stale on an item expiring today)', () => {
    const item = { stockLevel: 25, reorderLevel: 20, expiryDate: today } as PharmacyInventoryDoc;
    // expiryDate < today is false when expiryDate === today, so it is not yet expired.
    expect(classifyStockStatus(item)).toBe('adequate');
  });
});

describe('dispensedTodayOf', () => {
  it('reads the counter only when its day-stamp is today', () => {
    expect(dispensedTodayOf({ dispensedToday: 12, dispensedTodayDate: jubaDate() })).toBe(12);
    expect(dispensedTodayOf({ dispensedToday: 12, dispensedTodayDate: '2000-01-01' })).toBe(0);
    expect(dispensedTodayOf({ dispensedToday: 12, dispensedTodayDate: undefined })).toBe(0);
  });
});
