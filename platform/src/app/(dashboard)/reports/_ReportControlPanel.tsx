'use client';

/**
 * The Reports control panel: a short form of dropdowns, then Show report.
 *
 * 2026-11-04 (user): the panel was a sixteen-row list of report names under
 * five headings, with the Reports hub's seven pages as a tab strip above the
 * page. Now every choice is a field you select from, in the order you decide
 * them: which area of reporting, which topic, how often, which report, and
 * what shape to draw it in. The Report field searches as you type (Select
 * adds a filter box once a list is long), so the separate search box went.
 *
 * Report choice is draft state until Show report, because it reloads the
 * chart and its table. Chart type redraws immediately: choosing "Donut" and
 * still seeing columns is neither useful feedback nor an honest selection.
 * Topic and frequency only narrow the Report field.
 */

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Check } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useAuth } from '@/lib/context';
import type { LucideIcon } from '@/components/icons/lucide';
import type { ReportChartKind } from './_ReportCharts';
import {
  REPORT_CATEGORIES, REPORT_PERIODS,
  categoryKey, filterReportSections,
  periodKey, reportNameKey,
  type ReportFilter,
} from './_ReportCatalogue';
import Select from '@/components/Select';
import { MODULE_HUBS, visibleMembers } from '@/lib/navigation/module-hubs';
import './report-control-panel.css';

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
  filter, onFilterChange, applied, onApply, kinds, partToWholeOkFor,
}: {
  filter: ReportFilter;
  onFilterChange: (next: ReportFilter) => void;
  /** What the chart is drawing right now. */
  applied: ReportView;
  onApply: (view: ReportView) => void;
  kinds: readonly ChartKindOption[];
  /** Whether donut/treemap are honest for a given report's numbers. */
  partToWholeOkFor: (report: string) => boolean;
  /** Kept for the page's call; the Report field counts its own options. */
  total?: number;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { currentUser } = useAuth();
  const [draftReport, setDraftReport] = useState(applied.report);

  /* Re-sync the drafted report when an outside control changes the visible
     report. Chart type is not draft state: it is applied immediately. */
  useEffect(() => { setDraftReport(applied.report); }, [applied.report]);

  /* The Reports hub's other pages (facility statistics, data quality, DHIS2
     export, …) as the first field, in place of the tab strip above the page. */
  const areas = useMemo(() => {
    const hub = MODULE_HUBS.find(h => h.id === 'reports');
    return hub ? visibleMembers(hub, currentUser?.role) : [];
  }, [currentUser?.role]);

  // Topic and frequency narrow the Report field; there is no free-text query.
  const narrowing: ReportFilter = { ...filter, query: '' };
  const sections = useMemo(() => filterReportSections(narrowing, t), [narrowing.category, narrowing.period, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const options = sections.flatMap(section => section.items.map(item => ({ section, item })));

  /* A narrowed list that no longer holds the drafted report moves the draft
     to its first report, so the Report field never shows a choice it does not
     list. */
  useEffect(() => {
    if (options.length && !options.some(o => o.item.name === draftReport)) setDraftReport(options[0].item.name);
  }, [options, draftReport]);

  const dirty = draftReport !== applied.report;
  const setFilter = (patch: Partial<ReportFilter>) => onFilterChange({ ...filter, ...patch, query: '' });

  const applyReport = () => {
    const activeKind = kinds.find(kind => kind.id === applied.kind);
    const kind = activeKind?.partToWhole && !partToWholeOkFor(draftReport) ? 'column' : applied.kind;
    onApply({ report: draftReport, kind });
  };

  /* A shape the report cannot honestly take (percentages of a list that is
     not a whole) is offered as disabled, so the list does not change length
     from report to report. */
  const partToWholeOk = partToWholeOkFor(applied.report);

  return (
    <aside className="rpt-rail rcp" aria-label={t('reports.controlPanelTitle')}>
      <div className="rcp-head">
        <h2 className="rcp-title">{t('reports.controlPanelTitle')}</h2>
        {dirty && <span className="rcp-pending">{t('reports.controlPending')}</span>}
      </div>

      <div className="rcp-body">
        {areas.length > 1 && (
          <label className="rcp-field">
            <span className="rcp-label">{t('reports.controlArea')}</span>
            <Select
              value={pathname ?? '/reports'}
              onChange={e => { if (e.target.value !== pathname) router.push(e.target.value); }}
              data-action="report-control-area"
            >
              {areas.map(area => <option key={area.href} value={area.href}>{area.label}</option>)}
            </Select>
          </label>
        )}

        <label className="rcp-field">
          <span className="rcp-label">{t('reports.filterCategory')}</span>
          <Select
            value={filter.category}
            onChange={e => setFilter({ category: e.target.value })}
            data-action="report-filter-category"
          >
            <option value="">{t('reports.filterAllCategories')}</option>
            {REPORT_CATEGORIES.map(c => <option key={c} value={c}>{t(categoryKey[c] ?? c)}</option>)}
          </Select>
        </label>

        <label className="rcp-field">
          <span className="rcp-label">{t('reports.filterPeriod')}</span>
          <Select
            value={filter.period}
            onChange={e => setFilter({ period: e.target.value })}
            data-action="report-filter-period"
          >
            <option value="">{t('reports.filterAllPeriods')}</option>
            {REPORT_PERIODS.map(p => <option key={p} value={p}>{t(periodKey[p] ?? p)}</option>)}
          </Select>
        </label>

        <label className="rcp-field">
          <span className="rcp-label">{t('reports.controlReport')}</span>
          {options.length === 0 ? (
            <p className="rcp-empty">{t('reports.railNoMatches')}</p>
          ) : (
            <Select
              value={draftReport}
              onChange={e => setDraftReport(e.target.value)}
              searchPlaceholder={t('reports.filterSearchPlaceholder')}
              data-action="report-control-report"
            >
              {sections.map(section => (
                <optgroup key={section.category} label={t(categoryKey[section.category] ?? section.category)}>
                  {section.items.map(item => (
                    <option key={item.name} value={item.name}>{t(reportNameKey[item.name] ?? item.name)}</option>
                  ))}
                </optgroup>
              ))}
            </Select>
          )}
        </label>

        <label className="rcp-field">
          <span className="rcp-label">{t('reports.controlForm')}</span>
          <Select
            value={applied.kind}
            onChange={e => onApply({ ...applied, kind: e.target.value as ReportChartKind })}
            data-action="report-control-kind"
          >
            {kinds.map(kind => (
              <option key={kind.id} value={kind.id} disabled={kind.partToWhole && !partToWholeOk}>
                {t(kind.labelKey)}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {/* Outside the scroller, so it is reachable whatever the panel's
          height: a commit button below the fold is one nobody presses. */}
      <div className="rcp-foot">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!dirty}
          onClick={applyReport}
          data-action="report-control-apply"
        >
          <Check className="w-4 h-4" aria-hidden="true" /> {t('reports.controlApply')}
        </button>
        {dirty && (
          <button type="button" className="rcp-undo" onClick={() => setDraftReport(applied.report)}>
            {t('reports.controlReset')}
          </button>
        )}
      </div>
    </aside>
  );
}
