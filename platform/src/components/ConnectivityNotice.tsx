'use client';

/**
 * ConnectivityNotice — animated slide-down banner that announces transitions
 * in the sync/online state. Mounted once in the dashboard layout.
 *
 * Triggers:
 *  - isOnline flips (going online / going offline)
 *  - syncStatus.state transitions to 'error' (with the underlying message)
 *  - User-initiated pause/resume (via the toggleOnline preference flipping)
 *
 * UX:
 *  - position: fixed at the top, slides in from above (220ms ease-out),
 *    slides out (180ms ease-in), and auto-dismisses after ~4s.
 *  - role="status" with aria-live="polite" so screen readers announce
 *    the change without stealing focus.
 *  - Pure CSS keyframes (no framer-motion).
 *
 * Implementation note: we keep one Notice at a time. New transitions replace
 * the previous notice rather than stacking, so the user isn't bombarded
 * during a flapping connection.
 */

import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { DANGER, DANGER_STRONG, SUCCESS, SUCCESS_STRONG, WARNING, WARNING_STRONG, WHITE } from '@/lib/theme-colors';
import {
  DuotoneCheck as Check,
  DuotoneAlert as AlertTriangle,
  DuotoneWifiOff as WifiOff,
  DuotonePause as Pause,
  DuotoneClose as X,
} from '@/components/icons';

type Tone = 'success' | 'warning' | 'danger';

interface Notice {
  id: number;
  tone: Tone;
  title: string;
  body?: string;
  /** ms before auto-dismiss; null = sticky */
  ttl: number | null;
}

const NOTICE_TTL_MS = 4_000;
let nextId = 1;

function toneColors(tone: Tone): { bg: string; border: string; icon: string; text: string } {
  switch (tone) {
    case 'success':
      return { bg: SUCCESS, border: SUCCESS_STRONG, icon: WHITE, text: WHITE };
    case 'warning':
      return { bg: WARNING, border: WARNING_STRONG, icon: WHITE, text: WHITE };
    case 'danger':
      return { bg: DANGER, border: DANGER_STRONG, icon: WHITE, text: WHITE };
  }
}

function ToneIcon({ tone }: { tone: Tone }) {
  const cls = 'w-5 h-5 flex-shrink-0';
  // Icons sit on a solid tone background, so they take the tone's icon color
  // (white) rather than their own semantic hue — keeps contrast clean.
  const color = toneColors(tone).icon;
  if (tone === 'success') return <Check className={cls} color={color} />;
  if (tone === 'warning') return <WifiOff className={cls} color={color} />;
  return <AlertTriangle className={cls} color={color} />;
}

export default function ConnectivityNotice() {
  const { isAuthenticated, isOnline, isNetworkUp, syncPaused, syncStatus } = useApp();
  const { t } = useTranslation();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [exiting, setExiting] = useState(false);

  // Track previous values across renders so we can fire on transitions only.
  const prevOnline = useRef<boolean | null>(null);
  const prevPaused = useRef<boolean | null>(null);
  const prevSyncErrState = useRef<string | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const removeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Helper: show a notice, replacing any current one. Auto-dismisses after ttl.
  const show = (tone: Tone, title: string, body?: string) => {
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    if (removeTimerRef.current) clearTimeout(removeTimerRef.current);
    const id = nextId++;
    setExiting(false);
    setNotice({ id, tone, title, body, ttl: NOTICE_TTL_MS });
    exitTimerRef.current = setTimeout(() => setExiting(true), NOTICE_TTL_MS);
    removeTimerRef.current = setTimeout(() => setNotice(null), NOTICE_TTL_MS + 200);
  };

  const dismiss = () => {
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    if (removeTimerRef.current) clearTimeout(removeTimerRef.current);
    setExiting(true);
    removeTimerRef.current = setTimeout(() => setNotice(null), 200);
  };

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
  }, [isOnline, isNetworkUp, syncPaused, isAuthenticated, syncStatus?.state]);

  // Sync errors: notify on entering the 'error' state. Find a database error
  // message if available so we can show a useful body.
  useEffect(() => {
    if (!isAuthenticated) return;
    const state = syncStatus?.state ?? null;
    const prev = prevSyncErrState.current;
    if (state === 'error' && prev !== 'error') {
      let msg: string | undefined;
      if (syncStatus) {
        for (const s of Object.values(syncStatus.databases)) {
          if (s.state === 'error' && s.error) { msg = s.error; break; }
          if (s.state === 'denied') { msg = t('connectivity.authDenied'); break; }
        }
      }
      show(
        'danger',
        msg ? t('connectivity.syncErrorDetail', { msg }) : t('connectivity.syncError'),
        t('connectivity.retrying'),
      );
    }
    prevSyncErrState.current = state;
  }, [syncStatus, isAuthenticated]);

  // Cleanup timers on unmount
  useEffect(() => () => {
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    if (removeTimerRef.current) clearTimeout(removeTimerRef.current);
  }, []);

  if (!notice) return null;

  const colors = toneColors(notice.tone);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="connectivity-notice-wrap fixed start-0 end-0 z-[60] flex justify-center pointer-events-none px-3"
    >
      <div
        className={`pointer-events-auto flex items-center gap-3 px-4 py-2.5 shadow-lg max-w-md w-full sm:w-auto ${exiting ? 'connectivity-notice-exit' : 'connectivity-notice-enter'}`}
        style={{
          background: colors.bg,
          color: colors.text,
          borderRadius: 'var(--card-radius)',
          border: `1px solid ${colors.border}`,
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        }}
      >
        {notice.tone === 'warning' && syncPaused && isNetworkUp ? (
          <Pause className="w-5 h-5 flex-shrink-0" color={colors.icon} />
        ) : (
          <ToneIcon tone={notice.tone} />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{notice.title}</p>
          {notice.body && <p className="text-xs opacity-90 truncate">{notice.body}</p>}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t('common.dismissNotification')}
          className="p-1.5 rounded hover:bg-white/20 transition-colors flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <X className="w-3.5 h-3.5" color={colors.icon} />
        </button>
      </div>
    </div>
  );
}
