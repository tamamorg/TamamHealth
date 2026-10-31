'use client';

/**
 * ConnectivityNotice — announces transitions in the sync/online state as
 * ordinary toasts. Mounted once in the dashboard layout; renders nothing.
 *
 * Triggers:
 *  - isOnline flips (going online / going offline)
 *  - syncStatus.state transitions to 'error' (with the underlying message)
 *  - the server refuses a pushed record (named, with the validator's reason)
 *  - User-initiated pause/resume (via the toggleOnline preference flipping)
 *
 * A repeat of the same notice restarts the existing toast, so a flapping
 * connection doesn't bombard the user.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useToast, type ToastType } from '@/components/Toast';
import { useAuth, useSync } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { denialMessageKey } from '@/lib/sync/denial-text';

const NOTICE_TTL_MS = 4_000;

export default function ConnectivityNotice() {
  const { isAuthenticated } = useAuth();
  const { isOnline, isNetworkUp, syncPaused, syncStatus } = useSync();
  const { t } = useTranslation();
  const { showToast } = useToast();

  // Track previous values across renders so we can fire on transitions only.
  const prevOnline = useRef<boolean | null>(null);
  const prevPaused = useRef<boolean | null>(null);
  const prevSyncErrState = useRef<string | null>(null);
  // Refusals already announced, by database + document id — so one refused
  // record is announced once, not on every poll cycle that re-pauses push.
  const announcedDenials = useRef<Set<string>>(new Set());

  // Never routed into a form: a sync failure is not about what the user is
  // filling in. A failure stays up for the toast's longer error time.
  const show = useCallback((tone: ToastType, title: string, body: string) => {
    showToast(body, tone, { title, placement: 'corner', ...(tone === 'error' ? {} : { durationMs: NOTICE_TTL_MS }) });
  }, [showToast]);

  // Initial mount — record current values without firing a notice.
  useEffect(() => {
    prevOnline.current = isOnline;
    prevPaused.current = syncPaused;
    prevSyncErrState.current = syncStatus?.state ?? null;
    // intentionally only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Online/offline + paused transitions. We don't fire while logged out —
  // the sync system isn't running, so banners would be misleading.
  useEffect(() => {
    if (!isAuthenticated) {
      prevOnline.current = isOnline;
      prevPaused.current = syncPaused;
      return;
    }
    const prev = prevOnline.current;
    const prevP = prevPaused.current;

    // Pause/resume by the user takes priority when the network itself is up.
    // (Otherwise an OS-level offline event would mask a manual pause notice.)
    const pausedFlipped = prevP !== null && prevP !== syncPaused;
    const onlineFlipped = prev !== null && prev !== isOnline;

    if (pausedFlipped && isNetworkUp) {
      if (syncPaused) {
        show('warning', t('connectivity.syncPaused'), t('connectivity.syncPausedBody'));
      } else {
        show('success', t('connectivity.syncResumed'), t('connectivity.syncingNow'));
      }
    } else if (onlineFlipped) {
      if (isOnline) {
        show('success', t('connectivity.backOnline'), t('connectivity.syncingNow'));
      } else if (!isNetworkUp) {
        show('warning', t('connectivity.offline'), t('connectivity.offlineBody'));
      }
    }

    prevOnline.current = isOnline;
    prevPaused.current = syncPaused;
  }, [isOnline, isNetworkUp, syncPaused, isAuthenticated, syncStatus?.state, t, show]);

  // A record the server refused. This is NOT an authentication failure (the
  // session is fine and every other change keeps syncing): CouchDB's
  // validator rejected one document. Name it and give the validator's reason,
  // and never say "Retrying…" — a refused record is not retried, it stays on
  // the device until the edit is corrected.
  useEffect(() => {
    if (!isAuthenticated || !syncStatus) return;
    for (const [dbName, s] of Object.entries(syncStatus.databases)) {
      for (const denial of s.deniedDocs ?? []) {
        const key = `${dbName}/${denial.id}/${denial.reason}`;
        if (announcedDenials.current.has(key)) continue;
        announcedDenials.current.add(key);
        const record = dbName.replace(/^tamamhealth_/, '').split('--')[0].replace(/_/g, ' ');
        // The validator's own reason is for developers; say what it means.
        const reasonKey = denialMessageKey(denial.reason);
        const reason = reasonKey ? t(reasonKey) : denial.reason.replace(/\.?$/, '.');
        show(
          'error',
          t('connectivity.changeRejected'),
          t('connectivity.changeRejectedBody', { record, reason }),
        );
        return;
      }
    }
  }, [syncStatus, isAuthenticated, t, show]);

  // Sync errors: notify on entering the 'error' state with a real replication
  // error (network, session, server). Refusals are announced above instead.
  useEffect(() => {
    if (!isAuthenticated) return;
    const state = syncStatus?.state ?? null;
    const prev = prevSyncErrState.current;
    if (state === 'error' && prev !== 'error') {
      let msg: string | undefined;
      let onlyRefusals = true;
      if (syncStatus) {
        for (const s of Object.values(syncStatus.databases)) {
          if (s.state === 'error') {
            onlyRefusals = false;
            if (s.error) { msg = s.error; break; }
          }
        }
      }
      if (!onlyRefusals) {
        show(
          'error',
          msg ? t('connectivity.syncErrorDetail', { msg }) : t('connectivity.syncError'),
          t('connectivity.retrying'),
        );
      }
    }
    prevSyncErrState.current = state;
  }, [syncStatus, isAuthenticated, t, show]);

  return null;
}
