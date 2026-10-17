/**
 * The chart's "latest vitals" — one deterministic answer for the sticky band,
 * the facesheet's "Latest observations" and the printed record.
 *
 * Why this exists: the readings come from two independent hooks (medical
 * records incl. nursing stubs, and triage). Each resolves on its own schedule,
 * and the page drew whatever had arrived, so the same patient showed the Oct 14
 * triage reading or the older Aug 19 consult depending on which finished
 * first. Two rules fix it:
 *   1. Never present a result until every source has resolved (`ready`).
 *   2. Order by the real instant (Date.parse), not by string compare — the
 *      sources mix date-only ("2026-10-14"), offset and Z timestamps, which
 *      localeCompare orders wrongly.
 */

import type { MedicalRecordDoc, TriageDoc } from '@/lib/db-types';
import { mergeVitalsTimeline, type VitalsTimelineEntry } from '@/lib/clinical/vitals';

function instant(at: string | undefined): number {
  const t = at ? Date.parse(at) : NaN;
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/** Newest-first by measurement instant. Ties keep source order (records ahead
 *  of triage), as mergeVitalsTimeline defines. Does not mutate its input. */
export function sortVitalsNewestFirst(entries: VitalsTimelineEntry[]): VitalsTimelineEntry[] {
  return entries
    .map((entry, index) => ({ entry, index, t: instant(entry.at) }))
    .sort((a, b) => (b.t === a.t ? a.index - b.index : b.t > a.t ? 1 : -1))
    .map(x => x.entry);
}

export interface ChartVitalsSources {
  records: MedicalRecordDoc[];
  triages: TriageDoc[];
  /** True once the medical-records source has finished loading. */
  recordsReady: boolean;
  /** True once the triage source has finished loading. */
  triageReady: boolean;
}

export interface ChartLatestVitals {
  /** False until every source resolved. While false, show a loading state. */
  ready: boolean;
  timeline: VitalsTimelineEntry[];
  latest: VitalsTimelineEntry | undefined;
}

export function buildChartLatestVitals(src: ChartVitalsSources): ChartLatestVitals {
  const ready = src.recordsReady && src.triageReady;
  if (!ready) return { ready, timeline: [], latest: undefined };
  const timeline = sortVitalsNewestFirst(mergeVitalsTimeline(src.records, src.triages));
  return { ready, timeline, latest: timeline[0] };
}
