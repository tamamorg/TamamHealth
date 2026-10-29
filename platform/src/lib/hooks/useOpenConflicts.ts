'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api-fetch';
import type { ConflictQueueDoc } from '../db-types';

/**
 * The pending conflict-queue feed for the risk surfaces, fetched once and
 * shared by both screens that need it.
 *
 * Why this exists — and why it is a hook rather than two inline effects:
 *
 * `/admin` and `/admin/risk` both feed `buildRiskRows`, which was written so
 * "the two screens cannot disagree about what is open". They still disagreed,
 * because the *input* they disagreed on — the conflicts array — was fetched by
 * two hand-rolled effects that could each fail independently and silently:
 *
 *   - Both initialised `conflicts` to `[]` and only overwrote it on `res.ok`,
 *     swallowing every error path (offline, a non-ok status, a slow or
 *     malformed body). A failure left the page at `[]`, which `buildRiskRows`
 *     reads as "no pending conflicts" — so a feed hiccup made a platform with
 *     thousands of pending conflicts report itself clean, with no indication
 *     anything was missing.
 *   - The only guard against a stale write was a boolean flag. Under React
 *     Strict Mode's double-invoke (dev) or any dependency re-fire, two fetches
 *     of a large payload raced, and *which* one's `setConflicts` landed last
 *     decided the count — so the same data reported different numbers reload to
 *     reload.
 *
 * This hook removes both failure modes for both screens at once:
 *
 *   - A per-run `AbortController` cancels the previous request, and an `active`
 *     latch means only the latest run can write — a superseded response can
 *     never clobber a newer one, so the count is deterministic.
 *   - `status` distinguishes `loading` from `ready` from `error`, the same way
 *     `useBackupStatus` separates "still loading" from a real "unknown" answer.
 *     Callers that show a count MUST NOT present an `error` feed as a clean
 *     platform; the count is understated until the feed loads.
 */
export type ConflictFeedStatus = 'loading' | 'ready' | 'error';

export interface OpenConflictsState {
  /** Pending conflicts, or `[]` before the first successful load. Trust this
   *  as authoritative only when `status === 'ready'`. */
  conflicts: ConflictQueueDoc[];
  status: ConflictFeedStatus;
  /** Re-fetch on demand — wired to the Risk Center's retry control. */
  reload: () => void;
}

export function useOpenConflicts(): OpenConflictsState {
  const [conflicts, setConflicts] = useState<ConflictQueueDoc[]>([]);
  const [status, setStatus] = useState<ConflictFeedStatus>('loading');
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce(n => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    // Only the latest run may write. Set false by this run's cleanup, which
    // also aborts its request, so a Strict-Mode double-invoke or a dependency
    // re-fire cannot leave a stale response landing after a fresh one.
    let active = true;
    (async () => {
      try {
        // Reset to loading here rather than in the effect body: a manual reload
        // should show the spinner again, and keeping every setState inside the
        // async run keeps the effect body free of synchronous state writes.
        setStatus('loading');
        const res = await apiFetch('/api/admin/conflicts?status=pending', { signal: controller.signal });
        if (!active) return;
        if (!res.ok) { setStatus('error'); return; }
        const body = await res.json();
        if (!active) return;
        const list = Array.isArray(body?.conflicts)
          ? body.conflicts
          : Array.isArray(body)
            ? body
            : [];
        setConflicts(list as ConflictQueueDoc[]);
        setStatus('ready');
      } catch {
        // A superseded run's abort is not a feed failure; a real failure leaves
        // the count as loading→error rather than silently claiming zero.
        if (!active || controller.signal.aborted) return;
        setStatus('error');
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [nonce]);

  return { conflicts, status, reload };
}
