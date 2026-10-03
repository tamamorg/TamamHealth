'use client';

/**
 * Retries this user's queued patient texts. Renders nothing.
 *
 * A text written while the facility is offline is saved as `queued`; without
 * something to send it later, "queued" would be a polite word for "lost".
 * This runs once shortly after the app opens, whenever the device reports it
 * is back online, and on a slow interval — the `online` event is not reliable
 * on every tablet, and a server that was briefly unreachable never fires it.
 */
import { useEffect } from 'react';
import { useAuth } from '@/lib/context';
import { useDataScope } from '@/lib/hooks/useDataScope';

/** Long enough for seeding and first paint to settle before reading messages. */
const FIRST_RUN_DELAY_MS = 15_000;
const RETRY_INTERVAL_MS = 5 * 60_000;

export default function PatientTextOutbox() {
  const { currentUser, dbReady } = useAuth();
  const scope = useDataScope();
  const userId = currentUser?._id;

  useEffect(() => {
    if (!userId || !scope || !dbReady) return;
    let cancelled = false;
    const flush = () => {
      if (cancelled) return;
      void import('@/modules/communication/services/patient-text-service')
        .then(({ flushQueuedPatientTexts }) => flushQueuedPatientTexts(userId, scope))
        .catch(() => { /* the next tick retries */ });
    };
    const first = window.setTimeout(flush, FIRST_RUN_DELAY_MS);
    const timer = window.setInterval(flush, RETRY_INTERVAL_MS);
    window.addEventListener('online', flush);
    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
      window.removeEventListener('online', flush);
    };
  }, [userId, scope, dbReady]);

  return null;
}
