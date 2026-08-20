import { pharmacyInventoryDB } from '../db';
import type { PharmacyInventoryDoc } from '../db-types';
import { v4 as uuidv4 } from 'uuid';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { jubaDate } from '../time-juba';
import { findByType } from './db-query';

export async function getAllInventory(scope?: DataScope): Promise<PharmacyInventoryDoc[]> {
  const db = pharmacyInventoryDB();
  const all = (await findByType<PharmacyInventoryDoc>(db, 'pharmacy_inventory'))
    .sort((a, b) => a.medicationName.localeCompare(b.medicationName));
  return scope ? filterByScope(all, scope) : all;
}

export async function createInventoryItem(
  data: Omit<PharmacyInventoryDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt' | 'dispensedToday'>
): Promise<PharmacyInventoryDoc> {
  const db = pharmacyInventoryDB();
  const now = new Date().toISOString();
  const doc: PharmacyInventoryDoc = {
    _id: `inv-${uuidv4()}`,
    type: 'pharmacy_inventory',
    dispensedToday: 0,
    ...data,
    createdAt: now,
    updatedAt: now,
  };
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe('PHARMACY_STOCK_IN', undefined, undefined,
    `${data.medicationName} stocked: ${data.stockLevel} ${data.unit} (batch ${data.batchNumber})`
  );
  emitSyncEvent({
    resourceType: 'pharmacy_inventory',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.hospitalId,
  });
  return doc;
}

export async function updateInventoryItem(
  id: string,
  updates: Partial<PharmacyInventoryDoc>,
  scope?: DataScope,
): Promise<PharmacyInventoryDoc | null> {
  const db = pharmacyInventoryDB();
  try {
    const existing = await db.get(id) as PharmacyInventoryDoc;
    if (scope && filterByScope([existing], scope).length === 0) return null;
    const updated = {
      ...existing,
      ...updates,
      orgId: existing.orgId,
      hospitalId: existing.hospitalId,
      updatedAt: new Date().toISOString(),
    };
    const resp = await db.put(updated);
    updated._rev = resp.rev;
    emitSyncEvent({
      resourceType: 'pharmacy_inventory',
      resourceId: updated._id,
      operation: 'update',
      resourceVersion: updated._rev,
      orgId: updated.orgId,
      hospitalId: updated.hospitalId,
    });
    return updated;
  } catch {
    return null;
  }
}

/**
 * Decrement stock for a medication by name (best-effort match).
 * Called by the pharmacy page when a prescription is dispensed.
 * If the medication isn't in inventory (e.g. new drug), this is a no-op.
 *
 * Two pharmacists dispensing the same medication at the same time used to
 * cause a lost-update: each read stockLevel=N, each wrote stockLevel=N-1, so
 * one decrement evaporated. PouchDB rejects the second put with a 409
 * conflict (mismatched _rev), but the previous implementation didn't catch
 * it and silently lost the second decrement. We now retry up to 5 times,
 * re-reading the latest doc each round so the second writer sees the
 * post-first-decrement stock and applies its own decrement on top.
 */
export async function decrementStock(
  medicationName: string,
  hospitalId: string | undefined,
  quantity: number = 1,
  scope?: DataScope,
): Promise<void> {
  const db = pharmacyInventoryDB();
  const MAX_RETRIES = 5;

  // Locate the target row once. Subsequent retries refetch *that specific
  // row* by _id so we keep narrowing the window.
  const items = await findByType<PharmacyInventoryDoc>(
    db,
    'pharmacy_inventory',
    { medicationName },
    { indexFields: ['type', 'medicationName'] },
  );
  const visibleItems = scope ? filterByScope(items, scope) : items;
  // When a facility is supplied, never fall back to another facility's row.
  // The old fallback let a dispense at facility A decrement the first matching
  // medication in facility B when A had no local stock record.
  const initial = visibleItems.find(i => i.hospitalId === hospitalId)
    || (!hospitalId ? visibleItems[0] : undefined);
  if (!initial) return;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // On retry, refetch the freshest revision so we apply our decrement on
    // top of whatever the previous winner committed.
    const target = attempt === 0
      ? initial
      : (await db.get(initial._id) as PharmacyInventoryDoc);
    const now = new Date().toISOString();
    const updated: PharmacyInventoryDoc = {
      ...target,
      stockLevel: Math.max(0, (target.stockLevel || 0) - quantity),
      dispensedToday: (target.dispensedToday || 0) + quantity,
      lastDispensed: now,
      updatedAt: now,
    };
    try {
      const resp = await db.put(updated);
      emitSyncEvent({
        resourceType: 'pharmacy_inventory',
        resourceId: updated._id,
        operation: 'update',
        resourceVersion: resp.rev,
        orgId: updated.orgId,
        hospitalId: updated.hospitalId,
      });
      return;
    } catch (err: unknown) {
      // 409 = revision conflict from a concurrent put. Retry by re-reading.
      const status = (err as { status?: number }).status;
      if (status === 409 && attempt < MAX_RETRIES - 1) continue;
      throw err;
    }
  }
}

export async function deleteInventoryItem(id: string, scope?: DataScope): Promise<boolean> {
  const db = pharmacyInventoryDB();
  try {
    const doc = await db.get(id);
    const typed = doc as unknown as PharmacyInventoryDoc;
    if (scope && filterByScope([typed], scope).length === 0) return false;
    await db.remove(doc);
    emitSyncEvent({
      resourceType: 'pharmacy_inventory',
      resourceId: id,
      operation: 'delete',
      orgId: typed.orgId,
      hospitalId: typed.hospitalId,
    });
    return true;
  } catch {
    return false;
  }
}

export function classifyStockStatus(item: PharmacyInventoryDoc): 'adequate' | 'low' | 'critical' | 'expired' {
  const today = jubaDate();
  if (item.expiryDate && item.expiryDate < today) return 'expired';
  if (item.stockLevel <= 0) return 'critical';
  if (item.stockLevel < item.reorderLevel * 0.3) return 'critical';
  if (item.stockLevel < item.reorderLevel) return 'low';
  return 'adequate';
}
