'use client';

/**
 * Live per-facility patient/visit counts — see facility-census.ts for why
 * this exists (the stored HospitalDoc.patientCount/todayVisits fields it
 * replaces were write-once-zero). `null` until loaded, so callers can render
 * '…' instead of a false 0 while counting.
 */

import { useEffect, useState } from 'react';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { getFacilityCensus, type FacilityCensusEntry } from '@/lib/services/facility-census';

export function useFacilityCensus(): { census: Map<string, FacilityCensusEntry> | null; loading: boolean } {
  const scope = useDataScope();
  const [census, setCensus] = useState<Map<string, FacilityCensusEntry> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!scope) {
      setCensus(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const map = await getFacilityCensus(scope);
        if (!cancelled) setCensus(map);
      } catch (err) {
        console.error('Failed to compute facility census:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [scope]);

  return { census, loading };
}
