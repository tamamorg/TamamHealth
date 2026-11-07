import { useCallback, useState } from 'react';

/**
 * Which popup or slider is open over the note. Replaces twelve independent
 * `showX` booleans: each is a modal over the note, so one slot is enough.
 */
export type NotePanel =
  | 'addOptional' | 'signConfirm' | 'addendum' | 'coordination' | 'medications'
  | 'problems' | 'allergies' | 'history' | 'vitals' | 'prescribe' | 'labOrder'
  | 'followUp' | 'patientEducation';

export function useNotePanel() {
  const [panel, setPanel] = useState<NotePanel | null>(null);
  const open = useCallback((next: NotePanel) => setPanel(next), []);
  /** Closes `which` only if it is the one showing, like `setShowX(false)` did. */
  const close = useCallback((which: NotePanel) => setPanel(cur => (cur === which ? null : cur)), []);
  const is = (which: NotePanel) => panel === which;
  /** Any popup other than the sign confirmation (keyboard shortcuts yield to these). */
  const otherThanSignOpen = panel !== null && panel !== 'signConfirm';
  return { panel, open, close, is, otherThanSignOpen };
}
