/**
 * Restricted clinical-note access.
 *
 * Some clinical-note types are more sensitive than the chart's ordinary
 * canViewClinical gate should expose — a mental-health (PHQ) assessment is
 * visible to every clinician today, which the 2026-11-05 security audit (H4)
 * flagged. These notes stay in the ordinary clinical_notes store (they are
 * part of the record and replicate like any note), but their READ is narrowed
 * to a routine-access set, mirroring the break-glass policy already enforced by
 * /api/restricted-mental-health-notes for the separate server-only store:
 *
 *   routine access = super_admin | medical_superintendent | a psychiatry
 *   clinician, PLUS the note's own author (never locked out of their own note).
 *
 * This is a minimum-necessary read gate at the service layer (the same layer
 * filterByScope works at), consistent with how every clinical note is gated by
 * role in this app — not cryptographic isolation. Truly isolated notes belong
 * in the server-only restricted store (modules/specialty-care).
 *
 * Extend RESTRICTED_CLINICAL_NOTE_TYPES as new sensitive note types are added
 * (e.g. HIV status, GBV/safeguarding, substance-use), none of which exist as a
 * note type today.
 */
import type { DataScope } from '../services/data-scope';

export const RESTRICTED_CLINICAL_NOTE_TYPES: ReadonlySet<string> = new Set([
  'mental_health',
]);

export function isRestrictedNoteType(noteType?: string): boolean {
  return !!noteType && RESTRICTED_CLINICAL_NOTE_TYPES.has(noteType);
}

/**
 * May this viewer read this note? Non-restricted notes are always allowed here
 * (tenancy is enforced separately by filterByScope). A missing scope means a
 * server/internal caller that is already gated upstream, so it is not narrowed.
 */
export function mayViewRestrictedClinicalNote(
  scope: DataScope | undefined,
  note: { noteType?: string; authorId?: string },
): boolean {
  if (!isRestrictedNoteType(note.noteType)) return true;
  if (!scope) return true;
  if (scope.role === 'super_admin' || scope.role === 'medical_superintendent') return true;
  if (scope.specialtyCode === 'psychiatry') return true;
  if (scope.userId && note.authorId && scope.userId === note.authorId) return true;
  return false;
}
