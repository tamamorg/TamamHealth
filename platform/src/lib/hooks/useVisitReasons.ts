'use client';

/**
 * useVisitReasons — the bookable service menu for the signed-in user's facility.
 *
 * Read-only: reasons are authored on the booking settings screen, not from the
 * booking form.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context';
import type { PatientClass, VisitReasonDoc } from '../db-types-booking';

export function useVisitReasons(facilityIdOverride?: string) {
  const { currentUser } = useAuth();
  const facilityId = facilityIdOverride ?? currentUser?.hospitalId;
  const orgId = currentUser?.orgId;

  const [reasons, setReasons] = useState<VisitReasonDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!facilityId) {
      setReasons([]);
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const { getVisitReasonsForFacility } = await import('../services/visit-reason-service');
      setReasons(await getVisitReasonsForFacility(facilityId, orgId));
    } catch (err) {
      console.error('[useVisitReasons]', err);
      setError('Could not load visit reasons');
      setReasons([]);
    } finally {
      setLoading(false);
    }
  }, [facilityId, orgId]);

  useEffect(() => { load(); }, [load]);

  /** Only the reasons a given kind of booker may pick. */
  const bookableBy = useCallback(
    (patientClass: PatientClass) => reasons.filter(r => (
      patientClass === 'new' ? r.availableToNewPatients : r.availableToReturningPatients
    )),
    [reasons],
  );

  return {
    reasons,
    /** True when the facility has no service menu configured yet. */
    unconfigured: !loading && reasons.length === 0,
    bookableBy,
    loading,
    error,
    reload: load,
    byId: useMemo(() => new Map(reasons.map(r => [r._id, r])), [reasons]),
  };
}
