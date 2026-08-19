'use client';

/**
 * EhrListHeader — the shared list-page header, extracted from the patients
 * registry so every module presents the same shape:
 *
 *   Title (24px, left)                    ● Stat (n)  ● Stat (n)  ● Stat (n)
 *   [ rounded search input………………………………… ]  [Filters] [Download] [custom…]
 *
 * The stats row is dot-chips, right-aligned, using the flat palette from the
 * patients header (muted/blue/amber/green/bronze). Search and actions are
 * optional slots so pages keep their own filter popovers and buttons.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { Filter, X } from '@/components/icons/lucide';

export interface EhrListHeaderStat {
  label: string;
  value: number | string;
  /** Dot color. Defaults to the muted grey used by lead stats. */
  color?: string;
}

export interface EhrListHeaderTab {
  /** Stable key, also used to build the tab/panel aria ids. */
  key: string;
  label: string;
  /** Rendered as a small badge after the label. Omit (or pass 0) to hide it. */
  count?: number;
}

/** The id a tab button carries — panels point back at it with aria-labelledby. */
export const ehrTabId = (key: string) => `ehr-tab-${key}`;
/** The id the matching panel must carry, so the tab can aria-control it. */
export const ehrTabPanelId = (key: string) => `ehr-tabpanel-${key}`;

/** Flat stat-dot palette shared with the patients registry header. */
export const LIST_STAT_COLORS = {
  muted: 'var(--text-muted)',
  blue: 'var(--accent-primary)',
  amber: 'var(--color-warning)',
  green: 'var(--color-success)',
  bronze: 'var(--color-warning)',
  // Sixth slot for headers whose stats partition into four buckets plus two
  // lead counts (reports: total + categories + the four report cadences).
  purple: 'var(--accent-purple)',
} as const;

export default function EhrListHeader({
  title,
  stats = [],
  search,
  actions,
  tabs = [],
  activeTab,
  onTabChange,
  tabsAriaLabel,
  className = '',
}: {
  title: ReactNode;
  stats?: EhrListHeaderStat[];
  /** Omit to render no search row; pass `actions` alone to get a right-aligned action row. */
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    ariaLabel?: string;
  };
  /** Rendered to the right of the search input (filter buttons, download, etc.). */
  actions?: ReactNode;
  /**
   * Optional underline tab strip between the title row and the search row —
   * for cards that hold more than one list (a roster and the requests to join
   * it, say). The card keeps one title; the tabs switch what its body shows.
   */
  tabs?: EhrListHeaderTab[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
  tabsAriaLabel?: string;
  className?: string;
}) {
  const hasSecondRow = Boolean(search || actions);
  const hasTabs = tabs.length > 0;
  return (
    <div className={`px-4 pt-4 pb-3 flex-shrink-0 ${className}`}>
      <div className={`flex items-end justify-between gap-3 flex-wrap ${hasSecondRow || hasTabs ? 'mb-3' : ''}`}>
        {/* #000, not --text-primary: the registry's title is true black and
            this header exists to reproduce the registry. */}
        <span style={{ fontFamily: 'var(--font-platform)', fontWeight: 500, fontSize: 24, lineHeight: '100%', letterSpacing: 0, color: '#000000' }}>
          {title}
        </span>
        {stats.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap justify-end pb-0.5">
            {stats.map(s => (
              <span key={s.label} className="inline-flex items-center gap-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color || LIST_STAT_COLORS.muted }} />
                {s.label} ({typeof s.value === 'number' ? s.value.toLocaleString() : s.value})
              </span>
            ))}
          </div>
        )}
      </div>
      {hasTabs && (
        <div
          role="tablist"
          aria-label={tabsAriaLabel}
          className={hasSecondRow ? 'mb-3' : ''}
          style={{ display: 'flex', alignItems: 'center', gap: 18, borderBottom: '1px solid var(--border-light)' }}
        >
          {tabs.map(tab => {
            const on = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                id={ehrTabId(tab.key)}
                aria-selected={on}
                aria-controls={ehrTabPanelId(tab.key)}
                onClick={() => onTabChange?.(tab.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '0 0 9px', background: 'transparent', border: 0,
                  // -1px pulls the active underline onto the strip's own
                  // hairline instead of stacking a second line beneath it.
                  borderBottom: `2px solid ${on ? 'var(--accent-primary)' : 'transparent'}`,
                  marginBottom: -1,
                  fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer',
                  color: on ? 'var(--text-primary)' : 'var(--text-muted)',
                }}
              >
                {tab.label}
                {tab.count ? (
                  <span
                    className="tabular-nums"
                    style={{
                      minWidth: 18, padding: '0 5px', borderRadius: 999, fontSize: 11, fontWeight: 700, lineHeight: '16px', textAlign: 'center',
                      background: on ? 'var(--accent-light)' : 'var(--overlay-subtle)',
                      color: on ? 'var(--accent-text)' : 'var(--text-muted)',
                    }}
                  >
                    {tab.count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
      {hasSecondRow && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {search && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <input
                type="text"
                value={search.value}
                onChange={(e: ChangeEvent<HTMLInputElement>) => search.onChange(e.target.value)}
                placeholder={search.placeholder}
                aria-label={search.ariaLabel || search.placeholder}
                style={{ width: '100%', padding: '9px 18px', height: 38, borderRadius: 999, border: '1px solid var(--border-light)', background: 'var(--bg-card-solid)', fontSize: 13, color: 'var(--text-primary)', outline: 'none' }}
              />
            </div>
          )}
          {actions}
        </div>
      )}
    </div>
  );
}

/**
 * EhrListHeaderButton — icon-only toolbar button (38px, icon only — the
 * meaning carries via `ariaLabel`, which also becomes the hover tooltip).
 * `active` renders the blue-tinted state used when filters are applied;
 * `primary` renders the filled call-to-action variant (an Add button).
 *
 * Shape and colour are the patients registry's own toolbar button — a 38px
 * 999px pill, grey glyph on white, blue-tinted when active. This header exists
 * to reproduce the registry, so it can't borrow `.listpage-icon-btn`'s
 * 8px-radius blue-glyph square: that made the same Filters control change
 * shape between the registry and every module that adopted this header.
 */
export function EhrListHeaderButton({
  onClick,
  active = false,
  primary = false,
  children,
  ariaExpanded,
  ariaLabel,
}: {
  onClick?: () => void;
  active?: boolean;
  primary?: boolean;
  /** The icon (plus optional badge) — no text labels; use `ariaLabel`. */
  children: ReactNode;
  ariaExpanded?: boolean;
  ariaLabel?: string;
}) {
  const tone = primary
    ? { border: '1px solid var(--accent-primary)', background: 'var(--accent-primary)', color: '#fff' }
    : active
      ? { border: '1px solid var(--accent-primary)', background: 'rgba(33,145,208,0.08)', color: 'var(--accent-primary)' }
      : { border: '1px solid var(--border-light)', background: 'var(--bg-card-solid)', color: 'var(--text-secondary)' };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={ariaExpanded}
      aria-label={ariaLabel}
      title={ariaLabel}
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 38, height: 38, padding: 0, borderRadius: 999,
        cursor: 'pointer', flexShrink: 0, ...tone,
      }}
    >
      {children}
    </button>
  );
}

/**
 * EhrListFilters — the "Filters" pill + popover pattern from the patients
 * registry header. Renders an `EhrListHeaderButton` (with an active-count
 * badge) that toggles a panel; the panel's contents (selects, chips, whatever
 * a page needs) are passed as `children`.
 *
 * The panel is PORTALLED to <body> and positioned `fixed` from the trigger's
 * measured rect, not absolutely-positioned inside the header. Every list page
 * puts this button inside a `.card-elevated overflow-hidden` toolbar, so an
 * absolute panel was clipped by the card the moment it was wider or taller
 * than the space left inside it — the filters were there, you just couldn't
 * read or reach half of them. Same reason `EhrRailMenu` and `RowActionsMenu`
 * portal. Coordinates are clamped to the viewport on both axes and the body
 * scrolls internally, so the whole panel is always on screen whatever the
 * trigger's position or the panel's height.
 */
export function EhrListFilters({
  activeCount,
  onClear,
  children,
  label = 'Filters',
  panelWidth = 320,
  align = 'right',
}: {
  /** Number of filters currently applied — drives the badge and the active/blue button state. */
  activeCount: number;
  /** Optional "Clear all" affordance in the panel header, shown only when activeCount > 0. */
  onClear?: () => void;
  children: ReactNode;
  label?: string;
  panelWidth?: number;
  /** Which trigger edge the panel lines up with before clamping. */
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const margin = 8;
    const width = Math.min(panelWidth, window.innerWidth - margin * 2);
    const rawLeft = align === 'right' ? rect.right - width : rect.left;
    setCoords({
      top: rect.bottom + 8,
      left: Math.max(margin, Math.min(rawLeft, window.innerWidth - width - margin)),
      width,
      // Whatever is left below the trigger. The body scrolls inside this, so a
      // long filter list stays reachable instead of running off the fold.
      maxHeight: Math.max(180, window.innerHeight - rect.bottom - 8 - margin),
    });
  }, [align, panelWidth]);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    // Scroll/resize close rather than reposition: the trigger can leave the
    // viewport entirely, and a panel chasing it reads as a glitch.
    const onViewportChange = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [open]);

  return (
    <div className="relative" ref={triggerRef}>
      <EhrListHeaderButton onClick={() => setOpen(o => !o)} active={activeCount > 0} ariaExpanded={open} ariaLabel={label}>
        <Filter className="w-4 h-4" />
        {activeCount > 0 && (
          <span className="absolute inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[10px] font-bold" style={{ top: -4, right: -4, background: 'var(--accent-primary)', color: '#fff' }}>
            {activeCount}
          </span>
        )}
      </EhrListHeaderButton>
      {open && coords && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label={label}
          className="ehr-list-filters-panel"
          style={{ top: coords.top, left: coords.left, width: coords.width, maxHeight: coords.maxHeight }}
        >
          <div className="ehr-list-filters-head">
            <span>{label}</span>
            <div className="flex items-center gap-2">
              {activeCount > 0 && onClear && (
                <button type="button" onClick={onClear} className="text-[11px] font-semibold" style={{ color: 'var(--accent-primary)' }}>Clear all</button>
              )}
              <button type="button" onClick={() => setOpen(false)} className="p-1 rounded hover:bg-[var(--overlay-subtle)]" aria-label="Close">
                <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>
          </div>
          <div className="ehr-list-filters-body">{children}</div>
        </div>,
        document.body,
      )}
    </div>
  );
}
