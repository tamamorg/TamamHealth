'use client';

/**
 * The report picker: a filter, then the catalogue narrowed by it.
 *
 * Lifted out of the Reports page (2026-08-24). Sixteen reports across five
 * sections is more than a 244px rail shows at once — the last two sections sat
 * below the fold, so "Revenue Report" was findable only by scrolling a list
 * whose headings all look alike. The filter is the fix: narrow by name, by
 * section, or by cadence, and the list becomes short enough to read.
 *
 * SELECTION SURVIVES FILTERING. The chart keeps drawing whatever was picked
 * even when the filter hides its row — a filter is a way to look, not a way to
 * change what you are looking at, and clearing the search should not silently
 * redraw the page. When the active report is filtered out the head says so, so
 * the rail never just appears to have lost it.
 */

import { useId, useMemo } from 'react';
import { Search, X } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import {
  REPORT_CATEGORIES, REPORT_PERIODS,
  categoryKey, countFilteredReports, filterReportSections, isFilterActive,
  periodKey, reportNameKey,
  type ReportFilter,
} from './_ReportCatalogue';

export default function ReportRail({
  filter, onFilterChange, selected, onSelect, rowCountFor, loading, total,
}: {
  filter: ReportFilter;
  onFilterChange: (next: ReportFilter) => void;
  /** The report the chart is drawing. */
  selected: string;
  onSelect: (name: string) => void;
  /** Rows the report would generate, for the line under its name. */
  rowCountFor: (name: string) => number;
  loading: boolean;
  /** The unfiltered catalogue size, for the "n of 16" head. */
  total: number;
}) {
  const { t } = useTranslation();
  const fieldId = useId();

  const sections = useMemo(
    () => filterReportSections(filter, t),
    [filter, t],
  );
  const shown = useMemo(() => countFilteredReports(filter, t), [filter, t]);
  const active = isFilterActive(filter);
  const selectedIsHidden = active && !sections.some(s => s.items.some(i => i.name === selected));

  const set = (patch: Partial<ReportFilter>) => onFilterChange({ ...filter, ...patch });

  return (
    <aside className="rpt-rail" aria-label={t('reports.railTitle')}>
      <div className="rpt-rail-head">
        <span>{t('reports.railTitle')}</span>
        {/* Unfiltered this is the plain total, as before. Filtered it has to
            say what it is a count OF, or "5" reads as the catalogue shrinking. */}
        <b>{active ? t('reports.railCount', { shown, total }) : total}</b>
      </div>

      <div className="rpt-rail-filter">
        <div className="rpt-rail-search">
          <Search className="w-3.5 h-3.5" aria-hidden="true" />
          <input
            type="search"
            value={filter.query}
            onChange={e => set({ query: e.target.value })}
            placeholder={t('reports.filterSearchPlaceholder')}
            aria-label={t('reports.filterSearch')}
            data-action="report-filter-search"
          />
        </div>
        <div className="rpt-rail-selects">
          {/* Native selects, not the app's <Select>: this rail is 244px wide
              and the shared control's 40px end-padding leaves no room for the
              value. Labels are aria-only — globals.css force-uppercases every
              <label>, and two uppercase captions here would out-shout the
              section headings they sit above. */}
          <select
            id={`${fieldId}-category`}
            className="rpt-rail-select"
            value={filter.category}
            onChange={e => set({ category: e.target.value })}
            aria-label={t('reports.filterCategory')}
            data-action="report-filter-category"
          >
            <option value="">{t('reports.filterAllCategories')}</option>
            {REPORT_CATEGORIES.map(category => (
              <option key={category} value={category}>{t(categoryKey[category] ?? category)}</option>
            ))}
          </select>
          <select
            id={`${fieldId}-period`}
            className="rpt-rail-select"
            value={filter.period}
            onChange={e => set({ period: e.target.value })}
            aria-label={t('reports.filterPeriod')}
            data-action="report-filter-period"
          >
            <option value="">{t('reports.filterAllPeriods')}</option>
            {REPORT_PERIODS.map(period => (
              <option key={period} value={period}>{t(periodKey[period] ?? period)}</option>
            ))}
          </select>
        </div>
        {active && (
          <button
            type="button"
            className="rpt-rail-clear"
            onClick={() => onFilterChange({ query: '', category: '', period: '' })}
            data-action="report-filter-clear"
          >
            <X className="w-3 h-3" aria-hidden="true" />
            {t('reports.filterClear')}
          </button>
        )}
      </div>

      <div className="rpt-rail-scroll">
        {/* The picked report is still what the chart draws — say so rather than
            let the rail read as having dropped it. */}
        {selectedIsHidden && (
          <p className="rpt-rail-note">
            {t('reports.railSelectedHidden', { name: t(reportNameKey[selected] ?? selected) })}
          </p>
        )}

        {sections.length === 0 ? (
          <p className="rpt-rail-empty">{t('reports.railNoMatches')}</p>
        ) : sections.map(section => (
          <div key={section.category} className="rpt-rail-group">
            <p className="rpt-rail-group-title">
              {t(categoryKey[section.category] ?? section.category)}
            </p>
            {section.items.map(item => {
              const on = item.name === selected;
              return (
                <button
                  key={item.name}
                  type="button"
                  className={`rpt-rail-item${on ? ' is-on' : ''}`}
                  aria-current={on ? 'true' : undefined}
                  onClick={() => onSelect(item.name)}
                >
                  <span className="rpt-rail-name">{t(reportNameKey[item.name] ?? item.name)}</span>
                  <span className="rpt-rail-meta">
                    <span className={`rpt-chip rpt-chip--${item.period.toLowerCase()}`}>
                      {t(periodKey[item.period] ?? item.period)}
                    </span>
                    <span>
                      {loading ? '…' : t('reports.rowsAvailable', { count: rowCountFor(item.name) })}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
}
