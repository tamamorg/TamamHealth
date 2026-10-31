'use client';

/**
 * Start a clinical note from wherever the clinician already is.
 *
 * The point of creating from an appointment rather than from a blank screen is
 * that the appointment already knows the patient, the provider, the date, the
 * time. Every one of those is a field the
 * clinician would otherwise re-enter, and re-entry is where mismatched notes
 * come from.
 *
 * If a draft already exists for the same visit, this reopens it instead of
 * starting a second one — clicking twice should not fork the record.
 */

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClinicalNote, listClinicalNotes, updateClinicalNote, type CreateNoteInput } from './note-service';
import { type NoteTypeId } from './note-catalog';
import { useDataScope } from '../hooks/useDataScope';
import type { ClinicalNoteDoc } from './types';
import { toIsoDate } from '@/lib/date-utils';

export interface CreateNoteFromVisitInput {
  patientId: string;
  patientName: string;
  mrn?: string;
  patientDob?: string;
  /** Defaults to SOAP. */
  noteType?: NoteTypeId;
  appointmentId?: string;
  encounterId?: string;
  serviceDate?: string;
  serviceTime?: string;
  assignedToId?: string;
  assignedToName?: string;
}

export interface CurrentUserLike {
  _id: string;
  name?: string;
  username?: string;
  hospitalId?: string;
  hospitalName?: string;
  orgId?: string;
}

export interface ReuseKeys {
  /** The visit the new note would document. */
  encounterId?: string;
  appointmentId?: string;
  /** When set, only a draft of this type is reused: a procedure note started
   *  mid-consultation is a second document, not the consultation reopened. */
  noteType?: NoteTypeId;
  /** Fallback for a draft not yet tied to any visit: reused only when it is
   *  the same author's, from the same day. */
  serviceDate?: string;
  authorId?: string;
}

/**
 * Reopen candidate: the open draft documenting the same visit, if any.
 *
 * Same visit means the same encounter, or the same appointment when either
 * side has not been linked to an encounter yet. Matching on the appointment
 * alone forked a second draft whenever a note was started from somewhere that
 * knows the visit but not the booking (the chart's Notes tab), so one visit
 * ended up with two "Consultation" rows a few minutes apart.
 *
 * Pure and exported so the reopen-vs-fork decision is testable without
 * mounting React. The newest draft wins when an older duplicate already exists.
 */
export function findReusableDraft(
  existingNotes: readonly ClinicalNoteDoc[],
  keys: ReuseKeys,
): ClinicalNoteDoc | undefined {
  const { encounterId, appointmentId, noteType, serviceDate, authorId } = keys;
  const sameVisit = (n: ClinicalNoteDoc): boolean => {
    if (encounterId && n.encounterId) return n.encounterId === encounterId;
    if (appointmentId && n.appointmentId === appointmentId) return true;
    if (n.encounterId || n.appointmentId) return false;
    // The draft was never tied to a visit (started before the visit existed,
    // or from a screen that did not know it): the same clinician's draft from
    // the same day is this visit's, and the caller links it on reopen.
    return Boolean(serviceDate && authorId)
      && n.serviceDate === serviceDate && n.authorId === authorId;
  };
  return existingNotes
    // A colleague's draft is theirs to finish (canEditDraft): never reopened for
    // someone else, who starts their own.
    .filter(n => !authorId || n.authorId === authorId || n.assignedToId === authorId)
    .filter(n => n.status === 'draft' && (!noteType || n.noteType === noteType) && sameVisit(n))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
}

/**
 * An explicit choice from the type dropdown always wins; SOAP is the fallback.
 */
export function resolveNoteTypeForCreate(
  input: Pick<CreateNoteFromVisitInput, 'noteType'>,
): NoteTypeId {
  return input.noteType ?? 'soap';
}

/**
 * Map a visit-context input plus the acting user into `note-service`'s create
 * payload. Pure and exported for the same testability reason as the two
 * helpers above — `now` is threaded in explicitly rather than read from
 * `Date.now()` internally, so a test can pin it.
 */
export function buildCreateNoteInput(
  input: CreateNoteFromVisitInput,
  currentUser: CurrentUserLike | null,
  now: Date,
): CreateNoteInput {
  const noteType = resolveNoteTypeForCreate(input);
  return {
    patientId: input.patientId,
    patientName: input.patientName,
    mrn: input.mrn,
    patientDob: input.patientDob,
    noteType,
    serviceDate: input.serviceDate || toIsoDate(now),
    serviceTime: input.serviceTime || now.toTimeString().slice(0, 5),
    appointmentId: input.appointmentId,
    encounterId: input.encounterId,
    assignedToId: input.assignedToId ?? currentUser?._id,
    assignedToName: input.assignedToName ?? currentUser?.name ?? currentUser?.username,
    authorId: currentUser?._id,
    authorName: currentUser?.name ?? currentUser?.username,
    hospitalId: currentUser?.hospitalId,
    hospitalName: currentUser?.hospitalName,
    orgId: currentUser?.orgId,
  };
}

/**
 * The one way to start a note from a screen, including a list's "Create note"
 * button. Resolves the visit's encounter, reopens an existing draft for the
 * same visit instead of forking a second, then creates and (by default)
 * navigates to `/notes/<id>`.
 *
 *   const { createNote, creating } = useCreateNote(currentUser);
 *   await createNote({ patientId, patientName, mrn, patientDob, noteType }, { navigate: false });
 *
 * `createNote(input: CreateNoteFromVisitInput, options?: { navigate?: boolean })`
 * resolves to the draft (new or reopened) or rejects on a write failure, so
 * callers show their own error. Pass `{ navigate: false }` to open the draft in
 * an in-page drawer instead of the standalone route.
 */
export function useCreateNote(currentUser: CurrentUserLike | null) {
  const router = useRouter();
  const scope = useDataScope();
  const [creating, setCreating] = useState(false);

  const createNote = useCallback(async (
    input: CreateNoteFromVisitInput,
    options: { navigate?: boolean } = {},
  ): Promise<ClinicalNoteDoc | null> => {
    const navigate = options.navigate ?? true;
    setCreating(true);
    try {
      let encounterId = input.encounterId;
      if (!encounterId && scope?.userId && scope.hospitalId && (!input.serviceDate || input.serviceDate === toIsoDate(new Date()))) {
        const { resolveNoteEncounter } = await import('@/modules/post-consult/services/note-encounter-service');
        encounterId = await resolveNoteEncounter(input.patientId, scope, input.appointmentId);
      }
      // Reopen rather than fork: a second draft for one visit splits the
      // encounter across two records.
      const createInput = buildCreateNoteInput({ ...input, encounterId }, currentUser, new Date());
      const existing = await listClinicalNotes({ patientId: input.patientId }, scope);
      const draft = findReusableDraft(existing, {
        encounterId,
        appointmentId: input.appointmentId,
        noteType: createInput.noteType,
        serviceDate: createInput.serviceDate,
        authorId: createInput.authorId,
      });
      if (draft) {
        const link: Pick<ClinicalNoteDoc, 'encounterId' | 'appointmentId'> = {};
        if (!draft.encounterId && encounterId) link.encounterId = encounterId;
        if (!draft.appointmentId && input.appointmentId) link.appointmentId = input.appointmentId;
        const linkedDraft = Object.keys(link).length > 0
          ? (await updateClinicalNote(draft._id, link)) ?? draft : draft;
        if (navigate) router.push(`/notes/${draft._id}`);
        return linkedDraft;
      }

      const note = await createClinicalNote(createInput);

      if (navigate) router.push(`/notes/${note._id}`);
      return note;
    } finally {
      setCreating(false);
    }
  }, [currentUser, router, scope]);

  return { createNote, creating };
}
