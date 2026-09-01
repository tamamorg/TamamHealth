'use client';

import { PieChart } from '@/components/icons/lucide';

/**
 * "Arrivals by stage" — the rail donut from the Reception / Clinical App
 * design: a 92px ring with an 18px hole, the day's total in its middle, and a
 * legend of stages beside it.
 *
 * A conic-gradient rather than a chart library: three to five slices of one
 * total is a proportion, not a plot, and the rail already carries a real chart
 * above it. This adds no bundle and no axes.
 *
 * The segments are the queue's own tab counts, so the ring and the tabs can
 * never disagree — it is the same number rendered twice.
 */

export type StageSegment = {
  name: string;
  value: number;
  /** Slice colour. Defaults walk the design's own three-tone order. */
  color?: string;
};

/* The design's slice order: accent, amber, green — waiting, in office, done. */
const DEFAULT_COLORS = ['var(--chart-1)', 'var(--chart-5)', 'var(--color-success)', 'var(--chart-2)', 'var(--chart-6)'];

export default function EhrStageDonut({
  segments,
  title = 'Arrivals by stage',
  centerLabel = 'in queue',
}: {
  segments: StageSegment[];
  title?: string;
  centerLabel?: string;
}) {
  const slices = segments.filter(s => s.value > 0);
  const total = slices.reduce((sum, s) => sum + s.value, 0);

  // Build the ring in one pass: each slice ends where the next begins, so the
  // gradient carries no seams and no rounding drift across the last stop.
  let cursor = 0;
  const stops = slices.map((seg, i) => {
    const start = (cursor / total) * 360;
    cursor += seg.value;
    const end = (cursor / total) * 360;
    const color = seg.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
    return `${color} ${start}deg ${end}deg`;
  });
  // An empty day still draws the ring — as one quiet band, so the card keeps
  // its shape instead of collapsing to a legend with nothing above it.
  const gradient = total > 0
    ? `conic-gradient(${stops.join(', ')})`
    : 'conic-gradient(var(--ehr-border, #E2E6EB) 0deg 360deg)';

  return (
    <div className="ehr-side-card ehr-stage-donut">
      <div className="ehr-side-card-head">
        <PieChart className="w-5 h-5" />
        <h2>{title}</h2>
      </div>
      <div className="ehr-stage-donut-body">
        <div className="ehr-stage-donut-ring" style={{ background: gradient }} role="img" aria-label={`${total} ${centerLabel}`}>
          <div className="ehr-stage-donut-hole">
            <b>{total}</b>
            <span>{centerLabel}</span>
          </div>
        </div>
        <ul className="ehr-stage-donut-legend">
          {segments.map((seg, i) => (
            <li key={seg.name}>
              <span>
                <i style={{ background: seg.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length] }} />
                {seg.name}
              </span>
              <b>{seg.value}</b>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
