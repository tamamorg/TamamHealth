'use client';

/**
 * The Reports control panel: choose what to visualise, then Apply.
 *
 * Was `_ReportRail` — a picker that redrew the chart on every click, with the
 * chart-form buttons living on the chart itself and the data table hidden
 * behind a button labelled "Generate" that generated nothing (it toggled a
 * table whose rows were already computed). Three controls in three places for
 * one question: what am I looking at?
 *
 * They are one panel now. Report, chart form and data table are DRAFT state
 * here; nothing redraws until Apply. That is the point of a control panel —
 * you assemble a view and commit it, rather than watching the chart lurch
 * through every intermediate state on the way to the one you wanted.
 *
 * The filter above the list is deliberately NOT draft state. Searching for
 * "malaria" is how you FIND the thing to visualise, not part of the view
 * being assembled, so it narrows the list immediately and Apply has nothing
 * to say about it.
 */

import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Download, Search, X } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { LucideIcon } from '@/components/icons/lucide';
import type { ReportChartKind } from './_ReportCharts';
import {
  REPORT_CATEGORIES, REPORT_PERIODS,
  categoryKey, countFilteredReports, filterReportSections, isFilterActive,
  periodKey, reportNameKey,
  type ReportFilter,
} from './_ReportCatalogue';

/** The view being assembled. Applied as one unit. */
export interface ReportView {
  report: string;
  kind: ReportChartKind;
  /** The row-level table under the chart. Defaults ON — see the page. */
  tableOpen: boolean;
}

export interface ChartKindOption {
  id: ReportChartKind;
  labelKey: string;
  icon: LucideIcon;
  partToWhole?: true;
}

export default function ReportControlPanel({
  filter, onFilterChange, applied, onApply, kinds, partToWholeOkFor,
  rowCountFor, loading, total, onStep, positionOf, onExportCsv,
}: {
  filter: ReportFilter;
  onFilterChange: (next: ReportFilter) => void;
  /** What the chart is drawing right now. */
  applied: ReportView;
  onApply: (view: ReportView) => void;
  kinds: readonly ChartKindOption[];
  /** Whether donut/treemap are honest for a given report's numbers. */
  partToWholeOkFor: (report: string) => boolean;
  rowCountFor: (name: string) => number;
  loading: boolean;
  total: number;
  /** Step the DRAFT through the catalogue — the old bar's ‹ n/16 › arrows. */
  onStep: (from: string, delta: number) => string;
  /** Position of a report in the full catalogue, 1-based. */
  positionOf: (name: string) => number;
  onExportCsv: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ReportView>(applied);

  /* Re-sync when the view changes from outside the panel — the header's own
     report select and the chart's prev/next arrows still drive it. Without
     this the panel would keep showing the last thing drafted here and Apply
     would silently undo whatever those did. */
  useEffect(() => { setDraft(applied); }, [applied]);

  const sections = useMemo(() => filterReportSections(filter, t), [filter, t]);
  const shown = useMemo(() => countFilteredReports(filter, t), [filter, t]);
  const active = isFilterActive(filter);
  const selectedIsHidden = active && !sections.some(s => s.items.some(i => i.name === draft.report));

  const dirty = draft.report !== applied.report
    || draft.kind !== applied.kind
    || draft.tableOpen !== applied.tableOpen;

  /* A form the DRAFTED report cannot honestly take is offered as disabled
     rather than hidden, so the row does not reflow as you move between
     reports — and a donut left selected from a previous report falls back
     rather than drawing percentages of nothing. */
  const draftPartToWholeOk = partToWholeOkFor(draft.report);
  const set = (patch: Partial<ReportView>) => setDraft(d => ({ ...d, ...patch }));
  const setFilter = (patch: Partial<ReportFilter>) => onFilterChange({ ...filter, ...patch });

  return (
    <aside className="rpt-rail" aria-label={t('reports.controlPanelTitle')}>
      <div className="rpt-rail-head">
        <span>{t('reports.controlPanelTitle')}</span>
        {dirty && <b className="rpt-rail-dirty">{t('reports.controlPending')}</b>}
      </div>

      <div className="rpt-rail-scroll">
        {/* ── 1. What to visualise ─────────────────────────────────── */}
        <p className="rpt-ctl-legend">
          {t('reports.controlReport')}
          <span>{active ? t('reports.railCount', { shown, total }) : total}</span>
        </p>

        {/* The old bar's ‹ 6/16 › stepper. It walks the WHOLE catalogue, not
            the filtered list: it is a way to page through every report, and
            stopping at the edge of a search would make it a different control
            depending on what happened to be typed above it. */}
        <div className="rpt-ctl-step">
          <button type="button" className="rpt-nav-btn" aria-label={t('reports.chartPrev')}
                  onClick={() => set({ report: onStep(draft.report, -1) })}>
            <ChevronLeft />
          </button>
          <span className="rpt-nav-pos">{positionOf(draft.report)}/{total}</span>
          <button type="button" className="rpt-nav-btn" aria-label={t('reports.chartNext')}
                  onClick={() => set({ report: onStep(draft.report, 1) })}>
            <ChevronRight />
          </button>
        </div>

        <div className="rpt-rail-filter">
          <div className="rpt-rail-search">
            <Search className="w-3.5 h-3.5" aria-hidden="true" />
            <input
              type="search"
              value={filter.query}
              onChange={e => setFilter({ query: e.target.value })}
              placeholder={t('reports.filterSearchPlaceholder')}
              aria-label={t('reports.filterSearch')}
              data-action="report-filter-search"
            />
          </div>
          <div className="rpt-rail-selects">
            <select
              className="rpt-rail-select"
              value={filter.category}
              onChange={e => setFilter({ category: e.target.value })}
              aria-label={t('reports.filterCategory')}
              data-action="report-filter-category"
            >
              <option value="">{t('reports.filterAllCategories')}</option>
              {REPORT_CATEGORIES.map(c => (
                <option key={c} value={c}>{t(categoryKey[c] ?? c)}</option>
              ))}
            </select>
            <select
              className="rpt-rail-select"
              value={filter.period}
              onChange={e => setFilter({ period: e.target.value })}
              aria-label={t('reports.filterPeriod')}
              data-action="report-filter-period"
            >
              <option value="">{t('reports.filterAllPeriods')}</option>
              {REPORT_PERIODS.map(p => (
                <option key={p} value={p}>{t(periodKey[p] ?? p)}</option>
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

        {selectedIsHidden && (
          <p className="rpt-rail-note">
            {t('reports.railSelectedHidden', { name: t(reportNameKey[draft.report] ?? draft.report) })}
          </p>
        )}

        {sections.length === 0 ? (
          <p className="rpt-rail-empty">{t('reports.railNoMatches')}</p>
        ) : sections.map(section => (
          <div key={section.category} className="rpt-rail-group">
            <p className="rpt-rail-group-title">{t(categoryKey[section.category] ?? section.category)}</p>
            {section.items.map(item => {
              const on = item.name === draft.report;
              return (
                <button
                  key={item.name}
                  type="button"
                  className={`rpt-rail-item${on ? ' is-on' : ''}`}
                  aria-current={on ? 'true' : undefined}
                  onClick={() => set({ report: item.name })}
                >
                  <span className="rpt-rail-name">{t(reportNameKey[item.name] ?? item.name)}</span>
                  <span className="rpt-rail-meta">
                    <span className={`rpt-chip rpt-chip--${item.period.toLowerCase()}`}>
                      {t(periodKey[item.period] ?? item.period)}
                    </span>
                    <span>{loading ? '…' : t('reports.rowsAvailable', { count: rowCountFor(item.name) })}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}

        {/* ── 2. How to draw it ────────────────────────────────────── */}
        <p className="rpt-ctl-legend">{t('reports.controlForm')}</p>
        <div className="rpt-ctl-kinds" role="radiogroup" aria-label={t('reports.chartForm')}>
          {kinds.map(kind => {
            const blocked = kind.partToWhole && !draftPartToWholeOk;
            const on = draft.kind === kind.id;
            return (
              <button
                key={kind.id}
                type="button"
                role="radio"
                aria-checked={on}
                className={on ? 'is-on' : undefined}
                disabled={blocked}
                title={blocked ? t('reports.chartFormUnavailable') : t(kind.labelKey)}
                onClick={() => set({ kind: kind.id })}
              >
                <kind.icon />
                <span>{t(kind.labelKey)}</span>
              </button>
            );
          })}
        </div>

        {/* ── 3. What else to show ─────────────────────────────────── */}
        <p className="rpt-ctl-legend">{t('reports.controlInclude')}</p>
        <label className="rpt-ctl-check">
          <input
            type="checkbox"
            checked={draft.tableOpen}
            onChange={e => set({ tableOpen: e.target.checked })}
            data-action="report-control-table"
          />
          <span>{t('reports.controlShowTable')}</span>
        </label>

        {/* Export acts on what is ON SCREEN, so it is not draft state and does
            not wait for Apply — handing over a file for a view the page has
            not drawn yet is a different report than the one you are reading. */}
        <button type="button" className="rpt-ctl-csv" disabled={loading}
                data-track="reports.export_csv" onClick={onExportCsv}>
          <Download /> {t('reports.downloadCsv')}
        </button>
      </div>

      {/* Apply sits outside the scroller so it is reachable whatever the list
          length — a commit button below the fold is a commit button nobody
          presses. */}
      <div className="rpt-ctl-apply">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!dirty}
          onClick={() => onApply(draft)}
          data-action="report-control-apply"
        >
          <Check className="w-4 h-4" /> {t('reports.controlApply')}
        </button>
        {dirty && (
          <button type="button" className="rpt-rail-clear" onClick={() => setDraft(applied)}>
            {t('reports.controlReset')}
          </button>
        )}
      </div>
    </aside>
  );
}
