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
 * If a draft already exists for the same appointment, this reopens it instead
 * of starting a second one — clicking twice should not fork the record.
 */

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClinicalNote, listClinicalNotes, type CreateNoteInput } from './note-service';
import { getNoteType, type NoteTypeId } from './note-catalog';
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

/**
 * Reopen candidate: the existing draft against the same appointment, if any.
 *
 * Extracted from the hook body so the reopen-vs-fork decision is testable
 * without mounting React — the same reasoning as `noteTypeMenuOrder` in
 * `CreateNoteButton`. Pure: no I/O, just "given these notes, which (if any)
 * do we reopen."
 */
export function findReusableDraft(
  existingNotes: readonly ClinicalNoteDoc[],
  appointmentId?: string,
): ClinicalNoteDoc | undefined {
  if (!appointmentId) return undefined;
  return existingNotes.find(n => n.appointmentId === appointmentId && n.status === 'draft');
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
      // Reopen rather than fork: a second draft against one appointment splits
      // the encounter across two records.
      if (input.appointmentId) {
        const existing = await listClinicalNotes({ patientId: input.patientId }, scope);
        const draft = findReusableDraft(existing, input.appointmentId);
        if (draft) {
          if (navigate) router.push(`/notes/${draft._id}`);
          return draft;
        }
      }

      const note = await createClinicalNote(buildCreateNoteInput(input, currentUser, new Date()));

      if (navigate) router.push(`/notes/${note._id}`);
      return note;
    } finally {
      setCreating(false);
    }
  }, [currentUser, router, scope]);

  return { createNote, creating };
}
