'use client';

/**
 * Recharts half of the Reports page, split out so recharts (~80-100 KB) is
 * fetched only when a chart actually renders — the same dynamic boundary
 * FacilityManagementDashboard/_FacilityCharts and _GovernmentCharts use.
 *
 * Recharts primitives cannot themselves be wrapped in `dynamic()`: the library
 * identifies children by component identity to tell an `<XAxis>` from a
 * `<Bar>`, and a dynamic wrapper changes that type, silently rendering a blank
 * chart. The boundary has to sit around a whole chart, so each export here
 * owns one complete chart.
 */

import {
  BarChart, Bar, Cell, LabelList, PieChart, Pie,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { tooltipStyle, axisTick } from '@/components/ChartCard';
import type { ReportChartPoint } from '@/lib/reports/report-chart-data';

/**
 * Magnitude ramp: one hue, dark for large, light for small.
 *
 * Drawn from the sequential scale in globals.css (`--chart-seq-*`), but only
 * three of its five steps work as a bar fill on the card surface:
 *
 *   seq-1  L 0.940, contrast  1.14  — invisible on white, fails the 3:1 floor
 *   seq-2  L 0.652                  — 0.025 from seq-3, the same shade to the eye
 *   seq-3  L 0.627, contrast  3.39  OK
 *   seq-4  L 0.447, contrast  7.36  OK
 *   seq-5  L 0.233, contrast 16.40  OK
 *
 * Three evenly-spaced steps (ΔL ≈ 0.19) are ample: the bar's LENGTH already
 * carries the magnitude, so the shade only reinforces a ranking the reader can
 * measure anyway. Never a categorical scale here — these bars are ONE measure,
 * and separate hues would imply categories the data does not have.
 */
const MAGNITUDE_RAMP = [
  'var(--chart-seq-5)',
  'var(--chart-seq-4)',
  'var(--chart-seq-3)',
] as const;

/** Grey, reserved for the folded tail — "Other" is not a rank. */
const OTHER_FILL = 'var(--text-muted)';

/** Shade for the bar at `index` of `total`, darkest first. */
export function rankShade(index: number, total: number): string {
  if (total <= 1) return MAGNITUDE_RAMP[0];
  const step = Math.round((index / (total - 1)) * (MAGNITUDE_RAMP.length - 1));
  return MAGNITUDE_RAMP[Math.min(step, MAGNITUDE_RAMP.length - 1)];
}

/** Long names get an ellipsis rather than eating the plot area. */
const truncate = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

/**
 * Ranked magnitudes as bars — the shape every generated report and every
 * "by facility / by state" statistic reduces to.
 *
 * Horizontal because the categories are names (facilities, medicines,
 * diseases, tribes) and a vertical axis is the only one that carries them
 * unrotated. The title names the measure, so no legend box is needed.
 */
export function RankedBarChart({ points, valueLabel, labelWidth = 150 }: {
  points: ReportChartPoint[];
  valueLabel: string;
  labelWidth?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={points}
        layout="vertical"
        margin={{ top: 2, right: 46, left: 2, bottom: 2 }}
        barCategoryGap="26%"
      >
        <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
        <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="label"
          width={labelWidth}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: string) => truncate(String(v), Math.floor(labelWidth / 7))}
        />
        <Tooltip
          {...tooltipStyle}
          cursor={{ fill: 'var(--overlay-subtle)' }}
          formatter={(v: number | undefined) => [v ?? 0, valueLabel]}
        />
        <Bar dataKey="value" radius={[0, 3, 3, 0]} maxBarSize={16} isAnimationActive={false}>
          {points.map((p, i) => (
            <Cell key={p.label} fill={p.label === 'Other' ? OTHER_FILL : rankShade(i, points.length)} />
          ))}
          {/* Direct labels: the value is the point of the chart, and reading
              eight bars off an axis is worse than eight small numbers. They
              also carry the ranking for anyone who cannot separate the three
              shades, which is why three steps is enough. */}
          <LabelList
            dataKey="value"
            position="right"
            style={{ fill: 'var(--text-secondary)', fontSize: 11, fontWeight: 600 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface BurdenPoint extends ReportChartPoint { color: string }

/**
 * Disease burden — the headline the five surveillance reports all draw on.
 *
 * The one chart here NOT shaded by rank: colour comes from `diseaseColor`, so
 * malaria is the same hue here as on /surveillance and /government. Two of
 * those slots (measles, pneumonia) sit at the categorical palette's 7.7 ΔE
 * deuteranopia floor, which is legal only with a second encoding — hence the
 * direct labels and the named category axis.
 */
export function DiseaseBurdenChart({ points }: { points: BurdenPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={points}
        layout="vertical"
        margin={{ top: 2, right: 46, left: 2, bottom: 2 }}
        barCategoryGap="26%"
      >
        <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
        <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="label"
          width={150}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: string) => truncate(String(v), 20)}
        />
        <Tooltip {...tooltipStyle} cursor={{ fill: 'var(--overlay-subtle)' }} />
        <Bar dataKey="value" radius={[0, 3, 3, 0]} maxBarSize={16} isAnimationActive={false}>
          {points.map(p => <Cell key={p.label} fill={p.color} />)}
          <LabelList
            dataKey="value"
            position="right"
            style={{ fill: 'var(--text-secondary)', fontSize: 11, fontWeight: 600 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface StockSlice { key: string; label: string; value: number; color: string }

/**
 * Stock status mix — a part-to-whole of one inventory, so a donut earns its
 * place where it would not for ranked data.
 *
 * Reserved STATUS colours, not a magnitude ramp: "critical" genuinely means
 * critical, and this is the case that palette exists for. The legend lives in
 * the caller so it can sit beside the ring.
 */
export function StockStatusDonut({ data }: { data: StockSlice[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="label"
          innerRadius={46}
          outerRadius={74}
          paddingAngle={2}
          stroke="var(--bg-card-solid)"
          strokeWidth={2}
          isAnimationActive={false}
        >
          {data.map(s => <Cell key={s.key} fill={s.color} />)}
        </Pie>
        <Tooltip {...tooltipStyle} formatter={(v: number | undefined, n) => [v ?? 0, String(n ?? '')]} />
      </PieChart>
    </ResponsiveContainer>
  );
}
