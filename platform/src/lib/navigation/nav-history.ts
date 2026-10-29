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
 * To know whether there is an in-app page behind the current one, every
 * history entry carries its index (`tmIdx`). The History API is wrapped once:
 * a pushState stamps the next index, a replaceState keeps the current one.
 * Next.js's own navigations call `window.history.pushState/replaceState` at
 * call time (app-router.js), so every push and replace is seen as it happens
 * — no inference. (An earlier version guessed from `history.length`, which
 * stops growing once an overlay's entries have been stepped back over, so
 * after any slider had been opened and closed Back fell through to the
 * parent page.)
 *
 * Overlay entries (history-layer.ts) carry `tmLayer` on the same URL; they
 * keep the page's index, so a dialog's entry never counts as a page to go
 * back to. On a reload the entries keep their stamps, so Back still knows.
 */
import { useCallback, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

let current = 0;
let installed = false;

type Stamped = { tmIdx?: number; tmLayer?: string } & Record<string, unknown>;

function asObject(data: unknown): Stamped {
  return data && typeof data === 'object' ? { ...(data as Stamped) } : {};
}

/** Wrap the History API once so every push/replace is stamped. */
function install(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const history = window.history;
  const push = history.pushState;
  const replace = history.replaceState;
  history.pushState = function pushState(data: unknown, unused: string, url?: string | URL | null) {
    const next = asObject(data);
    // An overlay's entry sits on the same page: same index as the page.
    const idx = next.tmLayer ? current : current + 1;
    next.tmIdx = idx;
    const result = push.call(this, next, unused, url);
    current = idx;
    return result;
  };
  history.replaceState = function replaceState(data: unknown, unused: string, url?: string | URL | null) {
    const next = asObject(data);
    if (typeof next.tmIdx !== 'number') next.tmIdx = current;
    return replace.call(this, next, unused, url);
  };
  window.addEventListener('popstate', event => {
    const idx = (event.state as Stamped | null)?.tmIdx;
    current = typeof idx === 'number' ? idx : 0;
  });
  // The entry this document opened on: keep a stamp a reload carried over,
  // otherwise it is the floor — nothing in-app behind it.
  const state = asObject(history.state);
  current = typeof state.tmIdx === 'number' ? state.tmIdx : 0;
  if (typeof state.tmIdx !== 'number') {
    try { replace.call(history, { ...state, tmIdx: current }, ''); } catch { /* ignore */ }
  }
}

if (typeof window !== 'undefined') install();

/** Record the entry the browser is on now (kept for the tracker; idempotent). */
export function observeLocation(): void {
  install();
  const idx = (asObject(window.history.state)).tmIdx;
  if (typeof idx === 'number') current = idx;
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
}
