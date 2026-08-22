'use client';

/**
 * Searchable drop-in replacement for a native `<select>`.
 *
 * Usage is identical to the element it replaces — same props, same
 * `<option>` children, same `onChange(e => e.target.value)` — so converting a
 * dropdown is a one-word change:
 *
 *   <select value={x} onChange={e => setX(e.target.value)}>…</select>
 *   <Select value={x} onChange={e => setX(e.target.value)}>…</Select>
 *
 * WHY THE REAL `<select>` IS STILL RENDERED: this app styles dropdowns through
 * 70-odd bare `select` rules in globals.css plus per-module overrides
 * (`.ehr-chart-page select`, `.ehr-status-menu select.active`, …). A custom
 * trigger element would match none of them and every one of those rules would
 * have to be mirrored by hand. So the native control stays exactly where it
 * was — it keeps the styling, the form value, the label association and the
 * `required` validation — and this component only intercepts the *opening* of
 * the OS dropdown, replacing that one moment with a searchable listbox.
 *
 * Picking a row writes through the native value setter and dispatches a real
 * `change` event, so the parent's existing handler fires exactly as it would
 * have from the OS dropdown. Nothing downstream can tell the difference.
 *
 * The filter box appears once the list is long enough to be worth searching
 * (`searchThreshold`, default 7) and opens *on top of* the trigger, at its
 * exact position and height, keeping the current label as its placeholder — so
 * the bar you clicked is the bar you type in, and the rows fall out beneath it
 * as the query narrows. Shorter lists get the same popup without the filter
 * box, so every dropdown in the app looks and behaves the same way.
 */

import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from '@/components/icons/lucide';

interface SelectOptionItem {
  value: string;
  label: string;
  disabled: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Render the filter box once the list is at least this long. */
  searchThreshold?: number;
  /** Placeholder for the filter box. */
  searchPlaceholder?: string;
}

const MENU_MAX_HEIGHT = 320;
const ROW_HEIGHT = 36;
/** `.tsel-list` padding, top + bottom. */
const LIST_PADDING = 12;
/**
 * How far past the trigger the popup may grow to fit a long option. A staff
 * label like "Dr. James Wani Igga · Physician, Internal Medicine · Busy 09:00"
 * is half again the width of the box it hangs off; clipping it to the trigger
 * hides the part that distinguishes one clinician from the next.
 */
const MENU_MAX_WIDTH = 520;

/**
 * Where the popup sits. `top` and `bottom` are exclusive: whichever edge is
 * anchored is a number, the other is null, so a list that opens upward stays
 * pinned to the trigger while it grows rather than drifting.
 */
interface MenuPosition {
  top: number | null;
  bottom: number | null;
  left: number;
  width: number;
  maxHeight: number;
  /** Trigger metrics, so the in-place filter box can impersonate it. */
  triggerHeight: number;
  triggerFontSize: string;
}

/**
 * Mark the run of characters the query matched, so a filtered list shows *why*
 * each row survived — the matched letters carry the accent, the rest stays
 * ordinary text.
 */
function markMatch(label: string, query: string): ReactNode {
  const q = query.trim();
  if (!q) return label;
  const at = label.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return label;
  return (
    <>
      {label.slice(0, at)}
      <mark className="tsel-mark">{label.slice(at, at + q.length)}</mark>
      {label.slice(at + q.length)}
    </>
  );
}

/** Flatten an option's children down to the text the row should display. */
function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children);
  return '';
}

/**
 * Read the `<option>` elements out of the children so the popup can render
 * them as rows. Recurses through fragments and `.map()` arrays; anything that
 * is not an option (a stray wrapper) is walked into rather than dropped.
 */
function collectOptions(nodes: ReactNode, out: SelectOptionItem[]): void {
  Children.forEach(nodes, child => {
    if (!isValidElement(child)) return;
    const props = child.props as {
      value?: string | number | readonly string[];
      children?: ReactNode;
      disabled?: boolean;
    };
    if (child.type === 'option') {
      const label = nodeText(props.children);
      out.push({
        // An <option> with no value attribute submits its own text — mirror
        // that here so the popup writes back the same string the native
        // control would have.
        value: props.value === undefined ? label : String(props.value),
        label,
        disabled: Boolean(props.disabled),
      });
      return;
    }
    if (props?.children) collectOptions(props.children, out);
  });
}

/**
 * Set a select's value the way a user would, bypassing React's internal value
 * tracker so the subsequent `change` event is not deduped as a no-op.
 */
function commitValue(el: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(el) as object,
    'value',
  )?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export default function Select({
  searchThreshold = 7,
  searchPlaceholder = 'Search…',
  children,
  ...selectProps
}: SelectProps) {
  const selectRef = useRef<HTMLSelectElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  /** The trigger's value as of the moment the popup opened (uncontrolled use). */
  const [openValue, setOpenValue] = useState('');
  const [pos, setPos] = useState<MenuPosition | null>(null);
  /**
   * Width the popup settled on after being measured against its longest
   * option. Null until that measurement runs, which is one frame after the
   * rows exist — the popup opens at the trigger's width and widens only if
   * something in it is actually being clipped. Held in a ref as well as state
   * because `place` has to read it on every scroll and resize; the state copy
   * only exists to re-run `place` once the measurement lands.
   */
  const grownWidthRef = useRef<number | null>(null);
  const [grownWidth, setGrownWidth] = useState<number | null>(null);

  const options = useMemo(() => {
    const out: SelectOptionItem[] = [];
    collectOptions(children, out);
    return out;
  }, [children]);

  const showSearch = options.length >= searchThreshold;

  const currentValue = selectProps.value !== undefined
    ? String(selectProps.value)
    : undefined;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => o.label.toLowerCase().includes(q));
  }, [options, query]);

  // The filter box covers the trigger, so it carries the trigger's own text as
  // its placeholder: opening changes nothing on screen but the caret, and an
  // empty query still reads as the current selection ("Select patient…").
  // A controlled value that matches no option leaves the native control showing
  // its first row instead — in that case trust what is on screen, which is the
  // value openMenu read off the DOM.
  const selectedValue = currentValue !== undefined && options.some(o => o.value === currentValue)
    ? currentValue
    : openValue;

  const triggerLabel = useMemo(
    () => options.find(o => o.value === selectedValue)?.label.trim() || '',
    [options, selectedValue],
  );

  const place = useCallback(() => {
    const trigger = selectRef.current;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    // Sized from the whole list, not the filtered one: which side the rows
    // fall on is decided once, so narrowing the query never flips the popup
    // over the box being typed into.
    const rows = Math.min(options.length, 8);
    const listHeight = Math.min(MENU_MAX_HEIGHT, rows * ROW_HEIGHT + 8);
    // Both measured with the 12px breathing gap already subtracted, so `room`
    // below is space the popup may actually occupy rather than space it has to
    // remember to give back.
    const spaceBelow = window.innerHeight - r.bottom - 12;
    const spaceAbove = r.top - 12;
    // Once measured, the popup keeps its widened size; the left edge is
    // re-derived from the trigger on every call so it still tracks the box
    // when the page behind it scrolls.
    const width = Math.max(r.width, grownWidthRef.current ?? 0);
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8));
    // Flip up only when below genuinely cannot hold the list — matching
    // AssignPicker, where an unnecessary jump upward reads as a glitch.
    const flip = spaceBelow < listHeight && spaceAbove > spaceBelow;
    // Never taller than the side it opens on. This used to carry a 140px floor,
    // which meant a trigger near the bottom of the window got a popup longer
    // than the gap it had to live in — the overhanging rows were painted past
    // the viewport edge, unreachable, and the list reported itself as fully
    // visible so nothing scrolled to bring them back.
    const room = Math.min(MENU_MAX_HEIGHT, Math.max(ROW_HEIGHT + LIST_PADDING, flip ? spaceAbove : spaceBelow));
    // Round the list down to whole rows, so a scrolling menu ends on a clean
    // edge instead of slicing a name in half.
    const listMax = Math.max(1, Math.floor((room - LIST_PADDING) / ROW_HEIGHT)) * ROW_HEIGHT
      + LIST_PADDING;
    setPos({
      // With the filter box in place of the trigger, the popup starts at the
      // trigger's own top edge (or ends at its bottom edge when flipped) —
      // it does not hang below a bar it has replaced.
      top: flip ? null : (showSearch ? r.top : r.bottom + 6),
      bottom: flip
        ? (showSearch ? window.innerHeight - r.bottom : window.innerHeight - r.top + 6)
        : null,
      left,
      width,
      maxHeight: (showSearch ? r.height : 0) + listMax,
      triggerHeight: r.height,
      triggerFontSize: window.getComputedStyle(trigger).fontSize,
    });
  }, [options.length, showSearch]);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  // Measured once per opening, not per keystroke: a popup that resized itself
  // as the query narrowed would jump under the cursor mid-read.
  useLayoutEffect(() => {
    if (!open) {
      grownWidthRef.current = null;
      setGrownWidth(null);
      return;
    }
    if (!pos || grownWidth !== null) return;
    const list = listRef.current;
    if (!list) return;
    let clipped = 0;
    list.querySelectorAll<HTMLElement>('.tsel-row-label').forEach(el => {
      clipped = Math.max(clipped, el.scrollWidth - el.clientWidth);
    });
    // `pos.width` even when nothing is clipped, so the guard above stops this
    // from re-measuring on every reposition.
    const width = clipped <= 0 ? pos.width : Math.min(
      Math.max(pos.width, MENU_MAX_WIDTH),
      window.innerWidth - 16,
      pos.width + clipped + 2,
    );
    grownWidthRef.current = width;
    setGrownWidth(width);
  }, [open, pos, grownWidth]);

  // Re-place with the measured width so the left edge is re-clamped against it.
  useLayoutEffect(() => {
    if (open && grownWidth !== null) place();
  }, [open, grownWidth, place]);

  // Opening lands on the row already selected, so Enter without touching
  // anything is a no-op rather than a silent jump to the top of the list.
  const openMenu = useCallback((seed?: string) => {
    if (selectProps.disabled) return;
    const el = selectRef.current;
    // An uncontrolled trigger keeps its value in the DOM, where render cannot
    // read it — take a copy on open, which is the only moment the popup needs
    // to know what is currently selected.
    const value = el?.value ?? '';
    setOpenValue(value);
    const at = options.findIndex(o => o.value === value);
    setQuery(seed ?? '');
    setActiveIndex(at >= 0 ? at : 0);
    setOpen(true);
  }, [options, selectProps.disabled]);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    setQuery('');
    if (refocus) selectRef.current?.focus();
  }, []);

  const pick = useCallback((option: SelectOptionItem) => {
    if (option.disabled) return;
    const el = selectRef.current;
    setOpen(false);
    setQuery('');
    if (el) {
      commitValue(el, option.value);
      el.focus();
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (selectRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      close(false);
    };
    const reposition = () => place();
    // Escape belongs to the popup, not to whatever is behind it. The menu is
    // portaled to <body>, so an unhandled Escape carried on up to the dialog
    // that owns the trigger and closed that too — dismissing a dropdown threw
    // away the half-filled form underneath it. Captured on `document`, this
    // runs before the dialog's own window-level listener and stops it there.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, close, place]);

  // Filtering shrinks the list under the cursor; keep the highlight in range.
  useEffect(() => {
    setActiveIndex(i => (filtered.length === 0 ? 0 : Math.min(i, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    if (!open) return;
    if (showSearch) searchRef.current?.focus();
    else menuRef.current?.focus();
  }, [open, showSearch]);

  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    row?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  // ── The one behaviour we take from the native control: opening it. ──
  const onTriggerMouseDown = (e: React.MouseEvent<HTMLSelectElement>) => {
    if (selectProps.disabled) return;
    // preventDefault is what suppresses the OS dropdown. The event still
    // bubbles, so rows that were clickable behind a native select stay that way.
    e.preventDefault();
    if (open) close();
    else openMenu();
  };

  const onTriggerKeyDown = (e: ReactKeyboardEvent<HTMLSelectElement>) => {
    if (selectProps.disabled || open) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openMenu();
      return;
    }
    // Typing a letter on a native select jumps to the matching option; here it
    // opens the popup with that letter already in the filter.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      openMenu(e.key);
    }
  };

  // Escape is not handled here — the document-level capture listener installed
  // while the popup is open takes it first, so that the dialog behind never
  // sees the key at all.
  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key === 'Tab') { close(false); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => (filtered.length ? (i + 1) % filtered.length : 0));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => (filtered.length ? (i - 1 + filtered.length) % filtered.length : 0));
      return;
    }
    if (e.key === 'Home') { e.preventDefault(); setActiveIndex(0); return; }
    if (e.key === 'End') { e.preventDefault(); setActiveIndex(Math.max(0, filtered.length - 1)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const option = filtered[activeIndex];
      if (option) pick(option);
    }
  };

  const menu = open && pos && typeof document !== 'undefined' ? createPortal(
    <div
      ref={menuRef}
      className={`tsel-menu${showSearch ? ' is-inline' : ''}${pos.bottom !== null ? ' is-flipped' : ''}`}
      tabIndex={-1}
      style={{
        top: pos.top ?? undefined,
        bottom: pos.bottom ?? undefined,
        left: pos.left,
        width: pos.width,
        maxHeight: pos.maxHeight,
        '--tsel-trigger-h': `${pos.triggerHeight}px`,
        '--tsel-trigger-fs': pos.triggerFontSize,
      } as React.CSSProperties}
      onKeyDown={onMenuKeyDown}
    >
      {showSearch && (
        <div className="tsel-search">
          <Search className="tsel-search-icon" aria-hidden />
          <input
            ref={searchRef}
            type="text"
            value={query}
            placeholder={triggerLabel || searchPlaceholder}
            aria-label={searchPlaceholder}
            onChange={e => { setQuery(e.target.value); setActiveIndex(0); }}
          />
          {/* The trigger's chevron is hidden underneath — keep one here so the
              bar still reads as a dropdown. Once a query narrows the list it
              gives way to the number of rows left, which is the more useful
              thing to know at that point. */}
          {query.trim()
            ? <span className="tsel-search-count">{filtered.length}</span>
            : <ChevronDown className="tsel-search-caret" aria-hidden />}
        </div>
      )}
      <div className="tsel-list" role="listbox" ref={listRef}>
        {filtered.map((option, i) => {
          const selected = option.value === selectedValue;
          return (
            <button
              key={`${option.value}-${i}`}
              type="button"
              role="option"
              aria-selected={selected}
              disabled={option.disabled}
              className={`tsel-row${selected ? ' is-selected' : ''}${i === activeIndex ? ' is-active' : ''}`}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => pick(option)}
            >
              <span className="tsel-row-label">{option.label ? markMatch(option.label, query) : ' '}</span>
              {selected && <Check className="tsel-row-tick" aria-hidden />}
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p className="tsel-empty">
            {query.trim() ? `No match for “${query.trim()}”` : 'Nothing to choose from.'}
          </p>
        )}
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <select
        {...selectProps}
        ref={selectRef}
        // No aria-haspopup: a native <select> carries listbox semantics
        // implicitly, and the attribute is not supported on that role — screen
        // readers either ignore it or announce the control twice.
        aria-expanded={open}
        onMouseDown={onTriggerMouseDown}
        onKeyDown={onTriggerKeyDown}
      >
        {children}
      </select>
      {menu}
    </>
  );
}
