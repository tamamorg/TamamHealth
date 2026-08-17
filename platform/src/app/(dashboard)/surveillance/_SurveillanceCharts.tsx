'use client';

/**
 * Recharts half of the Weekly Disease Trends card, split out so recharts
 * (~80-100 KB) is fetched only when this chart actually renders — same
 * dynamic-boundary pattern as FacilityManagementDashboard/_FacilityCharts.
 *
 * Note recharts primitives cannot themselves be wrapped in `dynamic()` — the
 * library identifies children by component identity to tell an `<XAxis>`
 * from a `<Bar>`, and a dynamic wrapper changes that type, silently
 * rendering a blank chart. The dynamic boundary has to sit around the whole
 * chart, so this component owns the full area/bar/line switch.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, AreaChart, Area, Legend,
} from 'recharts';
import EmptyState from '@/components/EmptyState';
import { TrendingUp } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { diseaseColor } from '@/lib/chart-colors';
import { tooltipStyle, axisTick, AreaGradients, type ChartType } from '@/components/ChartCard';

/**
 * Series colour by disease, from the shared entity map.
 *
 * This was three separate bugs: malaria, pneumonia and hiv were all the brand
 * blue — three series painted identically — while cholera wore the danger red
 * and diarrhoea the success green, so severity and identity used one palette.
 * And every colour here disagreed with /government's map for the same disease.
 */
const COLORS = {
  malaria: diseaseColor('malaria'),
  cholera: diseaseColor('cholera'),
  measles: diseaseColor('measles'),
  pneumonia: diseaseColor('pneumonia'),
  diarrhea: diseaseColor('diarrhea'),
  tb: diseaseColor('tb'),
  hiv: diseaseColor('hiv'),
};

// Recharts <Legend> restyled to spec: identity comes from the coloured dot,
// the text stays in neutral ink (series-coloured legend text is illegible for
// light hues and reads loud) — same treatment as /government's charts.
const legendProps = {
  iconType: 'circle' as const,
  iconSize: 8,
  wrapperStyle: { fontSize: 11, paddingTop: 8 },
  formatter: (value: React.ReactNode) => <span style={{ color: 'var(--text-secondary)' }}>{value}</span>,
};

export interface WeeklyDiseaseTrendsChartProps {
  data: Array<Record<string, number | string>>;
  chartType: ChartType;
}

/** Weekly disease case trend — area / bar / line, switched by `chartType`. */
export function WeeklyDiseaseTrendsChart({ data, chartType }: WeeklyDiseaseTrendsChartProps) {
  const { t } = useTranslation();

  if (data.length === 0) {
    return (
      <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <EmptyState icon={TrendingUp} title="No data yet" message="No weekly disease trends for this period." />
      </div>
    );
  }

  const diseaseLines = [
    { key: 'malaria', name: t('surveillance.diseaseMalaria'), color: COLORS.malaria },
    { key: 'cholera', name: t('surveillance.diseaseCholera'), color: COLORS.cholera },
    { key: 'measles', name: t('surveillance.diseaseMeasles'), color: COLORS.measles },
    { key: 'pneumonia', name: t('surveillance.diseasePneumonia'), color: COLORS.pneumonia },
    { key: 'diarrhea', name: t('surveillance.diseaseDiarrhea'), color: COLORS.diarrhea },
  ];
  const commonProps = { data, margin: { top: 10, right: 20, left: 0, bottom: 5 } };

  if (chartType === 'area') {
    return (
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart {...commonProps}>
          <AreaGradients />
          <CartesianGrid stroke="var(--border-light)" vertical={false} />
          <XAxis dataKey="week" tick={axisTick} axisLine={false} tickLine={false} />
          <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip {...tooltipStyle} />
          <Legend {...legendProps} />
          {diseaseLines.map(d => <Area key={d.key} type="natural" dataKey={d.key} name={d.name} stroke={d.color} fill={d.color} fillOpacity={0.12} strokeWidth={2} />)}
        </AreaChart>
      </ResponsiveContainer>
    );
  }
  if (chartType === 'bar') {
    return (
      <ResponsiveContainer width="100%" height={300}>
        <BarChart {...commonProps}>
          <CartesianGrid stroke="var(--border-light)" vertical={false} />
          <XAxis dataKey="week" tick={axisTick} axisLine={false} tickLine={false} />
          <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip {...tooltipStyle} cursor={{ fill: 'var(--overlay-subtle)' }} />
          <Legend {...legendProps} />
          {diseaseLines.map(d => <Bar key={d.key} dataKey={d.key} name={d.name} fill={d.color} radius={[2, 2, 0, 0]} />)}
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart {...commonProps}>
        <CartesianGrid stroke="var(--border-light)" vertical={false} />
        <XAxis dataKey="week" tick={axisTick} axisLine={false} tickLine={false} />
        <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip {...tooltipStyle} />
        <Legend {...legendProps} />
        {diseaseLines.map(d => <Line key={d.key} type="natural" dataKey={d.key} name={d.name} stroke={d.color} strokeWidth={d.key === 'malaria' ? 2.5 : 2} dot={{ r: 3, fill: d.color }} activeDot={{ r: 5 }} />)}
      </LineChart>
    </ResponsiveContainer>
  );
}
