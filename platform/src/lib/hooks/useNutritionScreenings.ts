'use client';

import { useState, useEffect, useCallback } from 'react';
import { makeCoalescer } from './live-reload';
import type { NutritionScreeningDoc } from '../db-types';
import { nutritionScreeningsDB } from '../db';
import type { AddNutritionScreeningInput } from '../services/nutrition-screening-service';
import { useDataScope } from './useDataScope';

/** Nutrition screenings in the current user's scope, newest first, live-reloaded on changes. */
export function useNutritionScreenings() {
  const [screenings, setScreenings] = useState<NutritionScreeningDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const scope = useDataScope();

  const load = useCallback(async () => {
    try {
      const { getAllNutritionScreenings } = await import('../services/nutrition-screening-service');
      setScreenings(await getAllNutritionScreenings(scope));
    } catch {
      setScreenings([]);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) load(); });
    const changes = nutritionScreeningsDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', () => { /* swallow */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [load]);

  const add = useCallback(async (input: AddNutritionScreeningInput) => {
    const { addNutritionScreening } = await import('../services/nutrition-screening-service');
    const doc = await addNutritionScreening(input);
    await load();
    return doc;
  }, [load]);

  const update = useCallback(async (
    id: string,
    patch: Partial<Pick<NutritionScreeningDoc, 'notes' | 'followUpAction' | 'followUpAt'>>,
  ) => {
    const { updateNutritionScreening } = await import('../services/nutrition-screening-service');
    const doc = await updateNutritionScreening(id, patch);
    await load();
    return doc;
  }, [load]);

  return { screenings, loading, add, update, reload: load };
}
