/**
 * Chart series colour — one categorical scale, assigned by entity.
 *
 * Two rules do most of the work here, and both were being broken:
 *
 *   1. **Status colours are reserved.** Surveillance painted malaria with
 *      `--color-danger` and diarrhoea with `--color-success`, so a reader
 *      could not tell "this is the cholera series" from "this is the bad
 *      one". Series identity and clinical severity are different jobs and
 *      must not share a palette.
 *   2. **Colour follows the entity, not the position.** Malaria was the brand
 *      blue on /surveillance and red on /government; cholera was red on one
 *      and blue on the other. The same disease has to be the same colour
 *      wherever it appears, or the colour carries no information at all.
 *
 * The scale itself lives in globals.css as `--chart-1..6`. Its ORDER is the
 * colourblind-safety mechanism: 120 orderings of the hue pool were validated
 * and 17 passed; the one in use has a worst adjacent pair of ΔE 8.6 under
 * deuteranopia. Do not reorder it casually — re-run the validation first.
 */

/** The categorical slots, in fixed order. Never cycle past the end: a 7th
 *  series folds into "Other", becomes small multiples, or gets faceted. */
export const CHART_SERIES = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
] as const;

/** One hue, light → dark, for magnitude. Never a rainbow. */
export const CHART_SEQUENTIAL = [
  'var(--chart-seq-1)',
  'var(--chart-seq-2)',
  'var(--chart-seq-3)',
  'var(--chart-seq-4)',
  'var(--chart-seq-5)',
] as const;

/**
 * The same slots as literal hex, for JS colour MATH only — the choropleth
 * interpolates a wash toward the layer colour with `parseInt(hex.slice(…))`,
 * and a `var()` string parses to NaN, which is how the national map rendered
 * solid black. Use the `var()` forms everywhere the value is handed to CSS.
 * `color-tokens.test.ts` asserts these stay equal to the tokens.
 */
export const CHART_SERIES_HEX = [
  '#015697', '#2191D0', '#BE185D', '#0D9488', '#E67200', '#6D45C2',
] as const;

export const CHART_GRID = 'var(--chart-grid)';
export const CHART_AXIS = 'var(--chart-axis)';

/**
 * Disease → slot, stable across every screen that charts them.
 *
 * Seven entities share six slots because no single chart shows more than
 * five: the outbreak chart runs malaria/cholera/measles/pneumonia/diarrhoea,
 * the programme chart runs malaria/cholera/measles/tb/hiv. Only the first
 * three appear in both, and they hold slots 1–3 everywhere. `hiv` reuses
 * slot 5 — it is never charted beside diarrhoea, so the pair cannot be
 * confused inside one plot.
 */
export const DISEASE_COLOR: Record<string, string> = {
  malaria: CHART_SERIES[0],
  cholera: CHART_SERIES[1],
  measles: CHART_SERIES[2],
  pneumonia: CHART_SERIES[3],
  diarrhea: CHART_SERIES[4],
  'acute watery diarrhea': CHART_SERIES[4],
  tuberculosis: CHART_SERIES[5],
  tb: CHART_SERIES[5],
  hiv: CHART_SERIES[4],
};

/** Slot for a disease name, falling back to the neutral last slot. */
export function diseaseColor(name: string): string {
  return DISEASE_COLOR[name.trim().toLowerCase()] ?? CHART_SERIES[5];
}
