'use client';

/**
 * Recharts half of `FacilityManagementDashboard`, split out so recharts
 * (~80–100 KB) is fetched only when the dashboard's charts actually render
 * (KAN-66 / MED-15).
 *
 * Kept as one module rather than one file per chart: they sit in the same row
 * and are always shown together, so splitting them further would cost a second
 * round-trip for no benefit.
 *
 * Note recharts primitives cannot themselves be wrapped in `dynamic()` — the
 * library identifies children by component identity to tell an `<XAxis>` from
 * a `<Bar>`, and a dynamic wrapper changes that type, silently rendering a
 * blank chart. The dynamic boundary has to sit around a whole chart.
 */

import {
  PieChart, Pie, Cell, BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from 'recharts';
import { tooltipStyle as chartTooltipStyle, axisTick, AreaGradients } from '@/components/ChartCard';

export interface CashSlice {
  name?: string;
  value?: number;
  color: string;
}

/** Donut behind the Cash Flow card's centred total. */
export function CashFlowDonut({ data }: { data: CashSlice[] }) {
  const slices = data.length ? data : [{ name: 'None', value: 1, color: 'var(--border-light)' }];
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
      <PieChart>
        <Pie
          data={slices}
          dataKey="value"
          // Percentages, not pixels: the card sizes this donut down to sit
          // beside its figures, and fixed radii would clip the ring.
          innerRadius="70%"
          outerRadius="97%"
          paddingAngle={data.length > 1 ? 3 : 0}
          stroke="none"
        >
          {slices.map((d, i) => <Cell key={i} fill={d.color} />)}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}

export interface WeeklyPoint {
  day: string;
  /** `series` decides what is actually drawn, so a point legitimately carries
   *  only the measures its caller charts. */
  newPatients?: number;
  appointments?: number;
  /** Money billed that day, split by what has been collected. */
  received?: number;
  pending?: number;
  canceled?: number;
  /** Arrivals that day, split by where the patient went: admitted to a ward,
   *  or seen and sent home. */
  inpatient?: number;
  outpatient?: number;
}

export interface WeeklySeries {
  key: string;
  name: string;
  color: string;
  /** Tick formatter for the value axis (e.g. compact money). The first series
   *  that sets one wins — every series shares the axis. */
  axisFormat?: (value: number) => string;
  /** Tooltip formatter for this series; falls back to `axisFormat`. */
  tooltipFormat?: (value: number) => string;
}

export interface WeeklyActivityChartProps {
  data: WeeklyPoint[];
  chartType: string;
  series: WeeklySeries[];
}

/** Weekly patient activity — area / line / stacked-bar, driven by ChartCard. */
export function WeeklyActivityChart({ data, chartType, series }: WeeklyActivityChartProps) {
  // `nowrap` keeps the series on one line: the chart lives in a narrow rail,
  // where recharts' default wrapping stacks two short labels vertically.
  const legendProps = { wrapperStyle: { fontSize: 11, whiteSpace: 'nowrap' as const }, iconType: 'circle' as const };

  // Looked up per series, not per chart: each series states its own unit, so a
  // money series reads "SSP 12,400" while a plain count stays bare.
  const tooltipFormatter = (value: number | undefined, name: string | undefined): string => {
    const s = series.find(x => x.name === name);
    const fmt = s?.tooltipFormat || s?.axisFormat;
    return fmt ? fmt(value ?? 0) : String(value ?? 0);
  };

  if (chartType === 'area') {
    return (
      <ResponsiveContainer width="100%" height={208} minWidth={0}>
        <AreaChart data={data} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
          <AreaGradients />
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
          <XAxis dataKey="day" tickLine={false} axisLine={false} tick={axisTick} />
          <YAxis tickLine={false} axisLine={false} tick={axisTick} width={28} allowDecimals={false} />
          <Tooltip {...chartTooltipStyle} />
          <Legend {...legendProps} />
          {series.map(s => (
            <Area key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} fill={s.color} fillOpacity={0.12} strokeWidth={2} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === 'line') {
    return (
      <ResponsiveContainer width="100%" height={208} minWidth={0}>
        <LineChart data={data} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
          <XAxis dataKey="day" tickLine={false} axisLine={false} tick={axisTick} />
          <YAxis tickLine={false} axisLine={false} tick={axisTick} width={28} allowDecimals={false} />
          <Tooltip {...chartTooltipStyle} />
          <Legend {...legendProps} />
          {series.map(s => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={{ r: 3 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  // Default: one stacked column per day — the day's total at a glance,
  // composition by segment. Grouped bars read poorly at these narrow widths.
  const axisFormat = series.find(s => s.axisFormat)?.axisFormat;
  return (
    <ResponsiveContainer width="100%" height={208} minWidth={0}>
      <BarChart data={data} barCategoryGap="32%" margin={axisFormat ? { top: 5, right: 5, left: -2, bottom: 0 } : undefined}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tick={axisTick} />
        {/* A money axis needs both a wider tick column and compact ticks —
            "SSP 1,250,000" spelled out would eat the plot area. */}
        <YAxis tickLine={false} axisLine={false} tick={axisTick} width={axisFormat ? 40 : 28} allowDecimals={false} tickFormatter={axisFormat} />
        <Tooltip cursor={{ fill: 'var(--overlay-subtle)' }} contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={tooltipFormatter} />
        <Legend {...legendProps} />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.name}
            stackId="day"
            fill={s.color}
            maxBarSize={28}
            stroke="var(--bg-card-solid)"
            strokeWidth={1}
            radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
