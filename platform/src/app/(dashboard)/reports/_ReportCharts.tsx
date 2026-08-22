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
import { CHART_SERIES } from '@/lib/chart-colors';
import type { ReportChartPoint } from '@/lib/reports/report-chart-data';

/** Long names get an ellipsis rather than eating the plot area. */
const truncate = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

/**
 * A generated report, as bars.
 *
 * Horizontal because the categories are names — facilities, medicines,
 * diseases, tribes — and a vertical axis is the only one that can carry them
 * unrotated. One measure, so one hue: colouring the bars individually would
 * imply a category axis the data does not have, and the title already names
 * the series, so no legend is needed either.
 */
export function ReportBarChart({ points, valueLabel }: {
  points: ReportChartPoint[];
  valueLabel: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={points}
        layout="vertical"
        margin={{ top: 4, right: 44, left: 4, bottom: 4 }}
        barCategoryGap="22%"
      >
        <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
        <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="label"
          width={128}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: string) => truncate(String(v), 18)}
        />
        <Tooltip
          {...tooltipStyle}
          cursor={{ fill: 'var(--overlay-subtle)' }}
          formatter={(v: number | undefined) => [v ?? 0, valueLabel]}
        />
        <Bar dataKey="value" fill={CHART_SERIES[1]} radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
          {/* Direct labels: the value is the point of the chart, and reading it
              off an axis for eight bars is worse than eight small numbers. */}
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
 * Colour comes from `diseaseColor`, so malaria is the same hue here as on
 * /surveillance and /government. Two of those slots (measles, pneumonia) sit
 * at the palette's 7.7 ΔE deuteranopia floor, which is only legal with a
 * second encoding — hence the direct labels and the named category axis: the
 * chart never asks anyone to separate those two by hue alone.
 */
export function DiseaseBurdenChart({ points }: { points: BurdenPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={points}
        layout="vertical"
        margin={{ top: 4, right: 44, left: 4, bottom: 4 }}
        barCategoryGap="24%"
      >
        <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
        <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="label"
          width={104}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: string) => truncate(String(v), 14)}
        />
        <Tooltip {...tooltipStyle} cursor={{ fill: 'var(--overlay-subtle)' }} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false}>
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
 * place here where it would not for ranked data.
 *
 * The colours are the reserved STATUS palette, not the categorical one:
 * "critical" genuinely means critical, and this is the case that palette
 * exists for. The legend lives in the caller so it can sit beside the ring.
 */
export function StockStatusDonut({ data }: { data: StockSlice[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="label"
          innerRadius={38}
          outerRadius={62}
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
