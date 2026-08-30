/**
 * Clinical note service — the write path for the notes module.
 *
 * Signing semantics follow `medical-record-service` deliberately: a signed note
 * is locked and corrected with an addendum, never edited in place. Attestation
 * is what makes a note admissible, so allowing a quiet edit after signature
 * would destroy the property the signature exists to create.
 *
 * The DB accessor is defined here rather than in `db.ts` to keep the module
 * self-contained; it uses the same `getDB` factory every other accessor does,
 * so the database is registered and synced identically.
 */

import { getDB } from '../db';
import { findByType } from '../services/db-query';
import { logAuditSafe } from '../services/audit-service';
import { emitSyncEvent } from '../services/sync-event-service';
import type { DataScope } from '../services/data-scope';
import { filterByScope } from '../services/data-scope';
import { isProviderRole } from '../clinical-roles';
import {
  getNoteType, resolveSections, isNoteTypeId,
  type NoteTypeId, type NoteSectionId,
} from './note-catalog';
import { stripTemplateMarkers } from './section-templates';
import type {
  ClinicalNoteDoc, NoteSectionContent, NoteListFilters, NoteAddendum, NotePlanAction,
} from './types';

export const clinicalNotesDB = () => getDB('tamamhealth_clinical_notes');

/** Thrown when an edit is attempted against a signed (locked) note. */
export class NoteLockedError extends Error {
  constructor(public readonly id: string) {
    super(`Clinical note ${id} is signed and locked; add an addendum instead of editing.`);
    this.name = 'NoteLockedError';
  }
}

export function isNoteLocked(note: Pick<ClinicalNoteDoc, 'status'>): boolean {
  return note.status === 'signed' || note.status === 'amended';
}

/**
 * Thrown when the acting user is not permitted to sign or co-sign a note.
 * Enforced here (not just in the UI) so the medico-legal attestation rule
 * can't be bypassed by another caller. Mirrors
 * `medical-record-service.SigningAuthorizationError`.
 */
export class NoteSigningAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoteSigningAuthorizationError';
  }
}

/**
 * A signature attests to an encounter the signer actually documented, so only
 * the note's author or its assignee may sign it as themselves. A user who
 * holds a provider role (doctor / clinical officer / clinician / medical
 * superintendent — see `clinical-roles.ts`) additionally has standing
 * attestation authority and may sign a note even when it was not explicitly
 * authored by or assigned to them (e.g. picking up an unassigned draft).
 * Anyone else — including workflow-station roles such as a rooming or triage
 * nurse who merely opened someone else's chart — may not.
 */
function canAttestNote(
  note: Pick<ClinicalNoteDoc, 'authorId' | 'assignedToId'>,
  signerId?: string,
  signerRole?: string,
): boolean {
  if (signerId && (signerId === note.authorId || signerId === note.assignedToId)) return true;
  return isProviderRole(signerRole);
}

function nowIso(): string {
  return new Date().toISOString();
}

function noteId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `note-${Date.now().toString(36)}-${rand}`;
}

/**
 * Whether an encounter parked on a parallel order loop still has real work
 * outstanding. Read ONLY when the encounter is at `awaiting_pharmacy` /
 * `awaiting_labs` / `awaiting_imaging` — a doctor signing the note while the
 * visit is genuinely still waiting on a prescription or a result must not
 * force the visit toward checkout. A lookup failure defaults to "still
 * outstanding": the safe direction is to leave the visit parked, never to
 * push it toward checkout on a guess.
 */
async function hasOutstandingParkedWork(
  status: 'awaiting_pharmacy' | 'awaiting_labs' | 'awaiting_imaging',
  encounterId: string,
  patientId: string,
): Promise<boolean> {
  try {
    if (status === 'awaiting_pharmacy') {
      const { getPrescriptionsByPatient } = await import('../services/prescription-service');
      const rxs = await getPrescriptionsByPatient(patientId);
      return rxs.some(rx =>
        rx.encounterId === encounterId && rx.status !== 'dispensed' && rx.status !== 'discontinued');
    }
    // awaiting_labs / awaiting_imaging: any test tied to this encounter that
    // has not yet resulted still blocks the move.
    const { getLabResultsByPatient } = await import('../services/lab-service');
    const labs = await getLabResultsByPatient(patientId);
    return labs.some(l => l.encounterId === encounterId && l.status !== 'completed');
  } catch {
    return true;
  }
}

/**
 * Raise a `disease_alert` for every notifiable diagnosis on a signed note
 * (KAN-?? — surveillance never fired from the notes module). `validateDiagnosisCodes`
 * was wired only into medical-record-service, a legacy consultation path no
 * browser UI writes to any more, so a notifiable diagnosis recorded through
 * the notes module — the path clinicians actually use — never reached
 * surveillance at all. Mirrors medical-record-service's
 * `raiseNotifiableDiseaseAlerts`; kept as its own copy here because the two
 * document shapes (coded Assessment-section diagnoses vs. MedicalRecordDoc's
 * flat `diagnoses`) differ and medical-record-service is a separate module
 * this fix's scope did not extend to refactoring.
 *
 * Best-effort by design: runs AFTER the note is durably signed, and a failure
 * here must never undo or fail the attestation.
 */
async function raiseNotifiableDiseaseAlertsFromNote(note: ClinicalNoteDoc): Promise<void> {
  try {
    const diagnoses = note.sections.flatMap(s => s.diagnoses ?? []);
    if (diagnoses.length === 0) return;

    const { validateDiagnosisCodes, lookupIcd11 } = await import('../clinical/diagnosis-validation');
    const { notifiableCodes, freeTextNotifiableMatches } = validateDiagnosisCodes(diagnoses);
    const codes = [...new Set([...notifiableCodes, ...freeTextNotifiableMatches.map(m => m.code)])];
    if (codes.length === 0) return;

    const { createAlert, getAlertsBySourceRecord } = await import('../services/surveillance-service');
    // One case per (note, code) — ever. Signing never re-fires (a signed note
    // is locked), but an addendum-driven re-check would land here too.
    const alreadyRaised = new Set(
      (await getAlertsBySourceRecord(note._id)).map(a => a.icd11Code || ''),
    );

    let state = '';
    let county = '';
    if (note.patientId) {
      try {
        const { getPatientById } = await import('../services/patient-service');
        const patient = await getPatientById(note.patientId);
        state = patient?.state || '';
        county = patient?.county || '';
      } catch { /* best-effort — try the facility next */ }
    }
    if (!state && note.hospitalId) {
      try {
        const { getHospitalById } = await import('../services/hospital-service');
        const hospital = await getHospitalById(note.hospitalId);
        state = hospital?.state || '';
        county = county || hospital?.county || '';
      } catch { /* best-effort — an alert without geography still counts nationally */ }
    }

    for (const code of codes) {
      if (alreadyRaised.has(code)) continue;
      const entry = lookupIcd11(code);
      if (!entry) continue;
      await createAlert({
        disease: entry.title,
        state,
        county,
        cases: 1,
        deaths: 0,
        alertLevel: 'watch',
        reportDate: new Date().toISOString(),
        trend: 'stable',
        orgId: note.orgId,
        hospitalId: note.hospitalId,
        patientId: note.patientId,
        icd11Code: entry.code,
        sourceRecordId: note._id,
      });
      alreadyRaised.add(code);
    }
  } catch (err) {
    console.warn('[clinical-notes] notifiable disease alert failed (note was signed):', err);
  }
}

/**
 * Clear the shared progress tracker for this visit (KAN-?? — "write-only
 * progress tracker"). `consultation_signed` is the milestone the tracker's own
 * catalog already defines as the completion trigger (`stageForMilestone`
 * routes it to 'completed'); nothing ever called it, so a signed, fully
 * closed-out consultation kept reading "in progress" in the notification feed
 * indefinitely. Best-effort and scoped to this note's own visit — a stale
 * tracker from an unrelated earlier episode must never be closed by this sign.
 *
 * Looked up by `{patientId, encounterId}` via `getConsultationProgressByEncounter`
 * rather than "the patient's most recently touched tracker": a note with no
 * encounterId of its own (or one whose visit never got a tracker at all — a
 * lab-only visit, say) has no tracker to close, and must close nothing rather
 * than reaching for a DIFFERENT encounter's tracker and marking a past,
 * unrelated consultation "completed" via a milestone that never happened.
 */
async function closeConsultationProgressForNote(note: ClinicalNoteDoc, actorId?: string): Promise<void> {
  if (!note.encounterId) return;
  try {
    const { getConsultationProgressByEncounter, updateProgressMilestone } = await import('../services/consultation-progress-service');
    const tracker = await getConsultationProgressByEncounter(note.patientId, note.encounterId);
    if (!tracker || tracker.currentStage === 'completed' || tracker.currentStage === 'cancelled') return;
    await updateProgressMilestone(tracker._id, 'consultation_signed', 'completed', { id: actorId });
  } catch {
    // A stale progress notification is a nuisance, not a safety issue.
  }
}

/** Newest first, by date of service then last update. */
function byServiceDate(a: ClinicalNoteDoc, b: ClinicalNoteDoc): number {
  const d = `${b.serviceDate}${b.serviceTime || ''}`.localeCompare(`${a.serviceDate}${a.serviceTime || ''}`);
  return d !== 0 ? d : (b.updatedAt || '').localeCompare(a.updatedAt || '');
}

function byLastUpdate(a: ClinicalNoteDoc, b: ClinicalNoteDoc): number {
  return (b.updatedAt || '').localeCompare(a.updatedAt || '');
}

export interface CreateNoteInput {
  patientId: string;
  patientName: string;
  mrn?: string;
  patientDob?: string;
  noteType: NoteTypeId;
  serviceDate: string;
  serviceTime?: string;
  assignedToId?: string;
  assignedToName?: string;
  appointmentId?: string;
  encounterId?: string;
  authorId?: string;
  authorName?: string;
  hospitalId?: string;
  hospitalName?: string;
  orgId?: string;
  /** Pre-filled sections, e.g. derived snapshots taken at creation. */
  sections?: NoteSectionContent[];
  amendsNoteId?: string;
}

/**
 * Start a note. Sections are seeded empty from the type's catalog so the editor
 * has a stable shape to render and autosave into from the first keystroke.
 */
export async function createClinicalNote(input: CreateNoteInput): Promise<ClinicalNoteDoc> {
  const db = clinicalNotesDB();
  const type = isNoteTypeId(input.noteType) ? input.noteType : 'soap';
  const def = getNoteType(type);
  const ts = nowIso();

  const provided = new Map((input.sections || []).map(s => [s.sectionId, s]));
  const sections: NoteSectionContent[] = resolveSections(type).map(
    id => provided.get(id) ?? { sectionId: id, text: '' },
  );

  const doc: ClinicalNoteDoc = {
    _id: noteId(),
    type: 'clinical_note',
    patientId: input.patientId,
    patientName: input.patientName,
    mrn: input.mrn,
    patientDob: input.patientDob,
    noteType: type,
    sections,
    serviceDate: input.serviceDate,
    serviceTime: input.serviceTime,
    assignedToId: input.assignedToId,
    assignedToName: input.assignedToName,
    appointmentId: input.appointmentId,
    encounterId: input.encounterId,
    status: 'draft',
    authorId: input.authorId,
    authorName: input.authorName,
    hospitalId: input.hospitalId,
    hospitalName: input.hospitalName,
    orgId: input.orgId,
    amendsNoteId: input.amendsNoteId,
    createdBy: input.authorId,
    createdAt: ts,
    updatedAt: ts,
  };

  const resp = await db.put(doc);
  emitSyncEvent({
    resourceType: 'clinical_note',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: resp.rev,
    orgId: doc.orgId,
    hospitalId: doc.hospitalId,
  });
  await logAuditSafe('CLINICAL_NOTE_CREATED', input.authorId, input.authorName,
    `${def.label} started for ${input.patientName} (${doc._id})`);
  return { ...doc, _rev: resp.rev };
}

/**
 * Fetch one note by id. `scope`, like the sibling reads below, is optional so
 * internal call sites within this module (which already trust the id they
 * hold) are unaffected — but any caller reaching in from outside with an
 * externally-supplied id (e.g. a URL param) should pass one so a note from
 * another org/facility resolves to "not found" rather than rendering.
 */
export async function getClinicalNoteById(id: string, scope?: DataScope): Promise<ClinicalNoteDoc | null> {
  try {
    const doc = await clinicalNotesDB().get(id) as ClinicalNoteDoc;
    if (scope && filterByScope([doc], scope).length === 0) return null;
    return doc;
  } catch {
    return null;
  }
}

/** Notes for one patient, newest first. */
export async function getNotesByPatient(
  patientId: string,
  scope?: DataScope,
): Promise<ClinicalNoteDoc[]> {
  const rows = await findByType<ClinicalNoteDoc>(
    clinicalNotesDB(), 'clinical_note', { patientId },
    { indexFields: ['type', 'patientId'] },
  );
  const scoped = scope ? filterByScope(rows, scope) : rows;
  return scoped.sort(byServiceDate);
}

/** The chart's Notes list, with the filter row applied. */
export async function listClinicalNotes(
  filters: NoteListFilters = {},
  scope?: DataScope,
): Promise<ClinicalNoteDoc[]> {
  const selector: Record<string, unknown> = {};
  if (filters.patientId) selector.patientId = filters.patientId;

  const rows = await findByType<ClinicalNoteDoc>(
    clinicalNotesDB(), 'clinical_note', selector,
    { indexFields: filters.patientId ? ['type', 'patientId'] : ['type'] },
  );
  const scoped = scope ? filterByScope(rows, scope) : rows;

  const filtered = scoped.filter((n) => {
    if (filters.noteType && n.noteType !== filters.noteType) return false;
    if (filters.userId && filters.userId !== 'all') {
      if (n.authorId !== filters.userId && n.assignedToId !== filters.userId) return false;
    }
    if (filters.display === 'signed' && n.status !== 'signed' && n.status !== 'amended') return false;
    if (filters.display === 'unsigned' && (n.status === 'signed' || n.status === 'amended')) return false;
    return true;
  });

  return filtered.sort(filters.sortBy === 'last_update' ? byLastUpdate : byServiceDate);
}

/** Unsigned notes for the signing queue on a clinician's dashboard. */
export async function getUnsignedNotes(
  userId?: string,
  scope?: DataScope,
): Promise<ClinicalNoteDoc[]> {
  const rows = await listClinicalNotes({ display: 'unsigned', userId }, scope);
  return rows;
}

/**
 * Save an in-progress note. Rejects once signed — a locked note is corrected
 * with {@link addNoteAddendum}, which preserves the original attestation.
 */
export async function updateClinicalNote(
  id: string,
  patch: Partial<Omit<ClinicalNoteDoc, '_id' | 'type' | 'status'>>,
): Promise<ClinicalNoteDoc | null> {
  const db = clinicalNotesDB();
  let existing: ClinicalNoteDoc;
  try {
    existing = await db.get(id) as ClinicalNoteDoc;
  } catch {
    return null;
  }
  if (isNoteLocked(existing)) throw new NoteLockedError(id);

  const updated: ClinicalNoteDoc = { ...existing, ...patch, updatedAt: nowIso() };
  const resp = await db.put(updated);
  emitSyncEvent({
    resourceType: 'clinical_note',
    resourceId: id,
    operation: 'update',
    resourceVersion: resp.rev,
    orgId: updated.orgId,
    hospitalId: updated.hospitalId,
  });
  return { ...updated, _rev: resp.rev };
}

/** Write one section's content — the autosave path the editor calls. */
export async function saveNoteSection(
  id: string,
  sectionId: NoteSectionId,
  content: Partial<NoteSectionContent>,
): Promise<ClinicalNoteDoc | null> {
  const existing = await getClinicalNoteById(id);
  if (!existing) return null;
  if (isNoteLocked(existing)) throw new NoteLockedError(id);

  const sections = [...existing.sections];
  const idx = sections.findIndex(s => s.sectionId === sectionId);
  if (idx >= 0) sections[idx] = { ...sections[idx], ...content, sectionId };
  else sections.push({ sectionId, ...content });

  return updateClinicalNote(id, { sections });
}

/** Add an optional section from the "Add Optional" menu. */
export async function addNoteSection(
  id: string,
  sectionId: NoteSectionId,
): Promise<ClinicalNoteDoc | null> {
  const existing = await getClinicalNoteById(id);
  if (!existing) return null;
  if (isNoteLocked(existing)) throw new NoteLockedError(id);
  if (existing.sections.some(s => s.sectionId === sectionId)) return existing;

  const addedSections = [...(existing.addedSections || []), sectionId];
  const order = resolveSections(existing.noteType, addedSections);
  const bySection = new Map(existing.sections.map(s => [s.sectionId, s]));
  bySection.set(sectionId, { sectionId, text: '' });
  const sections = order
    .map(sid => bySection.get(sid) ?? { sectionId: sid, text: '' });

  return updateClinicalNote(id, { addedSections, sections });
}

/** Remove a section the clinician added. Default sections cannot be removed. */
export async function removeNoteSection(
  id: string,
  sectionId: NoteSectionId,
): Promise<ClinicalNoteDoc | null> {
  const existing = await getClinicalNoteById(id);
  if (!existing) return null;
  if (isNoteLocked(existing)) throw new NoteLockedError(id);

  const def = getNoteType(existing.noteType);
  if (def.sections.includes(sectionId)) return existing;   // not removable

  return updateClinicalNote(id, {
    addedSections: (existing.addedSections || []).filter(s => s !== sectionId),
    sections: existing.sections.filter(s => s.sectionId !== sectionId),
  });
}

/**
 * Switch note type, preserving any text already written.
 *
 * Sections the new type does not define are kept when they hold content — they
 * become "added" sections. Discarding documented narrative because the
 * clinician picked the wrong type first would be a records-integrity problem.
 */
export async function changeNoteType(
  id: string,
  noteType: NoteTypeId,
): Promise<ClinicalNoteDoc | null> {
  const existing = await getClinicalNoteById(id);
  if (!existing) return null;
  if (isNoteLocked(existing)) throw new NoteLockedError(id);

  const def = getNoteType(noteType);
  const withContent = existing.sections.filter(
    s => (s.text || '').trim().length > 0 && !def.sections.includes(s.sectionId),
  );
  const addedSections = withContent.map(s => s.sectionId);
  const order = resolveSections(noteType, addedSections);
  const bySection = new Map(existing.sections.map(s => [s.sectionId, s]));
  const sections = order.map(sid => bySection.get(sid) ?? { sectionId: sid, text: '' });

  return updateClinicalNote(id, {
    noteType,
    addedSections,
    sections,
  });
}

/** Clear every narrative section, leaving the note's identity intact. */
export async function clearNote(id: string): Promise<ClinicalNoteDoc | null> {
  const existing = await getClinicalNoteById(id);
  if (!existing) return null;
  if (isNoteLocked(existing)) throw new NoteLockedError(id);
  return updateClinicalNote(id, {
    sections: existing.sections.map(s => ({ sectionId: s.sectionId })),
  });
}

export interface SignNoteInput {
  signedBy: string;
  signedByName: string;
  /**
   * Acting user's role. Checked against attestation authority when the
   * signer is neither the note's author nor its assignee — see
   * {@link canAttestNote}.
   */
  signerRole?: string;
  /** Trainee signature that still needs a supervisor's countersignature. */
  awaitingCosign?: boolean;
}

/**
 * Attest the note. Refuses an empty note: a signature asserts that the content
 * is a true record, and there is nothing to assert about a blank document.
 *
 * Also refuses a signer who is neither the note's author/assignee nor holding
 * a provider role — without this, any role with `/notes` route access could
 * open and sign a colleague's draft, permanently attesting to an examination
 * they never performed (correctable only by addendum thereafter).
 */
export async function signClinicalNote(
  id: string,
  input: SignNoteInput,
): Promise<ClinicalNoteDoc | null> {
  const db = clinicalNotesDB();
  let existing: ClinicalNoteDoc;
  try {
    existing = await db.get(id) as ClinicalNoteDoc;
  } catch {
    return null;
  }
  if (isNoteLocked(existing)) throw new NoteLockedError(id);
  if (!canAttestNote(existing, input.signedBy, input.signerRole)) {
    throw new NoteSigningAuthorizationError(
      `${input.signedByName || 'This user'} may not sign note ${id} — only its author, its assignee, ` +
      'or a user holding a provider role may attest it.',
    );
  }
  if (!hasContent(existing)) {
    throw new Error('Cannot sign an empty note — document the encounter first.');
  }

  const ts = nowIso();
  const updated: ClinicalNoteDoc = {
    ...existing,
    status: input.awaitingCosign ? 'awaiting_cosign' : 'signed',
    signedBy: input.signedBy,
    signedByName: input.signedByName,
    signedAt: ts,
    updatedAt: ts,
  };
  const resp = await db.put(updated);
  emitSyncEvent({
    resourceType: 'clinical_note',
    resourceId: id,
    operation: 'update',
    resourceVersion: resp.rev,
    orgId: updated.orgId,
    hospitalId: updated.hospitalId,
  });
  await logAuditSafe('CLINICAL_NOTE_SIGNED', input.signedBy, input.signedByName,
    `${getNoteType(existing.noteType).label} signed for ${existing.patientName} (${id})`);

  // Signing the note is what ends the consultation, so it is what moves the
  // visit on. Without this the encounter sat at `with_clinician` for good: the
  // clinic-checkout queue stayed empty, `dischargeEncounter` had no legal walk,
  // and the stale open visit absorbed the patient's next arrival.
  //
  // Deliberately narrow. Only a note that names its encounter, and only for a
  // full sign — a note parked in `awaiting_cosign` is not finished
  // documentation. A nurse note or an addendum written alongside the visit
  // therefore cannot close it.
  //
  // Best-effort: the signature is the clinical act and must stand even if the
  // visit thread cannot be advanced.
  if (existing.encounterId && !input.awaitingCosign) {
    try {
      const { getEncounter, transitionEncounter } = await import('../services/encounter-service');
      const encounter = await getEncounter(existing.encounterId);
      if (encounter?.status === 'with_clinician') {
        await transitionEncounter(existing.encounterId, 'ready_for_clinic_checkout', {
          actorId: input.signedBy,
        });
      } else if (
        encounter
        && (encounter.status === 'awaiting_pharmacy' || encounter.status === 'awaiting_labs' || encounter.status === 'awaiting_imaging')
        && !(await hasOutstandingParkedWork(encounter.status, existing.encounterId, existing.patientId))
      ) {
        // The clinician prescribed/ordered before signing, which already
        // parked the visit away from `with_clinician` (see
        // prescription-service.parkVisitAtPharmacy / ensureLabOrderEncounter) —
        // so the branch above never fires for the commonest "prescribe then
        // sign" sequence. Every one of these three statuses has a direct,
        // legal edge to `ready_for_clinic_checkout` (encounter-journey.ts); it
        // is only taken here once the parked work has actually resolved, so a
        // genuinely outstanding prescription or result still leaves the visit
        // parked exactly as the architecture document intends.
        await transitionEncounter(existing.encounterId, 'ready_for_clinic_checkout', {
          actorId: input.signedBy,
        });
      }
    } catch {
      // Leave the visit where it is; the desk can move it by hand.
    }
  }

  if (!input.awaitingCosign) {
    await raiseNotifiableDiseaseAlertsFromNote(updated);
    await closeConsultationProgressForNote(updated, input.signedBy);
  }

  return { ...updated, _rev: resp.rev };
}

/**
 * Countersign a trainee's note. Requires a supervising provider role — that
 * is the entire point of a co-signature — and, when the original signer's id
 * is known, requires the co-signer to be someone else: a note cannot be its
 * own supervision.
 */
export async function cosignClinicalNote(
  id: string,
  cosignedBy: string,
  cosignedByName: string,
  cosignerRole?: string,
): Promise<ClinicalNoteDoc | null> {
  const db = clinicalNotesDB();
  let existing: ClinicalNoteDoc;
  try {
    existing = await db.get(id) as ClinicalNoteDoc;
  } catch {
    return null;
  }
  if (existing.status !== 'awaiting_cosign') return existing;
  if (!isProviderRole(cosignerRole)) {
    throw new NoteSigningAuthorizationError(
      `${cosignedByName || 'This user'} may not co-sign note ${id} — co-signature requires a supervising provider role.`,
    );
  }
  if (cosignedBy && existing.signedBy && cosignedBy === existing.signedBy) {
    throw new NoteSigningAuthorizationError('A note must be co-signed by a different provider than the one who signed it.');
  }

  const ts = nowIso();
  const updated: ClinicalNoteDoc = {
    ...existing, status: 'signed', cosignedBy, cosignedByName, cosignedAt: ts, updatedAt: ts,
  };
  const resp = await db.put(updated);
  await logAuditSafe('CLINICAL_NOTE_COSIGNED', cosignedBy, cosignedByName,
    `Note ${id} countersigned for ${existing.patientName}`);
  return { ...updated, _rev: resp.rev };
}

/**
 * Append an attested correction to a signed note. The original text is never
 * altered — an inspector sees both the record and its correction.
 */
export async function addNoteAddendum(
  id: string,
  text: string,
  authorId: string,
  authorName: string,
): Promise<ClinicalNoteDoc | null> {
  const db = clinicalNotesDB();
  let existing: ClinicalNoteDoc;
  try {
    existing = await db.get(id) as ClinicalNoteDoc;
  } catch {
    return null;
  }
  if (!isNoteLocked(existing)) {
    throw new Error('Addenda apply to signed notes; edit the draft instead.');
  }
  const body = (text || '').trim();
  if (!body) throw new Error('An addendum needs text.');

  const ts = nowIso();
  const addendum: NoteAddendum = {
    id: `add-${Date.now().toString(36)}`,
    text: body, authorId, authorName, createdAt: ts,
  };
  const updated: ClinicalNoteDoc = {
    ...existing,
    status: 'amended',
    addenda: [...(existing.addenda || []), addendum],
    updatedAt: ts,
  };
  const resp = await db.put(updated);
  await logAuditSafe('CLINICAL_NOTE_AMENDED', authorId, authorName,
    `Addendum added to note ${id} for ${existing.patientName}`);
  return { ...updated, _rev: resp.rev };
}

/** Record an order or action raised from the Plan section. */
export async function recordPlanAction(
  id: string,
  action: Omit<NotePlanAction, 'id' | 'createdAt'>,
): Promise<ClinicalNoteDoc | null> {
  const existing = await getClinicalNoteById(id);
  if (!existing) return null;
  if (isNoteLocked(existing)) throw new NoteLockedError(id);

  const entry: NotePlanAction = {
    ...action,
    id: `pa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: nowIso(),
  };
  return updateClinicalNote(id, { planActions: [...(existing.planActions || []), entry] });
}

/**
 * SALT — "same as last time". Copy the previous note's narrative forward into a
 * new draft so a follow-up starts from what was true last visit.
 *
 * Copies narrative only. Derived snapshots (vitals, medications, allergies) are
 * deliberately left empty so the new note takes today's chart values rather
 * than silently repeating stale observations as if freshly taken.
 */
export async function copyNoteForward(
  sourceId: string,
  input: Omit<CreateNoteInput, 'sections' | 'noteType'> & { noteType?: NoteTypeId },
): Promise<ClinicalNoteDoc | null> {
  const source = await getClinicalNoteById(sourceId);
  if (!source) return null;

  const noteType = input.noteType ?? source.noteType;
  const carried = source.sections
    .filter(s => (s.text || '').trim().length > 0)
    .map(s => ({
      sectionId: s.sectionId,
      text: s.text,
      templateSelection: s.templateSelection,
    }));

  const created = await createClinicalNote({ ...input, noteType, sections: carried });
  const addedSections = carried
    .map(s => s.sectionId)
    .filter(sid => !getNoteType(noteType).sections.includes(sid));

  const patch: Partial<ClinicalNoteDoc> = { copiedFromId: sourceId };
  if (addedSections.length > 0) {
    const order = resolveSections(noteType, addedSections);
    const bySection = new Map(created.sections.map(s => [s.sectionId, s]));
    for (const s of carried) bySection.set(s.sectionId, s);
    patch.addedSections = addedSections;
    patch.sections = order.map(sid => bySection.get(sid) ?? { sectionId: sid, text: '' });
  }
  return updateClinicalNote(created._id, patch);
}

/** Any narrative at all — used by the signing guard and list previews. */
export function hasContent(note: Pick<ClinicalNoteDoc, 'sections'>): boolean {
  return note.sections.some(s => stripTemplateMarkers(s.text || '').trim().length > 0);
}

/** First line of narrative, for the note card in the list. */
export function notePreview(note: ClinicalNoteDoc, max = 120): string {
  for (const section of note.sections) {
    const text = stripTemplateMarkers(section.text || '').replace(/\s+/g, ' ').trim();
    if (text) return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }
  return 'No content yet';
}

export async function deleteClinicalNote(id: string, userName?: string): Promise<boolean> {
  const db = clinicalNotesDB();
  try {
    const existing = await db.get(id) as ClinicalNoteDoc;
    if (isNoteLocked(existing)) throw new NoteLockedError(id);
    await db.remove({ _id: existing._id, _rev: existing._rev! });
    await logAuditSafe('CLINICAL_NOTE_DELETED', undefined, userName,
      `Draft note ${id} deleted for ${existing.patientName}`);
    return true;
  } catch (err) {
    if (err instanceof NoteLockedError) throw err;
    return false;
  }
}
