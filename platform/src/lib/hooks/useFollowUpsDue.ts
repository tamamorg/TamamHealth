'use client';

import { useState, useCallback } from 'react';
import { usePouchLiveReload } from './usePouchLiveReload';
import type { FollowUpDoc } from '../db-types';
import { followUpsDB } from '../db';
import { useDataScope } from './useDataScope';
import { toIsoDate } from '@/lib/date-utils';

// A follow-up counts as "due" here when it's scheduled today or within this
// many days out — mirrors the window the doctor worklist rail (dashboard
// page's "Follow-ups due" item) re-checks against its own injected `now`.
const DUE_WINDOW_DAYS = 3;

/**
 * Community-health follow-ups (CHV/Boma worker managed) that are due — or
 * nearly due — for this clinician's org/hospital. Feeds the doctor
 * worklist's "Follow-ups due" outstanding-items rail so a follow-up that's
 * about to lapse into a missed home visit surfaces to the clinical team,
 * not just the assigned community worker.
 *
 * Modeled on useReferrals: org/hospital-scoped load + a live PouchDB
 * `changes()` subscription so a follow-up created, completed, or
 * rescheduled anywhere in the app is reflected here without polling.
 */
export function useFollowUpsDue() {
  const [followUpsDue, setFollowUpsDue] = useState<FollowUpDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const load = useCallback(async () => {
    if (!scope) { setFollowUpsDue([]); setLoading(false); return; }
    try {
      setError(null);
      const { getPendingFollowUps } = await import('../services/follow-up-service');
      // No workerId — this narrows by org/hospital only (getPendingFollowUps'
      // own filterByScope), the same scoping every other worklist rail uses.
      // getPendingFollowUps also returns 'missed' follow-ups; only 'active'
      // ones belong on this rail, so that's filtered out here too.
      const pending = await getPendingFollowUps(undefined, scope);
      // Local calendar, not UTC — `scheduledDate` is a local date string, and
      // a UTC slice shifts the window boundary by a day east of UTC.
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + DUE_WINDOW_DAYS);
      const cutoffIso = toIsoDate(cutoff);
      setFollowUpsDue(
        pending.filter(f => f.status === 'active' && (f.scheduledDate || '') <= cutoffIso)
      );
    } catch (err) {
      console.error('Failed to load follow-ups due', err);
      setError('Failed to load follow-ups due');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  // Live PouchDB subscription: re-load when a follow-up is created,
  // completed, or rescheduled anywhere in the app. Replaces polling.
  usePouchLiveReload({ load, database: followUpsDB });

  return { followUpsDue, loading, error, reload: load };
}
