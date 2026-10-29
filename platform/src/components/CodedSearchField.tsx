'use client';

/**
 * CodedSearchField — the "label above a search input, dropdown of code +
 * name rows below" pattern used for picking from a coded reference list
 * (ICD-11 diagnoses, problems, allergens, screenings, …). One shared
 * implementation so every "Add X" flow that's genuinely a lookup against a
 * known list looks and behaves the same way, instead of each call site
 * hand-rolling its own filter/dropdown/blur logic.
 *
 * The dropdown is portalled to <body> with fixed positioning (same pattern
 * as RowActionsMenu) so it is never clipped by a card's `overflow: hidden`
 * or hidden behind another card's stacking context.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Search } from '@/components/icons/lucide';

export interface CodedOption {
  code: string;
  name: string;
  /** Optional subtitle shown under the name (e.g. ICD-11 chapter). */
  meta?: string;
  /** Extra search terms matched but never displayed (e.g. "fever, chills" for Malaria). */
  keywords?: string[];
}

/** Lowercase, with anything that is not a letter or digit as one space. */
function normalizeForSearch(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export default function CodedSearchField({
  label,
  placeholder,
  options,
  value,
  onChange,
  onSelect,
  onAddCustom,
  minChars = 1,
  maxResults = 8,
  autoFocus = false,
  excludeCodes,
  showCodeBadge = true,
}: {
  label: string;
  placeholder: string;
  options: CodedOption[];
  value: string;
  onChange: (value: string) => void;
  onSelect: (option: CodedOption) => void;
  /** When set, a trailing "Add “<typed text>”" row records entries that are
   *  not in the option list (free-text symptoms/findings). Omit for strict
   *  coded lookups like ICD-11 where inventing an entry makes no sense. */
  onAddCustom?: (text: string) => void;
  minChars?: number;
  maxResults?: number;
  autoFocus?: boolean;
  excludeCodes?: string[];
  /** Hide the mono code badge for option lists with no real coding system
   *  behind them (e.g. free-text screening names) — same input/dropdown,
   *  just a plain name row instead of implying a code that doesn't exist. */
  showCodeBadge?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);

  const query = value.trim().toLowerCase();
  const excluded = excludeCodes ? new Set(excludeCodes) : null;
  const available = options.filter(o => !excluded?.has(o.code));
  // Before the user has typed anything, focusing the field browses the top of
  // the list — clicking the search box always shows options, not a blank page.
  // Every word of the query must appear somewhere in the option (code, name
  // or a keyword), in any order, with punctuation ignored: "preeclampsia"
  // finds "Pre-eclampsia", "diabetes type 2" finds "Type 2 diabetes mellitus",
  // "1c62z" finds "1C62.Z".
  const queryWords = normalizeForSearch(query).split(' ').filter(Boolean);
  const matches = (query.length >= minChars
    ? available.filter(o => {
        const haystack = normalizeForSearch([o.code, o.name, ...(o.keywords || [])].join(' '));
        const compact = haystack.replace(/ /g, '');
        return queryWords.every(word => haystack.includes(word) || compact.includes(word));
      })
    : available
  ).slice(0, maxResults);
  // Offer the free-text row once the user has typed something that isn't an
  // exact option — a near-match still shows both, so "Fevers" can be added
  // verbatim even while "Fever" is listed.
  const customText = onAddCustom && query && !matches.some(o => o.name.toLowerCase() === query)
    ? value.trim()
    : null;

  // Whether a list is actually on screen. Escape is kept only then: in Chrome
  // Escape inside a search input also clears it, the clear counts as typing
  // and reopens an EMPTY list, and a listener that swallowed every Escape left
  // the form hosting this field impossible to close from the keyboard.
  const listShown = open && (matches.length > 0 || !!customText);

  useEffect(() => {
    if (!open || !anchorRef.current) return;
    const measure = () => {
      const r = anchorRef.current!.getBoundingClientRect();
      // At least 320px wide so code + title stay readable under narrow inputs
      // (e.g. the per-system exam finding fields), clamped to the viewport.
      const width = Math.min(Math.max(r.width, 320), window.innerWidth - 16);
      setCoords({
        top: r.bottom + 4,
        left: Math.min(r.left, window.innerWidth - 8 - width),
        width,
        maxHeight: Math.max(160, Math.min(288, window.innerHeight - r.bottom - 16)),
      });
    };
    measure();
    // Any scroll outside the menu itself moves the anchor away from the fixed
    // dropdown — close rather than float detached (scrolling the option list
    // stays open). Resize likewise.
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    // Escape dismisses the open list and stops there. Left to travel on, the
    // same keypress reached the dialog hosting this field and closed it —
    // discarding, for one, a half-written lab order.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !listShown) return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, listShown]);

  return (
    <div className="relative">
      {/* Callers that already head the field with their own question pass "" —
          an empty <label> would still occupy its bottom margin. */}
      {label && <label>{label}</label>}
      <div className="relative" ref={anchorRef}>
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
        <input
          type="search"
          // A combobox to assistive tech (and to tests): the menu below is its
          // listbox, each row an option.
          role="combobox"
          aria-expanded={listShown}
          aria-controls={listShown ? listId : undefined}
          aria-autocomplete="list"
          aria-label={label || placeholder}
          value={value}
          onChange={e => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          // Re-clicking an already-focused input fires no focus event — without
          // this, picking an option (which keeps focus in the input) would leave
          // a dead search box until the user typed or clicked away first.
          onClick={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          // Escape with a list showing closes the list and nothing else: the
          // browser's own Escape-clears-the-search would count as typing and
          // reopen it, so the form around this field never got its Escape.
          onKeyDown={e => { if (e.key === 'Escape' && listShown) e.preventDefault(); }}
          placeholder={placeholder}
          className="ps-9 search-icon-input w-full"
          style={{ background: 'var(--overlay-subtle)' }}
          autoFocus={autoFocus}
        />
      </div>
      {open && coords && (matches.length > 0 || customText) && createPortal(
        <div
          ref={menuRef}
          id={listId}
          role="listbox"
          className="csf-menu fixed overflow-hidden overflow-y-auto"
          // Mousedown inside the menu (options, scrollbar) must not blur the
          // input — blur is what closes the dropdown, and the option's click
          // event only fires if the menu is still mounted.
          onMouseDown={e => e.preventDefault()}
          style={{
            top: coords.top, left: coords.left, width: coords.width, maxHeight: coords.maxHeight,
            zIndex: 3000, // above modal overlays (2000) — used inside SectionPopup / AddAllergyModal
          }}
        >
          {matches.map(option => (
            <button
              key={`${option.code}-${option.name}`}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => { onSelect(option); setOpen(false); }}
              className="csf-row"
            >
              {showCodeBadge && (
                <span className="csf-row-code">{option.code}</span>
              )}
              <span className="min-w-0">
                <span className="csf-row-name">{option.name}</span>
                {option.meta && <span className="csf-row-meta">{option.meta}</span>}
              </span>
            </button>
          ))}
          {customText && (
            <button
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => { onAddCustom!(customText); setOpen(false); }}
              className="csf-row csf-row--add"
            >
              <Plus className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} aria-hidden />
              <span className="csf-row-name">Add &ldquo;{customText}&rdquo;</span>
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
