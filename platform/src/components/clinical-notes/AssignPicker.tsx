'use client';

/**
 * "Assigned to" as a list of people you click, rather than a bare <select>.
 *
 * Each row in the menu is the assign button: clicking a provider writes the
 * assignment straight away, so changing who owns a note is one click and the
 * clinician never has to hunt for a separate Save. The row currently in play
 * is ticked, and "None" is offered first so unassigning is as reachable as
 * assigning — a note handed back to the pool is a real move, not an edge case.
 *
 * The menu is portalled to document.body for the same reason CreateNoteButton's
 * is: inside the chart drawer every ancestor up to the app shell sets
 * `overflow: hidden`, which would clip a longer provider list out of reach.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';

export interface AssignOption {
  _id: string;
  name: string;
}

interface AssignPickerProps {
  /** Currently assigned provider id, if any. */
  value?: string;
  /** Name to show when nobody is assigned or the id is not in `options`. */
  valueName?: string;
  options: AssignOption[];
  disabled?: boolean;
  /** Called with the picked provider, or null to unassign. */
  onAssign: (option: AssignOption | null) => void | Promise<void>;
}

const MENU_WIDTH = 232;
const MENU_MAX_HEIGHT = 320;
const ROW_HEIGHT = 34;

export default function AssignPicker({
  value, valueName, options, disabled, onAssign,
}: AssignPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const trigger = wrapRef.current;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const height = Math.min(MENU_MAX_HEIGHT, (options.length + 1) * ROW_HEIGHT + 8);
    const spaceBelow = window.innerHeight - r.bottom;
    // Flip up only when below genuinely cannot hold the list — a menu that
    // jumps upward unnecessarily is more disorienting than a short scroll.
    const flip = spaceBelow < height + 12 && r.top > spaceBelow;
    setPos({
      top: flip ? Math.max(8, r.top - height - 6) : r.bottom + 6,
      left: Math.min(Math.max(8, r.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8),
    });
  }, [options.length]);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const reposition = () => place();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, place]);

  const choose = async (option: AssignOption | null) => {
    setOpen(false);
    if ((option?._id || '') === (value || '')) return;
    setSaving(true);
    try { await onAssign(option); } finally { setSaving(false); }
  };

  const current = options.find(o => o._id === value);
  const label = current?.name || valueName || 'None';

  const menu = open && pos && typeof document !== 'undefined' ? createPortal(
    <div
      className="cn-type-menu"
      ref={menuRef}
      role="menu"
      style={{ top: pos.top, left: pos.left, width: MENU_WIDTH, maxHeight: MENU_MAX_HEIGHT }}
    >
      <button
        type="button"
        role="menuitemradio"
        aria-checked={!value}
        className={`cn-type-item${!value ? ' is-selected' : ''}`}
        onClick={e => { e.stopPropagation(); void choose(null); }}
      >
        <span className="cn-type-tick" aria-hidden>{!value ? '✓' : ''}</span>
        {t('births.optNone')}
      </button>
      {options.map(option => {
        const selected = option._id === value;
        return (
          <button
            key={option._id}
            type="button"
            role="menuitemradio"
            aria-checked={selected}
            className={`cn-type-item${selected ? ' is-selected' : ''}`}
            onClick={e => { e.stopPropagation(); void choose(option); }}
          >
            <span className="cn-type-tick" aria-hidden>{selected ? '✓' : ''}</span>
            {option.name}
          </button>
        );
      })}
      {options.length === 0 && (
        <p className="cn-assign-empty">{t('ui.noProvidersAvailableToAssign')}</p>
      )}
    </div>,
    document.body,
  ) : null;

  return (
    <div className="cn-assign" ref={wrapRef}>
      <button
        type="button"
        className="cn-assign-trigger"
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        disabled={disabled || saving}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Assigned to ${label}. Change assignment`}
      >
        <span className="cn-assign-name">{saving ? 'Saving…' : label}</span>
        <ChevronDown size={13} aria-hidden />
      </button>
      {menu}
    </div>
  );
}
