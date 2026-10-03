/**
 * The end-of-visit summary a patient takes home: what they were seen for, what
 * they were given, what was ordered, and when to come back.
 *
 * It did not exist. The closest thing was the referral's "Summary of care",
 * which is written for the next clinician — full note narrative, problem list,
 * social history. This is the opposite document: for the patient, in the
 * plainest terms the record supports, with nothing in it that is only
 * meaningful to staff.
 *
 * What is deliberately left out, and why:
 *   - Lab and imaging VALUES. Results reach a patient through result release,
 *     which has its own review step; a summary must not become a side door.
 *   - The clinician's Plan narrative. It is written for colleagues. Only the
 *     sections addressed to the patient (education, discharge instructions,
 *     advice given, follow-up) are offered as advice, and the clinician can
 *     edit that text before it leaves.
 *   - The diagnosis, the names of the tests, and the reason for the follow-up
 *     visit, from the TEXT version unless the sender opts in. A phone is often
 *     shared; paper handed to the patient is not. Medicine names and the
 *     advice are always sent — a summary without them is no use — and the
 *     sender sees and can edit the whole text first, so what leaves is theirs.
 *
 * Pure: assembling, rendering and texting are separate so each is testable.
 */
import type { AppointmentDoc, LabResultDoc, MedicalRecordDoc, PrescriptionDoc } from './db-types';
import type { ClinicalNoteDoc } from './clinical-notes/types';
import type { NoteSectionId } from './clinical-notes/note-catalog';
import { stripTemplateMarkers } from './clinical-notes/section-templates';
import { toIsoDate, todayIso } from './date-utils';
import { escapeHtml } from './safe-html';
import { buildClinicalPrintDocument } from './print-document';
import { scriptDate, type ScriptPatient } from './prescription-script';
import { toSmsSafe } from './sms/text';

/** Note sections written TO the patient, in the order they should read. */
const PATIENT_FACING_SECTIONS: readonly NoteSectionId[] = [
  'discharge_instructions', 'patient_education', 'advice_given', 'follow_up',
];

export interface VisitSources {
  records: MedicalRecordDoc[];
  notes: ClinicalNoteDoc[];
  prescriptions: PrescriptionDoc[];
  labOrders: LabResultDoc[];
  appointments: AppointmentDoc[];
}

export interface VisitSummaryMedication {
  name: string;
  directions: string;
  duration: string;
  quantity: number;
  /** Where the patient gets it: this facility's pharmacy, or an outside one. */
  outsidePharmacy: boolean;
}

export interface VisitSummary {
  visitDate: string;
  facilityName: string;
  clinicianName: string;
  patient: ScriptPatient;
  reason: string;
  diagnoses: string[];
  medications: VisitSummaryMedication[];
  /**
   * Names of the tests ordered. No status: "done" would suggest the patient
   * has the result (release has its own review), and "pending" is wrong for a
   * rejected specimen. Results are the clinic's to give.
   */
  tests: string[];
  /** Patient-directed advice, one paragraph per entry. */
  advice: string[];
  followUp?: { date: string; time?: string; reason?: string; with?: string };
  /** A note for this visit is still a draft — the summary may be incomplete. */
  hasUnsignedNote: boolean;
}

/** Local calendar day of an ISO timestamp or date string. */
function localDay(value?: string | null): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : toIsoDate(d);
}

function isConsultation(record: MedicalRecordDoc): boolean {
  return record.recordKind !== 'nursing_vitals';
}

/**
 * The visit day each encounter belongs to, from the documents that record it.
 * A prescription carries its encounter, so one written the next morning —
 * after a lab result came back — still belongs to the visit that ordered it
 * rather than to a visit of its own.
 */
function encounterDays(sources: Pick<VisitSources, 'records' | 'notes'>): Map<string, string> {
  const days = new Map<string, string>();
  for (const record of sources.records) {
    const day = localDay(record.visitDate || record.consultedAt);
    if (isConsultation(record) && record.encounterId && day) days.set(record.encounterId, day);
  }
  for (const note of sources.notes) {
    const day = localDay(note.serviceDate);
    if (note.encounterId && day && !days.has(note.encounterId)) days.set(note.encounterId, day);
  }
  return days;
}

/** The visit a prescription belongs to: its encounter's day, else the day it was written. */
function prescriptionDay(rx: PrescriptionDoc, byEncounter: Map<string, string>): string {
  return (rx.encounterId && byEncounter.get(rx.encounterId)) || localDay(rx.createdAt);
}

/**
 * The days this patient was actually seen, newest first — the choices offered
 * when a summary is opened. A day counts when a consultation record or a
 * clinical note documents it, or a prescription belongs to it.
 */
export function visitDays(sources: Pick<VisitSources, 'records' | 'notes' | 'prescriptions'>): string[] {
  const byEncounter = encounterDays(sources);
  const days = new Set<string>();
  for (const record of sources.records) if (isConsultation(record)) days.add(localDay(record.visitDate || record.consultedAt));
  for (const note of sources.notes) days.add(localDay(note.serviceDate));
  for (const rx of sources.prescriptions) if (rx.status !== 'discontinued') days.add(prescriptionDay(rx, byEncounter));
  days.delete('');
  return [...days].sort((a, b) => b.localeCompare(a));
}

function sectionText(note: ClinicalNoteDoc, sectionId: NoteSectionId): string {
  const section = note.sections.find(s => s.sectionId === sectionId);
  return stripTemplateMarkers(section?.text || '').trim();
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter(value => {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const CLOSED_APPOINTMENT = new Set(['completed', 'cancelled', 'no_show']);

export interface BuildVisitSummaryInput extends VisitSources {
  visitDate: string;
  patient: ScriptPatient;
  facilityName: string;
  /** Fallback when neither the record nor a note names who saw the patient. */
  clinicianName: string;
  /** The day the summary is being made. Defaults to today (local). */
  today?: string;
}

export function buildVisitSummary(input: BuildVisitSummaryInput): VisitSummary {
  const day = input.visitDate;
  const record = input.records
    .filter(isConsultation)
    .filter(r => localDay(r.visitDate || r.consultedAt) === day)
    .sort((a, b) => (b.consultedAt || b.createdAt || '').localeCompare(a.consultedAt || a.createdAt || ''))[0];
  const notes = input.notes.filter(n => localDay(n.serviceDate) === day);
  const byEncounter = encounterDays(input);
  // A discontinued order is never listed: a summary must not tell a patient to
  // take a medicine that was stopped. The same medicine written twice with the
  // same directions (a re-issue, a renewal) is one line, the latest.
  const latestByLine = new Map<string, PrescriptionDoc>();
  for (const rx of input.prescriptions
    .filter(item => item.status !== 'discontinued' && prescriptionDay(item, byEncounter) === day)
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))) {
    latestByLine.set(`${rx.medication}|${rx.frequency}|${rx.duration}`.toLowerCase(), rx);
  }
  const prescriptions = [...latestByLine.values()];
  const labOrders = input.labOrders.filter(order => localDay(order.orderedAt) === day);

  const noteDiagnoses = notes.flatMap(note =>
    note.sections.flatMap(section => (section.diagnoses || []).map(d => d.name)));
  const recordDiagnoses = (record?.diagnoses || [])
    .filter(d => d.type !== 'differential')
    .map(d => d.name);

  const advice = dedupe(notes.flatMap(note =>
    PATIENT_FACING_SECTIONS.map(sectionId => sectionText(note, sectionId))));

  const reason = record?.chiefComplaint?.trim()
    || notes.map(note => sectionText(note, 'cc')).find(Boolean)
    || '';

  // "Next visit" must be a visit still to come. Summarising an older visit,
  // an appointment that has since passed (and was never closed) is not it,
  // and neither is a follow-up date that has gone by. Of what remains — a
  // booked appointment, the follow-up written in the record — the patient
  // needs the earliest; on the same day the booking wins, as it has a time.
  const today = input.today ?? todayIso();
  const candidates: Array<NonNullable<VisitSummary['followUp']> & { booked: boolean }> = input.appointments
    .filter(a => a.appointmentDate > day && a.appointmentDate >= today && !CLOSED_APPOINTMENT.has(a.status))
    .map(a => ({
      date: a.appointmentDate,
      time: a.appointmentTime || undefined,
      reason: a.reason || undefined,
      with: a.providerName || undefined,
      booked: true,
    }));
  if (record?.followUp?.date && record.followUp.date > day && record.followUp.date >= today) {
    candidates.push({ date: record.followUp.date, reason: record.followUp.reason || undefined, booked: false });
  }
  candidates.sort((a, b) =>
    a.date.localeCompare(b.date)
    || Number(b.booked) - Number(a.booked)
    || (a.time || '').localeCompare(b.time || ''));
  const next = candidates[0];
  const followUp: VisitSummary['followUp'] = next
    ? { date: next.date, time: next.time, reason: next.reason, with: next.with }
    : undefined;

  const signedNote = notes.find(n => n.status !== 'draft');
  return {
    visitDate: day,
    facilityName: input.facilityName,
    clinicianName: record?.providerName
      || signedNote?.signedByName
      || notes[0]?.authorName
      || prescriptions[0]?.prescribedBy
      || input.clinicianName,
    patient: input.patient,
    reason,
    diagnoses: dedupe([...noteDiagnoses, ...recordDiagnoses]),
    medications: prescriptions.map(rx => ({
      name: rx.medication,
      directions: rx.frequency || 'As directed',
      duration: rx.duration || '',
      quantity: Math.max(1, Number(rx.quantityToDispense) || 1),
      outsidePharmacy: rx.fulfilment === 'external',
    })),
    tests: dedupe(labOrders.map(order => order.testName)),
    advice,
    followUp,
    hasUnsignedNote: notes.some(n => n.status === 'draft'),
  };
}

/** True when the record holds nothing a patient could usefully take home. */
export function isVisitSummaryEmpty(summary: VisitSummary): boolean {
  return !summary.reason
    && summary.diagnoses.length === 0
    && summary.medications.length === 0
    && summary.tests.length === 0
    && summary.advice.length === 0
    && !summary.followUp;
}

function followUpLine(followUp: NonNullable<VisitSummary['followUp']>, withReason = true): string {
  return [
    `${scriptDate(followUp.date)}${followUp.time ? ` at ${followUp.time}` : ''}`,
    followUp.with ? `with ${followUp.with}` : '',
    withReason && followUp.reason ? `(${followUp.reason})` : '',
  ].filter(Boolean).join(' ');
}

export interface VisitSummaryRenderOptions {
  /** Replaces the advice gathered from the note with the sender's edited text. */
  advice?: string;
  /**
   * Text only: name the diagnosis, the tests, and the reason for the next
   * visit. Off unless the sender opts in.
   */
  includeDiagnosis?: boolean;
}

function adviceParagraphs(summary: VisitSummary, options: VisitSummaryRenderOptions): string[] {
  if (options.advice === undefined) return summary.advice;
  return options.advice.split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
}

export function buildVisitSummaryHtml(summary: VisitSummary, options: VisitSummaryRenderOptions = {}): string {
  const e = escapeHtml;
  const advice = adviceParagraphs(summary, options);
  const medications = summary.medications.length
    ? `<table><thead><tr><th>Medicine</th><th>How to take it</th><th>For</th><th class="num">Qty</th><th>Collect from</th></tr></thead><tbody>${
      summary.medications.map(m => `<tr><td><strong>${e(m.name)}</strong></td><td>${e(m.directions)}</td><td>${e(m.duration || '—')}</td><td class="num">${m.quantity}</td><td>${m.outsidePharmacy ? 'Outside pharmacy' : `${e(summary.facilityName)} pharmacy`}</td></tr>`).join('')
    }</tbody></table>`
    : '<p class="muted">No medicines were prescribed at this visit.</p>';

  const body = `
    ${summary.reason ? `<section class="section keep"><h2 class="section-title">Why you came</h2><p>${e(summary.reason)}</p></section>` : ''}
    ${summary.diagnoses.length ? `<section class="section keep"><h2 class="section-title">What we found</h2><ul>${summary.diagnoses.map(d => `<li>${e(d)}</li>`).join('')}</ul></section>` : ''}
    <section class="section"><h2 class="section-title">Your medicines</h2>${medications}</section>
    ${summary.tests.length ? `<section class="section keep"><h2 class="section-title">Tests ordered</h2><ul>${summary.tests.map(t => `<li>${e(t)}</li>`).join('')}</ul><p class="muted">Ask the clinic for your results.</p></section>` : ''}
    ${advice.length ? `<section class="section keep"><h2 class="section-title">Advice</h2>${advice.map(a => `<p>${e(a).replace(/\n/g, '<br>')}</p>`).join('')}</section>` : ''}
    <section class="section keep"><h2 class="section-title">Next visit</h2>
      <p class="notice">${summary.followUp ? `<strong>${e(followUpLine(summary.followUp))}</strong>` : 'No follow-up visit is booked.'} Come back sooner if you get worse.</p>
    </section>`;

  return buildClinicalPrintDocument({
    title: summary.patient.name,
    documentLabel: 'Visit summary',
    facilityName: summary.facilityName,
    meta: [
      { label: 'Patient ID', value: summary.patient.hospitalNumber },
      { label: 'Visit date', value: scriptDate(summary.visitDate) },
      { label: 'Seen by', value: summary.clinicianName },
    ],
    safeBodyHtml: body,
    footer: 'Visit summary for the patient. It does not replace the clinical record.',
  });
}

/** The same summary as a text message, kept to what a shared phone may show. */
export function buildVisitSummaryText(summary: VisitSummary, options: VisitSummaryRenderOptions = {}): string {
  const advice = adviceParagraphs(summary, options);
  const lines = [
    `${summary.facilityName} - Visit summary ${scriptDate(summary.visitDate)}`,
    `Patient: ${summary.patient.name}. Seen by ${summary.clinicianName}.`,
    options.includeDiagnosis && summary.diagnoses.length ? `Diagnosis: ${summary.diagnoses.join('; ')}.` : '',
    summary.medications.length
      ? `Medicines: ${summary.medications.map(m => `${m.name} - ${m.directions}${m.duration ? ` for ${m.duration}` : ''}`).join('; ')}.`
      : '',
    // A test's name says as much as the diagnosis ("HIV viral load"), so
    // without the opt-in the text says only that tests were ordered.
    summary.tests.length
      ? (options.includeDiagnosis
        ? `Tests ordered: ${summary.tests.join(', ')}. Ask the clinic for your results.`
        : 'Tests were ordered. Ask the clinic for your results.')
      : '',
    advice.length ? `Advice: ${advice.join(' ').replace(/\s+/g, ' ')}` : '',
    // A follow-up's reason usually names the condition ("Malaria treatment
    // follow-up"), so it travels with the diagnosis or not at all.
    summary.followUp ? `Next visit: ${followUpLine(summary.followUp, Boolean(options.includeDiagnosis))}.` : '',
    'Come back sooner if you get worse.',
  ].filter(Boolean);
  return toSmsSafe(lines.join('\n'));
}
