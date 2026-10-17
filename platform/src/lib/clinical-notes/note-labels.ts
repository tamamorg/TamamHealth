/**
 * Translated names for note types and sections.
 *
 * The catalog keeps English `label`s (they are stored nowhere, but pure data
 * must stay React- and locale-free). Screens route the label through here so
 * `noteEditor.type.<id>` / `noteEditor.section.<id>` can translate it; an id
 * with no key falls back to the catalog label rather than printing the key.
 */

import { getNoteType, getSectionLabel } from './note-catalog';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export function noteTypeLabel(t: Translate, typeId: string): string {
  const key = `noteEditor.type.${typeId}`;
  const text = t(key);
  return text !== key ? text : getNoteType(typeId).label;
}

export function sectionLabel(t: Translate, sectionId: string): string {
  const key = `noteEditor.section.${sectionId}`;
  const text = t(key);
  return text !== key ? text : getSectionLabel(sectionId);
}
