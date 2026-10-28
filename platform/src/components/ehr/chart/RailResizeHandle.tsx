'use client';

/**
 * Drag handle on the chart section list's inner edge: drag it (or focus it
 * and use the arrow keys) to make the list wider or narrower. Squeezed below
 * ICON_SNAP it snaps to an icon-only column, and dragging back out brings the
 * labels back. Double-click (or Home) returns to the default width.
 *
 * It sets `--tamam-rail-w` plus `data-resized` / `data-icons` on its parent
 * (`.tamam-rail-col`), which chart-frame.css reads. The width is remembered
 * in this browser only.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';

const STORAGE_KEY = 'tamam-rail-w';
/** Icon-only column: one 16px glyph with 20px either side. */
const ICON_WIDTH = 56;
/** Below this the labels no longer fit beside the icons. */
const ICON_SNAP = 150;
const MAX_WIDTH = 360;
const KEY_STEP = 24;

function readStored(): number | null {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeStored(value: number | null) {
  try {
    if (value == null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(Math.round(value)));
  } catch {
    // Private window or blocked storage: the width just isn't remembered.
  }
}

/** A dragged width, snapped: too narrow for labels means icons only. */
function settle(value: number): number {
  if (value < ICON_SNAP) return ICON_WIDTH;
  return Math.min(value, MAX_WIDTH);
}

export default function RailResizeHandle() {
  const { t } = useTranslation();
  const handleRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const column = () => handleRef.current?.parentElement ?? null;

  useEffect(() => {
    const stored = readStored();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- storage is only readable after mount
    setWidth(stored == null ? null : settle(stored));
  }, []);

  useEffect(() => {
    const el = column();
    if (!el) return;
    if (width == null) {
      el.style.removeProperty('--tamam-rail-w');
      el.removeAttribute('data-resized');
      el.removeAttribute('data-icons');
    } else {
      el.style.setProperty('--tamam-rail-w', `${width}px`);
      el.setAttribute('data-resized', '');
      if (width <= ICON_WIDTH) el.setAttribute('data-icons', '');
      else el.removeAttribute('data-icons');
    }
  }, [width]);

  const commit = useCallback((value: number | null) => {
    setWidth(value);
    writeStored(value);
  }, []);

  // The list sits on the inline-start side of the chart, so dragging toward
  // the end edge (right in LTR, left in RTL) makes it wider.
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = column();
    if (!el || event.button !== 0) return;
    event.preventDefault();
    const rtl = getComputedStyle(el).direction === 'rtl';
    const startX = event.clientX;
    const startWidth = el.getBoundingClientRect().width;
    let latest = startWidth;
    setDragging(true);
    const move = (e: PointerEvent) => {
      const delta = rtl ? startX - e.clientX : e.clientX - startX;
      latest = settle(startWidth + delta);
      setWidth(latest);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setDragging(false);
      writeStored(latest);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const el = column();
    if (!el) return;
    const rtl = getComputedStyle(el).direction === 'rtl';
    const current = el.getBoundingClientRect().width;
    const wider = rtl ? 'ArrowLeft' : 'ArrowRight';
    const narrower = rtl ? 'ArrowRight' : 'ArrowLeft';
    if (event.key === wider) {
      event.preventDefault();
      // From icons only, one step out goes straight back to a labelled list.
      commit(settle(current <= ICON_WIDTH ? ICON_SNAP : current + KEY_STEP));
    } else if (event.key === narrower) {
      event.preventDefault();
      commit(settle(current - KEY_STEP));
    } else if (event.key === 'Home') {
      event.preventDefault();
      commit(null);
    }
  };

  return (
    <div
      ref={handleRef}
      className={dragging ? 'tamam-rail-resize is-dragging' : 'tamam-rail-resize'}
      role="separator"
      aria-orientation="vertical"
      aria-label={t('chart.resizeSections')}
      title={t('chart.resizeSectionsHint')}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => commit(null)}
      onKeyDown={onKeyDown}
    />
  );
}
