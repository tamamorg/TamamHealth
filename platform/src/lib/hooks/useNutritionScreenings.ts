'use client';

import { useState, useCallback } from 'react';
import { usePouchLiveReload } from './usePouchLiveReload';
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
    if (!scope) { setScreenings([]); setLoading(false); return; }
    try {
      const { getAllNutritionScreenings } = await import('../services/nutrition-screening-service');
      setScreenings(await getAllNutritionScreenings(scope));
    } catch {
      setScreenings([]);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  usePouchLiveReload({ load, database: nutritionScreeningsDB });

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
    if (!scope) throw new Error('Your session has no tenant scope; sign in again.');
    const doc = await updateNutritionScreening(id, scope, patch);
    await load();
    return doc;
  }, [load, scope]);

  return { screenings, loading, add, update, reload: load };
}
