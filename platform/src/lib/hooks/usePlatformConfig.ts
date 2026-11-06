'use client';

import { useState, useEffect, useCallback } from 'react';
import type { PlatformConfigDoc } from '../db-types';

export function usePlatformConfig() {
  const [config, setConfig] = useState<PlatformConfigDoc | null>(null);
  const [loading, setLoading] = useState(true);

  const loadConfig = useCallback(async () => {
    try {
      const { getPlatformConfig } = await import('../services/platform-config-service');
      const data = await getPlatformConfig();
      setConfig(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const update = useCallback(async (
    data: Partial<PlatformConfigDoc>,
    // Kept for call-site compatibility; the server now stamps the actor from the
    // verified auth claim, so these are no longer sent.
    _actorId?: string, _actorUsername?: string
  ) => {
    // platform_config lives in a PULL-ONLY database: a browser write to the
    // local copy never replicates up, so feature flags, security policies and
    // configuration looked changed on this device but reached no one else, and
    // a second super-admin saw stale values (security/data audit 2026-11-05,
    // §2.1 #11). Write through the server, which owns the canonical doc and
    // replicates it back down to every device.
    const { apiFetch } = await import('../api-fetch');
    const res = await apiFetch('/api/platform-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      throw new Error(`Platform configuration not saved (HTTP ${res.status})`);
    }
    const { config: updated } = await res.json() as { config: PlatformConfigDoc };
    setConfig(updated);
    return updated;
  }, []);

  return { config, loading, update, reload: loadConfig };
}
