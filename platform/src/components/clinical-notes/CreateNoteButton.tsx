'use client';

/**
 * "Create Clinical Note" — a split button: the main half starts the note the
 * clinician most likely wants, the caret opens the full type list.
 *
 * The split matters because the common case and the complete case pull in
 * opposite directions. Making everyone choose from thirteen types before they
 * can start documenting taxes every visit for the sake of the rare one; hiding
 * the list entirely means an OB evaluation or a phone note has to be started
 * wrong and retyped. The default is derived from context (ANC reason → OB
 * Evaluation), so the fast path
 * is usually right and the list is one click away when it is not.
 *
 * The menu renders in a portal on `document.body`. It has to: the button lives
 * inside the queue row's inline visit panel, and every ancestor from that panel
 * up to the app shell sets `overflow: hidden`, which cut the list off partway
 * down — five of the thirteen types were unreachable. Fixed positioning off the
 * trigger's rect escapes all of them, and lets the menu flip above the button
 * when it would otherwise run off the bottom of the window.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ClipboardPen } from '@/components/icons/lucide';
import {
  NOTE_TYPE_ORDER, NOTE_TYPES, type NoteTypeId,
} from '@/lib/clinical-notes/note-catalog';
import './clinical-notes.css';

interface CreateNoteButtonProps {
  onCreate: (noteType: NoteTypeId) => void;
  /** Type the main half creates. Defaults to SOAP. */
  defaultType?: NoteTypeId;
  disabled?: boolean;
  label?: string;
  /** Match a neutral toolbar instead of using the primary fill. */
  tone?: 'primary' | 'neutral';
  className?: string;
}

const MENU_WIDTH = 190;
const MENU_MAX_HEIGHT = 420;
const ROW_HEIGHT = 34;

/**
 * Selected type first, then the rest alphabetically.
 *
 * The type in play sits at the top so the list opens on what is already chosen
 * and a mis-click reverts in one move; everything below is alphabetical because
 * with thirteen entries and no frequency data, alphabetical is the only order a
 * clinician can predict.
 */
export function noteTypeMenuOrder(selected: NoteTypeId): NoteTypeId[] {
  const rest = NOTE_TYPE_ORDER
    .filter(id => id !== selected)
    .sort((a, b) => NOTE_TYPES[a].label.localeCompare(NOTE_TYPES[b].label));
  return [selected, ...rest];
}

export default function CreateNoteButton({
  onCreate, defaultType = 'soap', disabled, label = 'Create clinical note',
  tone = 'primary', className = '',
}: CreateNoteButtonProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const trigger = wrapRef.current;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const height = Math.min(MENU_MAX_HEIGHT, NOTE_TYPE_ORDER.length * ROW_HEIGHT + 8);
    const spaceBelow = window.innerHeight - r.bottom;
    // Flip above only when below genuinely cannot hold it — a menu that jumps
    // upward when it did not need to is more disorienting than a short scroll.
    const flip = spaceBelow < height + 12 && r.top > spaceBelow;
    setPos({
      top: flip ? Math.max(8, r.top - height - 6) : r.bottom + 6,
      left: Math.min(Math.max(8, r.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8),
    });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    // The trigger sits in a scrollable queue; reposition rather than let the
    // menu drift away from the button it belongs to.
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

  const choose = (type: NoteTypeId) => { setOpen(false); onCreate(type); };
  const toneClass = tone === 'primary' ? 'cn-btn-primary' : 'cn-btn-neutral';

  const menu = open && pos && typeof document !== 'undefined' ? createPortal(
    <div
      className="cn-type-menu"
      ref={menuRef}
      role="menu"
      style={{ top: pos.top, left: pos.left, width: MENU_WIDTH, maxHeight: MENU_MAX_HEIGHT }}
    >
      {noteTypeMenuOrder(defaultType).map((id) => {
        const def = NOTE_TYPES[id];
        const selected = id === defaultType;
        return (
          <button
            key={id}
            type="button"
            role="menuitemradio"
            aria-checked={selected}
            className={`cn-type-item${selected ? ' is-selected' : ''}`}
            title={def.description}
            onClick={(e) => { e.stopPropagation(); choose(id); }}
          >
            <span className="cn-type-tick" aria-hidden>{selected ? '✓' : ''}</span>
            {def.label}
          </button>
        );
      })}
    </div>,
    document.body,
  ) : null;

  return (
    <div className={`cn-split ${className}`} ref={wrapRef}>
      {/* The label states the action and the glyph repeats it, so the half a
          clinician reads and the half they press are the same one. The type it
          will use is in the tooltip rather than the label — the word that has to
          survive a glance is "note", not "SOAP". */}
      <button
        type="button"
        className={`cn-btn ${toneClass} cn-split-main`}
        onClick={(e) => { e.stopPropagation(); choose(defaultType); }}
        disabled={disabled}
        title={`New ${NOTE_TYPES[defaultType].label} note`}
      >
        <ClipboardPen size={15} aria-hidden />
        {label}
      </button>

      <button
        type="button"
        className={`cn-btn ${toneClass} cn-split-caret`}
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Choose note type"
        title="Choose note type"
      >
        <ChevronDown size={13} />
      </button>

      {menu}
    </div>
  );
}

/**
 * Pick the type a visit most likely needs, so the split button's fast half is
 * usually correct. Maternity is decided by the reason for visit, which is how
 * an ANC booking reaches the clinic.
 */
export function defaultNoteTypeFor(input: {
  reason?: string;
  role?: string;
}): NoteTypeId {
  const reason = (input.reason || '').toLowerCase();
  if (/\banc\b|antenatal|obstetric|pregnan|maternity/.test(reason)) return 'ob_evaluation';
  if (input.role === 'nurse' || input.role === 'triage_nurse' || input.role === 'rooming_nurse') {
    return 'nurse_visit';
  }
  if (input.role === 'midwife') return 'ob_evaluation';
  return 'soap';
}
