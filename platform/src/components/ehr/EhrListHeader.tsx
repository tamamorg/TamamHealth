'use client';

/**
 * EhrListHeader — the shared list-page header, extracted from the patients
 * registry so every module presents the same shape:
 *
 *   Laboratory  (24px)                    ● Stat (n)  ● Stat (n)  ● Stat (n)
 *   [ rounded search input……………………… (2 ⌄) ]  [Download] [custom…]
 *
 * `title` is the page name and it is what the 24px line prints. It used to
 * print "Welcome, {name}" over a "ROLE · MODULE" eyebrow instead, with the
 * page name buried in that eyebrow — see EhrPageTitle for why that went.
 *
 * The stats row is dot-chips, right-aligned, using the flat palette from the
 * patients header (muted/blue/amber/green/bronze). Search and actions are
 * optional slots.
 *
 * Filters live INSIDE the search field (`search.filters`), not beside it. The
 * toolbar used to carry an input whose placeholder read "Filter table" and a
 * separate filter icon next to it — two affordances for one job, the second of
 * which named nothing it would filter by. One control now does both.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type ChangeEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Filter, Search, X } from '@/components/icons/lucide';
import EhrPageTitle from '@/components/ehr/EhrPageTitle';

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
  blue: 'var(--accent-bright)',
  amber: 'var(--color-warning)',
  green: 'var(--color-success)',
  bronze: 'var(--color-warning)',
  // Sixth slot for headers whose stats partition into four buckets plus two
  // lead counts (reports: total + categories + the four report cadences).
  purple: 'var(--accent-purple)',
} as const;

export default function EhrListHeader({
  title,
  count,
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
  /**
   * The list's total, printed inside the title itself — "Laboratory (24)".
   * This replaces the lead stat-chip that used to restate the total under a
   * second name ("Orders (24)" beside a page called Laboratory): the number
   * belongs to the title, and the chips are for the breakdown.
   */
  count?: number;
  stats?: EhrListHeaderStat[];
  /** Omit to render no search row; pass `actions` alone to get a right-aligned action row. */
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    ariaLabel?: string;
    /**
     * Fold this list's filters into the search field's trailing edge.
     *
     * Pass the panel contents as `children` and the applied count; the header
     * renders one control instead of an input plus a separate filter button
     * that meant the same thing. Omit for a list with nothing to filter by.
     */
    filters?: {
      activeCount: number;
      onClear?: () => void;
      label?: string;
      panelWidth?: 'trigger' | number;
      children: ReactNode;
      /** Guided-tour anchor for the folded trigger. */
      dataTour?: string;
    };
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
        <EhrPageTitle>
          {title}
          {count != null && (
            <span className="tabular-nums" style={{ color: 'var(--text-muted)', fontWeight: 600 }}>
              {' '}({count.toLocaleString()})
            </span>
          )}
        </EhrPageTitle>
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
        <div className="ehr-list-header-toolbar">
          {search && (
            <div className="ehr-list-header-search">
              <EhrSearchFilter
                value={search.value}
                onChange={search.onChange}
                placeholder={search.placeholder}
                ariaLabel={search.ariaLabel}
                activeCount={search.filters?.activeCount ?? 0}
                onClear={search.filters?.onClear}
                label={search.filters?.label}
                panelWidth={search.filters?.panelWidth ?? 'trigger'}
                dataTour={search.filters?.dataTour}
              >
                {search.filters?.children}
              </EhrSearchFilter>
            </div>
          )}
          {actions && <div className="ehr-list-header-actions">{actions}</div>}
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
/**
 * The anchored-popover machinery, shared by every filter disclosure.
 *
 * Extracted when the filter control moved inside the search field: the panel
 * behaviour (portal to <body>, viewport clamping, close on Escape / outside
 * click / scroll) is the part that was hard to get right, and it should not be
 * reimplemented per anchor. Only the trigger differs.
 */
function useFilterPanel(anchorWidth: 'trigger' | number, align: 'left' | 'right') {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const margin = 8;
    // `trigger` matches the anchor's own width — what the in-field control
    // wants, so the panel reads as an extension of the search box rather than
    // a floating card that happens to be near it.
    const desired = anchorWidth === 'trigger' ? rect.width : anchorWidth;
    const width = Math.min(Math.max(desired, 260), window.innerWidth - margin * 2);
    const rawLeft = align === 'right' ? rect.right - width : rect.left;
    setCoords({
      top: rect.bottom + 8,
      left: Math.max(margin, Math.min(rawLeft, window.innerWidth - width - margin)),
      width,
      // Whatever is left below the trigger. The body scrolls inside this, so a
      // long filter list stays reachable instead of running off the fold.
      maxHeight: Math.max(180, window.innerHeight - rect.bottom - 8 - margin),
    });
  }, [align, anchorWidth]);

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

  return { open, setOpen, coords, triggerRef, panelRef };
}

/** The portalled panel body — identical wherever the trigger lives. */
function FilterPanel({
  panelRef, coords, label, activeCount, onClear, onClose, children,
}: {
  panelRef: RefObject<HTMLDivElement | null>;
  coords: { top: number; left: number; width: number; maxHeight: number };
  label: string;
  activeCount: number;
  onClear?: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return createPortal(
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
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-[var(--overlay-subtle)]" aria-label="Close">
            <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>
      </div>
      <div className="ehr-list-filters-body">{children}</div>
    </div>,
    document.body,
  );
}

/**
 * FilterDisclosure — the chevron-plus-count trigger and its panel, on its own.
 *
 * Exported so a search field that is NOT this module's own (the admin kit's
 * `SadbSearch`, say) can fold its filters in without reimplementing the
 * popover. The caller positions it inside their field; everything below the
 * trigger — placement, clamping, Escape, outside-click — is handled here.
 */
export function FilterDisclosure({
  activeCount = 0,
  onClear,
  label = 'Filters',
  panelWidth = 'trigger',
  children,
}: {
  activeCount?: number;
  onClear?: () => void;
  label?: string;
  panelWidth?: 'trigger' | number;
  children: ReactNode;
}) {
  const { open, setOpen, coords, triggerRef, panelRef } = useFilterPanel(panelWidth, 'right');
  return (
    <span ref={triggerRef} style={{ display: 'inline-flex', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={activeCount > 0 ? `${label}, ${activeCount} applied` : label}
        title={activeCount > 0 ? `${label} (${activeCount} applied)` : label}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2,
          height: 26, minWidth: 26, padding: activeCount > 0 ? '0 8px' : 0,
          borderRadius: 999, border: 'none', cursor: 'pointer',
          background: activeCount > 0 ? 'rgba(33,145,208,0.10)' : 'transparent',
          color: activeCount > 0 ? 'var(--accent-primary)' : 'var(--text-muted)',
        }}
      >
        {activeCount > 0 && (
          <span className="text-[11px] font-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>{activeCount}</span>
        )}
        <ChevronDown className="w-4 h-4" style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 120ms' }} />
      </button>
      {open && coords && typeof document !== 'undefined' && (
        <FilterPanel
          panelRef={panelRef} coords={coords} label={label}
          activeCount={activeCount} onClear={onClear} onClose={() => setOpen(false)}
        >
          {children}
        </FilterPanel>
      )}
    </span>
  );
}

/**
 * EhrSearchFilter — the search field with its filters folded in.
 *
 * A list toolbar used to carry two controls that meant the same thing: an
 * input whose placeholder read "Filter table", and a separate filter icon
 * beside it. Two affordances for one job, and the icon-only button named
 * nothing it would filter by. The disclosure now sits inside the field's
 * trailing edge, so narrowing a list is one control: type to match, or open
 * the chevron to pick from the list's own axes.
 *
 * The applied count moved with it, where it reads as a property of the field —
 * "this list is narrowed" — which is what it always meant.
 */
export function EhrSearchFilter({
  value,
  onChange,
  placeholder,
  ariaLabel,
  activeCount = 0,
  onClear,
  label = 'Filters',
  panelWidth = 'trigger',
  children,
  dataTour,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  /** Number of filters applied — drives the badge and the tinted disclosure. */
  activeCount?: number;
  onClear?: () => void;
  label?: string;
  /** `'trigger'` matches the field's width; a number pins it. */
  panelWidth?: 'trigger' | number;
  /** Panel contents. Omit to render a plain search field with no disclosure. */
  children?: ReactNode;
  /** Guided-tour anchor. The trigger lives in here now, so pages tag it through. */
  dataTour?: string;
}) {
  const { open, setOpen, coords, triggerRef, panelRef } = useFilterPanel(panelWidth, 'right');
  const hasFilters = Boolean(children);

  return (
    <div ref={triggerRef} data-tour={dataTour} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      {/* The magnifier every other search field in the app carries — the top
          rail's, the worklist daybar's, the messages list's. This one, the
          field ~30 list pages actually search from, was the only one without
          it: a bare rounded box that read as a text input until you noticed
          the placeholder. Decorative, so it stays out of the a11y tree; the
          input keeps its own label. */}
      <Search
        className="w-4 h-4"
        aria-hidden
        style={{
          position: 'absolute', insetInlineStart: 14, top: '50%',
          transform: 'translateY(-50%)', pointerEvents: 'none',
          color: 'var(--text-muted)',
        }}
      />
      <input
        type="text"
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel || placeholder}
        style={{
          width: '100%', height: 38, borderRadius: 999,
          // Leading room for the magnifier; trailing room for the disclosure,
          // so typed text never runs under either.
          padding: hasFilters ? '9px 44px 9px 38px' : '9px 18px 9px 38px',
          border: '1px solid var(--border-light)', background: 'var(--bg-card-solid)',
          fontSize: 13, color: 'var(--text-primary)', outline: 'none',
        }}
      />
      {hasFilters && (
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={activeCount > 0 ? `${label}, ${activeCount} applied` : label}
          title={activeCount > 0 ? `${label} (${activeCount} applied)` : label}
          style={{
            position: 'absolute', top: 4, insetInlineEnd: 4,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2,
            height: 30, minWidth: 30, padding: activeCount > 0 ? '0 8px' : 0,
            borderRadius: 999, border: 'none', cursor: 'pointer',
            background: activeCount > 0 ? 'rgba(33,145,208,0.10)' : 'transparent',
            color: activeCount > 0 ? 'var(--accent-primary)' : 'var(--text-muted)',
          }}
        >
          {activeCount > 0 && (
            <span className="text-[11px] font-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>{activeCount}</span>
          )}
          {/* A filter glyph, not a chevron: the chevron said "something opens
              here" without saying what — the funnel names the job. */}
          <Filter className="w-4 h-4" />
        </button>
      )}
      {open && coords && typeof document !== 'undefined' && (
        <FilterPanel
          panelRef={panelRef} coords={coords} label={label}
          activeCount={activeCount} onClear={onClear} onClose={() => setOpen(false)}
        >
          {children}
        </FilterPanel>
      )}
    </div>
  );
}

export function EhrListFilters({
  activeCount,
  onClear,
  children,
  label = 'Filters',
  panelWidth = 320,
  align = 'right',
}: {
  /** Number of filters currently applied — drives the badge and the active/blue state. */
  activeCount: number;
  /** Optional "Clear all" affordance in the panel header, shown only when activeCount > 0. */
  onClear?: () => void;
  children: ReactNode;
  label?: string;
  panelWidth?: number;
  /** Which trigger edge the panel lines up with before clamping. */
  align?: 'left' | 'right';
}) {
  const { open, setOpen, coords, triggerRef, panelRef } = useFilterPanel(panelWidth, align);

  return (
    <div className="relative" ref={triggerRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={activeCount > 0 ? `${label}, ${activeCount} applied` : label}
        title={activeCount > 0 ? `${label} (${activeCount} applied)` : label}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          height: 38, padding: '0 14px', borderRadius: 999, cursor: 'pointer', flexShrink: 0,
          fontSize: 13, fontWeight: 600,
          border: activeCount > 0 ? '1px solid var(--accent-primary)' : '1px solid var(--border-light)',
          background: activeCount > 0 ? 'rgba(33,145,208,0.08)' : 'var(--bg-card-solid)',
          color: activeCount > 0 ? 'var(--accent-primary)' : 'var(--text-secondary)',
        }}
      >
        {label}
        {activeCount > 0 && (
          <span className="text-[11px] font-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>({activeCount})</span>
        )}
        <ChevronDown className="w-3.5 h-3.5" style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 120ms' }} />
      </button>
      {open && coords && typeof document !== 'undefined' && (
        <FilterPanel
          panelRef={panelRef} coords={coords} label={label}
          activeCount={activeCount} onClear={onClear} onClose={() => setOpen(false)}
        >
          {children}
        </FilterPanel>
      )}
    </div>
  );
}
