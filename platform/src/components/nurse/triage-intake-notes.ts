// Pure composition of the triage-form fields that have no dedicated TriageDoc
// column of their own — current medications, a chronic-conditions quick-pick,
// per-vital "couldn't measure this" reasons, and a manual priority-raise
// reason (see TriageWorkflow.tsx and the implementation report for why each
// one folds into `notes` instead of a new schema field). Split out as a pure
// function so the exact wording is unit-testable without mounting the form.

import type { TriageVitalField } from '@/lib/clinical/vitals';

export const TRIAGE_VITAL_FIELD_LABELS: Record<TriageVitalField, string> = {
  temperature: 'Temperature',
  pulse: 'Pulse',
  respiratoryRate: 'Respiratory rate',
  oxygenSaturation: 'Oxygen saturation',
  systolic: 'Systolic BP',
  diastolic: 'Diastolic BP',
  weight: 'Weight',
  height: 'Height',
  painScore: 'Pain score',
  bloodGlucose: 'Blood glucose',
  gcs: 'GCS',
  muac: 'MUAC',
  patientAge: 'Age',
};

export const UNMEASURED_VITAL_REASON_LABELS: Record<string, string> = {
  equipment_unavailable: 'equipment unavailable',
  patient_condition: 'patient condition',
  declined: 'patient declined',
};

/**
 * True when a manually-raised priority has no reason to justify it yet — the
 * one thing the submit guard must block on. Pulled out as its own pure
 * predicate (rather than an inline `if` in the form) so the rule — "raising
 * is fine, raising with nothing said about why is not" — is unit-testable on
 * its own.
 */
export function manualPriorityRaiseNeedsReason(
  manualPriorityRaise: 'RED' | 'YELLOW' | '',
  manualUpgradeReason: string,
): boolean {
  return Boolean(manualPriorityRaise) && !manualUpgradeReason.trim();
}

export interface TriageIntakeNotesInput {
  baseNotes: string;
  currentMedications: string;
  chronicConditions: string[];
  /** Keyed by TriageVitalField; value is a reason code from UNMEASURED_VITAL_REASON_LABELS. */
  unmeasuredVitalReasons: Partial<Record<TriageVitalField, string>>;
  manualPriorityRaise: 'RED' | 'YELLOW' | '';
  manualUpgradeReason: string;
}

/**
 * Builds the final `notes` string saved with the triage: the nurse's own
 * free text first, then one clearly labelled structured line per light-touch
 * field that actually has something to say. A field the nurse never touched
 * contributes nothing — an empty medications box or an untouched vital
 * should not manufacture a line of its own.
 */
export function composeTriageIntakeNotes(input: TriageIntakeNotesInput): string | undefined {
  const lines: string[] = [];
  const baseNotes = input.baseNotes.trim();
  if (baseNotes) lines.push(baseNotes);

  const medications = input.currentMedications.trim();
  if (medications) lines.push(`[Current medications] ${medications}`);

  if (input.chronicConditions.length > 0) {
    lines.push(`[Chronic conditions] ${input.chronicConditions.join(', ')}`);
  }

  const unmeasuredEntries = Object.entries(input.unmeasuredVitalReasons) as Array<[TriageVitalField, string]>;
  if (unmeasuredEntries.length > 0) {
    const parts = unmeasuredEntries.map(([field, reason]) => {
      const label = TRIAGE_VITAL_FIELD_LABELS[field] || field;
      const reasonLabel = UNMEASURED_VITAL_REASON_LABELS[reason] || reason || 'not recorded';
      return `${label}: ${reasonLabel}`;
    });
    lines.push(`[Vitals not measured] ${parts.join('; ')}`);
  }

  if (input.manualPriorityRaise && input.manualUpgradeReason.trim()) {
    lines.push(`[Priority raised to ${input.manualPriorityRaise} by nurse] ${input.manualUpgradeReason.trim()}`);
  }

  return lines.length > 0 ? lines.join('\n') : undefined;
}

const MANUAL_RAISE_NOTE_PATTERN = /^\[Priority raised to (RED|YELLOW) by nurse\] (.+)$/m;

/**
 * Read-side counterpart to the `[Priority raised to …]` line above — pulls
 * the manual-raise priority and reason back out of a saved triage's `notes`
 * so the chart/worklist can show it as its own callout instead of a reader
 * having to notice it inside a paragraph of free text. Returns null when the
 * triage was never manually raised (the overwhelming majority of records).
 */
export function extractManualPriorityRaise(notes: string | undefined): { priority: 'RED' | 'YELLOW'; reason: string } | null {
  if (!notes) return null;
  const match = notes.match(MANUAL_RAISE_NOTE_PATTERN);
  if (!match) return null;
  return { priority: match[1] as 'RED' | 'YELLOW', reason: match[2].trim() };
}
