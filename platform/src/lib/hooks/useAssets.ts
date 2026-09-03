'use client';

import { useState, useCallback } from 'react';
import { usePouchLiveReload } from './usePouchLiveReload';
import type { AssetDoc } from '../db-types-asset';
import { assetsDB } from '../db';
import { useDataScope } from './useDataScope';

export function useAssets() {
  const [assets, setAssets] = useState<AssetDoc[]>([]);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof import('../services/asset-service').getAssetSummary>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const load = useCallback(async () => {
    if (!scope) { setAssets([]); setLoading(false); return; }
    try {
      setError(null);
      const { getAllAssets, getAssetSummary } = await import('../services/asset-service');
      const [a, s] = await Promise.all([getAllAssets(scope), getAssetSummary(scope)]);
      setAssets(a);
      setSummary(s);
    } catch (err) {
      console.error('Failed to load assets', err);
      setError('Failed to load assets');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  usePouchLiveReload({ load, database: assetsDB });

  const create = useCallback(async (input: Parameters<typeof import('../services/asset-service').createAsset>[0]) => {
    const { createAsset } = await import('../services/asset-service');
    const doc = await createAsset(input);
    await load();
    return doc;
  }, [load]);

  const setStatus = useCallback(async (id: string, status: AssetDoc['status'], actor: { id: string; name: string }) => {
    const { setAssetStatus } = await import('../services/asset-service');
    const doc = await setAssetStatus(id, status, actor);
    await load();
    return doc;
  }, [load]);

  const logService = useCallback(async (id: string, entry: Parameters<typeof import('../services/asset-service').logMaintenance>[1]) => {
    const { logMaintenance } = await import('../services/asset-service');
    const doc = await logMaintenance(id, entry);
    await load();
    return doc;
  }, [load]);

  return { assets, summary, loading, error, create, setStatus, logService, reload: load };
}
