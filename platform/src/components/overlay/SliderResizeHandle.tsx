'use client';

/**
 * Drag handle on a slider's (or the chart drawer's) inner edge. Drag it — or
 * focus it and use the arrow keys — to make the panel wider; drag it back and
 * it settles on the default width again, snapping the last stretch so the
 * standard size is easy to land on. Double-click or Home resets it.
 *
 * Every panel opens at the standard width (`--slider-std-w`); a widened panel
 * is that one panel, for as long as it is open. The handle overrides the
 * width variables on its parent only, so the shared CSS stays the default.
 */

import { useRef, useState } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';

/** Within this many px of the default, the panel snaps to it. */
const SNAP = 40;
const KEY_STEP = 32;
/** The page keeps at least this much room beside the panel. */
const MIN_PAGE = 320;

function defaultWidth(): number {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--slider-std-w'));
  return Number.isFinite(value) && value > 0 ? value : 560;
}

export default function SliderResizeHandle() {
  const { t } = useTranslation();
  const ref = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const apply = (next: number | null) => {
    const panel = ref.current?.parentElement;
    if (!panel) return;
    const base = defaultWidth();
    const max = Math.max(base, window.innerWidth - MIN_PAGE);
    const clamped = next == null ? null : Math.min(Math.max(next, base), max);
    // Dragged back close to the default: settle exactly on it.
    const settled = clamped == null || clamped - base < SNAP ? null : clamped;
    if (settled == null) {
      panel.style.removeProperty('--slider-std-w');
      panel.style.removeProperty('--chart-slider-w');
      panel.removeAttribute('data-resized');
    } else {
      panel.style.setProperty('--slider-std-w', `${settled}px`);
      panel.style.setProperty('--chart-slider-w', `${settled}px`);
      panel.setAttribute('data-resized', '');
    }
    setWidth(settled);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLSpanElement>) => {
    const panel = ref.current?.parentElement;
    if (!panel || event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panel.getBoundingClientRect().width;
    // The panel sits at the inline end, so its edge moves the other way in RTL.
    const rtl = getComputedStyle(panel).direction === 'rtl';
    setDragging(true);
    const move = (e: PointerEvent) => apply(startWidth + (rtl ? e.clientX - startX : startX - e.clientX));
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>) => {
    const current = width ?? defaultWidth();
    const rtl = ref.current?.parentElement && getComputedStyle(ref.current.parentElement).direction === 'rtl';
    const wider = rtl ? 'ArrowRight' : 'ArrowLeft';
    const narrower = rtl ? 'ArrowLeft' : 'ArrowRight';
    if (event.key === wider) apply(current + KEY_STEP);
    else if (event.key === narrower) apply(current - KEY_STEP);
    else if (event.key === 'Home') apply(null);
    else return;
    event.preventDefault();
  };

  // A span: the slider kit stretches every direct div child of a panel to fill it.
  return (
    <span
      ref={ref}
      className={`tm-resize-handle${dragging ? ' is-dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={t('overlay.resizePanel')}
      aria-valuenow={Math.round(width ?? 0) || undefined}
      title={t('overlay.resizePanelHint')}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => apply(null)}
      onKeyDown={onKeyDown}
    />
  );
}
