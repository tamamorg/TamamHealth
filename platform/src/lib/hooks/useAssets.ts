'use client';

import { useTranslation } from '../i18n/useTranslation';
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
  const { t } = useTranslation();
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
      setError('msg.assetsNotLoaded');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  usePouchLiveReload({ load, database: assetsDB });

  const create = useCallback(async (input: Parameters<typeof import('../services/asset-service').createAsset>[0]) => {
    const { createAsset } = await import('../services/asset-service');
    // Stamp the tenant from the active data scope when the caller didn't supply
    // one. Without it the asset doc had no orgId, so the sync validator refused
    // it ("orgId is required") and filterByScope hid it from its own creator —
    // the equipment page showed "registered" for a record that never saved
    // (security/data audit 2026-11-05, §2.1 #10).
    const doc = await createAsset({ ...input, orgId: input.orgId ?? scope?.orgId });
    await load();
    return doc;
  }, [load, scope?.orgId]);

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

  const update = useCallback(async (id: string, updates: Partial<AssetDoc>) => {
    const { updateAsset } = await import('../services/asset-service');
    const doc = await updateAsset(id, updates);
    await load();
    return doc;
  }, [load]);

  const remove = useCallback(async (id: string) => {
    const { deleteAsset } = await import('../services/asset-service');
    const ok = await deleteAsset(id);
    await load();
    return ok;
  }, [load]);

  return { assets, summary, loading, error: error && t(error), create, update, remove, setStatus, logService, reload: load };
}
