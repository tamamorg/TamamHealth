'use client';

/**
 * Two signals for moving between screens.
 *
 * 1. A thin progress line under the top rail while a route is on its way.
 *    It appears only when a navigation takes longer than ~120 ms. Below
 *    that, a response feels instant (Nielsen's 0.1 s limit), and a flash of
 *    progress would only add noise. It crawls toward the end rather than
 *    pretending to know how far along it is, then completes and fades.
 *    Started by `onRouterTransitionStart` (src/instrumentation-client.ts),
 *    which every Link, router.push/replace and Back goes through.
 *
 * 2. The new screen fades in instead of cutting. Opacity only, and only when
 *    the path changes: a `?tab=` or filter change is the same screen, and
 *    the chart animates its own tab panel (TamamChartShell).
 *
 * Both are driven straight on the DOM. The start event fires inside the
 * navigation's transition, where React state would not render until the
 * navigation had already finished.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { fadeIn, MOTION_MS } from '@/lib/motion';

/** Below this, the navigation reads as instant and shows nothing. */
const SHOW_AFTER_MS = 120;
/** A navigation that never lands (offline, an error page) still clears. */
const GIVE_UP_MS = 12_000;

type State = 'idle' | 'loading' | 'done';

/**
 * The bar's controller. Module state, not component state: one layout mounts
 * one bar, and nothing here should ever cause a render.
 */
const progress = {
  bar: null as HTMLDivElement | null,
  pending: false,
  timers: [] as number[],
  set(state: State) { if (this.bar) this.bar.dataset.state = state; },
  clear() { this.timers.forEach(id => window.clearTimeout(id)); this.timers = []; },
  start(url: string) {
    try {
      const target = new URL(url, window.location.href);
      // Same screen (a hash, or a click on the page already open): nothing loads.
      if (target.origin !== window.location.origin) return;
      if (target.pathname === window.location.pathname && target.search === window.location.search) return;
    } catch { return; }
    this.clear();
    this.pending = true;
    // Back to the start line without animating there, ready to run again.
    this.set('idle');
    this.timers.push(
      window.setTimeout(() => this.set('loading'), SHOW_AFTER_MS),
      window.setTimeout(() => this.finish(), GIVE_UP_MS),
    );
  },
  finish() {
    if (!this.pending) return;
    this.pending = false;
    const wasShowing = this.bar?.dataset.state === 'loading';
    this.clear();
    if (!wasShowing) { this.set('idle'); return; }
    this.set('done');
    this.timers.push(window.setTimeout(() => this.set('idle'), MOTION_MS.slow + 260));
  },
};

export default function RouteMotion() {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? '';
  const barRef = useRef<HTMLDivElement>(null);
  const firstPath = useRef(true);

  useEffect(() => {
    progress.bar = barRef.current;
    const onStart = (event: Event) => {
      const url = (event as CustomEvent<{ url?: string }>).detail?.url;
      if (url) progress.start(url);
    };
    window.addEventListener('tamam:navigation-start', onStart);
    return () => {
      window.removeEventListener('tamam:navigation-start', onStart);
      progress.clear();
      progress.pending = false;
      progress.bar = null;
    };
  }, []);

  // The URL changed: the navigation landed.
  useEffect(() => { progress.finish(); }, [pathname, search]);

  // Before paint, so the new screen never shows for a frame at full strength
  // and then dips.
  useLayoutEffect(() => {
    if (firstPath.current) { firstPath.current = false; return; }
    fadeIn(document.getElementById('main-content'), MOTION_MS.slow);
  }, [pathname]);

  return (
    <div ref={barRef} className="tm-route-progress no-print" data-state="idle" aria-hidden="true">
      <span className="tm-route-progress__bar" />
    </div>
  );
}
