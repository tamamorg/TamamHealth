'use client';

/**
 * "More" — the overflow menu at the end of the visit panel's action line.
 *
 * The line used to carry every verb as its own pill: Open chart, Review
 * triage, Move, Escalate, LWBS, Return to desk, then the note button. Seven
 * equal-weight buttons meant the two a clinician presses on nearly every visit
 * sat in a row with the exits they press a few times a week, and the row
 * wrapped on a tablet. The line now keeps what moves a visit FORWARD; what
 * looks back, re-routes or ends it lives here.
 *
 * A menu also has room a pill does not, so each entry says what it does in
 * plain words ("Left without being seen", not "LWBS") and carries a one-line
 * consequence underneath — these are the actions a clinician should read
 * before pressing.
 *
 * Portalled to `document.body` for the same reason CreateNoteButton's list is:
 * every ancestor from the inline visit panel up to the app shell clips its
 * overflow, and the menu opens from the last control on the row.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from '@/components/icons/lucide';

export type VisitMoreItem = {
  key: string;
  label: string;
  /** One line on what pressing it does — shown under the label. */
  hint?: string;
  icon: ReactNode;
  onSelect: () => void;
  /** `danger` marks an action that closes the visit. */
  tone?: 'default' | 'danger';
  /** Items sharing a group sit together; a hairline separates groups. */
  group?: string;
};

const MENU_WIDTH = 288;
const ROW_HEIGHT = 52;

export default function EhrVisitMoreMenu({ items, label }: {
  items: VisitMoreItem[];
  /** The trigger's word — passed in so it arrives translated. */
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const height = items.length * ROW_HEIGHT + 16;
    const spaceBelow = window.innerHeight - r.bottom;
    // Flip above only when below genuinely cannot hold it (see CreateNoteButton).
    const flip = spaceBelow < height + 12 && r.top > spaceBelow;
    setPos({
      top: flip ? Math.max(8, r.top - height - 6) : r.bottom + 6,
      // Right edges aligned: the trigger is the last control on the line, so a
      // left-aligned menu would run off the panel.
      left: Math.min(Math.max(8, r.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8),
    });
  }, [items.length]);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Opening from the keyboard lands on the first entry, as a menu should.
  useEffect(() => {
    if (!open || !pos) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [open, pos]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(true); return; }
      if (e.key === 'Tab') { setOpen(false); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      const entries = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
      if (entries.length === 0) return;
      e.preventDefault();
      const at = entries.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === 'Home' ? 0
        : e.key === 'End' ? entries.length - 1
        : e.key === 'ArrowDown' ? (at + 1) % entries.length
        : (at - 1 + entries.length) % entries.length;
      entries[next].focus();
    };
    const reposition = () => place();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, place, close]);

  if (items.length === 0) return null;

  const menu = open && pos && typeof document !== 'undefined' ? createPortal(
    <div
      className="ehr-visit-more-menu"
      ref={menuRef}
      role="menu"
      aria-label={label}
      style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
    >
      {items.map((item, index) => {
        const newGroup = index > 0 && item.group !== items[index - 1].group;
        return (
          <div key={item.key} role="none" className={newGroup ? 'ehr-visit-more-group' : undefined}>
            <button
              type="button"
              role="menuitem"
              className="ehr-visit-more-item"
              data-tone={item.tone === 'danger' ? 'danger' : undefined}
              onClick={(e) => { e.stopPropagation(); close(false); item.onSelect(); }}
            >
              <span className="ehr-visit-more-glyph" aria-hidden>{item.icon}</span>
              <span className="ehr-visit-more-text">
                <strong>{item.label}</strong>
                {item.hint && <small>{item.hint}</small>}
              </span>
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="ehr-visit-pop-icon ehr-visit-pop-labelled ehr-visit-more-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
      >
        {label} <ChevronDown className="w-3.5 h-3.5" aria-hidden />
      </button>
      {menu}
    </>
  );
}
