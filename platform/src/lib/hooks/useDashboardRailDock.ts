'use client';

import { useEffect, type RefObject } from 'react';

/**
 * On a dashboard, a slider (check-in, a confirmation, a form) docks over the
 * right-hand panel — the same box, covering it — instead of squeezing the page
 * by its own width.
 *
 * Sliders are portalled to <body>, so they cannot see the panel. This
 * publishes the panel's box on <html> as `--dash-rail-top/-right/-w/-h` with
 * the class `tm-dash-rail` while the panel is on screen; globals.css (SLIDERS
 * ON A DASHBOARD) places every slider by them. Measured live: the panel moves
 * with resizes, the route bar and scrolling. A panel that is hidden (the
 * clinical dashboard folds it away on narrow screens) publishes nothing, and
 * sliders behave as they do everywhere else.
 */
export function useDashboardRailDock(railRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const root = document.documentElement;
    const clear = () => {
      root.classList.remove('tm-dash-rail');
      for (const name of ['--dash-rail-top', '--dash-rail-right', '--dash-rail-w', '--dash-rail-h']) root.style.removeProperty(name);
    };
    const publish = () => {
      const rect = el.getBoundingClientRect();
      const shown = rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';
      if (!shown) { clear(); return; }
      const top = Math.max(0, Math.round(rect.top));
      const bottom = Math.min(window.innerHeight, Math.round(rect.bottom));
      root.style.setProperty('--dash-rail-top', `${top}px`);
      root.style.setProperty('--dash-rail-right', `${Math.max(0, Math.round(window.innerWidth - rect.right))}px`);
      root.style.setProperty('--dash-rail-w', `${Math.round(rect.width)}px`);
      root.style.setProperty('--dash-rail-h', `${Math.max(240, bottom - top)}px`);
      root.classList.add('tm-dash-rail');
    };
    publish();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publish) : null;
    observer?.observe(el);
    window.addEventListener('resize', publish);
    window.addEventListener('scroll', publish, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', publish);
      window.removeEventListener('scroll', publish, true);
      clear();
    };
  }, [railRef]);
}
