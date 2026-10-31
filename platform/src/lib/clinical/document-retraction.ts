/**
 * Who may retract a document from a patient's chart.
 *
 * Nothing filed is erased: a retraction marks the document entered in error,
 * takes it out of normal views and keeps the original, as AHIMA's amendments
 * guidance sets out ("Amendments in the Electronic Health Record Toolkit":
 * retraction, not deletion, and policy must say who). So the rule is narrower
 * than who may FILE a document, which every registration and nursing role can:
 * the person who filed it, a clinician, or the records office that keeps the
 * legal record. A front-desk clerk cannot take a colleague's clinical letter
 * off a chart.
 */

import { CLINICIANS } from '@/lib/sync/write-permissions';
import type { UserRole } from '@/lib/db-types';

export const DOCUMENT_RECORDS_ROLES: readonly UserRole[] = ['records_hmis_officer', 'hrio'];

export function canRetractDocument(
  actor: { id?: string; role?: string } | undefined,
  doc: { uploadedById?: string },
): boolean {
  if (!actor?.role) return false;
  if (actor.id && doc.uploadedById === actor.id) return true;
  return ([...CLINICIANS, ...DOCUMENT_RECORDS_ROLES] as readonly string[]).includes(actor.role);
}

/** Who sees that a document was retracted, and why. */
export function canSeeRetractedDocuments(role?: string): boolean {
  return !!role && ([...CLINICIANS, ...DOCUMENT_RECORDS_ROLES, 'nurse', 'midwife'] as readonly string[]).includes(role);
}
