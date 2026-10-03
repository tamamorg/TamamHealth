/**
 * The prescriber's view of the shelf. Each case is a way the old first-word
 * match in the prescribing dialog told the prescriber something untrue.
 */
import { cannotFillOnSite, stockLineMatches, stockPositionFor } from '@/lib/pharmacy-stock-position';
import type { PharmacyInventoryDoc } from '@/lib/db-types';

const TODAY = '2026-10-03';

function line(overrides: Partial<PharmacyInventoryDoc>): PharmacyInventoryDoc {
  return {
    _id: `inv-${Math.random().toString(36).slice(2)}`,
    type: 'pharmacy_inventory',
    hospitalId: 'hosp-001',
    hospitalName: 'Wau State Hospital',
    medicationName: 'Amoxicillin 500mg',
    category: 'Antibiotic',
    stockLevel: 100,
    unit: 'capsules',
    reorderLevel: 40,
    batchNumber: 'B-1',
    expiryDate: '2027-06-30',
    dispensedToday: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as PharmacyInventoryDoc;
}

describe('stockPositionFor', () => {
  it('reports an adequately stocked medicine as ok', () => {
    const p = stockPositionFor('Amoxicillin', [line({})], 21, { today: TODAY });
    expect(p.state).toBe('ok');
    expect(p.available).toBe(100);
    expect(p.unit).toBe('capsules');
    expect(cannotFillOnSite(p)).toBe(false);
  });

  it('sums every in-date batch instead of reading the first line', () => {
    const p = stockPositionFor('Amoxicillin', [
      line({ stockLevel: 8, batchNumber: 'B-1', expiryDate: '2026-12-01' }),
      line({ stockLevel: 30, batchNumber: 'B-2', expiryDate: '2027-03-01' }),
    ], 20, { today: TODAY });
    expect(p.available).toBe(38);
    // 38 covers 20, and 38 <= reorder 40.
    expect(p.state).toBe('low');
    expect(p.soonestBatch).toBe('B-1');
    expect(p.soonestExpiry).toBe('2026-12-01');
  });

  it('flags a prescription larger than the shelf as short', () => {
    const p = stockPositionFor('Amoxicillin', [line({ stockLevel: 10 })], 60, { today: TODAY });
    expect(p.state).toBe('short');
    expect(p.available).toBe(10);
    expect(p.requested).toBe(60);
    expect(cannotFillOnSite(p)).toBe(true);
  });

  it('flags low stock at or below the reorder level', () => {
    expect(stockPositionFor('Amoxicillin', [line({ stockLevel: 40 })], 1, { today: TODAY }).state).toBe('low');
    expect(stockPositionFor('Amoxicillin', [line({ stockLevel: 41 })], 1, { today: TODAY }).state).toBe('ok');
  });

  it('reports a carried medicine with nothing on hand as out', () => {
    const p = stockPositionFor('Amoxicillin', [line({ stockLevel: 0 })], 1, { today: TODAY });
    expect(p.state).toBe('out');
    expect(cannotFillOnSite(p)).toBe(true);
  });

  it('never counts expired batches, and says so when they are all that is left', () => {
    const p = stockPositionFor('Amoxicillin', [line({ stockLevel: 50, expiryDate: '2026-09-30' })], 1, { today: TODAY });
    expect(p.available).toBe(0);
    expect(p.state).toBe('expired');
  });

  it('does not let a combination product answer for the single drug', () => {
    const shelf = [line({ medicationName: 'Amoxicillin-Clavulanate 625mg', stockLevel: 200 })];
    expect(stockPositionFor('Amoxicillin', shelf, 1, { today: TODAY }).state).toBe('not_stocked');
    expect(stockPositionFor('Artesunate (injection)', [
      line({ medicationName: 'Artesunate-Amodiaquine', stockLevel: 90 }),
    ], 1, { today: TODAY }).state).toBe('not_stocked');
  });

  it('keeps strengths apart when both names state one', () => {
    expect(stockLineMatches('Amoxicillin 250mg', 'Amoxicillin 500mg')).toBe(false);
    expect(stockLineMatches('Amoxicillin 500 mg', 'Amoxicillin 500mg')).toBe(true);
    // The formulary mostly omits strength; that must still match the shelf.
    expect(stockLineMatches('Amoxicillin', 'Amoxicillin 500mg')).toBe(true);
  });

  it('counts only the prescriber\'s facility when a scope spans several', () => {
    const shelf = [
      line({ hospitalId: 'hosp-001', stockLevel: 0 }),
      line({ hospitalId: 'hosp-002', stockLevel: 500 }),
    ];
    expect(stockPositionFor('Amoxicillin', shelf, 1, { today: TODAY, facilityId: 'hosp-001' }).state).toBe('out');
    expect(stockPositionFor('Amoxicillin', shelf, 1, { today: TODAY, facilityId: 'hosp-002' }).state).toBe('ok');
  });

  it('says untracked, not "not stocked", when the facility keeps no inventory', () => {
    expect(stockPositionFor('Amoxicillin', [], 1, { today: TODAY }).state).toBe('untracked');
    expect(stockPositionFor('Amoxicillin', [line({ hospitalId: 'hosp-002' })], 1, {
      today: TODAY, facilityId: 'hosp-001',
    }).state).toBe('untracked');
    expect(cannotFillOnSite(stockPositionFor('Amoxicillin', [], 1, { today: TODAY }))).toBe(false);
  });

  it('carries the controlled-drug flags of the matching lines', () => {
    const p = stockPositionFor('Morphine', [
      line({ medicationName: 'Morphine 10mg/mL injection', controlledSchedule: 'II', requiresWitness: true, unit: 'ampoules' }),
    ], 1, { today: TODAY });
    expect(p.controlledSchedule).toBe('II');
    expect(p.requiresWitness).toBe(true);
  });

  it('treats a missing or nonsense quantity as one unit', () => {
    expect(stockPositionFor('Amoxicillin', [line({ stockLevel: 100 })], Number.NaN, { today: TODAY }).requested).toBe(1);
    expect(stockPositionFor('Amoxicillin', [line({ stockLevel: 100 })], 0, { today: TODAY }).requested).toBe(1);
  });
});
