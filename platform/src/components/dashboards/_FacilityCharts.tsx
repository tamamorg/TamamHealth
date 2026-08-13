'use client';

/**
 * Recharts half of `FacilityManagementDashboard`, split out so recharts
 * (~80–100 KB) is fetched only when the dashboard's charts actually render
 * (KAN-66 / MED-15).
 *
 * Kept as one module with two exports rather than two files: both charts sit
 * in the same row and are always shown together, so splitting them further
 * would cost a second round-trip for no benefit.
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
    <ResponsiveContainer width="100%" height="100%">
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
  appointments: number;
  newPatients: number;
  /** Only present when a caller charts cancellations — `series` decides what
   *  is actually drawn, so a point may legitimately omit it. */
  canceled?: number;
}

export interface WeeklyActivityChartProps {
  data: WeeklyPoint[];
  chartType: string;
  series: Array<{ key: string; name: string; color: string }>;
}

/** Weekly patient activity — area / line / stacked-bar, driven by ChartCard. */
export function WeeklyActivityChart({ data, chartType, series }: WeeklyActivityChartProps) {
  // `nowrap` keeps the series on one line: the chart lives in a narrow rail,
  // where recharts' default wrapping stacks two short labels vertically.
  const legendProps = { wrapperStyle: { fontSize: 11, whiteSpace: 'nowrap' as const }, iconType: 'circle' as const };

  if (chartType === 'area') {
    return (
      <ResponsiveContainer width="100%" height={208}>
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
      <ResponsiveContainer width="100%" height={208}>
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

  // Default: one stacked column per day — total activity at a glance,
  // composition by segment. Grouped bars read poorly at these single-digit counts.
  return (
    <ResponsiveContainer width="100%" height={208}>
      <BarChart data={data} barCategoryGap="32%">
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tick={axisTick} />
        <YAxis tickLine={false} axisLine={false} tick={axisTick} width={28} allowDecimals={false} />
        <Tooltip cursor={{ fill: 'var(--overlay-subtle)' }} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
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
