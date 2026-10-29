'use client';

/**
 * Back closes the top layer — the convention on every touch platform
 * (Android's system Back, iOS's edge swipe, a tablet browser's Back button):
 * while a dialog, slider or chart workspace is open, Back closes it and
 * leaves the page where it is, rather than leaving the page with the overlay
 * still "open" in the user's mind.
 *
 * Each open layer holds one history entry on the current URL. Back pops it
 * and the layer closes; closing the layer any other way (✕, Escape, Cancel,
 * Save) marks the entry spent, and Back steps over spent entries, so the next
 * Back still means the page before. Layers stack: the newest entry belongs to
 * the topmost layer.
 *
 * Two traps this is written around:
 *  - React's development double-mount (mount → unmount → mount): the entry is
 *    pushed a tick after mount, so the throwaway mount never pushes or pops.
 *  - A layer that closes and then navigates (a form that saves and opens the
 *    chart, the registration slip that opens check-in): history is never
 *    stepped at close time. A timed history.go(-1) used to land in the middle
 *    of the app router's navigation and cancel it.
 *
 * Next.js (app router) integrates `history.pushState`, copying its own router
 * state into the entry, so these same-URL entries are ordinary to it.
 */
import { useEffect, useRef } from 'react';

type Layer = { token: string; onBack: () => void };
type LayerState = { tmLayer?: string; tmBase?: string; tmSpent?: string; tmSeq?: number } & Record<string, unknown>;

/** Open layers whose entry is in history, oldest first (top = last). */
const layers: Layer[] = [];
/** Layers that closed by their own controls (or with others, or under a
 *  navigation): their entries are spent — the same page as the base entry. */
const spent = new Set<string>();
let listening = false;
let seq = 0;
/** Sequence of the entry we are on, for the direction of a popstate.
 *  Infinity after an app navigation: anything we land on is behind it. */
let currentSeq = Number.POSITIVE_INFINITY;
/** URL of the entry we are on, for "did Back come from another page". */
let currentHref = '';
/** Stepping back over spent entries after arriving from another page: stop at
 *  the first live entry — that is the page the user went back to. */
let returningToPage = false;

const stateOf = (value: unknown): LayerState => (value && typeof value === 'object' ? value as LayerState : {});
const isOpen = (token: string) => layers.some(layer => layer.token === token);

/** An entry that is only "the page again": a layer that is no longer open. */
function isSpentEntry(state: LayerState): boolean {
  if (state.tmSpent) return true;
  return !!state.tmLayer && !isOpen(state.tmLayer);
}

function onPopState(event: PopStateEvent) {
  const state = stateOf(event.state);
  const fromHref = currentHref;
  const fromSeq = currentSeq;
  currentHref = window.location.href;
  currentSeq = typeof state.tmSeq === 'number' ? state.tmSeq : Number.NaN;
  // Direction: entries we stamped carry a sequence; an unknown pair is read as
  // Back, by far the common move.
  const forward = typeof state.tmSeq === 'number' && Number.isFinite(fromSeq) && state.tmSeq > fromSeq;
  const samePage = fromHref === currentHref;

  if (isSpentEntry(state)) {
    // Step over it in the direction of travel. Arriving from another page,
    // remember to stop at the page's own entry beneath.
    if (!samePage) returningToPage = true;
    if (forward) window.history.forward(); else window.history.back();
    return;
  }
  // The page entry under a spent layer, reached by Back from that layer (the
  // user closed a dialog, then pressed Back): that Back meant "leave the
  // page", so keep going — unless we are returning here from another page.
  if (!forward && state.tmBase && spent.has(state.tmBase) && samePage && !returningToPage) {
    window.history.back();
    return;
  }
  returningToPage = false;
  const top = layers[layers.length - 1];
  if (!top) return;
  // The top layer's entry is gone (Back): that layer closes. Entries below it
  // belong to older layers, which stay open.
  if (state.tmLayer !== top.token) {
    layers.pop();
    top.onBack();
  }
}

function ensureListener() {
  if (listening || typeof window === 'undefined') return;
  window.addEventListener('popstate', onPopState);
  // An app navigation pushes a newer entry: note it, so a later Back that
  // lands on one of our entries is read as Back and as "from another page".
  const push = window.history.pushState.bind(window.history);
  window.history.pushState = (data: unknown, unused: string, url?: string | URL | null) => {
    push(data, unused, url);
    const pushed = stateOf(data);
    currentSeq = typeof pushed.tmSeq === 'number' ? pushed.tmSeq : Number.POSITIVE_INFINITY;
    currentHref = window.location.href;
  };
  currentHref = window.location.href;
  listening = true;
}

/**
 * Give an open overlay its own Back entry. `active` is whether it is open;
 * `onBack` closes it (the latest one is used — it is read through a ref).
 */
export function useHistoryLayer(active: boolean, onBack: () => void): void {
  const onBackRef = useRef(onBack);
  useEffect(() => { onBackRef.current = onBack; });

  useEffect(() => {
    if (!active || typeof window === 'undefined') return;
    ensureListener();
    const token = `layer-${++seq}`;
    let layer: Layer | null = null;
    const pushTimer = window.setTimeout(() => {
      try {
        // Existing state is spread through every rewrite, so other keys on the
        // entry (the app router's, nav-history's page index) survive.
        const base = stateOf(window.history.state);
        window.history.replaceState({ ...base, tmBase: token, tmSeq: ++seq }, '');
        const { tmBase: _base, tmSpent: _spent, ...rest } = base;
        void _base; void _spent;
        window.history.pushState({ ...rest, tmLayer: token, tmSeq: ++seq }, '');
        layer = { token, onBack: () => onBackRef.current() };
        layers.push(layer);
      } catch { /* history unavailable: the overlay still closes by its own controls */ }
    }, 0);

    return () => {
      window.clearTimeout(pushTimer);
      if (!layer) return; // never pushed (a throwaway dev mount)
      const index = layers.indexOf(layer);
      if (index === -1) return; // already closed by Back
      layers.splice(index, 1);
      // Closed by its own controls (✕, Escape, Save…), alongside other layers,
      // or under a navigation. History is NOT stepped here: a close is often
      // followed by a navigation (save → open the chart; the registration slip
      // → check-in), and a history step taken now landed in the middle of the
      // app router's navigation and cancelled it. The entry is marked spent
      // instead, and Back steps over it later (onPopState). Only the current
      // entry can be rewritten; any other is recognised as spent because its
      // layer is no longer open.
      spent.add(token);
      const current = stateOf(window.history.state);
      if (current.tmLayer === token) {
        const { tmLayer: _layer, ...rest } = current;
        void _layer;
        try { window.history.replaceState({ ...rest, tmSpent: token }, ''); } catch { /* ignore */ }
      }
    };
  }, [active]);
}

/** Test seam: forget every layer. */
export function __resetHistoryLayers(): void {
  layers.length = 0;
  spent.clear();
  returningToPage = false;
  currentSeq = Number.POSITIVE_INFINITY;
  currentHref = typeof window === 'undefined' ? '' : window.location.href;
}
