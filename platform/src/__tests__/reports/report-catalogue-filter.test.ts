/**
 * The Reports rail filter.
 *
 * The rail is a picker over sixteen reports in five sections, and the filter is
 * the only thing standing between the operator and scrolling for the one they
 * want. These assert the narrowing itself — the part that is pure logic and
 * therefore worth pinning, separately from how the rail draws it.
 */

import {
  allReports, REPORT_CATEGORIES, REPORT_PERIODS,
  EMPTY_REPORT_FILTER, countFilteredReports, filterReportSections,
  isFilterActive, matchesReportFilter,
  type ReportFilter,
} from '@/app/(dashboard)/reports/_ReportCatalogue';

const filter = (patch: Partial<ReportFilter>): ReportFilter => ({ ...EMPTY_REPORT_FILTER, ...patch });
const names = (f: ReportFilter) => filterReportSections(f).flatMap(s => s.items.map(i => i.name));

describe('report catalogue', () => {
  it('flattens every section into one list', () => {
    expect(allReports).toHaveLength(16);
    expect(REPORT_CATEGORIES).toHaveLength(5);
    expect(new Set(allReports.map(r => r.name)).size).toBe(16); // no duplicate names
  });

  it('derives the cadences present, in reporting order', () => {
    expect(REPORT_PERIODS).toEqual(['Daily', 'Weekly', 'Monthly', 'Quarterly']);
  });

  it('gives every report a category that exists', () => {
    for (const report of allReports) expect(REPORT_CATEGORIES).toContain(report.category);
  });
});

describe('the empty filter', () => {
  it('is not active, and narrows nothing', () => {
    expect(isFilterActive(EMPTY_REPORT_FILTER)).toBe(false);
    expect(countFilteredReports(EMPTY_REPORT_FILTER)).toBe(16);
    expect(filterReportSections(EMPTY_REPORT_FILTER)).toHaveLength(5);
  });

  it('treats whitespace as no query rather than as a search for a space', () => {
    expect(isFilterActive(filter({ query: '   ' }))).toBe(false);
    expect(countFilteredReports(filter({ query: '   ' }))).toBe(16);
  });
});

describe('narrowing', () => {
  it('filters by section, and drops the sections left empty', () => {
    const f = filter({ category: 'Disease Surveillance' });
    const sections = filterReportSections(f);
    expect(sections).toHaveLength(1);
    expect(sections[0].category).toBe('Disease Surveillance');
    expect(sections[0].items).toHaveLength(5);
  });

  it('filters by cadence across every section', () => {
    const sections = filterReportSections(filter({ period: 'Quarterly' }));
    expect(names(filter({ period: 'Quarterly' }))).toEqual(
      expect.arrayContaining(['Patient Demographics Report', 'TB Treatment Outcomes', 'Donor Reporting Pack']),
    );
    // Spans more than one section — a cadence is not a section in disguise.
    expect(sections.length).toBeGreaterThan(1);
  });

  it('matches on name and on description', () => {
    expect(names(filter({ query: 'malaria' }))).toEqual(['Malaria Indicators Report']);
    // "bed occupancy" appears in the Bed Occupancy Report's own description.
    expect(names(filter({ query: 'stockouts' }))).toEqual(['Stock Status Report']);
  });

  it('is case-insensitive', () => {
    expect(names(filter({ query: 'MALARIA' }))).toEqual(names(filter({ query: 'malaria' })));
  });

  it('combines the three as AND, not OR', () => {
    // Quarterly alone spans several sections; inside Disease Surveillance it is
    // one report. An OR would have returned the union instead.
    const f = filter({ category: 'Disease Surveillance', period: 'Quarterly' });
    expect(names(f)).toEqual(['TB Treatment Outcomes']);

    const contradiction = filter({ category: 'Financial', period: 'Daily' });
    expect(names(contradiction)).toEqual([]);
    expect(filterReportSections(contradiction)).toEqual([]);
  });

  it('counts what it shows', () => {
    for (const f of [
      filter({ category: 'Pharmacy & Supply Chain' }),
      filter({ period: 'Weekly' }),
      filter({ query: 'report' }),
      filter({ category: 'Financial', period: 'Quarterly' }),
    ]) {
      expect(countFilteredReports(f)).toBe(names(f).length);
    }
  });

  it('reports itself active as soon as any one field is set', () => {
    expect(isFilterActive(filter({ query: 'x' }))).toBe(true);
    expect(isFilterActive(filter({ category: 'Financial' }))).toBe(true);
    expect(isFilterActive(filter({ period: 'Daily' }))).toBe(true);
  });
});

describe('translated search', () => {
  it('matches the translated name, not only the English identifier', () => {
    // An Arabic UI searching an Arabic word has to find the report; the
    // catalogue is still keyed on the English identifiers underneath.
    const translate = (key: string) => (key === 'reports.nameMalariaIndicators' ? 'تقرير الملاريا' : key);
    const report = allReports.find(r => r.name === 'Malaria Indicators Report')!;
    expect(matchesReportFilter(report, filter({ query: 'الملاريا' }), translate)).toBe(true);
    expect(matchesReportFilter(report, filter({ query: 'الملاريا' }))).toBe(false);
  });

  it('still honours section and cadence when a translator is supplied', () => {
    const report = allReports.find(r => r.name === 'Revenue Report')!;
    const translate = (key: string) => key;
    expect(matchesReportFilter(report, filter({ category: 'Financial' }), translate)).toBe(true);
    expect(matchesReportFilter(report, filter({ category: 'Financial', period: 'Daily' }), translate)).toBe(false);
  });
});
