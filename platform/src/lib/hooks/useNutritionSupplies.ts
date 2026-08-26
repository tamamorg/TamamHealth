'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { makeCoalescer } from './live-reload';
import type {
  NutritionSupplyDoc,
  CreateSupplyInput,
  SeedSupplyItem,
} from '../services/nutrition-supply-service';
import { nutritionSuppliesDB } from '../db';
import { useDataScope } from './useDataScope';

export interface UseNutritionSuppliesOptions {
  /**
   * Starter items to persist once as real docs if the store is empty.
   * Pass this only in demo mode — omit (or pass an empty array) in
   * production so an empty facility renders an honest empty state instead
   * of being auto-populated with sample stock.
   */
  demoSeed?: SeedSupplyItem[];
}

/** Nutrition supply inventory, name-sorted, live-reloaded on changes. */
export function useNutritionSupplies(options: UseNutritionSuppliesOptions = {}) {
  const { demoSeed } = options;
  const [items, setItems] = useState<NutritionSupplyDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();
  const seedAttempted = useRef(false);

  const load = useCallback(async () => {
    if (!scope) { setItems([]); setLoading(false); return; }
    try {
      setError(null);
      const { getAllSupplies } = await import('../services/nutrition-supply-service');
      const data = await getAllSupplies(scope);
      if (data.length === 0 && demoSeed && demoSeed.length > 0 && !seedAttempted.current) {
        seedAttempted.current = true;
        const { seedSuppliesIfEmpty } = await import('../services/nutrition-supply-service');
        await seedSuppliesIfEmpty(demoSeed, { hospitalId: scope.hospitalId, orgId: scope.orgId });
        const seeded = await getAllSupplies(scope);
        setItems(seeded);
        return;
      }
      setItems(data);
    } catch (err) {
      console.error(err);
      setError('Failed to load nutrition supply inventory');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [scope, demoSeed]);

  useEffect(() => { load(); }, [load]);

  // Live subscription so the supplies card stays in sync with adjustments
  // recorded from another tab/device.
  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) load(); });
    const changes = nutritionSuppliesDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', () => { /* swallow */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [load]);

  const create = useCallback(async (data: CreateSupplyInput) => {
    const { createSupplyItem } = await import('../services/nutrition-supply-service');
    const item = await createSupplyItem(data);
    await load();
    return item;
  }, [load]);

  const adjust = useCallback(async (id: string, delta: number, actor?: { id?: string; name?: string }) => {
    const { adjustSupplyLevel } = await import('../services/nutrition-supply-service');
    const item = await adjustSupplyLevel(id, delta, actor);
    await load();
    return item;
  }, [load]);

  return { items, loading, error, create, adjust, reload: load };
}
