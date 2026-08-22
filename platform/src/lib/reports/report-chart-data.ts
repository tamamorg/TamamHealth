/**
 * Turn a generated report's rows into something chartable.
 *
 * The Reports page produces sixteen different row shapes from sixteen
 * different generators, and hand-writing a chart for each would be sixteen
 * places to drift. Instead the shape is INFERRED: pick the column that names
 * things, pick the column that measures them, and let the caller draw bars.
 *
 * Deliberately predictable rather than clever. The full table sits directly
 * beneath the chart, so a reader can always see what was summarised; a
 * heuristic that silently picked a different column per report would make the
 * chart harder to trust than no chart at all.
 */

/** One bar: a label and the value it measures. */
export interface ReportChartPoint {
  label: string;
  value: number;
}

export interface ReportChart {
  points: ReportChartPoint[];
  /** Header of the column the values came from — the chart's axis title. */
  valueLabel: string;
  /** Header of the column the labels came from. */
  categoryLabel: string;
  /** True when the tail was folded into a single "Other" bar. */
  truncated: boolean;
}

/** Bars beyond this are folded into "Other" — past ~8 the labels stop fitting
 *  and the ranking, not the tail, is what the chart is for. */
const MAX_BARS = 8;

/**
 * Rows the generators add for the TABLE's benefit, which would be nonsense as
 * bars: the `TOTAL` summary row (it would dwarf every real bar and double-count
 * the data) and the `BY STATUS` / `BY URGENCY` group headings that Referral
 * Summary uses as sub-table separators.
 */
function isArtifactRow(row: Record<string, unknown>, headers: string[]): boolean {
  const first = String(row[headers[0]] ?? '').trim();
  if (first === 'TOTAL') return true;
  if (/^BY /.test(first)) return true;
  return false;
}

/** Parse a cell to a number, tolerating the `'12.5'` strings `.toFixed()` leaves. */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The column whose values name things.
 *
 * First column wins when it has values, which is what every generator intends
 * — but Referral Summary leaves its first column blank on all but the heading
 * rows, so a column that is mostly empty is skipped in favour of the next one.
 */
function pickCategoryColumn(rows: Record<string, unknown>[], headers: string[]): string | null {
  for (const header of headers) {
    const filled = rows.filter(r => String(r[header] ?? '').trim() !== '');
    if (filled.length < rows.length / 2) continue;
    // A column that parses as numbers throughout is a measure, not a name.
    const numeric = filled.filter(r => toNumber(r[header]) !== null);
    if (numeric.length === filled.length) continue;
    return header;
  }
  return null;
}

/**
 * The column whose values measure things.
 *
 * Rates and percentages are passed over when a count is available: charting
 * "CFR (%)" beside "Total Cases" would rank a one-case outbreak above a
 * thousand-case one. They are still eligible as a last resort, because some
 * reports carry nothing else.
 */
function pickValueColumn(
  rows: Record<string, unknown>[],
  headers: string[],
  exclude: string,
): string | null {
  const numericHeaders = headers.filter(header => {
    if (header === exclude) return false;
    const parsed = rows.map(r => toNumber(r[header]));
    const usable = parsed.filter(v => v !== null);
    // Mostly-numeric: a stray blank (Referral Summary's headings) is fine.
    return usable.length > 0 && usable.length >= rows.length / 2;
  });
  if (numericHeaders.length === 0) return null;
  const isRate = (h: string) => /%|rate|percent/i.test(h);
  return numericHeaders.find(h => !isRate(h)) ?? numericHeaders[0];
}

/**
 * Build the bars for a report, or `null` when its rows carry nothing to plot
 * (no names, no measures, or every measure is zero — an all-zero chart is a
 * blank rectangle that implies a rendering fault rather than an empty month).
 */
export function buildReportChart(rows: Record<string, unknown>[]): ReportChart | null {
  if (!rows.length) return null;
  const headers = Object.keys(rows[0]);
  if (headers.length < 2) return null;

  const body = rows.filter(row => !isArtifactRow(row, headers));
  if (!body.length) return null;

  const categoryLabel = pickCategoryColumn(body, headers);
  if (!categoryLabel) return null;
  const valueLabel = pickValueColumn(body, headers, categoryLabel);
  if (!valueLabel) return null;

  // Sum duplicates. Several reports emit one row per record rather than per
  // category (Stock Status is one row per SKU), so without this the same
  // facility would appear as five separate bars.
  const totals = new Map<string, number>();
  for (const row of body) {
    const label = String(row[categoryLabel] ?? '').trim();
    if (!label) continue;
    const value = toNumber(row[valueLabel]);
    if (value === null) continue;
    totals.set(label, (totals.get(label) ?? 0) + value);
  }
  if (totals.size === 0) return null;

  const sorted = [...totals.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  if (sorted.every(p => p.value === 0)) return null;

  let points = sorted;
  let truncated = false;
  if (sorted.length > MAX_BARS) {
    const head = sorted.slice(0, MAX_BARS - 1);
    const tail = sorted.slice(MAX_BARS - 1);
    const otherTotal = tail.reduce((sum, p) => sum + p.value, 0);
    points = otherTotal > 0 ? [...head, { label: 'Other', value: otherTotal }] : head;
    truncated = true;
  }

  return { points, valueLabel, categoryLabel, truncated };
}
