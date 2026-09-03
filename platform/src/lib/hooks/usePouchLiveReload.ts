'use client';

import { useEffect } from 'react';
import { makeCoalescer } from './live-reload';

interface ChangeLike<T> {
  doc?: T;
  deleted?: boolean;
}

interface LiveFeed<T> {
  on(event: 'change', listener: (change: ChangeLike<T>) => void): LiveFeed<T>;
  on(event: 'error', listener: () => void): LiveFeed<T>;
  cancel(): void;
}

interface LiveDatabase<T> {
  changes(options: { since: 'now'; live: true; include_docs: boolean }): LiveFeed<T>;
}

/**
 * One lifecycle for the platform's offline query hooks: load on mount, then
 * coalesce PouchDB changes into refreshes and always cancel both timer and feed.
 */
export function usePouchLiveReload<T>(options: {
  load: () => void | Promise<void>;
  database: () => LiveDatabase<T>;
  includeDocs?: boolean;
  shouldReload?: (change: ChangeLike<T>) => boolean;
}): void {
  const { load, database, includeDocs = false, shouldReload } = options;

  useEffect(() => {
    // The hook owns the external-store synchronization; callers no longer each
    // need an effect whose only job is invoking their loader.
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => {
      if (!cancelled) void load();
    });
    const changes = database().changes({ since: 'now', live: true, include_docs: includeDocs })
      .on('change', change => {
        if (!shouldReload || shouldReload(change)) reload.trigger();
      })
      .on('error', () => { /* offline/transient: the next write reconnects through the owning hook */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* already closed */ }
    };
  }, [database, includeDocs, load, shouldReload]);
}
