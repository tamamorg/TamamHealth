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
 * Save) removes the entry again, so the next Back still means the page
 * before. Layers stack: the newest entry belongs to the topmost layer.
 *
 * Two traps this is written around:
 *  - React's development double-mount (mount → unmount → mount): the entry is
 *    pushed a tick after mount, so the throwaway mount never pushes or pops.
 *  - A layer that closes *because* the app navigated (a form that saves and
 *    opens the chart): the entry is only removed if the URL is still the one
 *    it was pushed on, a moment later — never popping an entry under a
 *    navigation that is moving the user somewhere new.
 *
 * Next.js (app router) integrates `history.pushState`, copying its own router
 * state into the entry, so these same-URL entries are ordinary to it.
 */
import { useEffect, useRef } from 'react';

type Layer = { token: string; onBack: () => void; href: string };

/** Open layers whose entry is in history, oldest first (top = last). */
const layers: Layer[] = [];
/** Layers closed by their own controls, waiting for their entries to go. */
const closed = new Set<string>();
let flushTimer: number | null = null;
let listening = false;
let seq = 0;

function onPopState(event: PopStateEvent) {
  const top = layers[layers.length - 1];
  if (!top) return;
  const state = event.state as { tmLayer?: string } | null;
  // The top layer's entry is gone (Back): that layer closes. Entries below it
  // belong to older layers, which stay open.
  if (state?.tmLayer !== top.token) {
    layers.pop();
    closed.delete(top.token);
    top.onBack();
  }
}

function ensureListener() {
  if (listening || typeof window === 'undefined') return;
  window.addEventListener('popstate', onPopState);
  listening = true;
}

/**
 * Remove the entries of layers that closed themselves, newest first, in one
 * history step — "close all panels" shuts several at once, and several
 * separate back() calls would race and leave entries behind.
 */
function flushClosed() {
  flushTimer = null;
  let count = 0;
  let href = '';
  let topToken = '';
  while (layers.length && closed.has(layers[layers.length - 1].token)) {
    const layer = layers.pop()!;
    closed.delete(layer.token);
    if (!topToken) { topToken = layer.token; href = layer.href; }
    count += 1;
  }
  if (count === 0) return;
  const state = window.history.state as { tmLayer?: string } | null;
  // Only while the user is still on the page these entries were pushed on —
  // never under a navigation that has moved them somewhere new.
  if (window.location.href === href && state?.tmLayer === topToken) window.history.go(-count);
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
        window.history.pushState({ ...(window.history.state || {}), tmLayer: token }, '');
        layer = { token, onBack: () => onBackRef.current(), href: window.location.href };
        layers.push(layer);
      } catch { /* history unavailable: the overlay still closes by its own controls */ }
    }, 0);

    return () => {
      window.clearTimeout(pushTimer);
      if (!layer || !layers.includes(layer)) return; // never pushed, or already popped by Back
      closed.add(token);
      if (flushTimer === null) flushTimer = window.setTimeout(flushClosed, 250);
    };
  }, [active]);
}

/** Test seam: forget every layer. */
export function __resetHistoryLayers(): void {
  layers.length = 0;
  closed.clear();
  if (flushTimer !== null) { window.clearTimeout(flushTimer); flushTimer = null; }
}
