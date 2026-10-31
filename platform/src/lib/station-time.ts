/** Short durations for station worklists (lab, pharmacy). */

/** How long ago, in the unit that reads at a glance: 12 min, 3 h, 2 d. */
export function agoLabel(iso: string | undefined, now: Date): string {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return '';
  return `${durationLabel(Math.max(0, Math.round((now.getTime() - at) / 60000)))} ago`;
}

export function durationLabel(totalMinutes: number): string {
  if (totalMinutes >= 48 * 60) return `${Math.floor(totalMinutes / 1440)} d`;
  if (totalMinutes >= 60) return `${Math.floor(totalMinutes / 60)} h ${totalMinutes % 60} min`;
  return `${totalMinutes} min`;
}

/** A row's date as a person reads it ("Oct 24"), never an ISO day. */
export function shortDayLabel(iso?: string): string {
  if (!iso) return '';
  const when = new Date(iso);
  return Number.isNaN(when.getTime()) ? '' : when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
