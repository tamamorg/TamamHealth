'use client';

/**
 * A whole toolbar's worth of filters, folded into the search field.
 *
 * The billing work queue filters on two axes per tab (balance + activity for
 * accounts, status + payer for claims). Rendered inline those were four
 * labelled dropdowns competing with the search box, so they live behind one
 * disclosure — which now sits INSIDE that box rather than as a funnel button
 * beside it. The toolbar had a magnifier and a funnel side by side, both
 * narrowing the same list; the funnel named none of the axes below. The count
 * stays, where it reads as a property of the field.
 *
 * The panel is portalled to <body> with fixed positioning so a card's
 * `overflow` can never clip it.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from '@/components/icons/lucide';

import Select from '@/components/Select';
import type { FilterOption } from '@/components/filters';

export interface FilterField {
  key: string;
  label: string;
  value: string;
  /** The value that counts as "not filtering" — drives the active count. */
  neutralValue: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}

const PANEL_WIDTH = 250;

export default function BillingFilterMenu({ fields }: { fields: FilterField[] }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const activeCount = fields.filter(f => f.value !== f.neutralValue).length;

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setCoords({
      top: r.bottom + 6,
      left: Math.max(8, Math.min(r.right - PANEL_WIDTH, window.innerWidth - PANEL_WIDTH - 8)),
    });
  }, []);

  useEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (panelRef.current?.contains(e.target as Node)) return;
      // `Select` portals its listbox (`.tsel-menu`) to <body>, outside this
      // panel — picking an option there must not read as "clicked away".
      if ((e.target as HTMLElement)?.closest?.('.tsel-menu')) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  if (fields.length === 0) return null;

  const clearAll = () => fields.forEach(f => { if (f.value !== f.neutralValue) f.onChange(f.neutralValue); });

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`bl-search-filter${activeCount > 0 ? ' is-active' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        title={activeCount > 0 ? `Filters (${activeCount} applied)` : 'Filters'}
        aria-label={activeCount > 0 ? `Filters, ${activeCount} applied` : 'Filters'}
      >
        {activeCount > 0 && <span aria-hidden className="bl-search-filter-count">{activeCount}</span>}
        <ChevronDown size={16} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 120ms' }} />
      </button>

      {open && coords && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="Filters"
          className="bl-root"
          style={{
            position: 'fixed', top: coords.top, left: coords.left, width: PANEL_WIDTH,
            display: 'flex', flexDirection: 'column', gap: 12,
            padding: 14, borderRadius: 10, zIndex: 1250,
            background: 'var(--ehr-panel, #fff)',
            border: '1px solid var(--ehr-border, #E2E6EB)',
            boxShadow: '0 14px 30px rgba(0, 29, 63, 0.16)',
          }}
        >
          {fields.map(field => (
            <div className="bl-field" key={field.key}>
              <label htmlFor={`${panelId}-${field.key}`}>{field.label}</label>
              <Select
                id={`${panelId}-${field.key}`}
                value={field.value}
                onChange={e => field.onChange(e.target.value)}
              >
                {field.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="bl-btn bl-btn--ghost"
              style={{ padding: '5px 10px', fontSize: 12 }}
              disabled={activeCount === 0}
              onClick={clearAll}
            >
              Clear
            </button>
            <button
              type="button"
              className="bl-btn bl-btn--primary"
              style={{ padding: '5px 12px', fontSize: 12 }}
              onClick={() => { setOpen(false); btnRef.current?.focus(); }}
            >
              Done
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
