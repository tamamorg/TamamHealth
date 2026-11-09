/**
 * The pharmacy Reorder list. A line is a batch. Expired batches do not count
 * as stock, so a medicine whose shelf is partly or wholly expired still needs
 * replacing, and the pharmacist is told how much to remove ("N expired -
 * replace"). Stock position and dispensing already ignore expired batches;
 * this keeps the Reorder view agreeing with them.
 */
import type { PharmacyInventoryDoc } from './db-types';

/** An inventory line with its live status (adequate, low, critical, expired). */
export type InventoryLine = PharmacyInventoryDoc & { status: string };

export interface ReorderRow {
  item: InventoryLine;
  /** In-date units of this line (0 for an expired-only medicine). */
  onHand: number;
  /** Expired units of the same medicine at the same facility, to replace. */
  expiredQty: number;
  /** Row status: the line's own, or 'expired' when only expired stock remains. */
  status: string;
}

export function isExpiredLine(i: { status?: string; expiryDate?: string }, today: string): boolean {
  return i.status === 'expired' || (!!i.expiryDate && i.expiryDate < today);
}

const keyOf = (i: InventoryLine) => `${i.hospitalId || ''}|${(i.medicationName || '').trim().toLowerCase()}`;

export function buildReorderRows(
  inventory: InventoryLine[],
  options: { today: string; reorderCoverDays?: number },
): ReorderRow[] {
  const { today, reorderCoverDays = 0 } = options;
  const groups = new Map<string, { live: InventoryLine[]; expiredQty: number; firstExpired?: InventoryLine }>();
  for (const i of inventory) {
    const g = groups.get(keyOf(i)) || { live: [], expiredQty: 0 };
    if (isExpiredLine(i, today)) {
      if (i.stockLevel > 0) {
        g.expiredQty += i.stockLevel;
        g.firstExpired = g.firstExpired || i;
      }
    } else g.live.push(i);
    groups.set(keyOf(i), g);
  }
  const rows: ReorderRow[] = [];
  for (const g of groups.values()) {
    const needs = g.live.filter(i => i.status === 'low' || i.status === 'critical'
      || (reorderCoverDays > 0 && i.reorderLevel > 0 && i.stockLevel < (i.reorderLevel / 30) * reorderCoverDays));
    if (needs.length > 0) {
      // The expired units are named once, on the neediest line of the medicine.
      const lead = needs.reduce((a, b) => (b.stockLevel < a.stockLevel ? b : a));
      for (const i of needs) rows.push({ item: i, onHand: i.stockLevel, expiredQty: i === lead ? g.expiredQty : 0, status: i.status });
    } else if (g.expiredQty > 0) {
      // In-date stock is fine (or none): expired units alone make it a row.
      const lead = g.live[0];
      rows.push(lead
        ? { item: lead, onHand: lead.stockLevel, expiredQty: g.expiredQty, status: lead.status }
        : { item: g.firstExpired!, onHand: 0, expiredQty: g.expiredQty, status: 'expired' });
    }
  }
  return rows;
}
