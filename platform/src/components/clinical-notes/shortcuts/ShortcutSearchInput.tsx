'use client';

/**
 * The shortcut search box and its results popup, together.
 *
 * The box is a control the size of the other buttons in the section's tool
 * row. Clicking or focusing it opens the section's shortcuts as a floating
 * menu anchored underneath — portalled to <body> like `.cn-type-menu`,
 * because `.cn-section` clips its own overflow — and typing narrows the
 * rows. The popup closes on outside click, Escape, or choosing a row, so it
 * can always be dismissed without picking anything; before this it only
 * closed on Escape, which left the list stuck open under the note. Arrow
 * keys walk the rows and Enter takes the highlighted one.
 */

import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { Search } from '@/components/icons/lucide';
import type { ShortcutSearch } from './useShortcutSearch';

const POP_WIDTH = 360;
const POP_MAX_HEIGHT = 320;

interface PopPosition {
  /** Exclusive: the anchored edge is a number, the other null, so a menu that
   *  opens upward stays pinned to the box while its height changes. */
  top: number | null;
  bottom: number | null;
  left: number;
  width: number;
}

export default function ShortcutSearchInput({ search }: { search: ShortcutSearch }) {
  const fieldRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<PopPosition | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const place = useCallback(() => {
    const field = fieldRef.current;
    if (!field) return;
    const r = field.getBoundingClientRect();
    const width = Math.min(POP_WIDTH, window.innerWidth - 16);
    // Right-aligned to the box it hangs off, clamped on-screen.
    const left = Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8);
    const spaceBelow = window.innerHeight - r.bottom - 12;
    // Flip above only when below genuinely cannot hold a useful list.
    const flip = spaceBelow < 180 && r.top - 12 > spaceBelow;
    setPos({
      top: flip ? null : r.bottom + 6,
      bottom: flip ? window.innerHeight - r.top + 6 : null,
      left,
      width,
    });
  }, []);

  useLayoutEffect(() => { if (search.open) place(); }, [search.open, place]);

  // Outside click dismisses; the box and the popup itself do not count as
  // outside. Scroll and resize re-anchor the popup to the box.
  const { open, close } = search;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (fieldRef.current?.contains(t) || popRef.current?.contains(t)) return;
      close();
    };
    const reposition = () => place();
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, close, place]);

  // A new query means a new list; the highlight restarts at the top.
  useEffect(() => { setActiveIndex(0); }, [search.query, search.open]);

  // Filtering shrinks the list under the highlight; keep it in range.
  useEffect(() => {
    setActiveIndex(i => (search.results.length === 0 ? 0 : Math.min(i, search.results.length - 1)));
  }, [search.results.length]);

  useEffect(() => {
    if (!search.open) return;
    document.getElementById(`cn-shortcut-opt-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [search.open, activeIndex]);

  const menu = search.open && pos && typeof document !== 'undefined' ? createPortal(
    <div
      ref={popRef}
      id="cn-shortcut-results"
      role="listbox"
      aria-label="Text shortcut suggestions"
      className="cn-shortcut-pop"
      style={{
        top: pos.top ?? undefined,
        bottom: pos.bottom ?? undefined,
        left: pos.left,
        width: pos.width,
        maxHeight: POP_MAX_HEIGHT,
      }}
      // Prevented so that clicking a row does not blur the search box first:
      // the blur would close the list out from under the click.
      onMouseDown={e => e.preventDefault()}
    >
      {search.loading && <p className="cn-popover-empty">Loading…</p>}

      {!search.loading && search.results.length === 0 && (
        <p className="cn-popover-empty">
          {search.empty
            ? 'No shortcuts yet. Save one from a section to reuse it here.'
            : 'No shortcut matches that search.'}
        </p>
      )}

      {!search.loading && search.results.map((shortcut, i) => (
        <button
          key={shortcut._id}
          id={`cn-shortcut-opt-${i}`}
          type="button"
          role="option"
          aria-selected={i === activeIndex}
          className={`cn-popover-item${i === activeIndex ? ' is-active' : ''}`}
          onMouseEnter={() => setActiveIndex(i)}
          onClick={() => search.choose(shortcut)}
        >
          <span className="cn-popover-item-name">{shortcut.name}</span>
          <span className="cn-popover-item-body">{shortcut.body}</span>
        </button>
      ))}
    </div>,
    document.body,
  ) : null;

  return (
    <div className="cn-shortcut-field" ref={fieldRef}>
      <Search size={12} aria-hidden />
      <input
        className="cn-shortcut-input"
        placeholder="Shortcut…"
        value={search.query}
        aria-label="Search text shortcuts"
        // Without role="combobox" this is a plain textbox, which has no
        // expanded state — so aria-expanded was announced as nothing and a
        // screen-reader user never heard the suggestion list open.
        role="combobox"
        aria-controls="cn-shortcut-results"
        aria-expanded={search.open}
        aria-activedescendant={search.open && search.results.length > 0 ? `cn-shortcut-opt-${activeIndex}` : undefined}
        onFocus={search.openList}
        onClick={search.openList}
        onChange={(e) => { search.openList(); search.setQuery(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); search.close(); return; }
          if (!search.open) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex(i => (search.results.length ? (i + 1) % search.results.length : 0));
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex(i => (search.results.length ? (i - 1 + search.results.length) % search.results.length : 0));
            return;
          }
          if (e.key === 'Enter' && search.results.length > 0) {
            e.preventDefault();
            search.choose(search.results[Math.min(activeIndex, search.results.length - 1)]);
          }
        }}
      />
      {menu}
    </div>
  );
}
