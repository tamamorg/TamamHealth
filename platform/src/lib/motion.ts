/**
 * Functional motion, played from script.
 *
 * The CSS tokens in globals.css (`--motion-*`, `--ease-*`) drive every CSS
 * animation; this file is their script twin for the few movements CSS cannot
 * express on its own: a surface that must animate AFTER React has removed it
 * (a dialog closing), and content that is replaced in place (a page or a chart
 * tab changing). Both run on the Web Animations API, which the stylesheet's
 * "static UI" rule (`animation: none !important` outside `.tm-motion`) does
 * not reach, so the exemption stays in one place: here.
 *
 * Timing follows IBM Carbon's *productive* motion, the system OpenMRS O3 is
 * built on. Productive motion is for task work: short, never decorative, and
 * the exit always faster than the entrance so a leaving surface never
 * competes with the one arriving.
 *
 * Every helper is a no-op when the user asks for reduced motion, in a browser
 * without `Element.animate`, and under jsdom, so no caller needs a guard.
 */

export const MOTION_MS = { fast: 110, base: 150, slow: 240, exit: 110 } as const;

export const EASE = {
  /** Carbon entrance-productive: arrives quickly, settles softly. */
  enter: 'cubic-bezier(0, 0, 0.38, 0.9)',
  /** Carbon exit-productive: accelerates away. */
  exit: 'cubic-bezier(0.2, 0, 1, 0.9)',
  /** Carbon standard-productive: for something that moves and stays. */
  standard: 'cubic-bezier(0.2, 0, 0.38, 0.9)',
} as const;

export function motionAllowed(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (typeof Element === 'undefined' || typeof Element.prototype.animate !== 'function') return false;
  if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  return true;
}

/**
 * Fade replaced content in. Opacity only: a transform on a page container
 * would become the containing block of every `position: fixed` element inside
 * it for the length of the animation (sticky footers, the order basket bar),
 * which shows as a jump.
 */
export function fadeIn(el: Element | null | undefined, duration: number = MOTION_MS.base): void {
  if (!el || !motionAllowed()) return;
  el.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: EASE.enter });
}

/** A surface arriving from the inline end (a docked panel, a drawer body). */
export function slideIn(el: Element | null | undefined, offset = 12): void {
  if (!el || !motionAllowed()) return;
  const rtl = document.documentElement.dir === 'rtl';
  el.animate(
    [{ opacity: 0, transform: `translateX(${rtl ? -offset : offset}px)` }, { opacity: 1, transform: 'none' }],
    { duration: MOTION_MS.slow, easing: EASE.enter },
  );
}

/**
 * Let a surface leave visibly after React has removed it.
 *
 * Call this from a `useLayoutEffect` cleanup: when it runs, the real node is
 * still in the document. It is cloned there and then, and the clone plays
 * the exit in its place one tick later, only if the original is really gone.
 * Under React Strict Mode the effect is torn down and rebuilt on mount while
 * the node stays put, and that case must not flash a ghost.
 *
 * The clone is inert, unlabelled and id-free, so focus, the accessibility tree,
 * `getElementById` and the guided tour never find it. It sits one layer under
 * the overlay rung, so a dialog opened in the same moment lands above it.
 */
export function playExitGhost(
  node: HTMLElement | null | undefined,
  animate: (ghost: HTMLElement) => Animation[],
  zIndex?: number,
): void {
  if (!node || !node.isConnected || !motionAllowed()) return;
  if (node.closest('[data-no-exit-motion]')) return;
  const parent = node.parentNode;
  if (!parent) return;

  const ghost = node.cloneNode(true) as HTMLElement;
  // Values typed into a field live on the element, not in its attributes, so
  // a bare clone would show the form blank for the length of the exit.
  const liveFields = node.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select');
  const ghostFields = ghost.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select');
  liveFields.forEach((field, i) => {
    const copy = ghostFields[i];
    if (!copy) return;
    if (field instanceof HTMLInputElement && (field.type === 'checkbox' || field.type === 'radio')) {
      (copy as HTMLInputElement).checked = field.checked;
    } else if (field.type !== 'file') {
      copy.value = field.value;
    }
  });
  // Scroll offsets are not cloned either; keep the panel where the user left it.
  const scrolled: Array<[number, number, number]> = [];
  const liveAll = node.querySelectorAll<HTMLElement>('*');
  liveAll.forEach((el, i) => { if (el.scrollTop > 0 || el.scrollLeft > 0) scrolled.push([i, el.scrollTop, el.scrollLeft]); });

  for (const el of [ghost, ...Array.from(ghost.querySelectorAll<HTMLElement>('[id]'))]) el.removeAttribute('id');
  // An inserted clone would replay every CSS entrance it carries; the stylesheet's
  // static rule stills anything without `tm-motion`, so the exit plays alone.
  for (const el of [ghost, ...Array.from(ghost.querySelectorAll<HTMLElement>('.tm-motion'))]) el.classList.remove('tm-motion');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.setAttribute('inert', '');
  ghost.removeAttribute('role');
  ghost.dataset.exitGhost = 'true';
  ghost.style.pointerEvents = 'none';
  if (zIndex !== undefined) ghost.style.zIndex = String(zIndex);
  const before = node.nextSibling;

  queueMicrotask(() => {
    // Strict Mode re-ran the effect and kept the node: nothing is leaving.
    if (node.isConnected) return;
    parent.insertBefore(ghost, before && before.parentNode === parent ? before : null);
    if (scrolled.length) {
      const ghostAll = ghost.querySelectorAll<HTMLElement>('*');
      for (const [i, top, left] of scrolled) {
        const el = ghostAll[i];
        if (el) { el.scrollTop = top; el.scrollLeft = left; }
      }
    }
    let removed = false;
    const remove = () => { if (!removed) { removed = true; ghost.remove(); } };
    let animations: Animation[] = [];
    try { animations = animate(ghost); } catch { /* an exit is a nicety */ }
    if (!animations.length) { remove(); return; }
    Promise.allSettled(animations.map(a => a.finished)).then(remove, remove);
    // Belt and braces: a ghost must never outstay its exit.
    window.setTimeout(remove, MOTION_MS.slow + 200);
  });
}
