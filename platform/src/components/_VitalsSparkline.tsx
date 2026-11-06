'use client';

/**
 * Recharts half of `VitalsTrends`, split out so recharts (~80–100 KB) is
 * fetched only when a vitals chart actually renders (KAN-66 / MED-15).
 *
 * Why a separate file rather than `dynamic()` around the recharts primitives
 * themselves: recharts inspects its children by component identity to tell an
 * `<XAxis>` from a `<Line>`. Wrapping those primitives in `dynamic()` changes
 * their type and the chart silently renders blank. Isolating the whole chart
 * behind one dynamic boundary keeps recharts' internals intact.
 *
 * The parent renders the numbers, arrow and status chip without this file, so
 * a patient chart is readable before the chart chunk lands.
 */

import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceArea,
} from 'recharts';

export interface VitalsSparklinePoint {
  date: string;
  label: string;
  value: number;
  secondary?: number;
}

export interface VitalsSparklineProps {
  points: VitalsSparklinePoint[];
  color: string;
  statusColor: string;
  unit: string;
  title: string;
  /** Shaded band for the metric's normal range, when it has one. */
  normalRange?: [number, number];
  /** Blood pressure carries a second (diastolic) series. */
  showSecondary?: boolean;
}

export default function VitalsSparkline({
  points,
  color,
  statusColor,
  unit,
  title,
  normalRange,
  showSecondary,
}: VitalsSparklineProps) {
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
      <LineChart data={points} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
        <XAxis
          dataKey="label"
          tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={['auto', 'auto']}
          tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
          axisLine={false}
          tickLine={false}
          width={28}
        />
        <Tooltip
          contentStyle={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-light)',
            borderRadius: 0,
            fontSize: 11,
            padding: '6px 8px',
          }}
          labelStyle={{ color: 'var(--text-muted)' }}
          formatter={(v, name) => [`${v ?? '—'} ${unit}`, name === 'value' ? title : String(name ?? '')]}
        />
        {normalRange && (
          <ReferenceArea
            y1={normalRange[0]}
            y2={normalRange[1]}
            fill={statusColor}
            fillOpacity={0.06}
            stroke="none"
          />
        )}
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          dot={points.length > 1 ? { r: 2.5, fill: color } : false}
          activeDot={points.length > 1 ? { r: 4 } : false}
          isAnimationActive={false}
        />
        {showSecondary && (
          <Line
            type="monotone"
            dataKey="secondary"
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray="3 3"
            dot={points.length > 1 ? { r: 2, fill: color } : false}
            isAnimationActive={false}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}
