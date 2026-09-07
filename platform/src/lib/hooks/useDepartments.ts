'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DepartmentDoc } from '@/modules/departments/client';
import { useDataScope } from './useDataScope';

export function useDepartments(facilityId?: string, orgId?: string) {
  const scope = useDataScope();
  const [departments, setDepartments] = useState<DepartmentDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!scope) { setDepartments([]); setLoading(false); return; }
    try {
      setError(null);
      const { getDepartments } = await import('@/modules/departments/services/department-service');
      const rows = await getDepartments({
        ...scope,
        orgId: orgId || scope.orgId,
        hospitalId: facilityId || scope.hospitalId,
      });
      setDepartments(facilityId ? rows.filter(item => item.facilityId === facilityId) : rows);
    } catch (cause) {
      console.error(cause);
      setError('departments.loadError');
    } finally {
      setLoading(false);
    }
  }, [facilityId, orgId, scope]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    let cancelled = false;
    let changes: { cancel: () => void } | undefined;
    void import('@/lib/db').then(({ hospitalsDB }) => {
      if (cancelled) return;
      changes = hospitalsDB().changes({ since: 'now', live: true, include_docs: false })
        .on('change', (change: { id?: string }) => { if (change.id?.startsWith('department:')) void reload(); })
        .on('error', () => undefined);
    });
    return () => { cancelled = true; try { changes?.cancel(); } catch { /* noop */ } };
  }, [reload]);

  return { departments, loading, error, reload };
}
