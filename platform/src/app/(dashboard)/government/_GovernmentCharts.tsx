'use client';

/**
 * Recharts half of the National Dashboard, split out so recharts
 * (~80-100 KB) is fetched only when a chart actually renders — same
 * dynamic-boundary pattern as FacilityManagementDashboard/_FacilityCharts.
 *
 * Note recharts primitives cannot themselves be wrapped in `dynamic()` — the
 * library identifies children by component identity to tell an `<XAxis>`
 * from a `<Bar>`, and a dynamic wrapper changes that type, silently
 * rendering a blank chart. The dynamic boundary has to sit around a whole
 * chart, so each export here owns one complete chart.
 */

import {
  BarChart, Bar, Cell, PieChart, Pie,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { tooltipStyle, axisTick } from '@/components/ChartCard';

// Recharts <Legend> restyled to spec: identity comes from the colored dot,
// the text stays in neutral ink (series-colored legend text is illegible for
// light hues and reads loud).
const legendProps = {
  iconType: 'circle' as const,
  iconSize: 8,
  wrapperStyle: { fontSize: 11, paddingTop: 4 },
  formatter: (value: React.ReactNode) => <span style={{ color: 'var(--text-secondary)' }}>{value}</span>,
};

export interface FacilityMixEntry {
  key: string;
  value: number;
  label: string;
  color: string;
}

/** Facility-type mix donut — the design's 104px ring, hole filled by the caller. */
export function FacilityTypeDonut({ data }: { data: FacilityMixEntry[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="label" innerRadius={32} outerRadius={52} paddingAngle={0} stroke="none" isAnimationActive={false}>
          {data.map(f => <Cell key={f.key} fill={f.color} />)}
        </Pie>
        <Tooltip {...tooltipStyle} formatter={(v: number | undefined, n) => [v ?? 0, String(n ?? '')]} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export type WeeklyByDiseaseRow = Record<string, number> & { week: string; sortKey: string };

export interface WeeklyCasesChartProps {
  data: WeeklyByDiseaseRow[];
  diseases: string[];
  colorMap: Map<string, string>;
}

/** Weekly reported cases — paired bars, one series per shown disease. */
export function WeeklyCasesChart({ data, diseases, colorMap }: WeeklyCasesChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={0}>
      <BarChart data={data} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid stroke="var(--chart-grid, #ECEEF1)" vertical={false} />
        <XAxis dataKey="week" tick={axisTick} tickLine={false} axisLine={false} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip {...tooltipStyle} cursor={{ fill: 'var(--overlay-subtle)' }} />
        <Legend {...legendProps} />
        {diseases.map(d => (
          <Bar key={d} dataKey={d} name={d} fill={colorMap.get(d)} radius={[2, 2, 0, 0]} maxBarSize={9} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
