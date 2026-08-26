'use client';

import { useState, useEffect, useCallback } from 'react';
import { makeCoalescer } from './live-reload';
import type { PharmacyInventoryDoc } from '../db-types';
import { pharmacyInventoryDB } from '../db';
import { useDataScope } from './useDataScope';

export function usePharmacyInventory() {
  const [items, setItems] = useState<PharmacyInventoryDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const load = useCallback(async () => {
    if (!scope) { setItems([]); setLoading(false); return; }
    try {
      setError(null);
      const { getAllInventory } = await import('../services/pharmacy-inventory-service');
      const data = await getAllInventory(scope);
      setItems(data);
    } catch (err) {
      console.error(err);
      setError('Failed to load pharmacy inventory');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { load(); }, [load]);

  // Live subscription so the pharmacy page stays in sync with stock changes
  // (e.g. dispense triggered from a different browser tab, or a receipt
  // recorded by the pharmacist in parallel).
  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) load(); });
    const changes = pharmacyInventoryDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', () => { /* swallow */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [load]);

  const create = useCallback(async (
    data: Omit<PharmacyInventoryDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt' | 'dispensedToday'>
  ) => {
    const { createInventoryItem } = await import('../services/pharmacy-inventory-service');
    const item = await createInventoryItem(data);
    await load();
    return item;
  }, [load]);

  const update = useCallback(async (id: string, updates: Partial<PharmacyInventoryDoc>) => {
    const { updateInventoryItem } = await import('../services/pharmacy-inventory-service');
    const item = await updateInventoryItem(id, updates);
    await load();
    return item;
  }, [load]);

  const remove = useCallback(async (id: string) => {
    const { deleteInventoryItem } = await import('../services/pharmacy-inventory-service');
    const ok = await deleteInventoryItem(id);
    await load();
    return ok;
  }, [load]);

  return { items, loading, error, create, update, remove, reload: load };
}
