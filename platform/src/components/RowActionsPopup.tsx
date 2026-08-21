'use client';

/**
 * Row actions opened by clicking the ROW, not a trailing button.
 *
 * `RowActionsMenu` puts a pencil in a column of its own on every row. That
 * column costs horizontal space on tables that are already tight, and it makes
 * the actions findable only by aiming at a 32px target — while the whole row is
 * sitting there being the obvious thing to click.
 *
 * This is the same menu, opened from wherever the pointer was. One instance per
 * list rather than one per row: the page keeps a single piece of state naming
 * which row is open and where, so a hundred rows cost one portal, not a hundred.
 *
 * Positioning is clamped to the viewport — a click near the right or bottom
 * edge would otherwise open a menu half off-screen, which on a laptop is most
 * of the last column and every row near the fold.
 */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { RowAction } from './RowActionsMenu';

/** Where the menu is anchored, and what it offers. Null = closed. */
export interface RowActionsPopupState {
  actions: RowAction[];
  x: number;
  y: number;
}

const MENU_WIDTH = 200;
const ROW_HEIGHT = 34;
const EDGE_GAP = 8;

/** Open state for a click event — call from a row's `onClick`. */
export function rowActionsAt(event: { clientX: number; clientY: number }, actions: RowAction[]): RowActionsPopupState {
  return { actions, x: event.clientX, y: event.clientY };
}

export default function RowActionsPopup({
  state, onClose,
}: {
  state: RowActionsPopupState | null;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    // Any scroll detaches the menu from the row it belongs to, so close rather
    // than let it float over unrelated content.
    const onScroll = () => onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [state, onClose]);

  if (!state || state.actions.length === 0) return null;

  const height = state.actions.length * ROW_HEIGHT + 8;
  const left = Math.min(state.x, window.innerWidth - MENU_WIDTH - EDGE_GAP);
  const top = state.y + height + EDGE_GAP > window.innerHeight
    ? Math.max(EDGE_GAP, state.y - height)   // flip above the pointer
    : state.y + EDGE_GAP;

  const toneColor = (tone?: string) =>
    tone === 'success' ? 'var(--color-success)' : tone === 'danger' ? 'var(--color-danger)' : 'var(--text-primary)';

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className="fixed rounded-xl overflow-hidden py-1"
      style={{
        top, left: Math.max(EDGE_GAP, left), width: MENU_WIDTH, zIndex: 1000,
        background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)',
        boxShadow: 'var(--card-shadow-lg, 0 16px 48px rgba(0,0,0,0.2))',
      }}
    >
      {state.actions.map(a => (
        <button
          key={a.key}
          type="button"
          role="menuitem"
          disabled={a.disabled}
          onClick={(e) => { e.stopPropagation(); onClose(); a.onClick(); }}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] font-bold text-start transition-colors hover:bg-[rgba(33,145,208,0.12)] disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ color: toneColor(a.tone) }}
        >
          {a.icon}
          <span>{a.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
