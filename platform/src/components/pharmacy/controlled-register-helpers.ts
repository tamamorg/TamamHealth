import type { PharmacyInventoryDoc } from '@/lib/db-types';

/**
 * Match a typed medication name to the facility's controlled-stock items
 * (exact, case-insensitive) so a controlled-substance register movement can
 * carry the item's REAL inventory id, letting the register reconcile against
 * real balances instead of a synthetic per-name id (security audit 2026-11-05,
 * §2.1 #7). Returns undefined for a free-hand / off-catalogue name.
 */
export function matchControlledInventoryItem(
  name: string,
  items: readonly PharmacyInventoryDoc[],
): PharmacyInventoryDoc | undefined {
  const n = name.trim().toLowerCase();
  if (!n) return undefined;
  return items.find(i => i.medicationName.trim().toLowerCase() === n);
}

/** The inventory id a register movement is recorded against: the matched item's
 *  real id, or a synthetic per-name id when the drug is off-catalogue. */
export function registerInventoryId(selectedInventoryId: string, medicationName: string): string {
  if (selectedInventoryId) return selectedInventoryId;
  const slug = medicationName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `csub-${slug || 'item'}`;
}
