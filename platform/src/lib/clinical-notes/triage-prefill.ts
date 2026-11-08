/**
 * What triage already found, as the opening text of the visit's note, so the
 * clinician edits what the nurse recorded rather than asking again. The text
 * lands in narrative sections, where it is theirs to change.
 *
 * Vitals and allergies are not repeated here: their own sections read them.
 * A clerk's check-in holds a complaint and nothing clinical, and an ABCC value
 * of `not_assessed` means nobody looked, so neither becomes a finding.
 */

import { IITT_RED_CRITERIA, IITT_YELLOW_CRITERIA, INFECTION_RISK_SIGNS, iittCodeLabels } from '../clinical/iitt';
import { priorityLabel } from '../clinical/triage-display';
import { toIsoDate } from '../date-utils';
import { formatDateTime } from '../format-utils';
import type { TriageDoc } from '../db-types';
import type { NoteSectionId } from './note-catalog';
import { formatMedicationReview } from '../clinical/triage-medication-review';

/** The longest a triage with no visit link can wait for its note. */
export const UNLINKED_TRIAGE_WINDOW_HOURS = 24;

const HISTORY_SECTIONS: NoteSectionId[] = ['hpi', 'subjective'];
const FINDINGS_SECTIONS: NoteSectionId[] = ['physical_exam', 'objective'];

const line = (label: string, value?: string | number | null) => {
  const text = String(value ?? '').trim();
  return text ? `${label}: ${text}` : '';
};

const sentence = (value?: string) => {
  const text = (value || '').replace(/_/g, ' ').trim();
  return text && text[0].toUpperCase() + text.slice(1);
};

const assessed = (value?: string) => (value && value !== 'not_assessed' ? sentence(value) : '');

function pregnancy(triage: TriageDoc): string {
  const status = triage.pregnancyStatus;
  if (!status || status === 'unknown' || status === 'not_applicable') return '';
  const weeks = status === 'pregnant' && triage.gestationalAgeWeeks ? `, ${triage.gestationalAgeWeeks} weeks` : '';
  return `${sentence(status)}${weeks}`;
}

function source(triage: TriageDoc): string {
  return `From triage: ${triage.triagedByName || 'nurse'}, ${formatDateTime(triage.triagedAt || triage.createdAt)}`;
}

function historyText(triage: TriageDoc): string {
  const lines = [
    line('Duration', triage.symptomDuration),
    line('Presentation', sentence(triage.presentationCategory)),
    line('Arrived by', triage.modeOfArrival === 'walk-in' ? '' : sentence(triage.modeOfArrival)),
    line('Referred from', triage.referralSource),
    line('Pregnancy', pregnancy(triage)),
    line('Mechanism of injury', triage.injuryMechanism),
    line('Care before arrival', triage.preArrivalCare),
    line('Medication list', triage.medicationReview ? formatMedicationReview(triage.medicationReview) : ''),
    line('Triage notes', triage.notes),
  ].filter(Boolean);
  return lines.length ? [source(triage), ...lines].join('\n') : '';
}

function findingsText(triage: TriageDoc): string {
  const lines = [
    line('Priority', triage.priority ? priorityLabel(triage.priority) : ''),
    line('Airway', assessed(triage.airway)),
    line('Breathing', assessed(triage.breathing)),
    line('Circulation', assessed(triage.circulation)),
    line('Consciousness', assessed(triage.consciousness)),
    line('Pain score', triage.painScore && `${triage.painScore}/10`),
    line('GCS', triage.gcs),
    line('Blood glucose', triage.bloodGlucose && `${triage.bloodGlucose} mmol/L`),
    line('MUAC', triage.muac && `${triage.muac} cm`),
    line('Capillary refill', triage.capillaryRefillSeconds && `${triage.capillaryRefillSeconds} seconds`),
    line('Danger signs', iittCodeLabels(triage.redCriteria, IITT_RED_CRITERIA).join('; ')),
    line('Urgent signs', iittCodeLabels(triage.yellowCriteria, IITT_YELLOW_CRITERIA).join('; ')),
    line('Infection risk', iittCodeLabels(triage.infectionRiskSigns, INFECTION_RISK_SIGNS).join('; ')),
    triage.isolationRequired ? 'Isolation required' : '',
    line('Vital sign warnings', (triage.vitalUrgencyWarnings || []).map(warning => warning.message).join('; ')),
    line('Priority changed because', triage.vitalUrgencyOverridden ? triage.vitalUrgencyOverrideReason : ''),
    line('Treatment at triage', triage.immediateInterventions),
    line('Sent to', triage.destinationClinic || sentence(triage.disposition)),
    line('Receiving provider', triage.assignedProviderName),
    line('Handoff note', triage.handoffNote),
  ].filter(Boolean);
  return lines.length ? [source(triage), ...lines].join('\n') : '';
}

/** The opening text for each section this note has, from the visit's triage. */
export function noteTextFromTriage(
  triage: TriageDoc,
  noteSections: readonly NoteSectionId[],
): Partial<Record<NoteSectionId, string>> {
  const texts: Partial<Record<NoteSectionId, string>> = {};
  const complaint = (triage.chiefComplaint || '').trim();
  if (complaint && noteSections.includes('cc')) texts.cc = complaint;
  if (triage.assessmentSource === 'clerical_checkin') return texts;

  const historySection = HISTORY_SECTIONS.find(id => noteSections.includes(id));
  const history = historyText(triage);
  if (historySection && history) texts[historySection] = history;

  const findingsSection = FINDINGS_SECTIONS.find(id => noteSections.includes(id));
  const findings = findingsText(triage);
  if (findingsSection && findings) texts[findingsSection] = findings;
  return texts;
}

/**
 * The open triage this visit's note may draw on when no triage carries its
 * encounter. Only one with no visit link at all: a triage linked to another
 * encounter belongs to that visit. Recent, open, at this facility and on the
 * note's own date, so a past visit cannot land on today's note or today's
 * triage on a backdated one.
 */
export function unlinkedTriageForNote(
  triages: TriageDoc[],
  hospitalId: string | undefined,
  serviceDate: string,
  now: Date,
): TriageDoc | null {
  const earliest = now.getTime() - UNLINKED_TRIAGE_WINDOW_HOURS * 3_600_000;
  return triages
    .filter(triage => !triage.encounterId
      && (triage.status === 'pending' || triage.status === 'seen')
      && Boolean(hospitalId) && (triage.facilityId || hospitalId) === hospitalId
      && Date.parse(triage.triagedAt || '') >= earliest
      && (serviceDate === toIsoDate(now) || serviceDate === toIsoDate(new Date(triage.triagedAt))))
    .sort((a, b) => (b.triagedAt || '').localeCompare(a.triagedAt || ''))[0] ?? null;
}
