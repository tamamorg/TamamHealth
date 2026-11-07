/**
 * Small pure helpers and constants for the Encounter Note screen, moved
 * verbatim out of ClinicalNoteEditor.tsx. `nameInitials` deliberately differs
 * from `lib/patient-utils` `initials` (which strips title tokens such as
 * "Dr."), and there is no `dobWithAge` in patient-utils, so these stay local.
 */

export const NOTE_NAV_KEY = 'tm.noteNavCollapsed';

export const AUTOSAVE_MS = 900;
/** A chart read that has not answered by now is reported as failed, not left "loading". */
export const CHART_LOAD_TIMEOUT_MS = 20000;

export type ChartStatus = 'loading' | 'error' | 'ready';

export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    work.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}

/** "01 Jan 1973 (52 yo)" from an ISO date of birth. */
export function dobWithAge(dob?: string): string | null {
  if (!dob) return null;
  const d = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dob;
  const text = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 ? `${text} (${age} yo)` : text;
}

export function nameInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

/** "id_document" → "Id Document" — display label for a document category. */
export function docCategoryLabel(category: string): string {
  return String(category).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
