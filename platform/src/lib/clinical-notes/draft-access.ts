/**
 * Who may change a saved draft: the clinician who wrote it, the one it is
 * assigned to, and those who oversee documentation. Everyone else reads it
 * locked. Whether the role may write notes at all is the caller's `canConsult`.
 */

import type { ClinicalNoteDoc } from './types';
import type { MedicalRecordDoc } from '@/lib/db-types';

const DRAFT_OVERSIGHT_ROLES = new Set(['super_admin', 'medical_superintendent']);

export function canEditDraft(
  note: Pick<ClinicalNoteDoc, 'authorId' | 'assignedToId'>,
  user: { _id?: string; role?: string } | null | undefined,
): boolean {
  if (!user?._id) return false;
  return note.authorId === user._id
    || note.assignedToId === user._id
    || DRAFT_OVERSIGHT_ROLES.has(user.role || '');
}

/**
 * The same rule for a draft consultation record, whose author is `consultedBy`.
 * Referral intakes the system writes name nobody, so they stay with every
 * clinician who may author records.
 */
export function canEditRecordDraft(
  record: Pick<MedicalRecordDoc, 'consultedBy'>,
  user: { _id?: string; role?: string } | null | undefined,
): boolean {
  return !record.consultedBy || canEditDraft({ authorId: record.consultedBy }, user);
}
