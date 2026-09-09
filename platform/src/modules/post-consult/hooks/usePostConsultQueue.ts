'use client';
import { useEffect, useState } from 'react';
import { useDataScope } from '@/lib/hooks/useDataScope';
import type { EncounterDoc } from '@/lib/db-types';
import { getHandoffQueue } from '../services/handoff-service';

export function usePostConsultQueue() {
  const scope = useDataScope();
  const [rows, setRows] = useState<EncounterDoc[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    async function refresh() {
      if (!scope) { if (active) setRows([]); return; }
      try {
        const next = await getHandoffQueue(scope);
        if (active) { setRows(next); setError(false); }
      } catch { if (active) { setRows([]); setError(true); } }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => { active = false; clearInterval(timer); };
  }, [scope]);
  return { rows, error };
}
