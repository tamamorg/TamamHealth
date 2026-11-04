/**
 * Which right-hand panel is newest: sliders (Modal variant="slider") and the
 * patient chart's docked workspace share one opening order, and the newest is
 * the one on top.
 *
 * Sliders are body portals far above the page, so a workspace opened from the
 * chart's rail while a slider is open would otherwise land underneath it. The
 * docked workspace cannot rise above them (it lives inside the page's own
 * stacking context), so instead the older sliders step aside — hidden, not
 * closed, nothing typed in them lost — until that workspace closes. A slider
 * opened after the workspace is newer and sits on top of it as usual.
 */

let counter = 0;
const sliders = new Set<number>();
/** Sliders that are a question waiting for an answer: never put aside. */
const pinned = new Set<number>();
let drawerOrder = 0;
let drawerOpen = false;
const listeners = new Set<() => void>();

function recompute() {
  const newestSlider = Math.max(0, ...sliders);
  const drawerOnTop = drawerOpen && drawerOrder > newestSlider;
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('tm-drawer-over', drawerOnTop);
  listeners.forEach(listener => listener());
}

/** For useSyncExternalStore: told whenever the order changes. */
export function subscribeOverlayOrder(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** A slider's place in the order, taken when it first renders. */
export function reserveOverlayOrder(): number {
  return ++counter;
}

/** `pin`: a question (a confirm) stays in view until it is answered, even
 *  under a newer workspace — hidden, it would wait unanswered out of sight. */
export function openSliderLayer(order: number, pin = false) {
  sliders.add(order);
  if (pin) pinned.add(order);
  recompute();
}

export function closeSliderLayer(order: number) {
  pinned.delete(order);
  if (!sliders.delete(order)) return;
  recompute();
}

/** The chart's workspace was opened or given a new panel: it is now newest. */
export function raiseDrawerLayer() {
  drawerOrder = ++counter;
  drawerOpen = true;
  recompute();
}

export function closeDrawerLayer() {
  if (!drawerOpen) return;
  drawerOpen = false;
  recompute();
}

/** Whether this slider is under a newer workspace (and so hidden). */
export function isSliderBuried(order: number): boolean {
  return drawerOpen && order < drawerOrder && !pinned.has(order);
}
