/**
 * South Sudan routine childhood immunisation (EPI) schedule.
 *
 * ⚠️ CLINICAL DATA — CONFIRM AGAINST THE MoH / WHO-UNICEF EPI SCHEDULE BEFORE
 * RELYING ON IT FOR RECALL. These are the standard WHO-aligned timings; this is
 * the ONE place they live, so a correction is a single edit. Drives the
 * defaulter tracker: completing a dose schedules the next dose in the same
 * antigen series at its age-based due date, and getDefaulters surfaces it once
 * overdue (security/data audit 2026-11-05, §2.1 #13).
 *
 * Only within-series progression is modelled (Penta1 → Penta2 → Penta3): that
 * is what the per-child defaulter list is for — a child who started a series
 * and missed a later dose. Whether a child ever STARTED a series is a
 * birth-cohort coverage question, handled by the coverage analytics, not here.
 *
 * `vaccine` + `doseNumber` match the values the register writes (db-seed.ts /
 * the immunizations page): BCG, OPV, Penta, PCV, Rota, Measles, Yellow Fever,
 * Vitamin A. Single-dose antigens (BCG, Yellow Fever) and supplements
 * (Vitamin A) have no follow-up dose and are intentionally absent.
 */

export interface EpiDose {
  dose: number;
  /** Age at which the dose is due, from date of birth. Exactly one of these. */
  weeks?: number;
  months?: number;
}

/** Antigen series, each ordered by dose. */
export const EPI_SCHEDULE: Readonly<Record<string, readonly EpiDose[]>> = {
  OPV: [{ dose: 0, weeks: 0 }, { dose: 1, weeks: 6 }, { dose: 2, weeks: 10 }, { dose: 3, weeks: 14 }],
  Penta: [{ dose: 1, weeks: 6 }, { dose: 2, weeks: 10 }, { dose: 3, weeks: 14 }],
  PCV: [{ dose: 1, weeks: 6 }, { dose: 2, weeks: 10 }, { dose: 3, weeks: 14 }],
  Rota: [{ dose: 1, weeks: 6 }, { dose: 2, weeks: 10 }],
  Measles: [{ dose: 1, months: 9 }, { dose: 2, months: 18 }],
};

/**
 * The next dose due in the same antigen series after a completed one, or null
 * when the dose is the last (or the antigen has no scheduled follow-up).
 */
export function nextScheduledDose(vaccine: string, doseNumber: number): EpiDose | null {
  const series = EPI_SCHEDULE[vaccine];
  if (!series) return null;
  const idx = series.findIndex(d => d.dose === doseNumber);
  if (idx === -1 || idx + 1 >= series.length) return null;
  return series[idx + 1];
}

/** Due date (ISO yyyy-mm-dd) for a dose, computed from the child's birth date. */
export function dueDateFromBirth(dateOfBirth: string, dose: EpiDose): string {
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return '';
  // Compute in UTC throughout: `new Date('yyyy-mm-dd')` is parsed as UTC
  // midnight, so local setDate/setMonth would drift the result by a day in any
  // non-UTC timezone. toISOString() is UTC, so the arithmetic must be too.
  const due = new Date(dob);
  if (dose.months != null) due.setUTCMonth(due.getUTCMonth() + dose.months);
  else due.setUTCDate(due.getUTCDate() + (dose.weeks ?? 0) * 7);
  return due.toISOString().slice(0, 10);
}
