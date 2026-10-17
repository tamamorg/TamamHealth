'use client';

import { useEffect, useRef } from 'react';
import { makeCoalescer } from './live-reload';

interface ChangeLike<T> {
  id?: string;
  doc?: T;
  deleted?: boolean;
}

interface LiveFeed<T> {
  on(event: 'change', listener: (change: ChangeLike<T>) => void): LiveFeed<T>;
  on(event: 'error', listener: (error: unknown) => void): LiveFeed<T>;
  cancel(): void;
}

interface LiveDatabase<T> {
  changes(options: { since: 'now'; live: true; include_docs: boolean }): LiveFeed<T>;
}

/**
 * One lifecycle for the platform's offline query hooks: load on mount, then
 * coalesce PouchDB changes into refreshes and always cancel both timers and feeds.
 *
 * - `database` may return several databases; a change in any of them reloads
 *   through ONE shared coalescer. It must be referentially stable (a module-level
 *   `xxxDB` accessor or a `useCallback`), because a new identity resubscribes.
 * - `enabled: false` keeps the mount load but opens no feed.
 * - `loadOnMount: false` is for callers whose own effect already performs the
 *   initial load under conditions this hook cannot see.
 * - `onError` observes feed errors; they are otherwise swallowed (offline/transient).
 */
export function usePouchLiveReload<T>(options: {
  load: () => void | Promise<void>;
  database: () => LiveDatabase<T> | LiveDatabase<T>[];
  includeDocs?: boolean;
  shouldReload?: (change: ChangeLike<T>) => boolean;
  enabled?: boolean;
  loadOnMount?: boolean;
  onError?: (error: unknown) => void;
}): void {
  const { load, database, includeDocs = false, shouldReload, enabled = true, loadOnMount = true, onError } = options;
  // Held in a ref so an inline error logger never resubscribes the feed.
  const onErrorRef = useRef(onError);
  useEffect(() => { onErrorRef.current = onError; });

  useEffect(() => {
    // The hook owns the external-store synchronization; callers no longer each
    // need an effect whose only job is invoking their loader.
    if (loadOnMount) void load();
  }, [load, loadOnMount]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const reload = makeCoalescer(() => {
      if (!cancelled) void load();
    });
    const databases = database();
    const feeds = (Array.isArray(databases) ? databases : [databases]).map(db => db
      .changes({ since: 'now', live: true, include_docs: includeDocs })
      .on('change', change => {
        if (!shouldReload || shouldReload(change)) reload.trigger();
      })
      .on('error', error => {
        // offline/transient: the next write reconnects through the owning hook
        onErrorRef.current?.(error);
      }));
    return () => {
      cancelled = true;
      reload.cancel();
      for (const feed of feeds) {
        try { feed.cancel(); } catch { /* already closed */ }
      }
    };
  }, [database, enabled, includeDocs, load, shouldReload]);
}
