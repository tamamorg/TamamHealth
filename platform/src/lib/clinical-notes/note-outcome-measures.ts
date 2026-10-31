/**
 * Outcome measures (GAD-7, PHQ-9 and the like) on a clinical note.
 *
 * An assessment is its own document, entered from the chart's Care plan, so a
 * note knew nothing of one taken in the same visit: the clinician filled it in
 * and the unsigned note did not show it. A note now carries the assessments of
 * its encounter, or failing that of its day, as a derived section.
 *
 * Like every derived section this is a snapshot, kept current while the note is
 * a draft and fixed by signing. Reading a note never writes it: the viewer lays
 * the measures over the note in memory (`withOutcomeMeasures`), because the
 * person reading may not be allowed to edit it; the editor and Sign persist them.
 */

import type { AssessmentDoc } from '../db-types';
import type { DataScope } from '../services/data-scope';
import { localDayOf } from '../date-utils';
import type { ClinicalNoteDoc, NoteSectionContent } from './types';

const SECTION = 'outcome_measures' as const;

type NoteRef = Pick<ClinicalNoteDoc, 'encounterId' | 'serviceDate'>;

/** The assessments that belong to this note: its encounter's, or its day's. */
export function measuresForNote(note: NoteRef, assessments: AssessmentDoc[]): AssessmentDoc[] {
  return assessments
    .filter(a => (note.encounterId && a.encounterId === note.encounterId) || localDayOf(a.createdAt) === note.serviceDate)
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
}

/** "GAD-7 (Anxiety): 12 · Moderate anxiety (7/7 answered, awaiting signature)". */
export function formatOutcomeMeasures(measures: AssessmentDoc[]): string {
  return measures.map(a => {
    const score = [a.totalScore, a.interpretation].filter(part => part !== undefined && part !== '').join(' · ');
    const state = a.documentStatus === 'signed' ? `signed by ${a.signedByName || 'provider'}` : 'awaiting signature';
    return `${a.instrumentName}: ${score} (${a.answeredCount}/${a.questionCount} answered, ${state})`;
  }).join('\n');
}

/** The note as it reads with its measures in, for a reader who only views it. */
export function withOutcomeMeasures<T extends Pick<ClinicalNoteDoc, 'encounterId' | 'serviceDate' | 'sections'>>(
  note: T,
  assessments: AssessmentDoc[],
): T {
  const snapshot = formatOutcomeMeasures(measuresForNote(note, assessments));
  if (!snapshot) return note;
  const section: NoteSectionContent = { sectionId: SECTION, snapshot };
  const others = note.sections.filter(s => s.sectionId !== SECTION);
  return { ...note, sections: [...others, section] };
}

async function loadAssessments(patientId: string, scope: DataScope): Promise<AssessmentDoc[]> {
  const { getAssessmentsByPatient } = await import('../services/assessment-service');
  return getAssessmentsByPatient(patientId, scope);
}

/** The patient's assessments, for the viewer's in-memory overlay. Never throws. */
export async function assessmentsForViewer(patientId: string, scope: DataScope): Promise<AssessmentDoc[]> {
  return loadAssessments(patientId, scope).catch(() => []);
}

/**
 * Bring a draft's section in line with the chart. Returns the note as it now
 * stands; a signed note and a note with nothing to change come back untouched.
 */
export async function syncOutcomeMeasures(noteId: string, scope: DataScope): Promise<ClinicalNoteDoc | null> {
  const { addNoteSection, getClinicalNoteById, saveNoteSection } = await import('./note-service');
  const note = await getClinicalNoteById(noteId, scope);
  if (!note || note.status !== 'draft') return note;
  const snapshot = formatOutcomeMeasures(measuresForNote(note, await loadAssessments(note.patientId, scope)));
  const held = note.sections.find(s => s.sectionId === SECTION);
  if ((held?.snapshot || '') === snapshot) return note;
  if (!held) await addNoteSection(noteId, SECTION);
  return saveNoteSection(noteId, SECTION, { snapshot, snapshotAt: new Date().toISOString() });
}

/**
 * A signed note attests what it shows, so the held assessments it shows are
 * signed with it. Best-effort, one at a time: the note stands if one cannot be,
 * and the assessment stays in the signing inbox. Returns how many were left.
 */
export async function signNoteOutcomeMeasures(
  note: NoteRef & Pick<ClinicalNoteDoc, 'patientId'>,
  signer: { userId?: string; userName: string; userRole?: string },
  scope: DataScope,
): Promise<number> {
  const { signAssessment } = await import('../services/assessment-service');
  const held = measuresForNote(note, await loadAssessments(note.patientId, scope)).filter(a => a.documentStatus === 'held');
  let left = 0;
  for (const assessment of held) {
    try {
      await signAssessment(assessment._id, signer);
    } catch (err) {
      left += 1;
      console.warn('[note] assessment not signed with its note', assessment._id, err);
    }
  }
  return left;
}
