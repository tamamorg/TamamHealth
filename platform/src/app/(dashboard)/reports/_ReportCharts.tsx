'use client';

/**
 * Every chart the Reports page can draw, behind a dynamic boundary so recharts
 * (~80-100 KB) is fetched only when one renders — the pattern
 * _GovernmentCharts and _FacilityCharts use.
 *
 * Recharts primitives cannot themselves be wrapped in `dynamic()`: the library
 * identifies children by component identity to tell an `<XAxis>` from a
 * `<Bar>`, and a dynamic wrapper changes that type, silently rendering a blank
 * chart. The boundary sits around the whole switch below, which is also why
 * this file exports one component rather than five.
 *
 * ── Which forms are offered, and which are not ──────────────────────────
 * Every report on this page reduces to the same shape: NAMED CATEGORIES
 * measured once. Five forms read that shape honestly:
 *
 *   column    ranked magnitude, few names             — the default
 *   bar       ranked magnitude, long names
 *   lollipop  ranked magnitude, many categories       — least ink per row
 *   donut     part-to-whole, up to ~7 slices
 *   treemap   part-to-whole, many parts, by area
 *
 * Line and area are deliberately absent. They encode change along an ordered
 * continuum, and "Unity, Jonglei, Lakes…" has no order beyond the ranking the
 * chart itself imposed — a line between those points would draw a trend that
 * does not exist. Donut and treemap are offered only when the values are a
 * genuine part-to-whole (see `supportsPartToWhole`); a ring of percentages
 * that do not sum to anything is the same lie in a different shape.
 *
 * ── Colour ──────────────────────────────────────────────────────────────
 * The ranked forms are ONE series over nominal categories, so every bar wears
 * one hue — the report section's accent, passed in by the page — and length
 * alone carries the magnitude. (An earlier revision shaded bars dark-to-light
 * by rank; that spent the identity channel re-encoding what length already
 * shows, and read as murky navy besides.) A point may still carry its own
 * colour when its category is a named entity that holds a hue across screens
 * (diseases). The part-to-whole forms are the opposite case: each slice IS an
 * identity, so they take the categorical scale in its fixed, CVD-validated
 * order, folded so it is never cycled.
 */

import {
  BarChart, Bar, Cell, LabelList, PieChart, Pie, Legend, Treemap,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { tooltipStyle, axisTick } from '@/components/ChartCard';
import { CHART_SERIES } from '@/lib/chart-colors';
import type { ReportChartPoint } from '@/lib/reports/report-chart-data';

export type ReportChartKind = 'bar' | 'column' | 'lollipop' | 'donut' | 'treemap';

/** Single-series hue when the page does not name one: the brand blue. */
const DEFAULT_ACCENT = 'var(--chart-2)';

/** Grey, reserved for the folded tail — "Other" is not a rank. */
const OTHER_FILL = 'var(--text-muted)';

/** A point may carry its own colour when its category is a named entity. */
export interface RankedPoint extends ReportChartPoint { color?: string }

const rankedFill = (p: RankedPoint, accent: string) =>
  p.label === 'Other' ? OTHER_FILL : (p.color ?? accent);

/**
 * The categorical scale is never cycled: past its six slots the tail folds
 * into "Other". MAX_BARS upstream already caps points at eight, so at most
 * two named slices join an existing (or new) grey tail here.
 */
function foldForSlices(points: RankedPoint[]): RankedPoint[] {
  const named = points.filter(p => p.label !== 'Other');
  if (named.length <= CHART_SERIES.length) return points;
  const head = named.slice(0, CHART_SERIES.length);
  const tailTotal = points
    .filter(p => !head.includes(p))
    .reduce((sum, p) => sum + p.value, 0);
  return tailTotal > 0 ? [...head, { label: 'Other', value: tailTotal }] : head;
}

const sliceFill = (p: RankedPoint, i: number) =>
  p.label === 'Other' ? OTHER_FILL : (p.color ?? CHART_SERIES[Math.min(i, CHART_SERIES.length - 1)]);

/**
 * Ink for text set INSIDE a fill (treemap tiles). Which of the two inks wins
 * is MEASURED, not guessed — WCAG contrast of white and of the navy ink
 * against each fill:
 *
 *   chart-1 deep blue #015697   white 7.56 · navy 1.76   -> white
 *   chart-2 brand     #2191D0   white 3.49 · navy 3.82   -> navy
 *   chart-3 rose      #BE185D   white 6.04 · navy 2.20   -> white
 *   chart-4 teal      #0D9488   white 3.74 · navy 3.55   -> white
 *   chart-5 orange    #E67200   white 3.10 · navy 4.29   -> navy
 *   chart-6 violet    #6D45C2   white 6.40 · navy 2.08   -> white
 *   Other     grey    #5D728B   white 4.95 · navy 2.69   -> white
 *
 * Brand blue and teal top out below the 4.5:1 small-text bar whichever ink
 * they wear — they are mid-lightness hues, and darkening them to fix it would
 * cost the brightness these tiles are for. Both clear the 3:1 mark bar, and
 * the value is never gated on the tile: the tooltip carries it on hover and
 * the generated table lists every row.
 */
const NAVY_INK_FILLS = new Set<string>([
  CHART_SERIES[1], // brand blue #2191D0
  CHART_SERIES[4], // orange     #E67200
]);
const tileInk = (fill: string) =>
  NAVY_INK_FILLS.has(fill) ? 'var(--color-slate-900)' : 'var(--color-white)';

/**
 * Whether a donut or treemap would be truthful for this measure.
 *
 * Both encode a share of a total, so they need values that ADD UP. A rate or a
 * percentage column does not (three facilities at 80% do not make 240%), and a
 * negative value cannot own an angle or an area at all.
 */
export function supportsPartToWhole(valueLabel: string, points: ReportChartPoint[]): boolean {
  if (/%|rate|percent/i.test(valueLabel)) return false;
  if (points.some(p => p.value < 0)) return false;
  return points.length >= 2 && points.length <= 10;
}

/** Long names get an ellipsis rather than eating the plot area. */
const truncate = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

const VALUE_LABEL = { fill: 'var(--text-secondary)', fontSize: 11, fontWeight: 600 } as const;

const formatValue = (v: React.ReactNode): string =>
  typeof v === 'number' ? v.toLocaleString() : String(v ?? '');

/** Legend text stays neutral — identity is carried by the swatch beside it. */
const legendProps = {
  iconType: 'circle' as const,
  iconSize: 8,
  layout: 'vertical' as const,
  align: 'right' as const,
  verticalAlign: 'middle' as const,
  wrapperStyle: { fontSize: 11.5, paddingInlineStart: 12, lineHeight: '20px' },
  formatter: (value: React.ReactNode) => <span style={{ color: 'var(--text-secondary)' }}>{value}</span>,
};

/**
 * Lollipop mark: a 2px stem to a ringed dot.
 *
 * A custom shape rather than a Bar-plus-Scatter composition — recharts would
 * need two axes agreeing on a category scale for that, and the shape callback
 * already receives the exact rect the bar would have occupied. The 2px
 * surface-colour ring keeps the dot legible against its own stem and against
 * the value label sitting to its right.
 */
function LollipopShape(props: { x?: number; y?: number; width?: number; height?: number; fill?: string }) {
  const { x = 0, y = 0, width = 0, height = 0, fill } = props;
  const cy = y + height / 2;
  const r = 5;
  const end = x + Math.max(0, width);
  return (
    <g>
      <line x1={x} y1={cy} x2={Math.max(x, end - r)} y2={cy} stroke={fill} strokeWidth={2} strokeLinecap="round" />
      <circle cx={end} cy={cy} r={r} fill={fill} stroke="var(--bg-card-solid)" strokeWidth={2} />
    </g>
  );
}

/** Treemap tile: fill, a 2px surface gap, and a label when the tile can hold one. */
function TreemapTile(props: {
  x?: number; y?: number; width?: number; height?: number;
  index?: number; name?: string; value?: number; fills?: string[];
}) {
  const { x = 0, y = 0, width = 0, height = 0, index = 0, name = '', value = 0, fills = [] } = props;
  const fill = fills[index] ?? DEFAULT_ACCENT;
  const ink = tileInk(fill);
  const roomy = width > 74 && height > 38;
  return (
    <g>
      <rect
        x={x + 1} y={y + 1}
        width={Math.max(0, width - 2)} height={Math.max(0, height - 2)}
        rx={3}
        fill={fill}
        stroke="var(--bg-card-solid)"
        strokeWidth={2}
      />
      {roomy && (
        <>
          <text x={x + 9} y={y + 20} fill={ink} stroke="none" fontSize={11.5} fontWeight={600}>
            {truncate(name, Math.floor(width / 8))}
          </text>
          <text x={x + 9} y={y + 36} fill={ink} stroke="none" fontSize={12} fontWeight={700} opacity={0.8}>
            {value.toLocaleString()}
          </text>
        </>
      )}
    </g>
  );
}

export function ReportChart({ kind, points, valueLabel, accent = DEFAULT_ACCENT }: {
  kind: ReportChartKind;
  points: RankedPoint[];
  valueLabel: string;
  /** The one hue the ranked forms draw in — the report section's accent. */
  accent?: string;
}) {
  if (kind === 'donut') {
    const sliced = foldForSlices(points).map((p, i) => ({ ...p, fill: sliceFill(p, i) }));
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={sliced}
            dataKey="value"
            nameKey="label"
            innerRadius="52%"
            outerRadius="80%"
            paddingAngle={2}
            stroke="var(--bg-card-solid)"
            strokeWidth={2}
            isAnimationActive={false}
            /* Share, not raw count: the reason to draw a ring at all. Text
               wears a text token, never the slice colour, and slivers under
               4% go unlabelled — the legend and tooltip still carry them. */
            label={({ x, y, textAnchor, percent }: {
              x?: number; y?: number;
              textAnchor?: 'inherit' | 'end' | 'middle' | 'start';
              percent?: number;
            }) => {
              const pct = Math.round((percent ?? 0) * 100);
              if (pct < 4) return <g />;
              return (
                <text
                  x={x} y={y}
                  textAnchor={textAnchor}
                  dominantBaseline="central"
                  fill="var(--text-secondary)"
                  fontSize={11}
                  fontWeight={600}
                >
                  {pct}%
                </text>
              );
            }}
            labelLine={false}
          >
            {sliced.map(s => <Cell key={s.label} fill={s.fill} />)}
          </Pie>
          <Tooltip {...tooltipStyle} formatter={(v: number | undefined, nm) => [(v ?? 0).toLocaleString(), String(nm ?? '')]} />
          <Legend {...legendProps} />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (kind === 'treemap') {
    const folded = foldForSlices(points);
    const fills = folded.map((p, i) => sliceFill(p, i));
    return (
      <ResponsiveContainer width="100%" height="100%">
        <Treemap
          data={folded.map(p => ({ name: p.label, value: p.value }))}
          dataKey="value"
          isAnimationActive={false}
          content={<TreemapTile fills={fills} />}
        >
          <Tooltip {...tooltipStyle} formatter={(v: number | undefined) => [(v ?? 0).toLocaleString(), valueLabel]} />
        </Treemap>
      </ResponsiveContainer>
    );
  }

  if (kind === 'column') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 26, right: 16, left: 16, bottom: 4 }} barCategoryGap="34%">
          {/* No value axis and no gridlines: every column already carries its
              number on the cap, so a scale beside them is ink that repeats
              what the labels say. The category axis stays — it is the only
              thing naming the marks — and a hairline grounds them. */}
          <XAxis
            dataKey="label"
            tick={{ ...axisTick }}
            tickLine={false}
            axisLine={{ stroke: 'var(--border-light)' }}
            interval={0}
            angle={-28}
            textAnchor="end"
            height={62}
            tickFormatter={(v: string) => truncate(String(v), 16)}
          />
          <YAxis hide domain={[0, 'dataMax']} />
          <Tooltip {...tooltipStyle} cursor={{ fill: 'var(--overlay-subtle)' }} formatter={(v: number | undefined) => [(v ?? 0).toLocaleString(), valueLabel]} />
          {/* ≤24px thick with a 4px rounded cap, square at the baseline: the
              band's leftover is air, which is what keeps the panel quiet. */}
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
            {points.map(p => <Cell key={p.label} fill={rankedFill(p, accent)} />)}
            <LabelList dataKey="value" position="top" offset={8} style={VALUE_LABEL} formatter={formatValue} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }

  // bar | lollipop — both horizontal, differing only in the mark.
  const isLollipop = kind === 'lollipop';
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={points}
        layout="vertical"
        margin={{ top: 6, right: 62, left: 2, bottom: 6 }}
        barCategoryGap={isLollipop ? '42%' : '32%'}
      >
        {/* Same reasoning as the column form: the value rides the tip of every
            mark, so the number axis and its grid are dropped and the category
            names do the labelling. */}
        <XAxis type="number" hide domain={[0, 'dataMax']} />
        <YAxis
          type="category"
          dataKey="label"
          width={186}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: string) => truncate(String(v), 26)}
        />
        <Tooltip {...tooltipStyle} cursor={{ fill: 'var(--overlay-subtle)' }} formatter={(v: number | undefined) => [(v ?? 0).toLocaleString(), valueLabel]} />
        <Bar
          dataKey="value"
          radius={[0, 4, 4, 0]}
          maxBarSize={isLollipop ? 12 : 20}
          isAnimationActive={false}
          shape={isLollipop ? <LollipopShape /> : undefined}
        >
          {points.map(p => <Cell key={p.label} fill={rankedFill(p, accent)} />)}
          {/* Direct labels: the value is the point of the chart, and reading
              eight bars off an axis is worse than eight small numbers. The
              offset clears the lollipop dot and the bar's rounded end. */}
          <LabelList dataKey="value" position="right" offset={isLollipop ? 12 : 8} style={VALUE_LABEL} formatter={formatValue} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
