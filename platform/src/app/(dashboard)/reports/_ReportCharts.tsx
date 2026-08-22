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
 *   bar       ranked magnitude, long names          — the default
 *   column    ranked magnitude, few short names
 *   lollipop  ranked magnitude, many categories     — least ink per row
 *   donut     part-to-whole, up to ~8 slices
 *   treemap   part-to-whole, many parts, by area
 *
 * Line and area are deliberately absent. They encode change along an ordered
 * continuum, and "Unity, Jonglei, Lakes…" has no order beyond the ranking the
 * chart itself imposed — a line between those points would draw a trend that
 * does not exist. Donut and treemap are offered only when the values are a
 * genuine part-to-whole (see `supportsPartToWhole`); a ring of percentages
 * that do not sum to anything is the same lie in a different shape.
 */

import {
  BarChart, Bar, Cell, LabelList, PieChart, Pie, Legend, Treemap,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { tooltipStyle, axisTick } from '@/components/ChartCard';
import type { ReportChartPoint } from '@/lib/reports/report-chart-data';

export type ReportChartKind = 'bar' | 'column' | 'lollipop' | 'donut' | 'treemap';

/**
 * Magnitude ramp: one hue, dark for large, light for small.
 *
 * Drawn from the sequential scale in globals.css (`--chart-seq-*`), but only
 * three of its five steps work as a fill on the card surface:
 *
 *   seq-1  L 0.940, contrast  1.14  — invisible on white, fails the 3:1 floor
 *   seq-2  L 0.652                  — 0.025 from seq-3, the same shade to the eye
 *   seq-3  L 0.627, contrast  3.39  OK
 *   seq-4  L 0.447, contrast  7.36  OK
 *   seq-5  L 0.233, contrast 16.40  OK
 *
 * Three evenly-spaced steps (ΔL ≈ 0.19) are ample for the ranked forms: the
 * bar's LENGTH already carries the magnitude, so the shade only reinforces a
 * ranking the reader can measure. The part-to-whole forms have no length to
 * read, so they step through the whole ramp instead — there, shade is the only
 * ordering cue the reader gets.
 */
const MAGNITUDE_RAMP = [
  'var(--chart-seq-5)',
  'var(--chart-seq-4)',
  'var(--chart-seq-3)',
] as const;

/** Five steps for the area/angle forms, where shade does all the ordering. */
const SLICE_RAMP = [
  'var(--chart-seq-5)',
  'var(--chart-seq-4)',
  'var(--chart-1)',
  'var(--chart-seq-3)',
  'var(--chart-2)',
] as const;

/** Grey, reserved for the folded tail — "Other" is not a rank. */
const OTHER_FILL = 'var(--text-muted)';

function rampShade(index: number, total: number, ramp: readonly string[]): string {
  if (total <= 1) return ramp[0];
  const step = Math.round((index / (total - 1)) * (ramp.length - 1));
  return ramp[Math.min(step, ramp.length - 1)];
}

/** A point may carry its own colour when its category is a named entity. */
export interface RankedPoint extends ReportChartPoint { color?: string }

const fillFor = (p: RankedPoint, i: number, n: number, ramp: readonly string[]) =>
  p.label === 'Other' ? OTHER_FILL : (p.color ?? rampShade(i, n, ramp));

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
 * Lollipop mark: a 2px stem to a filled dot.
 *
 * A custom shape rather than a Bar-plus-Scatter composition — recharts would
 * need two axes agreeing on a category scale for that, and the shape callback
 * already receives the exact rect the bar would have occupied.
 */
function LollipopShape(props: { x?: number; y?: number; width?: number; height?: number; fill?: string }) {
  const { x = 0, y = 0, width = 0, height = 0, fill } = props;
  const cy = y + height / 2;
  const r = 5;
  const end = x + Math.max(0, width);
  return (
    <g>
      <line x1={x} y1={cy} x2={Math.max(x, end - r)} y2={cy} stroke={fill} strokeWidth={2} strokeLinecap="round" />
      <circle cx={end} cy={cy} r={r} fill={fill} />
    </g>
  );
}

/** Treemap tile: fill, a 2px surface gap, and a label when the tile can hold one. */
function TreemapTile(props: {
  x?: number; y?: number; width?: number; height?: number;
  index?: number; name?: string; value?: number; fills?: string[];
}) {
  const { x = 0, y = 0, width = 0, height = 0, index = 0, name = '', value = 0, fills = [] } = props;
  const fill = fills[index] ?? MAGNITUDE_RAMP[0];
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
          <text x={x + 9} y={y + 20} fill="var(--color-white)" fontSize={11.5} fontWeight={600}>
            {truncate(name, Math.floor(width / 8))}
          </text>
          <text x={x + 9} y={y + 36} fill="var(--color-white)" fontSize={12} fontWeight={700} opacity={0.85}>
            {value.toLocaleString()}
          </text>
        </>
      )}
    </g>
  );
}

export function ReportChart({ kind, points, valueLabel }: {
  kind: ReportChartKind;
  points: RankedPoint[];
  valueLabel: string;
}) {
  const n = points.length;

  if (kind === 'donut') {
    const total = points.reduce((sum, p) => sum + p.value, 0);
    const sliced = points.map((p, i) => ({ ...p, fill: fillFor(p, i, n, SLICE_RAMP) }));
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
            /* Share, not raw count: the reason to draw a ring at all. */
            label={({ value }: { value?: number }) =>
              total > 0 ? `${Math.round(((value ?? 0) / total) * 100)}%` : ''}
            labelLine={false}
          >
            {sliced.map(s => <Cell key={s.label} fill={s.fill} />)}
          </Pie>
          <Tooltip {...tooltipStyle} formatter={(v: number | undefined, nm) => [v ?? 0, String(nm ?? '')]} />
          <Legend {...legendProps} />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (kind === 'treemap') {
    const fills = points.map((p, i) => fillFor(p, i, n, SLICE_RAMP));
    return (
      <ResponsiveContainer width="100%" height="100%">
        <Treemap
          data={points.map(p => ({ name: p.label, value: p.value }))}
          dataKey="value"
          stroke="var(--bg-card-solid)"
          isAnimationActive={false}
          content={<TreemapTile fills={fills} />}
        >
          <Tooltip {...tooltipStyle} formatter={(v: number | undefined) => [v ?? 0, valueLabel]} />
        </Treemap>
      </ResponsiveContainer>
    );
  }

  if (kind === 'column') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 18, right: 8, left: -8, bottom: 46 }} barCategoryGap="24%">
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ ...axisTick }}
            tickLine={false}
            axisLine={false}
            interval={0}
            angle={-28}
            textAnchor="end"
            height={54}
            tickFormatter={(v: string) => truncate(String(v), 16)}
          />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip {...tooltipStyle} cursor={{ fill: 'var(--overlay-subtle)' }} formatter={(v: number | undefined) => [v ?? 0, valueLabel]} />
          <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={54} isAnimationActive={false}>
            {points.map((p, i) => <Cell key={p.label} fill={fillFor(p, i, n, MAGNITUDE_RAMP)} />)}
            <LabelList dataKey="value" position="top" style={VALUE_LABEL} />
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
        margin={{ top: 2, right: 54, left: 2, bottom: 2 }}
        barCategoryGap={isLollipop ? '40%' : '28%'}
      >
        <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
        <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="label"
          width={186}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: string) => truncate(String(v), 26)}
        />
        <Tooltip {...tooltipStyle} cursor={{ fill: 'var(--overlay-subtle)' }} formatter={(v: number | undefined) => [v ?? 0, valueLabel]} />
        <Bar
          dataKey="value"
          radius={[0, 3, 3, 0]}
          maxBarSize={isLollipop ? 12 : 22}
          isAnimationActive={false}
          shape={isLollipop ? <LollipopShape /> : undefined}
        >
          {points.map((p, i) => <Cell key={p.label} fill={fillFor(p, i, n, MAGNITUDE_RAMP)} />)}
          {/* Direct labels: the value is the point of the chart, and reading
              eight bars off an axis is worse than eight small numbers. They
              also carry the ranking for anyone who cannot separate the three
              shades, which is why three steps is enough. */}
          <LabelList dataKey="value" position="right" style={VALUE_LABEL} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
