/**
 * The clinical Visit Summary for one visit — the sheet the Visits tab's print
 * button produces, in the OpenMRS O3 order: Patient Information, Vital Signs,
 * Diagnoses (certainty and rank), Conditions, Lab Results, Allergies, Active
 * Medications, Visit Notes. Printed through the shared clinical template
 * (print-document.ts), so it carries the same header and page footer as every
 * other printout.
 *
 * Distinct from the patient handover sheet (visit-summary.ts), which is
 * written for the patient ("Why you came", "Your medicines").
 *
 * Pure: takes the documents, returns HTML. Every value is escaped.
 */
import { escapeHtml } from './safe-html';
import { buildClinicalPrintDocument } from './print-document';
import { stripTemplateMarkers } from './clinical-notes/section-templates';
import { patientAge, patientFullName } from './patient-utils';
import type { LabResultDoc, MedicalRecordDoc, PatientDoc, PrescriptionDoc, ProblemDoc } from './db-types';
import type { ClinicalNoteDoc } from './clinical-notes/types';
import type { VitalsTimelineEntry } from './clinical/vitals';

export interface ClinicalVisitSummaryInput {
  patient: PatientDoc;
  /** The visit's day, YYYY-MM-DD. */
  day: string;
  visitType?: string;
  facilityName?: string;
  records: MedicalRecordDoc[];
  notes: ClinicalNoteDoc[];
  labs: LabResultDoc[];
  prescriptions: PrescriptionDoc[];
  problems: ProblemDoc[];
  /** The visit's vitals, when any were taken that day. */
  vitals?: VitalsTimelineEntry;
}

const e = (value: unknown) => escapeHtml(value === undefined || value === null ? '' : String(value));
const onDay = (iso: string | undefined, day: string) => !!iso && iso.slice(0, 10) === day;

function field(label: string, value: string | number | undefined | null): string {
  const shown = value === undefined || value === null || value === '' ? '—' : String(value);
  return `<div><span class="field-label">${e(label)}</span><span class="field-value">${e(shown)}</span></div>`;
}

function table(head: string[], rows: string[][], empty = 'No data recorded'): string {
  if (rows.length === 0) return `<p class="empty">${e(empty)}</p>`;
  return `<table><thead><tr>${head.map(h => `<th>${e(h)}</th>`).join('')}</tr></thead><tbody>${
    rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')
  }</tbody></table>`;
}

const section = (title: string, body: string) => `<section class="section"><h2 class="section-title">${e(title)}</h2>${body}</section>`;

/** Diagnoses for the day, in rank order: primary 1, secondary 2, differential 3. */
export function visitDiagnoses(records: MedicalRecordDoc[], day: string): Array<{ name: string; certainty: 'Confirmed' | 'Provisional'; rank: number }> {
  const rank = { primary: 1, secondary: 2, differential: 3 } as const;
  return records
    .filter(r => onDay(r.consultedAt || r.visitDate || r.createdAt, day))
    .flatMap(r => r.diagnoses || [])
    .filter(d => !!d?.name)
    .map(d => ({
      name: d.name,
      certainty: d.certainty === 'suspected' || d.type === 'differential' ? 'Provisional' as const : 'Confirmed' as const,
      rank: rank[d.type] ?? 2,
    }))
    .sort((a, b) => a.rank - b.rank);
}

function noteText(note: ClinicalNoteDoc): string {
  return note.sections
    .map(s => stripTemplateMarkers(s.text || '').trim())
    .filter(Boolean)
    .join('\n');
}

export function buildClinicalVisitSummaryHtml(input: ClinicalVisitSummaryInput): string {
  const { patient, day } = input;
  const age = patientAge(patient);
  const dob = patient.dateOfBirth ? `${patient.dateOfBirth}${age !== null ? ` (Age: ${age})` : ''}` : (age !== null ? `Age: ${age}` : '');
  const v = input.vitals;

  const vitals = `<div class="doc-meta">${[
    field('Blood Pressure', v?.systolic !== undefined && v?.diastolic !== undefined ? `${v.systolic}/${v.diastolic} mmHg` : ''),
    field('Pulse', v?.pulse !== undefined ? `${v.pulse} beats/min` : ''),
    field('Temperature (c)', v?.temperature !== undefined ? `${v.temperature} DEG C` : ''),
    field('Weight (kg)', v?.weight !== undefined ? `${v.weight} kg` : ''),
    field('Height (cm)', v?.height !== undefined ? `${v.height} cm` : ''),
    field('Arterial blood oxygen saturation (pulse oximeter)', v?.oxygenSaturation !== undefined ? `${v.oxygenSaturation} %` : ''),
    field('Respiratory rate', v?.respiratoryRate !== undefined ? `${v.respiratoryRate} breaths/min` : ''),
  ].join('')}</div>`;

  const diagnoses = table(['Diagnosis', 'Certainty', 'Rank'],
    visitDiagnoses(input.records, day).map(d => [e(d.name), e(d.certainty), `<span class="num">${d.rank}</span>`]));

  const conditions = table(['Condition', 'Onset Date'],
    input.problems
      .filter(p => (p.status === 'active' || p.status === 'chronic') && p.recordStatus !== 'entered_in_error')
      .map(p => [e(p.name), e(p.onsetDate || '')]));

  const labsForDay = input.labs.filter(l => onDay(l.completedAt || l.orderedAt || l.createdAt, day));
  const labs = table(['Test', 'Result', 'Reference Range', 'Flag'],
    labsForDay.map(l => [
      e(l.testName),
      e([l.result, l.unit].filter(Boolean).join(' ') || (l.status === 'completed' ? '' : l.status.replace(/_/g, ' '))),
      e(l.referenceRange || ''),
      l.critical ? '<span class="status status-alert">Critical</span>' : l.abnormal ? '<span class="status">Abnormal</span>' : '',
    ]));

  const activeAllergies = (patient.structuredAllergies ?? (patient.allergies || [])
    .filter(Boolean)
    .map((substance, i) => ({ id: String(i), substance, status: 'active' as const, reaction: undefined as string | undefined, criticality: undefined as string | undefined })))
    .filter(a => a.status === 'active' && a.substance && !/^none( known)?$/i.test(a.substance));
  const allergies = table(['Allergen', 'Reaction', 'Severity'],
    activeAllergies.map(a => [e(a.substance), e(a.reaction || ''), e(a.criticality && a.criticality !== 'unknown' ? a.criticality.charAt(0).toUpperCase() + a.criticality.slice(1) : '')]));

  const meds = table(['Medication', 'Dosing', 'Duration', 'Start Date'],
    input.prescriptions
      .filter(p => p.status === 'pending' || p.status === 'dispensed')
      .map(p => [e(p.medication), e([p.dose, p.route, p.frequency].filter(Boolean).join(', ')), e(p.duration || ''), e((p.createdAt || '').slice(0, 10))]));

  const notesForDay = input.notes
    .filter(n => onDay(n.serviceDate || n.createdAt, day))
    .map(n => ({ n, text: noteText(n) }))
    .filter(x => x.text);
  const notes = notesForDay.length === 0
    ? '<p class="empty">No data recorded</p>'
    : notesForDay.map(({ n, text }) => `<div class="note"><div class="note-meta">${e(`${n.serviceDate || ''} ${n.serviceTime || ''}`.trim())} — ${e(n.authorName || '')}</div><div>${e(text).replace(/\n/g, '<br>')}</div></div>`).join('');

  return buildClinicalPrintDocument({
    title: 'Visit Summary',
    documentLabel: 'Visit Summary',
    date: day,
    facilityName: input.facilityName,
    metaTitle: 'Patient Information',
    meta: [
      { label: 'Patient Name', value: patientFullName(patient) },
      { label: 'Patient ID', value: patient.hospitalNumber },
      { label: 'Date of Birth', value: dob },
      { label: 'Gender', value: patient.gender ? patient.gender.charAt(0).toUpperCase() : '' },
      { label: 'Visit Date', value: day },
      { label: 'Visit Type', value: input.visitType || 'Facility Visit' },
      { label: 'Location', value: input.facilityName },
    ],
    safeBodyHtml: [
      section('Vital Signs', vitals),
      section('Diagnoses', diagnoses),
      section('Conditions', conditions),
      section('Lab Results', labs),
      section('Allergies', allergies),
      section('Active Medications', meds),
      section('Visit Notes', notes),
    ].join(''),
  });
}
