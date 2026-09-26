import { clinicalNotesDB } from '@/lib/clinical-notes/note-service';
import { emitSyncEvent } from '@/lib/services/sync-event-service';
import { canUseScribe, isScribeSection, type ScribeSuggestion } from '../core/contracts';
import type { ClinicalNoteDoc } from '@/lib/clinical-notes/types';

/** One revision-checked local write; no read/merge retry which could overwrite a concurrent edit. */
export async function applyScribeSuggestion(noteId: string, revision: string, section: string, suggestion: ScribeSuggestion,
  actor: { _id: string; role?: string; orgId?: string; hospitalId?: string }) {
  const db = clinicalNotesDB(); const note = await db.get(noteId) as ClinicalNoteDoc;
  if (!isScribeSection(section) || !canUseScribe(actor, note) || !actor.hospitalId || actor.hospitalId !== note.hospitalId) throw new Error('forbidden');
  if (note._rev !== revision || !note.sections.some(s => s.sectionId === section)) throw new Error('stale_note');
  if (!suggestion.text.trim() || suggestion.text.length > 12000) throw new Error('invalid_output');
  const updatedAt = new Date().toISOString();
  const updated = { ...note, updatedAt, sections: note.sections.map(s => s.sectionId === section ? { ...s, text: suggestion.text,
    aiAssistance: { requestId: suggestion.requestId, model: suggestion.model, promptVersion: suggestion.promptVersion, reviewedBy: actor._id, reviewedAt: updatedAt } } : s) };
  const result = await db.put(updated);
  emitSyncEvent({ resourceType: 'clinical_note', resourceId: noteId, operation: 'update', resourceVersion: result.rev, orgId: note.orgId, hospitalId: note.hospitalId });
  return { ...updated, _rev: result.rev };
}
