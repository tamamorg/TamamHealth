/**
 * The Reports page infers a chart from whatever shape a generator produced.
 * Sixteen generators feed it, so the cases that matter are the ones where a
 * naive "first column, second column" read would draw something wrong: a
 * TOTAL row that dwarfs every real bar, the sub-table headings Referral
 * Summary emits, a rate column that would rank a one-case outbreak above a
 * thousand-case one, and one-row-per-record reports that need aggregating.
 */
import { buildReportChart } from '@/lib/reports/report-chart-data';

describe('buildReportChart', () => {
  it('returns null when there is nothing to plot', () => {
    expect(buildReportChart([])).toBeNull();
    // One column: a label with no measure beside it.
    expect(buildReportChart([{ Facility: 'Juba' }])).toBeNull();
  });

  it('reads the first name column and the first measure column', () => {
    const chart = buildReportChart([
      { State: 'Jonglei', 'Total Patients': 12, Male: 5 },
      { State: 'Unity', 'Total Patients': 30, Male: 14 },
    ]);
    expect(chart).not.toBeNull();
    expect(chart!.categoryLabel).toBe('State');
    expect(chart!.valueLabel).toBe('Total Patients');
    // Sorted by magnitude — the chart's job is the ranking.
    expect(chart!.points).toEqual([
      { label: 'Unity', value: 30 },
      { label: 'Jonglei', value: 12 },
    ]);
  });

  it('drops the TOTAL row rather than charting it as a bar', () => {
    const chart = buildReportChart([
      { State: 'Jonglei', 'Total Patients': 12 },
      { State: 'Unity', 'Total Patients': 30 },
      { State: 'TOTAL', 'Total Patients': 42 },
    ]);
    expect(chart!.points.map(p => p.label)).toEqual(['Unity', 'Jonglei']);
  });

  it('drops the sub-table headings Referral Summary emits, and skips its blank first column', () => {
    // Shape straight out of the Referral Summary generator.
    const chart = buildReportChart([
      { Category: 'BY STATUS', Metric: '', Count: '' },
      { Category: '', Metric: 'Pending', Count: 4 },
      { Category: '', Metric: 'Completed', Count: 9 },
      { Category: 'BY URGENCY', Metric: '', Count: '' },
      { Category: '', Metric: 'Routine', Count: 7 },
    ]);
    // `Category` is blank on most rows, so the names come from `Metric`.
    expect(chart!.categoryLabel).toBe('Metric');
    expect(chart!.valueLabel).toBe('Count');
    expect(chart!.points.map(p => p.label)).toEqual(['Completed', 'Routine', 'Pending']);
  });

  it('prefers a count over a rate, so magnitude is not ranked by percentage', () => {
    const chart = buildReportChart([
      { Disease: 'Cholera', 'Total Cases': 900, 'CFR (%)': '1.0' },
      { Disease: 'Measles', 'Total Cases': 10, 'CFR (%)': '40.0' },
    ]);
    expect(chart!.valueLabel).toBe('Total Cases');
    expect(chart!.points[0].label).toBe('Cholera');
  });

  it('falls back to a rate when the report carries no count', () => {
    const chart = buildReportChart([
      { Facility: 'Juba', 'Collection Rate (%)': '82.0' },
      { Facility: 'Wau', 'Collection Rate (%)': '31.5' },
    ]);
    expect(chart!.valueLabel).toBe('Collection Rate (%)');
    expect(chart!.points[0]).toEqual({ label: 'Juba', value: 82 });
  });

  it('sums duplicate labels — reports that emit one row per record', () => {
    // Stock Status is one row per SKU, several per facility.
    const chart = buildReportChart([
      { Facility: 'Juba', Medication: 'ORS', 'Stock Level': 10 },
      { Facility: 'Juba', Medication: 'Zinc', 'Stock Level': 15 },
      { Facility: 'Wau', Medication: 'ORS', 'Stock Level': 4 },
    ]);
    expect(chart!.points).toEqual([
      { label: 'Juba', value: 25 },
      { label: 'Wau', value: 4 },
    ]);
  });

  it('folds a long tail into a single Other bar', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      Medicine: `Drug ${i}`,
      'Total Stock': 20 - i,
    }));
    const chart = buildReportChart(rows);
    expect(chart!.truncated).toBe(true);
    expect(chart!.points).toHaveLength(8);
    expect(chart!.points[7].label).toBe('Other');
    // Nothing is lost: the tail's total is what the Other bar carries.
    const tail = rows.slice(7).reduce((sum, r) => sum + r['Total Stock'], 0);
    expect(chart!.points[7].value).toBe(tail);
  });

  it('does not truncate at exactly the bar limit', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ Medicine: `Drug ${i}`, Stock: 8 - i }));
    const chart = buildReportChart(rows);
    expect(chart!.truncated).toBe(false);
    expect(chart!.points).toHaveLength(8);
    expect(chart!.points.some(p => p.label === 'Other')).toBe(false);
  });

  it('returns null when every measure is zero, rather than a blank plot', () => {
    // An all-zero chart reads as a rendering fault, not as an empty month.
    expect(buildReportChart([
      { Medicine: 'ORS', 'Total Stock': 0 },
      { Medicine: 'Zinc', 'Total Stock': 0 },
    ])).toBeNull();
  });

  it('parses the numeric strings toFixed() leaves behind', () => {
    const chart = buildReportChart([
      { Facility: 'Juba', Collected: '1200.50' },
      { Facility: 'Wau', Collected: '340.00' },
    ]);
    expect(chart!.points[0].value).toBeCloseTo(1200.5);
  });

  it('returns null when no column measures anything', () => {
    expect(buildReportChart([
      { Disease: 'Cholera', State: 'Unity', Trend: 'rising' },
    ])).toBeNull();
  });
});
