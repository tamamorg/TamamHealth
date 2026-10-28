'use client';

/**
 * Drag handle on the docked workspace's inner edge: drag it (or focus it and
 * use the arrow keys) to make the workspace wider or narrower; double-click
 * puts it back to the default width. The chart beside it squeezes to match.
 *
 * It sets `--tamam-drawer-w` on its parent (the `.tamam-drawer`), which
 * drawer-resize.css reads, so the shell's own width rules stay the default.
 * The chosen width is remembered per workspace kind (note vs other panels)
 * in this browser only.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import './drawer-resize.css';

const MIN_WIDTH = 360;
/** The chart keeps at least this much room beside the workspace. */
const MIN_CHART = 320;
const KEY_STEP = 32;

function readStored(key: string): number | null {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: number | null) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(Math.round(value)));
  } catch {
    // Private window or blocked storage: the width just isn't remembered.
  }
}

export default function DrawerResizeHandle({ storageKey }: { storageKey: string }) {
  const { t } = useTranslation();
  const handleRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const drawer = () => handleRef.current?.parentElement ?? null;

  const clamp = useCallback((value: number) => {
    const row = drawer()?.parentElement;
    const room = row ? row.clientWidth - MIN_CHART : window.innerWidth - MIN_CHART;
    return Math.max(MIN_WIDTH, Math.min(value, Math.max(MIN_WIDTH, room)));
  }, []);

  // Pick up the remembered width for this kind of workspace.
  useEffect(() => {
    const stored = readStored(storageKey);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- storage is only readable after mount
    setWidth(stored == null ? null : clamp(stored));
  }, [storageKey, clamp]);

  // Apply it to the drawer.
  useEffect(() => {
    const el = drawer();
    if (!el) return;
    if (width == null) {
      el.style.removeProperty('--tamam-drawer-w');
      el.removeAttribute('data-resized');
    } else {
      el.style.setProperty('--tamam-drawer-w', `${width}px`);
      el.setAttribute('data-resized', '');
    }
  }, [width]);

  const commit = (value: number | null) => {
    setWidth(value);
    writeStored(storageKey, value);
  };

  // The workspace sits on the inline-end side of the chart, so dragging
  // toward the start edge (left in LTR, right in RTL) makes it wider.
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = drawer();
    if (!el || event.button !== 0) return;
    event.preventDefault();
    const rtl = getComputedStyle(el).direction === 'rtl';
    const startX = event.clientX;
    const startWidth = el.getBoundingClientRect().width;
    let latest = startWidth;
    setDragging(true);
    const move = (e: PointerEvent) => {
      const delta = rtl ? e.clientX - startX : startX - e.clientX;
      latest = clamp(startWidth + delta);
      setWidth(latest);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setDragging(false);
      writeStored(storageKey, latest);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const el = drawer();
    if (!el) return;
    const rtl = getComputedStyle(el).direction === 'rtl';
    const current = el.getBoundingClientRect().width;
    const wider = rtl ? 'ArrowRight' : 'ArrowLeft';
    const narrower = rtl ? 'ArrowLeft' : 'ArrowRight';
    if (event.key === wider) { event.preventDefault(); commit(clamp(current + KEY_STEP)); }
    else if (event.key === narrower) { event.preventDefault(); commit(clamp(current - KEY_STEP)); }
    else if (event.key === 'Home') { event.preventDefault(); commit(null); }
  };

  return (
    <div
      ref={handleRef}
      className={dragging ? 'tamam-drawer-resize is-dragging' : 'tamam-drawer-resize'}
      role="separator"
      aria-orientation="vertical"
      aria-label={t('chart.resizeWorkspace')}
      title={t('chart.resizeWorkspaceHint')}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => commit(null)}
      onKeyDown={onKeyDown}
    />
  );
}
