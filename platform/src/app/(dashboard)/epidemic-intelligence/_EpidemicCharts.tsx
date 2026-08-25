'use client';

/**
 * Recharts half of the epidemic curve card, split out so recharts
 * (~80-100 KB) is fetched only when this chart actually renders — same
 * dynamic-boundary pattern as FacilityManagementDashboard/_FacilityCharts.
 *
 * Note recharts primitives cannot themselves be wrapped in `dynamic()` — the
 * library identifies children by component identity to tell an `<XAxis>`
 * from a `<Bar>`, and a dynamic wrapper changes that type, silently
 * rendering a blank chart. The dynamic boundary has to sit around the whole
 * chart.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
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

export interface EpidemicCurveChartProps {
  data: Array<Record<string, number | string>>;
  diseases: string[];
  colorMap: Map<string, string>;
}

/** Epidemic curve — weekly case counts, one bar series per shown disease. */
export function EpidemicCurveChart({ data, diseases, colorMap }: EpidemicCurveChartProps) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid stroke="var(--border-light)" vertical={false} />
        <XAxis dataKey="week" tick={axisTick} tickLine={false} axisLine={false} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip {...tooltipStyle} cursor={{ fill: 'var(--overlay-subtle)' }} />
        <Legend {...legendProps} />
        {diseases.map(d => (
          <Bar key={d} dataKey={d} name={d} fill={colorMap.get(d)} radius={[2, 2, 0, 0]} maxBarSize={16} isAnimationActive animationDuration={420} animationEasing="ease-out" />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
