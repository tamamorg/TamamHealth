'use client';

/**
 * "Back" means the screen the user actually came from.
 *
 * Every Back control in the app (the route bar's Back, a record page's
 * "Back to …") used to go to a fixed parent — the chart's Back always went
 * to the patient list, even when the user had opened the chart from the
 * dashboard. Now Back returns through the browser's own history when there
 * is an in-app page to return to, and falls back to the parent link only
 * when there is not (a link opened in a new tab, a bookmark, a fresh load).
 *
 * To know whether there is an in-app page behind the current one, each
 * history entry is stamped with its index (`tmIdx`) the first time it is
 * seen. Next.js does not say whether a navigation pushed a new entry or
 * replaced the current one, so the stamp reads `history.length`: a push
 * grows it, a replace does not. When that reading is ambiguous the count can
 * only come out too low, which means Back uses the parent link — never that
 * it walks the user out of the app or to the wrong page.
 *
 * Overlay entries (history-layer.ts) copy the page entry's state, index
 * included, so a dialog's entry never counts as a page to go back to.
 */
import { useCallback, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

let current = 0;
let lastLength = 0;
let observed = false;
let listening = false;

type Stamped = { tmIdx?: number } & Record<string, unknown>;

function stamp(idx: number) {
  try {
    const state = (window.history.state || {}) as Stamped;
    window.history.replaceState({ ...state, tmIdx: idx }, '');
  } catch { /* history unavailable: Back falls back to the parent link */ }
}

/** Record the entry the browser is on now. Call after every URL change. */
export function observeLocation(): void {
  if (typeof window === 'undefined') return;
  if (!listening) {
    window.addEventListener('popstate', event => {
      const idx = (event.state as Stamped | null)?.tmIdx;
      if (typeof idx === 'number') current = idx;
      lastLength = window.history.length;
    });
    listening = true;
  }
  const state = (window.history.state || {}) as Stamped;
  if (typeof state.tmIdx === 'number') {
    current = state.tmIdx;
  } else {
    // First entry this document has seen is the floor (index 0). After that a
    // new, unstamped entry is a push when history grew, a replace when not.
    const idx = !observed ? 0 : (window.history.length > lastLength ? current + 1 : current);
    stamp(idx);
    current = idx;
  }
  observed = true;
  lastLength = window.history.length;
}

/** True when there is an in-app page behind the current one. */
export function canGoBackInApp(): boolean {
  return current > 0;
}

/** Mount once in the app shell: stamps each page entry as the URL changes. */
export function useNavHistoryTracker(): void {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  useEffect(() => { observeLocation(); }, [pathname, query]);
}

/**
 * The Back action: the previous in-app screen if there is one, otherwise
 * `fallbackHref` (the page's logical parent).
 */
export function useGoBack(fallbackHref: string): () => void {
  const router = useRouter();
  return useCallback(() => {
    if (canGoBackInApp()) router.back();
    else router.push(fallbackHref);
  }, [router, fallbackHref]);
}

/** Test seam. */
export function __resetNavHistory(): void {
  current = 0;
  lastLength = 0;
  observed = false;
}
