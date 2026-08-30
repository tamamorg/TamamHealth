// Pure triage-station queue logic — split out of TriageWorkflow.tsx so the
// "queue, not a log" rules (KAN-triage-ux) are unit-testable without mounting
// the 1400-line form component.

import type { TriageDoc } from '@/lib/db-types';
import { priorityOrder } from '@/lib/clinical/triage-display';

/**
 * Once a triage reaches one of these, the patient is no longer someone the
 * station needs to keep an eye on — they were admitted, sent home, referred
 * onward, or left without being seen. The default station view is "who do I
 * still need to deal with", not a chronological log of everyone ever triaged.
 */
export const TERMINAL_TRIAGE_STATUSES: ReadonlySet<TriageDoc['status']> = new Set([
  'admitted', 'discharged', 'referred', 'lwbs',
]);

export function isTerminalTriageStatus(status: TriageDoc['status']): boolean {
  return TERMINAL_TRIAGE_STATUSES.has(status);
}

/**
 * A RED triage the department still owes attention to: not yet assessed
 * (`pending`), or assessed but not yet handed into an active consultation
 * (`seen` and not `in_consultation`). The station header used to count only
 * `status === 'pending'`, so the counter dropped to zero the instant a nurse
 * marked a RED patient 'seen' even though that patient was often still
 * sitting in the waiting area with no doctor free yet.
 */
export function isActiveRedTriage(
  t: Pick<TriageDoc, 'priority' | 'status' | 'handoffStatus'>,
): boolean {
  if (t.priority !== 'RED') return false;
  if (t.status === 'pending') return true;
  return t.status === 'seen' && t.handoffStatus !== 'in_consultation';
}

export function countActiveRedTriage(
  triages: readonly Pick<TriageDoc, 'priority' | 'status' | 'handoffStatus'>[],
): number {
  return triages.filter(isActiveRedTriage).length;
}

/**
 * The rows a station queue shows by default: everyone still active, plus
 * (opt-in) anyone who reached a terminal status today — a nurse checking what
 * wrapped up this shift, without the list defaulting to a lifetime log.
 */
export function selectTriageQueueRows<T extends { status: TriageDoc['status']; triagedAt: string }>(
  rows: readonly T[],
  options: { includeCompletedToday: boolean; todayIso: string },
): T[] {
  return rows.filter(row => {
    if (!isTerminalTriageStatus(row.status)) return true;
    return options.includeCompletedToday && (row.triagedAt || '').startsWith(options.todayIso);
  });
}

/**
 * Most urgent first (RED, then YELLOW, then GREEN, unrecognised last), then —
 * within the same acuity — whoever has been waiting longest. `priorityOrder`
 * is the single shared acuity ranking (`lib/clinical/triage-display.ts`), so
 * this sorts by the exact same rule every other worklist in the app uses.
 */
export function sortTriageQueueRows<T extends { priority?: TriageDoc['priority']; triagedAt: string }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => {
    const byPriority = priorityOrder(a.priority) - priorityOrder(b.priority);
    if (byPriority !== 0) return byPriority;
    // Ascending triagedAt: the earliest timestamp (longest wait) sorts first.
    return (a.triagedAt || '').localeCompare(b.triagedAt || '');
  });
}
