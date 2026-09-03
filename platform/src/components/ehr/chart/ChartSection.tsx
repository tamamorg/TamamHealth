'use client';

/**
 * ChartSection — the reusable Tamam O3 "section card" chrome used across
 * the patient chart's tab content: bold title with a short teal underline,
 * an optional right-aligned "Add +", an optional filter slot (e.g. "Show:
 * Active ▼"), an optional table/chart toggle slot, a body slot, and an
 * optional Tamam-style pagination footer ("{shown} / {total} items" +
 * "‹ of {N} pages ›").
 *
 * Purely presentational — callers own their own data, filtering, and
 * pagination state (a plain `useState(1)` page number) and pass the
 * already-sliced rows in as `children`; this component just renders the
 * chrome and the pager controls.
 */

import { Plus, ChevronLeft, ChevronRight, ClipboardList, Search } from '@/components/icons/lucide';

export interface ChartSectionPagination {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

interface ChartSectionProps {
  title: string;
  addLabel?: string;
  /** Glyph for the action button. Defaults to a plus; pass the domain's own
   *  icon (a flask for lab orders, say) when the action is a specific verb
   *  rather than a generic "add a row here". */
  addIcon?: React.ReactNode;
  onAdd?: () => void;
  filterSlot?: React.ReactNode;
  toggleSlot?: React.ReactNode;
  searchValue?: string;
  searchPlaceholder?: string;
  onSearchChange?: (value: string) => void;
  pagination?: ChartSectionPagination;
  className?: string;
  children: React.ReactNode;
}

export default function ChartSection({
  title, addLabel = 'Add', addIcon, onAdd, filterSlot, toggleSlot,
  searchValue = '', searchPlaceholder, onSearchChange, pagination, className, children,
}: ChartSectionProps) {
  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;
  const shown = pagination
    ? Math.max(0, Math.min(pagination.pageSize, pagination.total - (pagination.page - 1) * pagination.pageSize))
    : 0;

  return (
    <section className={className ? `tamam-section ${className}` : 'tamam-section'}>
      <header className="tamam-section-head">
        <div className="tamam-section-title-wrap">
          <h3 className="tamam-section-title">{title}</h3>
          <span className="tamam-section-underline" aria-hidden />
        </div>
        <div className="tamam-section-controls">
          {filterSlot}
          {toggleSlot}
          {onAdd && (
            <button type="button" className="tamam-section-add" onClick={onAdd}>
              {addIcon ?? <Plus />} {addLabel}
            </button>
          )}
        </div>
      </header>
      {onSearchChange && (
        <label className="tamam-section-search" aria-label={`Search ${title}`}>
          <Search aria-hidden />
          <input
            type="search"
            value={searchValue}
            onChange={event => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder || `Search ${title.toLowerCase()}…`}
          />
        </label>
      )}
      <div className="tamam-section-body">{children}</div>
      {pagination && pagination.total > 0 && (
        <footer className="tamam-section-footer">
          <span className="tamam-section-count">{shown} / {pagination.total} items</span>
          {pagination.total > pagination.pageSize && (
            <div className="tamam-section-pager">
              <button
                type="button"
                disabled={pagination.page <= 1}
                onClick={() => pagination.onPageChange(pagination.page - 1)}
                aria-label="Previous page"
              >
                <ChevronLeft />
              </button>
              <span>of {totalPages} pages</span>
              <button
                type="button"
                disabled={pagination.page >= totalPages}
                onClick={() => pagination.onPageChange(pagination.page + 1)}
                aria-label="Next page"
              >
                <ChevronRight />
              </button>
            </div>
          )}
        </footer>
      )}
    </section>
  );
}

/**
 * OmrsEmptyState — the "There are no {itemLabel} to display for this
 * patient" empty state shared by every ChartSection-wrapped tab, matching
 * Tamam's tone: centered clipboard glyph, one line of muted body copy, and
 * an optional blue "Record {itemLabel}" action.
 */
export function OmrsEmptyState({
  itemLabel, actionLabel, onAction, disabledReason,
}: {
  /** Plural noun used in the sentence, e.g. "allergies", "conditions". */
  itemLabel: string;
  /** Defaults to `Record {itemLabel}`. */
  actionLabel?: string;
  onAction?: () => void;
  /** When set (and onAction is omitted), renders the action as a disabled/
   *  coming-soon note instead of a link. */
  disabledReason?: string;
}) {
  return (
    <div className="tamam-empty-state">
      <ClipboardList />
      <p>There are no {itemLabel} to display for this patient</p>
      {onAction && (
        <button type="button" className="tamam-empty-action" onClick={onAction}>
          {actionLabel || `Record ${itemLabel}`}
        </button>
      )}
      {!onAction && disabledReason && (
        <span className="tamam-empty-action tamam-empty-action--disabled" title={disabledReason}>
          {actionLabel || `Record ${itemLabel}`}
        </span>
      )}
    </div>
  );
}
