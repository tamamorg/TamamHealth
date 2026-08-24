'use client';

import { useMemo } from 'react';
import { useApp } from '../context';
import type { DataScope } from '../services/data-scope';

/**
 * Returns the current user's DataScope (org + entitled facilities + role) for
 * passing into service calls. Returns undefined when there is no user
 * (e.g. pre-login, pre-hydration) so callers can early-return gracefully.
 *
 * Memoized on orgId/facilities/role so consumers that depend on `scope`
 * don't churn their own callbacks/effects on unrelated context changes.
 */
export function useDataScope(): DataScope | undefined {
  const { currentUser } = useApp();
  return useMemo(
    () =>
      currentUser
        ? {
            orgId: currentUser.orgId,
            hospitalId: currentUser.hospitalId,
            facilityIds: currentUser.facilityIds,
            role: currentUser.role,
          }
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentUser?.orgId, currentUser?.hospitalId, currentUser?.facilityIds, currentUser?.role],
  );
}
