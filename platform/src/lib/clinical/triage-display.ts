/**
 * The one description of ETAT triage acuity (RED / YELLOW / GREEN): what each
 * level is called, what colour it is, and how it sorts.
 *
 * Everything that shows how urgent a row is reads from here — triage, the
 * clinician queue, the nurse station, the front desk, appointment worklists.
 * The same three lines used to be re-derived inline in a dozen files, and they
 * disagreed: one station called RED "Critical" while the rest said
 * "Emergency", routine appointments were labelled "Appointment", and RED text
 * was #E03127 in TSX but --color-danger in CSS — two reds for one acuity.
 *
 * Colours are the --acuity-* tokens from globals.css — the same ones the CSS
 * cue under a status pill reads — so a word painted inline here and the
 * identical word painted by a stylesheet cannot come out different shades.
 */

import type { AppointmentDoc, TriagePriority } from '@/lib/db-types';

export type { TriagePriority };
export type TriagePriorityLike = TriagePriority | 'normal' | string | undefined | null;

interface AcuityMeta {
  /** The word every worklist shows for this level. */
  label: string;
  /** Translation key for the same word, where a screen renders through i18n. */
  i18nKey: string;
  /** Text colour for that word. */
  color: string;
  /** Tint behind it, where the word is shown as a badge. */
  bg: string;
  /** Pill tone keyword used by the queue pills. */
  tone: string;
  /** Sort weight — most urgent first. */
  order: number;
}

const ACUITY: Record<TriagePriority, AcuityMeta> = {
  RED: {
    label: 'Emergency',
    i18nKey: 'appointments.priorityEmergency',
    color: 'var(--acuity-red)',
    bg: 'var(--acuity-red-bg)',
    tone: 'red',
    order: 0,
  },
  YELLOW: {
    label: 'Urgent',
    i18nKey: 'appointments.priorityUrgent',
    color: 'var(--acuity-yellow)',
    bg: 'var(--acuity-yellow-bg)',
    tone: 'yellow',
    order: 1,
  },
  GREEN: {
    label: 'Routine',
    i18nKey: 'appointments.priorityRoutine',
    color: 'var(--acuity-green)',
    bg: 'var(--acuity-green-bg)',
    tone: 'green',
    order: 2,
  },
};

export function isTriagePriority(priority: TriagePriorityLike): priority is TriagePriority {
  return priority === 'RED' || priority === 'YELLOW' || priority === 'GREEN';
}

/**
 * Label + tone per acuity, keyed by code.
 *
 * Kept under this name because the worklists already read `PRIORITY_META[code]`
 * — it is now a view of the table above rather than its own copy.
 */
export const PRIORITY_META: Record<TriagePriority, { label: string; tone: string }> = ACUITY;

/** The word shown for a triage acuity; empty for rows that carry none. */
export function priorityLabel(priority: TriagePriorityLike): string {
  return isTriagePriority(priority) ? ACUITY[priority].label : '';
}

/**
 * Translation key for a triage acuity, for screens that render through i18n.
 * Anything without an acuity reads as routine, which is what the hand-rolled
 * ternaries this replaced did.
 */
export function priorityLabelKey(priority: TriagePriorityLike): string {
  return ACUITY[isTriagePriority(priority) ? priority : 'GREEN'].i18nKey;
}

/** Colour token for a triage acuity; anything else falls back to the accent. */
export function priorityColor(priority: TriagePriorityLike): string {
  return isTriagePriority(priority) ? ACUITY[priority].color : 'var(--accent-primary)';
}

/** Badge colours for a triage acuity — text plus its tint, always as a pair. */
export function priorityBadge(priority: TriagePriorityLike): { color: string; bg: string } {
  const meta = ACUITY[isTriagePriority(priority) ? priority : 'GREEN'];
  return { color: meta.color, bg: meta.bg };
}

/** Sort weight for a triage acuity (RED first … then unknown last). */
export function priorityOrder(priority: TriagePriorityLike): number {
  return isTriagePriority(priority) ? ACUITY[priority].order : 3;
}

/**
 * The acuity an order or booking's priority maps onto. Routine is an acuity,
 * not the absence of one — a row that says "Routine" must be tinted like every
 * other GREEN row rather than dropping to the neutral grey used for rows with
 * no acuity at all.
 *
 * Takes a loose string because the urgency vocabularies differ by module —
 * appointments say `emergency`, imaging and lab orders say `stat` — and both
 * mean the same thing to a worklist. Reading them through one function is what
 * stops a STAT study from being drawn as routine.
 */
export function appointmentTriage(priority: AppointmentDoc['priority'] | string | undefined): TriagePriority {
  if (priority === 'emergency' || priority === 'stat') return 'RED';
  if (priority === 'urgent') return 'YELLOW';
  return 'GREEN';
}

/** The word a worklist row shows under its status pill for such a row. */
export function appointmentPriorityLabel(priority: AppointmentDoc['priority'] | string | undefined): string {
  return ACUITY[appointmentTriage(priority)].label;
}
