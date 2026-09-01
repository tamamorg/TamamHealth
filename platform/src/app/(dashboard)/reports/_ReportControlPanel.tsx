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
 * They are one panel now. Report choice is draft state until Apply, while the
 * chart form redraws immediately: choosing "Donut" and seeing Columns until a
 * second action is neither useful feedback nor an honest selected state.
 *
 * The filter above the list is deliberately NOT draft state. Searching for
 * "malaria" is how you FIND the thing to visualise, not part of the view
 * being assembled, so it narrows the list immediately and Apply has nothing
 * to say about it.
 */

import { useEffect, useMemo, useState } from 'react';
import { Check, Search, X } from '@/components/icons/lucide';
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
}

export interface ChartKindOption {
  id: ReportChartKind;
  labelKey: string;
  icon: LucideIcon;
  partToWhole?: true;
}

export default function ReportControlPanel({
  filter, onFilterChange, applied, onApply, kinds, partToWholeOkFor, total,
}: {
  filter: ReportFilter;
  onFilterChange: (next: ReportFilter) => void;
  /** What the chart is drawing right now. */
  applied: ReportView;
  onApply: (view: ReportView) => void;
  kinds: readonly ChartKindOption[];
  /** Whether donut/treemap are honest for a given report's numbers. */
  partToWholeOkFor: (report: string) => boolean;
  total: number;
}) {
  const { t } = useTranslation();
  const [draftReport, setDraftReport] = useState(applied.report);

  /* Re-sync the drafted report when an outside control changes the visible
     report. Chart form is not draft state: it is applied immediately below. */
  useEffect(() => { setDraftReport(applied.report); }, [applied.report]);

  const sections = useMemo(() => filterReportSections(filter, t), [filter, t]);
  const shown = useMemo(() => countFilteredReports(filter, t), [filter, t]);
  const active = isFilterActive(filter);
  const selectedIsHidden = active && !sections.some(s => s.items.some(i => i.name === draftReport));

  const dirty = draftReport !== applied.report;

  /* A form the DRAFTED report cannot honestly take is offered as disabled
     rather than hidden, so the row does not reflow as you move between
     reports — and a donut left selected from a previous report falls back
     rather than drawing percentages of nothing. */
  const visiblePartToWholeOk = partToWholeOkFor(applied.report);
  const setFilter = (patch: Partial<ReportFilter>) => onFilterChange({ ...filter, ...patch });

  const applyReport = () => {
    const activeKind = kinds.find(kind => kind.id === applied.kind);
    const kind = activeKind?.partToWhole && !partToWholeOkFor(draftReport)
      ? 'column'
      : applied.kind;
    onApply({ report: draftReport, kind });
  };

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

        {/* Chart form belongs directly under the filter selections and acts
            on the chart immediately. Its checked state therefore always
            names the shape visible in the plot, not an unapplied draft. */}
        <div className="rpt-ctl-chart-form">
          <p className="rpt-ctl-legend">{t('reports.controlForm')}</p>
          <div className="rpt-ctl-kinds" role="radiogroup" aria-label={t('reports.chartForm')}>
            {kinds.map(kind => {
              const blocked = kind.partToWhole && !visiblePartToWholeOk;
              const on = applied.kind === kind.id;
              return (
                <button
                  key={kind.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={on ? 'is-on' : undefined}
                  disabled={blocked}
                  title={blocked ? t('reports.chartFormUnavailable') : t(kind.labelKey)}
                  onClick={() => onApply({ ...applied, kind: kind.id })}
                >
                  <kind.icon />
                  <span>{t(kind.labelKey)}</span>
                </button>
              );
            })}
          </div>
        </div>

        {selectedIsHidden && (
          <p className="rpt-rail-note">
            {t('reports.railSelectedHidden', { name: t(reportNameKey[draftReport] ?? draftReport) })}
          </p>
        )}

        {sections.length === 0 ? (
          <p className="rpt-rail-empty">{t('reports.railNoMatches')}</p>
        ) : sections.map(section => (
          <div key={section.category} className="rpt-rail-group">
            <p className="rpt-rail-group-title">{t(categoryKey[section.category] ?? section.category)}</p>
            {section.items.map(item => {
              const on = item.name === draftReport;
              return (
                <button
                  key={item.name}
                  type="button"
                  className={`rpt-rail-item${on ? ' is-on' : ''}`}
                  aria-current={on ? 'true' : undefined}
                  onClick={() => setDraftReport(item.name)}
                >
                  {/* Name only. Each row used to carry a cadence chip and an
                      "11 rows" count under it — two labels per item, sixteen
                      items, none of it the thing you are picking by. The
                      cadence is a filter above and a fact on the report itself;
                      the row count belongs to the table, not to choosing. */}
                  <span className="rpt-rail-name">{t(reportNameKey[item.name] ?? item.name)}</span>
                </button>
              );
            })}
          </div>
        ))}

        {/* No "Include" section. The data table is generated from the chart's
            own header now and its export sits with the table it exports —
            both belong to the result, not to assembling the view. */}
      </div>

      {/* Apply sits outside the scroller so it is reachable whatever the list
          length — a commit button below the fold is a commit button nobody
          presses. */}
      <div className="rpt-ctl-apply">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!dirty}
          onClick={applyReport}
          data-action="report-control-apply"
        >
          <Check className="w-4 h-4" /> {t('reports.controlApply')}
        </button>
        {dirty && (
          <button type="button" className="rpt-rail-clear" onClick={() => setDraftReport(applied.report)}>
            {t('reports.controlReset')}
          </button>
        )}
      </div>
    </aside>
  );
}
