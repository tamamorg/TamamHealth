/**
 * The triage form's "Medication list review": what changed on the patient's
 * medication list while triage was open, and the confirmation saved with the
 * triage (`TriageDoc.medicationReview`).
 *
 * The list is `history_entry` documents with domain 'medication' — what the
 * patient already takes, recorded by nurses or clinicians. Nothing here places
 * an order or reaches the pharmacy; prescribing stays with prescribers.
 */
import type { TriageMedicationReview } from '../db-types';

export type MedicationChangeKind = 'added' | 'edited' | 'stopped' | 'removed';

export type MedicationReviewChanges = Record<MedicationChangeKind, string[]>;

export const NO_MEDICATION_CHANGES: MedicationReviewChanges = Object.freeze({
  added: [], edited: [], stopped: [], removed: [],
}) as MedicationReviewChanges;

/** Note one change, by medicine name, once per kind. */
export function recordMedicationChange(
  changes: MedicationReviewChanges,
  kind: MedicationChangeKind,
  name: string,
): MedicationReviewChanges {
  const title = name.trim();
  if (!title || changes[kind].includes(title)) return changes;
  // An edit to a medicine added in this same triage is still "added".
  if (kind === 'edited' && changes.added.includes(title)) return changes;
  return { ...changes, [kind]: [...changes[kind], title] };
}

/** Two sets of changes as one, e.g. a saved review carried into a correction. */
export function mergeMedicationChanges(
  a: Partial<MedicationReviewChanges> | undefined,
  b: MedicationReviewChanges,
): MedicationReviewChanges {
  let out: MedicationReviewChanges = {
    added: [...(a?.added || [])],
    edited: [...(a?.edited || [])],
    stopped: [...(a?.stopped || [])],
    removed: [...(a?.removed || [])],
  };
  for (const kind of ['added', 'edited', 'stopped', 'removed'] as const) {
    for (const name of b[kind]) out = recordMedicationChange(out, kind, name);
  }
  return out;
}

/** True when the triage may not be saved: the patient is known and the list was not reviewed. */
export function medicationReviewBlocksSave(input: { patientKnown: boolean; reviewed: boolean }): boolean {
  return input.patientKnown && !input.reviewed;
}

export function buildMedicationReview(input: {
  reviewedAt: string;
  reviewedBy: string;
  reviewedByName: string;
  activeCount: number;
  changes: MedicationReviewChanges;
}): TriageMedicationReview {
  return {
    reviewedAt: input.reviewedAt,
    reviewedBy: input.reviewedBy,
    reviewedByName: input.reviewedByName,
    activeCount: input.activeCount,
    added: [...input.changes.added],
    edited: [...input.changes.edited],
    stopped: [...input.changes.stopped],
    removed: [...input.changes.removed],
  };
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * One line for the chart and the note: "Reviewed by Nurse Ayen. 3 on the list.
 * Added: Metformin. Stopped: Amoxicillin." Changes are named, not counted, so
 * the clinician reads what moved. English unless a translator is passed: the
 * note's opening text is English, the chart's facesheet is not.
 */
export function formatMedicationReview(review: TriageMedicationReview, t?: Translate): string {
  const by = review.reviewedByName || 'nurse';
  const named: Array<[MedicationChangeKind, string, string[] | undefined]> = [
    ['added', 'Added', review.added],
    ['edited', 'Edited', review.edited],
    ['stopped', 'Stopped', review.stopped],
    ['removed', 'Removed as entered in error', review.removed],
  ];
  const changes = named.filter(([, , names]) => names && names.length > 0);
  if (t) {
    return [
      t('triageMeds.summaryReviewed', { by, count: review.activeCount }),
      ...(changes.length === 0
        ? [t('triageMeds.summaryNoChanges')]
        : changes.map(([kind, , names]) => t(`triageMeds.summary_${kind}`, { names: names!.join(', ') }))),
    ].join(' ');
  }
  const parts = [`Reviewed by ${by}`, `${review.activeCount} on the list`];
  if (changes.length === 0) parts.push('No changes');
  for (const [, label, names] of changes) parts.push(`${label}: ${names!.join(', ')}`);
  return `${parts.join('. ')}.`;
}
