'use client';

/**
 * Shared pieces for the ministry and county oversight pages.
 *
 * `FieldRow` / `Field` follow the Reports page's "Choose a report" pattern:
 * a short row of labelled dropdowns above the content, replacing the pill and
 * tab strips that picked one option from a set. `MultiField` is the same
 * look for a filter that takes several values. `weeklyCaseTrend` gives the
 * KPI tiles an honest last-seven-days against the seven before comparison.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from '@/components/icons/lucide';
import { trendBetween, type SadbTrendValue } from '@/components/admin/sadb-ui';
import './oversight-kit.css';

export function FieldRow({ children, end }: { children: ReactNode; end?: ReactNode }) {
  return (
    <div className="ov-fields">
      {children}
      {end && <div className="ov-fields-end">{end}</div>}
    </div>
  );
}

export function Field({ label, children, inline = false, group = false }: { label: string; children: ReactNode; inline?: boolean; group?: boolean }) {
  const cls = inline ? 'ov-inline-field' : 'ov-field';
  const inner = (<><span className="ov-field-label">{label}</span>{children}</>);
  /* A search box is itself a label; nesting one in another is invalid, so it
     takes the group form. */
  return group ? <div className={cls} role="group" aria-label={label}>{inner}</div> : <label className={cls}>{inner}</label>;
}

/** A multi-select filter as a field: a trigger showing the count and a menu of choices. */
export function MultiField({ label, summary, options, selected, onToggle, onAll, allLabel }: {
  label: string;
  summary: string;
  options: { key: string; label: string; color?: string }[];
  /** null = every option is on. */
  selected: Set<string> | null;
  onToggle: (key: string) => void;
  onAll: () => void;
  allLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="ov-inline-field" ref={ref}>
      <span className="ov-field-label">{label}</span>
      <div className="relative">
        <button type="button" className="ov-multi-trigger" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(o => !o)}>
          {summary}
          <ChevronDown className="w-4 h-4" aria-hidden="true" />
        </button>
        {open && (
          <div className="ov-multi-menu">
            <button type="button" className={`ov-multi-item${selected === null ? '' : ' is-off'}`} onClick={onAll}>
              <span className="flex-1">{allLabel}</span>
              {selected === null && <Check className="w-4 h-4" aria-hidden="true" />}
            </button>
            {options.map(o => {
              const on = selected === null || selected.has(o.key);
              return (
                <button key={o.key} type="button" className={`ov-multi-item${on ? '' : ' is-off'}`} onClick={() => onToggle(o.key)}>
                  {o.color && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: on ? o.color : 'var(--border-medium)' }} />}
                  <span className="flex-1 truncate">{o.label}</span>
                  {on && <Check className="w-4 h-4" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const DAY = 86_400_000;

/**
 * Sum of `valueOf` over records dated in the last seven days, against the
 * seven days before. Returns null when no record is dated before the current
 * window, so a tile never shows a comparison the loaded records cannot back.
 */
export function weeklyTrend<T>(
  rows: readonly T[],
  dateOf: (row: T) => string | undefined,
  valueOf: (row: T) => number,
  now: number = Date.now(),
): { current: number; previous: number; trend: SadbTrendValue } | null {
  let current = 0; let previous = 0; let priorSeen = false;
  for (const r of rows) {
    const raw = dateOf(r);
    const ts = raw ? new Date(raw).getTime() : NaN;
    if (Number.isNaN(ts)) continue;
    const age = now - ts;
    if (age >= 0 && age < 7 * DAY) current += valueOf(r);
    else if (age >= 7 * DAY && age < 14 * DAY) { previous += valueOf(r); priorSeen = true; }
  }
  if (!priorSeen && current === 0) return null;
  return {
    current,
    previous,
    trend: {
      direction: trendBetween(current, previous),
      label: `vs ${previous.toLocaleString()} last week`,
      good: 'down',
    },
  };
}
