'use client';

/**
 * A breadcrumb trail that can name the RECORD you are standing on.
 *
 * `resolveRouteContext` builds crumbs from the URL alone, which is right for
 * a fixed route ("Admin › Audit Log") and useless for a hierarchy of records:
 * `/admin/facilities/abc123` has no static label, and the level above it — the
 * organization that owns the facility — is not in the URL at all.
 *
 * So the pages that form the organization → facility → person chain publish
 * their own trail as they load it, and `RouteContextBar` renders that instead
 * of the URL-derived one. The bar stays a single shared strip; only its
 * source changes.
 *
 * Publishing is an effect, not a render-time write, so a page that has not
 * resolved its record yet simply shows nothing until it has. The trail is
 * cleared on unmount, which means navigating from a trail page to a plain one
 * falls straight back to `resolveRouteContext`.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface ConsoleCrumb {
  /** Already-translated text — these are record names, not message keys. */
  label: string;
  /** Omitted on the last crumb: you are already there. */
  href?: string;
}

interface ConsoleTrailValue {
  trail: ConsoleCrumb[] | null;
  publish: (id: string, crumbs: ConsoleCrumb[] | null) => void;
}

const ConsoleTrailContext = createContext<ConsoleTrailValue | null>(null);

export function ConsoleTrailProvider({ children }: { children: ReactNode }) {
  /* Keyed by publisher so a page unmounting cannot erase the trail a page
     mounting in the same commit has already set — React runs the new page's
     effect before the old page's cleanup in some transitions, and a bare
     `setTrail(null)` on unmount blanked the bar on every drill-down. */
  const [entries, setEntries] = useState<Record<string, ConsoleCrumb[]>>({});

  const publish = useCallback((id: string, crumbs: ConsoleCrumb[] | null) => {
    setEntries(current => {
      if (!crumbs) {
        if (!(id in current)) return current;
        const next = { ...current };
        delete next[id];
        return next;
      }
      return { ...current, [id]: crumbs };
    });
  }, []);

  const value = useMemo<ConsoleTrailValue>(() => {
    const published = Object.values(entries);
    return {
      trail: published.length ? published[published.length - 1] : null,
      publish,
    };
  }, [entries, publish]);

  return <ConsoleTrailContext.Provider value={value}>{children}</ConsoleTrailContext.Provider>;
}

/** What `RouteContextBar` reads. Null outside the provider or with nothing published. */
export function useConsoleTrailValue(): ConsoleCrumb[] | null {
  return useContext(ConsoleTrailContext)?.trail ?? null;
}

/**
 * Publish this page's trail.
 *
 * `id` must be stable for the page (its route pattern is the natural choice).
 * Pass `null` while the record is still loading — the bar then falls back to
 * the URL-derived context rather than flashing a half-built trail.
 */
export function useConsoleTrail(id: string, crumbs: ConsoleCrumb[] | null): void {
  const context = useContext(ConsoleTrailContext);
  const publish = context?.publish;
  /* Serialised so a caller building the array inline does not republish on
     every render — the common shape here is `[{label: org.name, href: …}]`,
     a fresh array each time with identical contents. */
  const encoded = crumbs ? JSON.stringify(crumbs) : null;

  useEffect(() => {
    if (!publish) return;
    publish(id, encoded ? JSON.parse(encoded) as ConsoleCrumb[] : null);
    return () => publish(id, null);
  }, [publish, id, encoded]);
}
