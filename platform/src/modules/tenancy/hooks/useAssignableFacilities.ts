'use client';

import { useCallback, useEffect, useState } from 'react';
import type { HospitalDoc } from '@/lib/db-types';
import { describeError } from '@/lib/user-facing-error';

/**
 * Facilities that the central identity service can assign immediately.
 *
 * This deliberately has no PouchDB fallback. Offline facility lists are useful
 * for clinical reads, but showing a local-only record in a central account
 * form creates a choice the server cannot honour.
 */
export function useAssignableFacilities(orgId?: string, enabled = true) {
  const [facilities, setFacilities] = useState<HospitalDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled || !orgId) {
      setFacilities([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { apiFetch } = await import('@/lib/api-fetch');
      const response = await apiFetch(`/api/hospitals/assignment-options?orgId=${encodeURIComponent(orgId)}`);
      const body = await response.json().catch(() => ({})) as { facilities?: HospitalDoc[]; error?: string };
      if (!response.ok) throw new Error(body.error || `Facility list not loaded (server code ${response.status}). Reload the page to try again.`);
      setFacilities(Array.isArray(body.facilities) ? body.facilities : []);
    } catch (cause) {
      setFacilities([]);
      setError(describeError(cause, 'Facility list not loaded. Reload the page to try again.'));
    } finally {
      setLoading(false);
    }
  }, [enabled, orgId]);

  useEffect(() => { void reload(); }, [reload]);

  return { facilities, loading, error, reload };
}
