/**
 * Documents for the clinical notes module.
 *
 * These live here rather than in `db-types.ts` so the module is self-contained:
 * everything a clinical note needs — catalog, templates, documents, services —
 * sits under `lib/clinical-notes/`, and the rest of the platform depends on the
 * module rather than the module scattering itself through shared files.
 *
 * The signing vocabulary deliberately mirrors `MedicalRecordDoc.documentStatus`
 * ('draft' | 'signed' | 'amended' | 'awaiting_cosign'), because a note and a
 * medical record are the same kind of legal object: once attested it is locked,
 * and corrections are appended as addenda rather than edited in place.
 */

import type { BaseDoc } from '../db-types';
import type { NoteTypeId, NoteSectionId } from './note-catalog';
import type { TemplateSelection } from './section-templates';

export type NoteStatus = 'draft' | 'signed' | 'amended' | 'awaiting_cosign';

/**
 * A coded diagnosis attached to the Assessment section — one card in the
 * editor. Coded (ICD-11) when picked from the catalog; free-text entries keep
 * `icd11Code` empty rather than inventing a code.
 */
export interface NoteDiagnosis {
  id: string;
  name: string;
  /** Full diagnosis description line, when it differs from the short name. */
  description?: string;
  icd11Code?: string;
  acuity?: 'acute' | 'chronic';
  /** Onset/start date (YYYY-MM-DD). */
  startDate?: string;
  addedAt: string;
  /** Problem-list doc this line was included from (or pushed to). */
  problemId?: string;
}

/** One section's captured content inside a note. */
export interface NoteSectionContent {
  sectionId: NoteSectionId;
  /** Narrative body. May contain the template block delimiters. */
  text?: string;
  /** Coded diagnoses (Assessment section only) — the cards above the narrative. */
  diagnoses?: NoteDiagnosis[];
  /** Ticks behind the section's template, kept so reopening restores the tree. */
  templateSelection?: TemplateSelection;
  /**
   * Snapshot of derived chart data (vitals, medications, allergies) as it stood
   * when the note was written. A note is a record of what the clinician saw, so
   * it must not silently change when the chart later does.
   */
  snapshot?: string;
  /** When the snapshot was taken, for the "refresh" affordance. */
  snapshotAt?: string;
}

/** An attested correction appended to a signed note. */
export interface NoteAddendum {
  id: string;
  text: string;
  authorId: string;
  authorName: string;
  createdAt: string;
}

/** Orders and actions raised from the Plan section, recorded on the note. */
export interface NotePlanAction {
  id: string;
  kind: 'medication' | 'lab' | 'vaccine' | 'patient_education' | 'referral' | 'follow_up';
  label: string;
  /** Id of the document this action created (prescription, lab order, …). */
  targetId?: string;
  createdAt: string;
  createdBy?: string;
}

export interface ClinicalNoteDoc extends BaseDoc {
  type: 'clinical_note';

  patientId: string;
  patientName: string;
  /** Medical record number, denormalised for the note header and print view. */
  mrn?: string;
  patientDob?: string;

  noteType: NoteTypeId;
  /** Optional sections the clinician added beyond the type's defaults. */
  addedSections?: NoteSectionId[];
  sections: NoteSectionContent[];

  /** Date and time of service — editable, defaults from the appointment. */
  serviceDate: string;
  serviceTime?: string;

  /** Provider the note is assigned to (may differ from the author). */
  assignedToId?: string;
  assignedToName?: string;

  /** Appointment this note documents, when created from one. */
  appointmentId?: string;
  encounterId?: string;

  status: NoteStatus;
  signedBy?: string;
  signedByName?: string;
  signedAt?: string;
  cosignedBy?: string;
  cosignedByName?: string;
  cosignedAt?: string;
  addenda?: NoteAddendum[];

  /** Actions raised from the Plan section. */
  planActions?: NotePlanAction[];

  /** Note this one was copied forward from (SALT). */
  copiedFromId?: string;
  /** Signed note this amendment corrects. */
  amendsNoteId?: string;

  authorId?: string;
  authorName?: string;
  hospitalId?: string;
  hospitalName?: string;
  orgId?: string;
}

/**
 * A per-clinician text shortcut ("dot phrase"): a short trigger that expands to
 * a block of narrative. Ranked by use so the phrases someone actually reaches
 * for rise to the top of the picker.
 */
export interface TextShortcutDoc extends BaseDoc {
  type: 'text_shortcut';
  /** Owning clinician. Shortcuts with `shared` true are visible org-wide. */
  userId: string;
  /** Short trigger, e.g. "headache". */
  name: string;
  /** The narrative inserted when chosen. */
  body: string;
  /** Restrict to one section, or leave unset for any. */
  sectionId?: NoteSectionId;
  useCount?: number;
  lastUsedAt?: string;
  /** Visible to the whole organisation rather than only its author. */
  shared?: boolean;
  hospitalId?: string;
  orgId?: string;
}

/** Filters backing the Notes list in the chart. */
export interface NoteListFilters {
  patientId?: string;
  /** 'all' or a specific author/assignee id. */
  userId?: string;
  noteType?: NoteTypeId;
  /** Active hides nothing; signed/unsigned narrow by attestation state. */
  display?: 'active' | 'signed' | 'unsigned';
  sortBy?: 'service_date' | 'last_update';
}
