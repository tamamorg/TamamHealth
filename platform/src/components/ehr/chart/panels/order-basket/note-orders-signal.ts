/**
 * The order basket opened from a note goes on top of it, and the drawer only
 * keeps the top workspace mounted — so the note editor is not there to hear
 * that its orders were signed. The basket leaves a mark here instead, and the
 * editor reads it when it comes back on top and brings its medication list
 * in line with the chart. In memory only: it carries no patient data, just
 * the note's id.
 */

const signedFor = new Set<string>();

export function markNoteOrdersSigned(noteId: string): void {
  signedFor.add(noteId);
}

/** True once per mark: reading it clears it. */
export function takeNoteOrdersSigned(noteId: string): boolean {
  return signedFor.delete(noteId);
}
