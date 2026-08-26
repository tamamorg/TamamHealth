'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/context';
import {
  flushUsageQueue,
  setUsageIdentity,
  startUsageFlushLoop,
  track,
  trackDomEvent,
} from '@/lib/usage/tracker';

/**
 * Mount once inside the authenticated dashboard shell.
 * Captures page views, clickstream, and session boundaries.
 */
export default function UsageTracker() {
  const pathname = usePathname();
  const { currentUser, isAuthenticated } = useAuth();
  const sessionStarted = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !currentUser?._id) {
      setUsageIdentity(null);
      return;
    }
    setUsageIdentity({
      userId: currentUser._id,
      orgId: currentUser.orgId || currentUser.organization?._id,
      role: currentUser.role,
    });
  }, [isAuthenticated, currentUser]);

  useEffect(() => {
    if (!isAuthenticated || !currentUser?._id) return;

    if (!sessionStarted.current) {
      sessionStarted.current = true;
      track('session_start', { path: pathname || '/' });
    }

    const stopFlush = startUsageFlushLoop();

    const onClick = (e: MouseEvent) => {
      trackDomEvent('click', e.target, pathname || undefined);
    };
    const onChange = (e: Event) => {
      trackDomEvent('change', e.target, pathname || undefined);
    };
    // pagehide and visibilitychange both fire on tab close — debounce once.
    let lastEndAt = 0;
    const endSession = () => {
      const now = Date.now();
      if (now - lastEndAt < 1000) return;
      lastEndAt = now;
      track('session_end', { path: pathname || '/' });
      void flushUsageQueue();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') endSession();
    };

    document.addEventListener('click', onClick, true);
    document.addEventListener('change', onChange, true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', endSession);

    return () => {
      stopFlush();
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('change', onChange, true);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', endSession);
    };
  }, [isAuthenticated, currentUser?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isAuthenticated || !currentUser?._id) return;
    if (!pathname) return;
    track('page_view', { path: pathname });
  }, [pathname, isAuthenticated, currentUser?._id]);

  return null;
}
