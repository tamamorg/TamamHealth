'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Pencil } from '@/components/icons/lucide';

export type RowAction = {
  key: string;
  label: string;
  icon?: React.ReactNode;
  tone?: 'default' | 'success' | 'danger';
  disabled?: boolean;
  onClick: () => void;
};

/**
 * Shared row-action menu (pencil trigger) used across every data table in
 * the platform. The dropdown is portalled to <body> with fixed positioning so
 * it is never clipped by a table's `overflow:auto` scroll container, and the
 * trigger keeps each row's action area to a single compact button regardless of
 * how many actions a row offers.
 */
export default function RowActionsMenu({ actions, ariaLabel = 'Actions' }: { actions: RowAction[]; ariaLabel?: string }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  const MENU_WIDTH = 200;

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const left = Math.max(8, r.right - MENU_WIDTH);
    setCoords({ top: r.bottom + 6, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onScroll = () => setOpen(false);
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
  }, [open]);

  if (!actions.length) return null;

  const toneColor = (tone?: string) =>
    tone === 'success' ? 'var(--color-success)' : tone === 'danger' ? 'var(--color-danger)' : 'var(--text-primary)';

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        className="inline-flex items-center justify-center w-8 h-8 rounded-lg transition-colors hover:bg-[var(--overlay-subtle)]"
        style={{ border: '1px solid var(--border-medium)', background: 'var(--bg-card-solid)', color: 'var(--text-secondary)' }}
      >
        <Pencil className="w-4 h-4" />
      </button>
      {open && coords && createPortal(
        <div
          ref={menuRef}
          className="fixed rounded-xl overflow-hidden py-1"
          style={{ top: coords.top, left: coords.left, width: MENU_WIDTH, zIndex: 1000, background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', boxShadow: 'var(--card-shadow-lg, 0 16px 48px rgba(0,0,0,0.2))' }}
        >
          {actions.map(a => (
            <button
              key={a.key}
              type="button"
              disabled={a.disabled}
              onClick={(e) => { e.stopPropagation(); setOpen(false); a.onClick(); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] font-medium text-left transition-colors hover:bg-[rgba(33,145,208,0.12)] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ color: toneColor(a.tone) }}
            >
              {a.icon}
              <span>{a.label}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
