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

import { useEffect, useRef, useState } from 'react';
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
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);

  const query = value.trim().toLowerCase();
  const excluded = excludeCodes ? new Set(excludeCodes) : null;
  const available = options.filter(o => !excluded?.has(o.code));
  // Before the user has typed anything, focusing the field browses the top of
  // the list — clicking the search box always shows options, not a blank page.
  const matches = (query.length >= minChars
    ? available.filter(o =>
        o.code.toLowerCase().includes(query) ||
        o.name.toLowerCase().includes(query) ||
        (o.keywords || []).some(k => k.toLowerCase().includes(query))
      )
    : available
  ).slice(0, maxResults);
  // Offer the free-text row once the user has typed something that isn't an
  // exact option — a near-match still shows both, so "Fevers" can be added
  // verbatim even while "Fever" is listed.
  const customText = onAddCustom && query && !matches.some(o => o.name.toLowerCase() === query)
    ? value.trim()
    : null;

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
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative">
      {/* Callers that already head the field with their own question pass "" —
          an empty <label> would still occupy its bottom margin. */}
      {label && <label>{label}</label>}
      <div className="relative" ref={anchorRef}>
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
        <input
          type="search"
          value={value}
          onChange={e => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          // Re-clicking an already-focused input fires no focus event — without
          // this, picking an option (which keeps focus in the input) would leave
          // a dead search box until the user typed or clicked away first.
          onClick={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          placeholder={placeholder}
          className="ps-9 search-icon-input w-full"
          style={{ background: 'var(--overlay-subtle)' }}
          autoFocus={autoFocus}
        />
      </div>
      {open && coords && (matches.length > 0 || customText) && createPortal(
        <div
          ref={menuRef}
          className="fixed rounded-lg border overflow-hidden overflow-y-auto"
          // Mousedown inside the menu (options, scrollbar) must not blur the
          // input — blur is what closes the dropdown, and the option's click
          // event only fires if the menu is still mounted.
          onMouseDown={e => e.preventDefault()}
          style={{
            top: coords.top, left: coords.left, width: coords.width, maxHeight: coords.maxHeight,
            zIndex: 3000, // above modal overlays (2000) — used inside SectionPopup / AddAllergyModal
            background: 'var(--bg-card)', borderColor: 'var(--border-light)', boxShadow: 'var(--card-shadow-lg)',
          }}
        >
          {matches.map(option => (
            <button
              key={`${option.code}-${option.name}`}
              type="button"
              onClick={() => { onSelect(option); setOpen(false); }}
              className="w-full flex items-center gap-3 px-4 py-3 text-start hover:bg-white/5 transition-colors"
              style={{ borderBottom: '1px solid var(--border-light)' }}
            >
              {showCodeBadge && (
                <span className="font-mono text-xs px-2 py-0.5 rounded flex-shrink-0" style={{ background: 'var(--accent-light)', color: 'var(--accent-primary)' }}>{option.code}</span>
              )}
              <span className="min-w-0">
                <span className="text-sm font-bold block truncate" style={{ color: 'var(--text-primary)' }}>{option.name}</span>
                {option.meta && <span className="text-[11px] block truncate" style={{ color: 'var(--text-muted)' }}>{option.meta}</span>}
              </span>
            </button>
          ))}
          {customText && (
            <button
              type="button"
              onClick={() => { onAddCustom!(customText); setOpen(false); }}
              className="w-full flex items-center gap-3 px-4 py-3 text-start hover:bg-white/5 transition-colors"
            >
              <Plus className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} aria-hidden />
              <span className="text-sm font-bold truncate" style={{ color: 'var(--accent-primary)' }}>Add &ldquo;{customText}&rdquo;</span>
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
